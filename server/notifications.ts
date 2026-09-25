import {randomUUID} from 'node:crypto';
import {db,now} from './db.js';
export const appURL=()=> (process.env.APP_URL||'http://localhost:5173').replace(/\/$/,'');
export const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function template(title:string,body:string,link:string,label='Open issue'){const name=process.env.EMAIL_SENDER_NAME||'Helm Track';return {text:`${title}\n\n${body}\n\n${label}: ${link}\n\n${name}`,html:`<!doctype html><html><body style="background:#f4f5f1;font-family:Arial,sans-serif;color:#203b34;padding:24px"><div style="max-width:560px;margin:auto;background:white;padding:32px;border-radius:16px"><p style="font-weight:bold;letter-spacing:2px">HELM TRACK</p><h1 style="font-size:24px">${escape(title)}</h1><p style="white-space:pre-wrap;line-height:1.7">${escape(body)}</p><a href="${escape(link)}" style="display:inline-block;background:#234c40;color:white;text-decoration:none;border-radius:8px;padding:14px 20px">${escape(label)}</a><p style="color:#777;margin-top:30px">${escape(name)}</p></div></body></html>`};}
export async function queue(q:any,{issue,kind,body,dedupe,recipients,subject,link}:{issue?:any,kind:string,body:string,dedupe:string,recipients?:string[],subject?:string,link?:string}){
 const exists=await q('events').where({dedupe}).first();if(exists)return exists.id;
 const eventId=randomUUID();await q('events').insert({id:eventId,issue_id:issue?.id||null,kind,cycle:issue?.cycle||0,dedupe,created_at:now()});
 const settings=await q('settings').where({id:1}).first();
 const admins=await q('users').where({role:'admin',active:true,verified:true});
 const to=recipients||[...admins.map((a:any)=>a.email),...JSON.parse(settings.recipients||'[]')];
 const title=subject||`[${issue.reference}] ${kind==='new'?'New submission':kind==='retest'?'Fix ready — please retest':kind==='reminder'?'Reminder — please retest':kind==='verified'?'Fix verified':kind==='reopened'?'Issue reopened':kind==='information'?'More information needed':'Issue updated'}: ${issue.title}`;
 const content=template(title,body,link||`${appURL()}/?issue=${issue.id}`);
 for(const recipient of [...new Set(to.map((s:string)=>s.trim().toLowerCase()))])await q('deliveries').insert({id:randomUUID(),event_id:eventId,recipient,subject:title,...content,state:'queued',attempts:0,next_attempt:now(),created_at:now(),updated_at:now()});
 return eventId;
}
export async function applicable(q:any,event:any){if(!event.issue_id)return true;const i=await q('issues').where({id:event.issue_id}).first();if(!i)return false;if(['retest','reminder'].includes(event.kind))return i.status==='Ready for Retest'&&i.cycle===event.cycle&&!i.archived;return true;}
export async function schedule(){
 const settings=await db('settings').where({id:1}).first();
 const issues=await db('issues').where({status:'Ready for Retest',archived:false});
 for(const i of issues){const approval=await db('approvals').where({issue_id:i.id,cycle:i.cycle}).first();if(!approval)continue;const elapsed=Date.now()-Date.parse(approval.created_at);const n=Math.min(2,Math.floor(elapsed/(settings.reminder_hours*3600000)));if(n<1)continue;
 await db.transaction(async q=>{const current=await q('issues').where({id:i.id,status:'Ready for Retest',cycle:i.cycle,archived:false}).first();if(!current)return;const reporter=await q('users').where({id:i.reporter_id}).first();await queue(q,{issue:i,kind:'reminder',dedupe:`reminder:${i.id}:${i.cycle}:${n}`,recipients:[reporter.email],body:`Hi ${reporter.name},\n\nYour report is awaiting a retest.\n\n${approval.summary}\n\nPlease choose “Verified — fixed” or “Still happening” on the issue. We will never close an issue because you have not replied.`});});}
 if(settings.digest_enabled){const p=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const get=(s:string)=>p.find(x=>x.type===s)?.value;const date=`${get('year')}-${get('month')}-${get('day')}`;if(`${get('hour')}:${get('minute')}`>=settings.digest_time){const all=await db('issues').where({archived:false}).whereNotIn('status',['Closed','Duplicate']);await db.transaction(q=>queue(q,{kind:'digest',dedupe:`digest:${date}`,subject:'Helm Track — daily issue overview',body:`Open: ${all.length}\nNew: ${all.filter(i=>i.status==='New').length}\nReopened: ${all.filter(i=>i.status==='Reopened').length}\nOlder than 7 days: ${all.filter(i=>Date.now()-Date.parse(i.created_at)>7*86400000).length}`,link:appURL()}));}}
}
