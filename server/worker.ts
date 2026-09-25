import {randomUUID} from 'node:crypto';
import {db,migrate,now} from './db.js';
import {hash,token} from './auth.js';
import {applicable} from './notifications.js';
import {remove} from './storage.js';
import {pathToFileURL} from 'node:url';
export async function dispatch(fetcher:typeof fetch=fetch){
 const webhook=process.env.N8N_WEBHOOK_URL,secret=process.env.N8N_WEBHOOK_SECRET,base=process.env.INTEGRATION_BASE_URL;
 if(!webhook||!secret||!base)return;
 const expired=await db('deliveries').whereIn('state',['sending','dispatching']).where('lease_until','<',now());
 for(const d of expired)await db('deliveries').where({id:d.id,state:d.state}).update({state:d.first_claim_at?'uncertain':'queued',lease_until:null,error:d.first_claim_at?'unknown_outcome':null,updated_at:now()});
 const rows=await db('deliveries').whereIn('state',['queued','uncertain']).where('attempts','<',5).where('next_attempt','<=',now()).limit(20);
 for(const row of rows){
 const raw=token();let ready=false;
 await db.transaction(async q=>{const d=await q('deliveries').where({id:row.id}).first();if(!d||!['queued','uncertain'].includes(d.state))return;
 const event=await q('events').where({id:d.event_id}).first();if(!await applicable(q,event)){await q('deliveries').where({id:d.id}).update({state:'cancelled',updated_at:now()});return;}
 if(d.first_claim_at&&Date.now()-Date.parse(d.first_claim_at)>23*3600000){await q('deliveries').where({id:d.id}).update({state:'uncertain',attempts:5,error:'Provider deduplication window expired; manual investigation required.'});return;}
 const n=await q('deliveries').where({id:d.id,state:d.state,attempts:d.attempts}).update({state:'dispatching',attempts:d.attempts+1,lease_until:new Date(Date.now()+120000).toISOString(),token_hash:hash(raw),token_expires:new Date(Date.now()+10*60000).toISOString(),updated_at:now()});ready=!!n;});
 if(!ready)continue;
 try{const response=await fetcher(webhook,{method:'POST',headers:{'Content-Type':'application/json','X-Helm-Webhook-Secret':secret},body:JSON.stringify({schema_version:1,delivery_id:row.id,event_id:row.event_id,capability:raw,base_url:base.replace(/\/$/,''),timestamp:Date.now()}),signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('n8n rejected dispatch');
 }catch{await db.transaction(async q=>{const current=await q('deliveries').where({id:row.id}).first();if(current.state!=='dispatching')return;const state=current.attempts>=5?'failed':'queued';await q('deliveries').where({id:row.id,state:'dispatching'}).update({state,error:'n8n_unavailable',lease_until:null,next_attempt:new Date(Date.now()+Math.min(3600,30*2**current.attempts)*1000).toISOString(),updated_at:now()});await q('attempts').insert({id:randomUUID(),delivery_id:row.id,state:'dispatch_failed',error:'n8n_unavailable',created_at:now()});});}
 }
 await db('deliveries').whereIn('state',['queued','uncertain']).where('attempts','>=',5).update({state:'failed',updated_at:now()});
}
export async function cleanup(){const stale=await db('attachments').whereNull('issue_id').where('created_at','<',new Date(Date.now()-24*3600000).toISOString());for(const a of stale){const deleted=await db('attachments').where({id:a.id}).whereNull('issue_id').delete();if(deleted)await remove(a.storage_key);}await db('sessions').where('expires_at','<',now()).delete();await db('limits').where('expires_at','<',now()).delete();}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){await migrate();console.log('Outbox worker started. Unconfigured integrations stay queued.');let stopped=false;process.on('SIGTERM',()=>{stopped=true;});process.on('SIGINT',()=>{stopped=true;});let tick=0;while(!stopped){try{await dispatch();if(tick++%60===0)await cleanup();}catch{console.error('Worker iteration failed; will retry.');}await new Promise(r=>setTimeout(r,5000));}await db.destroy();}
