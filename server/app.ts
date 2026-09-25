import express from 'express';
import {Webhook} from 'svix';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import multer from 'multer';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import path from 'node:path';
import {db,now,production} from './db.js';
import {auth,admin,fail,hash,token,passwordHash,passwordValid,publicUser,session,accessible,rateLimit,signDownload} from './auth.js';
import {queue,appURL,applicable,schedule} from './notifications.js';
import * as storage from './storage.js';
const statuses=['New','Under Review','In Progress','Ready for Retest','Closed','Reopened','Needs Information','Deferred','Duplicate'] as const;
const url=z.union([z.literal(''),z.url().refine(v=>/^https?:\/\//i.test(v),'Use an HTTP or HTTPS URL.')]).default('');
const text=z.string().trim().max(15000).default('');
const issueInput=z.object({project_id:z.uuid(),type:z.enum(['Bug','Improvement']),title:z.string().trim().min(3).max(180),description:z.string().trim().min(10).max(15000),steps:text,expected:text,actual:text,reason:text,desired:text,notes:text,url,environment:z.enum(['development','staging','production']),build:z.string().max(100).default(''),severity:z.enum(['Low','Medium','High','Critical']),device:z.string().max(1000).default(''),attachments:z.array(z.uuid()).max(5).default([]),idempotency_key:z.uuid()}).superRefine((v,c)=>{for(const key of v.type==='Bug'?['steps','expected','actual']:['reason','desired'])if(!(v as any)[key])c.addIssue({code:'custom',path:[key],message:'This field is required.'});});
async function audit(q:any,user:any,action:string,detail:string){await q('audit').insert({id:randomUUID(),user_id:user.id,action,detail,created_at:now()});}
async function activity(q:any,i:any,u:any,action:string,detail:string,internal=false){await q('activity').insert({id:randomUUID(),issue_id:i.id,user_id:u.id,action,detail,internal,created_at:now()});}
async function attach(q:any,ids:string[],issueId:string,userId:string){if(!ids.length)return;const files=await q('attachments').whereIn('id',ids).where({user_id:userId}).whereNull('issue_id');if(files.length!==new Set(ids).size)throw fail(400,'An attachment is unavailable. Please upload it again.');const bound=await q('attachments').whereIn('id',ids).where({user_id:userId}).whereNull('issue_id').update({issue_id:issueId});if(bound!==new Set(ids).size)throw fail(409,'An upload was already attached. Please refresh.');}
export function createApp(){
 const app=express();app.disable('x-powered-by');app.set('trust proxy',Number(process.env.TRUST_PROXY_HOPS||0));app.use(helmet({contentSecurityPolicy:production?undefined:false}));app.post('/api/provider/resend',express.raw({type:'application/json',limit:'100kb'}),async(req,res)=>{
 if(!process.env.RESEND_WEBHOOK_SECRET)throw fail(503,'Delivery webhook is not configured.');
 let event:any;try{event=new Webhook(process.env.RESEND_WEBHOOK_SECRET).verify(req.body.toString('utf8'),{'svix-id':req.get('svix-id')||'','svix-timestamp':req.get('svix-timestamp')||'','svix-signature':req.get('svix-signature')||''});}catch{throw fail(401,'Invalid webhook signature.');}
 if(['email.delivered','email.bounced'].includes(event.type)&&typeof event.data?.email_id==='string'){
 const state=event.type==='email.delivered'?'delivered':'bounced';
 await db('deliveries').where({provider_id:event.data.email_id}).whereIn('state',state==='bounced'?['provider-accepted','delivered']:['provider-accepted']).update({state,updated_at:now()});}
 res.json({ok:true});
 });app.use(express.json({limit:'100kb'}));app.use(cookieParser());
 app.use('/api',async(req,res,next)=>{try{res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!req.path.startsWith('/integration/')){const origin=req.get('origin');if(origin&&origin!==new URL(appURL()).origin)throw fail(403,'Request origin is not allowed.');if(!req.get('x-helm-request'))throw fail(403,'Missing request protection header.');}await rateLimit(`api:${req.ip}`,600,1);next();}catch(e){next(e);}});
 app.get('/api/health',async(req,res)=>{await db.raw('select 1');res.json({ok:true,mode:production?'production':'local'});});
 app.get('/api/auth/me',auth,(req,res)=>res.json({user:publicUser((req as any).user),mode:production?'production':'local'}));
 app.post('/api/auth/login',async(req,res)=>{await rateLimit(`login:${req.ip}`,15,15);const data=z.object({email:z.email().max(254),password:z.string().max(256)}).parse(req.body);const u=await db('users').where({email:data.email.toLowerCase()}).first();const valid=passwordValid(data.password,u?.password_hash||passwordHash('invalid-placeholder-password'));if(!u||!valid||!u.active||!u.verified)throw fail(401,'Email or password is incorrect.');await session(res,u.id);res.json({user:publicUser(u)});});
 app.post('/api/auth/logout',auth,async(req,res)=>{await db('sessions').where({id:hash(req.cookies.helm_session)}).delete();res.clearCookie('helm_session',{path:'/'});res.json({ok:true});});
 app.post('/api/auth/accept-invite',async(req,res)=>{await rateLimit(`invite:${req.ip}`,15,15);const d=z.object({token:z.string().length(64),name:z.string().trim().min(2).max(100),password:z.string().min(12).max(256)}).parse(req.body);let uid='';await db.transaction(async q=>{const i=await q('invites').where({id:hash(d.token),used:false}).where('expires_at','>',now()).first();if(!i)throw fail(400,'Invitation expired or already used. Ask your admin for another invitation.');const changed=await q('invites').where({id:i.id,used:false}).update({used:true});if(!changed)throw fail(409,'Invitation already used.');uid=i.user_id;await q('users').where({id:uid}).update({name:d.name,password_hash:passwordHash(d.password),verified:true});});await session(res,uid);res.json({ok:true});});
   // ── Guest (no-login) endpoints ──────────────────────────────────────────
  const guestUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
  app.post('/api/guest/upload',guestUpload.single('file'),async(req,res)=>{
    if(!req.file)throw fail(400,'Choose a screenshot.');
    const bytes=await storage.validateImage(req.file.buffer,req.file.mimetype);
    const id=randomUUID();
    await storage.put(id,bytes,req.file.mimetype);
    try{await db('attachments').insert({id,user_id:null,name:path.basename(req.file.originalname).slice(0,200),mime:req.file.mimetype,size:bytes.length,storage_key:id,created_at:now()});}
    catch(e){await storage.remove(id);throw e;}
    res.status(201).json({id,name:req.file.originalname,size:bytes.length});
  });
  app.post('/api/guest/submit',async(req,res)=>{
    await rateLimit('guest:'+req.ip,20,60);
    const d=z.object({
      reporter_name:z.string().trim().min(2).max(100),
      reporter_role:z.enum(['tester','developer']).default('tester'),
      issue:z.string().trim().min(5).max(15000),
      expected:z.string().trim().max(15000).default(''),
      assigned_to:z.string().trim().max(100).default(''),
      assigned_role:z.enum(['tester','developer','']).default(''),
      type:z.enum(['Bug','Improvement','Question']).default('Bug'),
      project_id:z.string().optional(),
      attachments:z.array(z.uuid()).max(5).default([]),
      idempotency_key:z.uuid(),
    }).parse(req.body);
    let guestUser=await db('users').where({email:'guest@helm.local'}).first();
    if(!guestUser){
      const gid=randomUUID();
      await db('users').insert({id:gid,email:'guest@helm.local',name:'Guest',role:'tester',password_hash:'',verified:true,active:true,created_at:now()});
      guestUser=await db('users').where({id:gid}).first();
      const firstProject=await db('projects').where({active:true}).first();
      if(firstProject)await db('memberships').insert({project_id:firstProject.id,user_id:gid}).onConflict(['project_id','user_id']).ignore();
    }
    const existing=await db('issues').where({reporter_id:guestUser.id,idempotency_key:d.idempotency_key}).first();
    if(existing)return res.json(existing);
    const project=(d.project_id ? await db('projects').where({id:d.project_id,active:true}).first() : null) || await db('projects').where({active:true}).first();
    if(!project)throw fail(503,'No active project found. Ask an admin to create one.');
    let saved;
    await db.transaction(async q=>{
      if(d.attachments.length){
        const files=await q('attachments').whereIn('id',d.attachments).whereNull('issue_id');
        if(files.length!==new Set(d.attachments).size)throw fail(400,'An attachment is unavailable. Please upload it again.');
      }
      const title='['+d.reporter_name+'] '+d.issue.slice(0,160);
      const [i]=await q('issues').insert({
        id:randomUUID(),project_id:project.id,reporter_id:guestUser.id,
        type:d.type,title:title.slice(0,180),
        description:d.issue,steps:'',expected:d.expected,actual:'',
        reason:'',desired:'',notes:'',url:'',environment:'staging',
        build:'',severity:'Medium',priority:'Medium',category:'General',
        status:'New',version:1,cycle:0,archived:false,
        assigned_to:d.assigned_to,assigned_role:d.assigned_role,
        device:'Submitted by '+d.reporter_name+' ('+d.reporter_role+')',
        idempotency_key:d.idempotency_key,
        created_at:now(),updated_at:now(),
      }).returning('*');
      const prefix = d.type === 'Improvement' ? 'IMP-' : d.type === 'Question' ? 'QST-' : 'BUG-';
      i.reference = prefix + String(i.number).padStart(6, '0');
      await q('issues').where({id:i.id}).update({reference:i.reference});
      if(d.attachments.length)await q('attachments').whereIn('id',d.attachments).whereNull('issue_id').update({issue_id:i.id,user_id:guestUser.id});
      const submitDetail=d.assigned_to?'Submitted by '+d.reporter_name+' ('+d.reporter_role+') · Assigned to '+d.assigned_to+' ('+d.assigned_role+')':'Submitted by '+d.reporter_name+' ('+d.reporter_role+')';
      await q('activity').insert({id:randomUUID(),issue_id:i.id,user_id:guestUser.id,action:d.reporter_name+' ('+d.reporter_role+')',detail:submitDetail,internal:false,created_at:now()});
      saved=i;
    });
    res.status(201).json(saved);
  });
  app.get('/api/guest/projects',async(req,res)=>{
    const list = await db('projects').where({active:true}).select('id','name','description');
    res.json(list);
  });
  app.get('/api/guest/issues',async(req,res)=>{
    const rows=await db('issues')
      .join('users','users.id','issues.reporter_id')
      .join('projects','projects.id','issues.project_id')
      .where('users.email','guest@helm.local')
      .whereNot('issues.archived',true)
      .select('issues.id','issues.reference','issues.type','issues.title','issues.description','issues.expected','issues.status','issues.severity','issues.created_at','issues.assigned_to','issues.assigned_role','issues.device','users.name as reporter_name','projects.name as project_name','projects.id as project_id')
      .orderBy('issues.created_at','desc')
      .limit(200);
    const withFiles=await Promise.all(rows.map(async i=>{
      const attachments=await db('attachments').where({issue_id:i.id}).select('id','name','mime','size');
      return {...i,attachments};
    }));
    res.json(withFiles);
  });
  app.get('/api/guest/issues/:id/log',async(req,res)=>{
    const guestUser=await db('users').where({email:'guest@helm.local'}).first();
    if(!guestUser)return res.json([]);
    const issue=await db('issues').where({id:req.params.id,reporter_id:guestUser.id}).first();
    if(!issue)throw fail(404,'Issue not found.');
    const log=await db('activity').where({issue_id:issue.id}).orderBy('created_at','asc');
    res.json(log);
  });
  app.patch('/api/guest/issues/:id',async(req,res)=>{
    const d=z.object({
      actor_name:z.string().trim().min(1).max(100),
      actor_role:z.enum(['tester','developer']),
      assigned_to:z.string().trim().max(100).optional(),
      assigned_role:z.enum(['tester','developer','']).optional(),
      status:z.string().max(60).optional(),
      note:z.string().trim().max(5000).optional(),
    }).parse(req.body);
    const guestUser=await db('users').where({email:'guest@helm.local'}).first();
    if(!guestUser)throw fail(404,'Guest user not found.');
    const issue=await db('issues').where({id:req.params.id,reporter_id:guestUser.id}).first();
    if(!issue)throw fail(404,'Issue not found.');
    const updates:any={updated_at:now(),version:issue.version+1};
    if(d.assigned_to!==undefined)updates.assigned_to=d.assigned_to;
    if(d.assigned_role!==undefined)updates.assigned_role=d.assigned_role;
    if(d.status)updates.status=d.status;
    const parts:string[]=[];
    if(d.assigned_to!==undefined)parts.push(d.assigned_to?'Assigned to '+d.assigned_to+' ('+d.assigned_role+')':'Unassigned');
    if(d.status)parts.push('Status → '+d.status);
    const action=d.actor_name+' ('+d.actor_role+')';
    const detail=[parts.join(' · '),d.note].filter(Boolean).join(' — ');
    await db.transaction(async q=>{
      await q('issues').where({id:issue.id}).update(updates);
      await q('activity').insert({id:randomUUID(),issue_id:issue.id,user_id:guestUser.id,action,detail,internal:false,created_at:now()});
    });
    res.json({ok:true});
  });
  // ── End guest endpoints ─────────────────────────────────────────────────

  app.use('/api', (req,res,next)=>req.path.startsWith('/integration/')?next():auth(req,res,next));
 app.get('/api/projects',async(req,res)=>{const u=(req as any).user;let query=db('projects').where({'projects.active':true});if(u.role!=='admin')query=query.join('memberships','projects.id','memberships.project_id').where('memberships.user_id',u.id);res.json(await query.select('projects.*'));});
 app.get('/api/issues',async(req,res)=>{const u=(req as any).user;const page=Math.max(1,Math.min(100000,Number(req.query.page)||1));let q=db('issues').join('projects','projects.id','issues.project_id').join('users','users.id','issues.reporter_id').where('issues.archived',req.query.archived==='true');if(u.role!=='admin')q=q.where('reporter_id',u.id);if(req.query.status)q=q.where('status',String(req.query.status));if(req.query.project)q=q.where('project_id',String(req.query.project));if(req.query.type)q=q.where('type',String(req.query.type));if(req.query.severity)q=q.where('severity',String(req.query.severity));if(req.query.search){const s=`%${String(req.query.search).slice(0,100).toLowerCase()}%`;q=q.where(function(){this.whereRaw('lower(issues.title) like ?',[s]).orWhereRaw('lower(issues.reference) like ?',[s]);});}const count=await q.clone().count({total:'issues.id'}).first();const sort=req.query.sort==='oldest'?'asc':'desc';const rows=await q.select('issues.*','projects.name as project_name','users.name as reporter_name').orderBy('issues.created_at',sort).limit(25).offset((page-1)*25);res.json({issues:rows,total:Number(count?.total||0),page});});
 app.get('/api/stats',async(req,res)=>{const u=(req as any).user;let q=db('issues').where({archived:false});if(u.role!=='admin')q=q.where('reporter_id',u.id);const rows=await q;const counts=Object.fromEntries(statuses.map(s=>[s,rows.filter(i=>i.status===s).length]));res.json({counts,total:rows.length,open:rows.filter(i=>!['Closed','Duplicate'].includes(i.status)).length,critical:rows.filter(i=>['High','Critical'].includes(i.severity)&&!['Closed','Duplicate'].includes(i.status)).length,aging:rows.filter(i=>!['Closed','Duplicate'].includes(i.status)&&Date.now()-Date.parse(i.created_at)>7*86400000).length,failed:u.role==='admin'?Number((await db('deliveries').whereIn('state',['failed','uncertain']).count({n:'id'}).first())?.n):0});});
 app.post('/api/issues',async(req,res)=>{const u=(req as any).user;await rateLimit(`submit:${u.id}`,30,60);const d=issueInput.parse(req.body);const existing=await db('issues').where({reporter_id:u.id,idempotency_key:d.idempotency_key}).first();if(existing)return res.json(existing);let saved:any;try{await db.transaction(async q=>{const p=await q('projects').where({id:d.project_id,active:true}).first();const member=u.role==='admin'||await q('memberships').where({project_id:d.project_id,user_id:u.id}).first();if(!p||!member)throw fail(403,'You do not have access to that project.');const {attachments,...fields}=d;const [i]=await q('issues').insert({...fields,id:randomUUID(),reporter_id:u.id,status:'New',priority:'Medium',category:'General',created_at:now(),updated_at:now()}).returning('*');i.reference=`${i.type==='Bug'?'BUG':'IMP'}-${String(i.number).padStart(6,'0')}`;await q('issues').where({id:i.id}).update({reference:i.reference});await attach(q,attachments,i.id,u.id);await activity(q,i,u,'Submitted',`${i.type} reported by ${u.name}`);await queue(q,{issue:i,kind:'new',dedupe:`new:${i.id}`,body:`${i.reference} · ${i.type} · ${i.severity}\nReporter: ${u.name} (${u.email})\n\n${i.description}`});await queue(q,{issue:i,kind:'acknowledgment',dedupe:`ack:${i.id}`,recipients:[u.email],subject:`[${i.reference}] We received your report`,body:`Hi ${u.name},\n\nThanks for helping improve ${p.name}. Your report has been saved with reference ${i.reference}. You can follow its progress and add details on the issue page.`});saved=i;});}catch(e){const duplicate=await db('issues').where({reporter_id:u.id,idempotency_key:d.idempotency_key}).first();if(duplicate)return res.json(duplicate);throw e;}res.status(201).json(saved);});
 app.get('/api/issues/:id',async(req,res)=>{const u=(req as any).user;const i=await accessible(db,u,String(req.params.id));const [reporter,project,comments,history,attachments,approval]=await Promise.all([db('users').where({id:i.reporter_id}).first(),db('projects').where({id:i.project_id}).first(),db('comments').join('users','users.id','comments.user_id').where('issue_id',i.id).modify(q=>{if(u.role!=='admin')q.where('internal',false);}).select('comments.*','users.name as name').orderBy('created_at'),db('activity').join('users','users.id','activity.user_id').where('issue_id',i.id).modify(q=>{if(u.role!=='admin')q.where('internal',false);}).select('activity.*','users.name as name').orderBy('created_at'),db('attachments').where({issue_id:i.id}).select('id','name','mime','size'),db('approvals').where({issue_id:i.id,cycle:i.cycle}).first()]);const notifications=u.role==='admin'?await db('deliveries').join('events','events.id','deliveries.event_id').where('events.issue_id',i.id).select('deliveries.id','deliveries.recipient','deliveries.state','deliveries.error','deliveries.attempts','deliveries.created_at','events.kind'):[];res.json({...i,reporter:publicUser(reporter),project,comments,history,attachments,approval,notifications});});
 app.post('/api/issues/:id/action',async(req,res)=>{const u=(req as any).user;const d=z.object({action:z.enum(['approve','verify','reopen','status','information','update','archive']),version:z.number().int().positive(),summary:text,note:text,build:z.string().max(100).default(''),test_url:url,status:z.enum(statuses).optional(),priority:z.enum(['Low','Medium','High','Urgent']).optional(),severity:z.enum(['Low','Medium','High','Critical']).optional(),category:z.string().max(80).optional(),type:z.enum(['Bug','Improvement']).optional(),assignee_id:z.uuid().nullable().optional(),duplicate_of:z.uuid().nullable().optional(),attachments:z.array(z.uuid()).max(5).default([])}).parse(req.body);await db.transaction(async q=>{const i=await accessible(q,u,String(req.params.id));if(i.version!==d.version)throw fail(409,'This issue changed. Refresh it before making another update.');const isAdmin=u.role==='admin';if(!isAdmin&&!['verify','reopen'].includes(d.action))throw fail(403,'Administrator access required.');if(!isAdmin&&i.status!=='Ready for Retest')throw fail(409,'This issue is not awaiting retesting.');const updates:any={version:i.version+1,updated_at:now()};let detail=d.note,kind='';
 if(d.action==='approve'){if(!d.summary.trim())throw fail(400,'A fix summary is required.');if(i.archived||['Closed','Duplicate','Ready for Retest'].includes(i.status))throw fail(409,'Reopen this issue before requesting a new retest.');updates.status='Ready for Retest';updates.cycle=i.cycle+1;await q('approvals').insert({id:randomUUID(),issue_id:i.id,admin_id:u.id,cycle:updates.cycle,summary:d.summary,build:d.build,test_url:d.test_url,created_at:now()});detail=d.summary;kind='retest';}
 if(d.action==='verify'){if(u.id!==i.reporter_id)throw fail(403,'Only the reporter can verify a fix. Administrators can close manually with a reason.');if(i.status!=='Ready for Retest')throw fail(409,'This issue is not awaiting retesting.');updates.status='Closed';detail='Reporter verified the fix.';kind='verified';}
 if(d.action==='reopen'){if(!d.note.trim())throw fail(400,'Please describe what is still happening.');if(!isAdmin&&i.status!=='Ready for Retest')throw fail(409,'This issue is not awaiting retesting.');updates.status='Reopened';kind='reopened';}
 if(d.action==='information'){if(!d.note.trim())throw fail(400,'Enter the information you need.');updates.status='Needs Information';kind='information';}
 if(d.action==='status'){if(!d.status||['Ready for Retest','Needs Information'].includes(d.status))throw fail(400,'Use the dedicated approval or information action.');if(['Closed','Duplicate'].includes(d.status)&&!d.note.trim())throw fail(400,'A reason is required.');if(d.status==='Duplicate'){if(!d.duplicate_of||d.duplicate_of===i.id||!await q('issues').where({id:d.duplicate_of}).first())throw fail(400,'Choose another valid issue ID for the duplicate.');updates.duplicate_of=d.duplicate_of;}updates.status=d.status;}
 if(d.action==='update'){for(const key of ['priority','severity','category','type','assignee_id'])if((d as any)[key]!==undefined)updates[key]=(d as any)[key];if(d.assignee_id&&!await q('users').where({id:d.assignee_id,role:'admin',active:true}).first())throw fail(400,'Assign to an active administrator.');detail='Issue fields updated.';}
 if(d.action==='archive'){updates.archived=!i.archived;detail=updates.archived?'Issue archived.':'Issue restored.';}
 const changed=await q('issues').where({id:i.id,version:d.version}).update(updates);if(!changed)throw fail(409,'This issue changed. Refresh and try again.');await attach(q,d.attachments,i.id,u.id);await activity(q,i,u,updates.status?`${i.status} → ${updates.status}`:d.action,detail);if(isAdmin)await audit(q,u,d.action,i.reference);
 if(kind){const reporter=await q('users').where({id:i.reporter_id}).first();const recipients=['retest','information'].includes(kind)?[reporter.email]:undefined;const body=kind==='retest'?`Hi ${reporter.name},\n\nA fix for “${i.title}” is ready for you to test.\n\nWhat changed:\n${d.summary}\n\n${d.build?`Version/build: ${d.build}\n`:''}${d.test_url?`Test here: ${d.test_url}\n`:''}\nPlease open the issue and choose “Verified — fixed” if it works, or “Still happening” if you can reproduce the problem.`:detail;await queue(q,{issue:{...i,...updates},kind,dedupe:`${kind}:${i.id}:${updates.version}`,recipients,body});}
 });res.json({ok:true});});
 app.post('/api/issues/:id/attachments',async(req,res)=>{const u=(req as any).user;const d=z.object({attachments:z.array(z.uuid()).min(1).max(5)}).parse(req.body);await db.transaction(async q=>{const i=await accessible(q,u,String(req.params.id));await attach(q,d.attachments,i.id,u.id);await activity(q,i,u,'Screenshots added',`${d.attachments.length} additional screenshot(s)`);});res.json({ok:true});});
 app.post('/api/issues/:id/comments',async(req,res)=>{const u=(req as any).user;await rateLimit(`comment:${u.id}`,60,60);const d=z.object({body:z.string().trim().min(1).max(15000),internal:z.boolean().default(false)}).parse(req.body);if(d.internal&&u.role!=='admin')throw fail(403,'Internal notes are restricted to admins.');await db.transaction(async q=>{const i=await accessible(q,u,String(req.params.id));const id=randomUUID();await q('comments').insert({id,issue_id:i.id,user_id:u.id,...d,created_at:now()});await activity(q,i,u,d.internal?'Internal note':'Comment added',d.body,d.internal);if(u.role!=='admin'&&i.status==='Needs Information')await queue(q,{issue:i,kind:'response',dedupe:`response:${id}`,body:`${u.name} responded:\n\n${d.body}`});});res.status(201).json({ok:true});});
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
 app.post('/api/uploads',async(req,res,next)=>{try{await rateLimit(`upload:${(req as any).user.id}`,50,60);next();}catch(e){next(e);}},upload.single('file'),async(req,res)=>{const u=(req as any).user;if(!req.file)throw fail(400,'Choose a screenshot.');const count=await db('attachments').where({user_id:u.id}).whereNull('issue_id').count({n:'id'}).first();if(Number(count?.n)>19)throw fail(400,'Too many pending uploads. Remove unused screenshots first.');const bytes=await storage.validateImage(req.file.buffer,req.file.mimetype);const id=randomUUID();await storage.put(id,bytes,req.file.mimetype);try{await db('attachments').insert({id,user_id:u.id,name:path.basename(req.file.originalname).slice(0,200),mime:req.file.mimetype,size:bytes.length,storage_key:id,created_at:now()});}catch(e){await storage.remove(id);throw e;}res.status(201).json({id,name:req.file.originalname,size:bytes.length});});
 app.delete('/api/uploads/:id',async(req,res)=>{const a=await db('attachments').where({id:req.params.id,user_id:(req as any).user.id}).whereNull('issue_id').first();if(!a)throw fail(404,'Upload not found.');await storage.remove(a.storage_key);await db('attachments').where({id:a.id}).delete();res.json({ok:true});});
 app.get('/api/attachments/:id/link',async(req,res)=>{const u=(req as any).user;const a=await db('attachments').where({id:req.params.id}).first();if(!a)throw fail(404,'Screenshot not found.');if(a.issue_id)await accessible(db,u,a.issue_id);else if(a.user_id!==u.id)throw fail(404,'Screenshot not found.');const expiry=Date.now()+60000;res.json({url:`/api/attachments/${a.id}/file?expires=${expiry}&signature=${signDownload(a.id,u.id,expiry)}`});});
 app.get('/api/attachments/:id/file',async(req,res)=>{const u=(req as any).user;const id=String(req.params.id),expires=Number(req.query.expires),signature=String(req.query.signature||'');const expected=signDownload(id,u.id,expires);if(!Number.isFinite(expires)||expires<Date.now()||expires>Date.now()+61000||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw fail(403,'Screenshot link expired. Reopen the screenshot.');const a=await db('attachments').where({id}).first();if(!a)throw fail(404,'Screenshot not found.');if(a.issue_id)await accessible(db,u,a.issue_id);else if(a.user_id!==u.id)throw fail(404,'Screenshot not found.');const f=await storage.download(a.storage_key);res.setHeader('Content-Type',a.mime);res.setHeader('Content-Disposition','inline');if(f.url)res.redirect(f.url);else res.sendFile(f.file!);});
 app.get('/api/admin/settings',admin,async(req,res)=>{const settings=await db('settings').where({id:1}).first();res.json({...settings,recipients:JSON.parse(settings.recipients),users:(await db('users').orderBy('name')).map(publicUser),projects:await db('projects'),memberships:await db('memberships'),health:{database:process.env.DATABASE_URL?'PostgreSQL':'Local SQLite',storage:process.env.S3_ENDPOINT?'Private S3':'Private local storage',n8n:!!process.env.N8N_WEBHOOK_URL,sender:process.env.EMAIL_FROM||null,mode:production?'production':'local'}});});
 app.patch('/api/admin/settings',admin,async(req,res)=>{const d=z.object({reminder_hours:z.number().int().min(1).max(720),digest_enabled:z.boolean(),timezone:z.string().refine(s=>{try{new Intl.DateTimeFormat('en',{timeZone:s});return true;}catch{return false;}}),digest_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),recipients:z.array(z.email()).max(10)}).parse(req.body);await db.transaction(async q=>{await q('settings').where({id:1}).update({...d,recipients:JSON.stringify(d.recipients)});await audit(q,(req as any).user,'settings','Notification preferences updated');});res.json({ok:true});});
 app.post('/api/admin/projects',admin,async(req,res)=>{const d=z.object({name:z.string().trim().min(2).max(80),description:z.string().max(500).default('')}).parse(req.body);const id=randomUUID();await db.transaction(async q=>{await q('projects').insert({id,...d,active:true,created_at:now()});await audit(q,(req as any).user,'project-created',d.name);});res.status(201).json({id});});
 app.post('/api/admin/invites',admin,async(req,res)=>{const d=z.object({email:z.email().max(254),name:z.string().trim().min(2).max(100),projects:z.array(z.uuid()).min(1).max(50)}).parse(req.body);const raw=token();let uid='';await db.transaction(async q=>{if((await q('projects').whereIn('id',d.projects).where({active:true})).length!==new Set(d.projects).size)throw fail(400,'Choose active projects.');const existing=await q('users').where({email:d.email.toLowerCase()}).first();if(existing?.verified)throw fail(409,'This person already has an account. Edit their project access instead.');uid=existing?.id||randomUUID();if(!existing)await q('users').insert({id:uid,email:d.email.toLowerCase(),name:d.name,role:'tester',verified:false,active:true,created_at:now()});await q('invites').where({user_id:uid,used:false}).update({used:true});await q('invites').insert({id:hash(raw),user_id:uid,used:false,expires_at:new Date(Date.now()+72*3600000).toISOString()});for(const project_id of d.projects)await q('memberships').insert({project_id,user_id:uid}).onConflict(['project_id','user_id']).ignore();await queue(q,{kind:'invite',dedupe:`invite:${hash(raw)}`,recipients:[d.email],subject:'You’re invited to Helm Track',body:`Hi ${d.name},\n\nYou have been invited to help test and improve our projects. Set up your account using the button below. This invitation expires in 72 hours.`,link:`${appURL()}/?invite=${raw}`});await audit(q,(req as any).user,'invitation',d.email);});res.status(201).json({ok:true,...(!production?{local_invite_url:`${appURL()}/?invite=${raw}`}:{})});});
 app.patch('/api/admin/users/:id',admin,async(req,res)=>{const d=z.object({active:z.boolean(),projects:z.array(z.uuid()).max(50)}).parse(req.body);const uid=String(req.params.id);if(uid===(req as any).user.id)throw fail(400,'You cannot deactivate your own account.');await db.transaction(async q=>{const user=await q('users').where({id:uid}).first();if(!user||user.role!=='tester')throw fail(400,'Only tester accounts can be managed here.');if((await q('projects').whereIn('id',d.projects)).length!==new Set(d.projects).size)throw fail(400,'Invalid projects.');await q('users').where({id:uid}).update({active:d.active});await q('memberships').where({user_id:uid}).delete();for(const project_id of d.projects)await q('memberships').insert({project_id,user_id:uid});if(!d.active)await q('sessions').where({user_id:uid}).delete();await audit(q,(req as any).user,'tester-access',uid);});res.json({ok:true});});
 app.get('/api/admin/notifications',admin,async(req,res)=>res.json(await db('deliveries').select('id','recipient','subject','state','attempts','error','created_at').orderBy('created_at','desc').limit(100)));
 app.post('/api/admin/notifications/:id/retry',admin,async(req,res)=>{const d=await db('deliveries').where({id:req.params.id}).first();if(!d||!['failed','uncertain'].includes(d.state))throw fail(409,'This notification is not retryable.');if(d.first_claim_at&&Date.now()-Date.parse(d.first_claim_at)>23*3600000)throw fail(409,'Provider deduplication window expired. Check the provider’s records before manually resending; automatic retry is blocked.');await db.transaction(async q=>{await q('deliveries').where({id:d.id,state:d.state}).update({state:'queued',attempts:0,next_attempt:now(),error:null,updated_at:now()});await audit(q,(req as any).user,'notification-retry',d.id);});res.json({ok:true});});
 // Integration uses expiring capabilities scoped to one delivery; no session cookies.
 app.post('/api/integration/schedule',async(req,res)=>{
 const secret=process.env.N8N_SCHEDULER_SECRET||'',received=req.get('authorization')?.replace(/^Bearer /,'')||'';
 if(secret.length<32||received.length!==secret.length||!timingSafeEqual(Buffer.from(secret),Buffer.from(received)))throw fail(401,'Invalid scheduler authorization.');
 const d=z.object({timestamp:z.number(),nonce:z.string().min(1).max(200)}).parse(req.body);
 if(Math.abs(Date.now()-d.timestamp)>300000)throw fail(401,'Expired scheduler request.');
 const key=hash(`scheduler:${d.nonce}`);const inserted=await db('limits').insert({key,count:1,expires_at:new Date(Date.now()+600000).toISOString()}).onConflict('key').ignore().returning('key');
 if(!inserted.length)return res.json({ok:true,replayed:true});
 await schedule();res.json({ok:true});
 });
 app.use('/api/integration',async(req,res,next)=>{try{await rateLimit(`integration:${req.ip}`,300,1);const bearer=req.get('authorization')?.replace(/^Bearer /,'');if(!bearer)throw fail(401,'Missing integration authorization.');const d=await db('deliveries').where({token_hash:hash(bearer)}).where('token_expires','>',now()).first();if(!d)throw fail(401,'Invalid or expired integration authorization.');(req as any).delivery=d;next();}catch(e){next(e);}});
 app.post('/api/integration/claim',async(req,res)=>{const d=(req as any).delivery;let output:any={send:false};await db.transaction(async q=>{const row=await q('deliveries').where({id:d.id}).first();const e=await q('events').where({id:row.event_id}).first();if(!await applicable(q,e)){await q('deliveries').where({id:d.id}).update({state:'cancelled',updated_at:now()});return;}if(!['dispatching','queued','uncertain'].includes(row.state)||row.lease_until&&row.lease_until>now()&&row.state!=='dispatching')return;
 if(row.first_claim_at&&Date.now()-Date.parse(row.first_claim_at)>23*3600000){await q('deliveries').where({id:d.id}).update({state:'uncertain',error:'Provider deduplication window expired; manual investigation required.'});return;}
 if(!process.env.EMAIL_FROM)throw fail(503,'Sender configuration is incomplete.');const updated=await q('deliveries').where({id:d.id,state:row.state}).update({state:'sending',lease_until:new Date(Date.now()+120000).toISOString(),first_claim_at:row.first_claim_at||now(),updated_at:now()});if(!updated)return;output={send:true,delivery_id:row.id,event_id:e.id,idempotency_key:`helm/${row.id}`,email:{from:process.env.EMAIL_FROM,to:[row.recipient],subject:row.subject,html:row.html,text:row.text}};});res.json(output);});
 app.post('/api/integration/outcome',async(req,res)=>{const d=(req as any).delivery;const data=z.object({state:z.enum(['provider-accepted','failed','uncertain']),provider_id:z.string().max(200).optional(),execution_id:z.string().max(200).default(''),error:z.enum(['provider_rejected','provider_unavailable','unknown_outcome']).optional()}).parse(req.body);if(data.state==='provider-accepted'&&!data.provider_id)throw fail(400,'Provider message ID required.');await db.transaction(async q=>{const row=await q('deliveries').where({id:d.id}).first();if(['provider-accepted','delivered','bounced','cancelled'].includes(row.state))return;if(row.state!=='sending')throw fail(409,'No active delivery attempt.');await q('deliveries').where({id:d.id,state:'sending'}).update({state:data.state,provider_id:data.provider_id||null,error:data.error||null,lease_until:null,next_attempt:new Date(Date.now()+Math.min(3600,30*2**row.attempts)*1000).toISOString(),updated_at:now()});await q('attempts').insert({id:randomUUID(),delivery_id:d.id,state:data.state,error:data.error||null,execution_id:data.execution_id,created_at:now()});});res.json({ok:true});});
 app.use('/api',(req,res)=>res.status(404).json({error:'Endpoint not found.'}));
 app.use(express.static(path.resolve('dist')));app.get('/{*path}',(req,res)=>res.sendFile(path.resolve('dist/index.html')));
 app.use((err:any,req:express.Request,res:express.Response,next:express.NextFunction)=>{if(err instanceof z.ZodError)return res.status(400).json({error:err.issues.map(x=>`${x.path.join('.')}: ${x.message}`).join('; ')});if(err instanceof multer.MulterError)return res.status(400).json({error:'Upload failed. Maximum file size is 10 MB.'});if(err.code==='23505'||err.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That record already exists.'});res.status(err.status||500).json({error:err.status?err.message:'Something went wrong. Please try again.'});if(!err.status)console.error('Request failed:',err.name,err.code||'internal_error');});return app;
}
