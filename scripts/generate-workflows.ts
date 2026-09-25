import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
const validate=fs.readFileSync('n8n/validate-dispatch.js','utf8');
const classify=fs.readFileSync('n8n/classify-outcome.js','utf8');
const node=(name:string,type:string,typeVersion:number,position:number[],parameters:any,extra:any={})=>({id:randomUUID(),name,type:`n8n-nodes-base.${type}`,typeVersion,position,parameters,...extra});
const edge=(name:string,index=0)=>({node:name,type:'main',index});
const http=(name:string,position:number[],url:string,body:string,headers:any[]=[],extra:any={})=>node(name,'httpRequest',4.2,position,{method:'POST',url,sendHeaders:headers.length>0,headerParameters:{parameters:headers},sendBody:true,specifyBody:'json',jsonBody:body,options:{timeout:20000,...extra.options},...extra.parameters},extra.node||{});
const settings={executionOrder:'v1',saveDataSuccessExecution:'none',saveDataErrorExecution:'none',saveManualExecutions:false,executionTimeout:120,timezone:'America/Chicago'};
const authHeader={name:'Authorization',value:"={{ 'Bearer ' + $('Validate envelope').first().json.capability }}"};
const delivery={name:'Helm Track — Reliable notification delivery (A–D)',active:false,settings,nodes:[
node('Setup notes','stickyNote',1,[-40,-280],{width:1060,height:220,content:'## Helm Track · Reliable notification delivery\nHandles new submissions + acknowledgment (A), approved retests (B), retest results (C), and information requests/replies (D).\n\n**Before publishing:** set the HTTPS app origin in Validate envelope; select Header Auth on the webhook (`X-Helm-Webhook-Secret`); select Resend Header Auth (`Authorization: Bearer …`) on Send via Resend. Do not put credentials into node text. The app outbox retries safely and rechecks issue status. Execution payload saving is disabled because notifications contain private data.\n\n**Provider accepted ≠ delivered.** Signed delivery/bounce webhooks go directly to the app.'}),
node('Notification webhook','webhook',2,[0,80],{httpMethod:'POST',path:'helm-track-notifications',authentication:'headerAuth',responseMode:'onReceived',options:{}},{webhookId:randomUUID()}),
node('Validate envelope','code',2,[240,80],{jsCode:validate+"\nconst APP_ORIGIN = ''; // REQUIRED: exact public HTTPS app origin, with no trailing slash.\nreturn [{json: validateDispatch($input.first().json.body, APP_ORIGIN)}];"}),
http('Claim current notification',[480,80],"={{ $('Validate envelope').first().json.base_url + '/api/integration/claim' }}",'={{ {} }}',[authHeader]),
node('Send is authorized','if',2.2,[720,80],{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:randomUUID(),leftValue:'={{ $json.send }}',rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}}),
http('Send via Resend',[960,0],'https://api.resend.com/emails','={{ $json.email }}',[{name:'Idempotency-Key',value:'={{ $json.idempotency_key }}'}],{parameters:{authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth'},options:{response:{response:{fullResponse:true,neverError:true,responseFormat:'json'}}},node:{onError:'continueRegularOutput'}}),
node('Classify provider outcome','code',2,[1200,0],{jsCode:classify+'\nreturn [{json:classifyOutcome($input.first().json, $execution.id)}];'}),
http('Record outcome',[1440,0],"={{ $('Validate envelope').first().json.base_url + '/api/integration/outcome' }}",'={{ $json }}',[authHeader]),
node('No send needed','noOp',1,[960,220],{}),
],connections:{'Notification webhook':{main:[[edge('Validate envelope')]]},'Validate envelope':{main:[[edge('Claim current notification')]]},'Claim current notification':{main:[[edge('Send is authorized')]]},'Send is authorized':{main:[[edge('Send via Resend')],[edge('No send needed')]]},'Send via Resend':{main:[[edge('Classify provider outcome')]]},'Classify provider outcome':{main:[[edge('Record outcome')]]}}};
const scheduler={name:'Helm Track — Retest reminders and daily digest (E–F)',active:false,settings,nodes:[
node('Setup notes','stickyNote',1,[-30,-260],{width:800,height:220,content:'## Retest reminders + daily admin digest\nRuns every 15 minutes. The app checks current status, retest cycle, reminder limits, and each digest’s configured timezone.\n\nSet the HTTPS origin in App URL. Select a Header Auth credential in Schedule due notifications: header `Authorization`, value `Bearer <N8N_SCHEDULER_SECRET>`. This secret is separate from the delivery webhook secret.\n\nThis workflow only queues eligible events. The app worker delivers them through the notification workflow. It never closes an issue.'}),
node('Every 15 minutes','scheduleTrigger',1.2,[0,40],{rule:{interval:[{field:'minutes',minutesInterval:15}]}}),
node('App URL','code',2,[240,40],{jsCode:"const origin = ''; // REQUIRED: exact public HTTPS app origin.\nif (!origin.startsWith('https://') || !/^[a-z0-9.-]+(?::[0-9]+)?$/i.test(origin.slice(8))) throw new Error('Configure the HTTPS app origin.');\nreturn [{json:{origin,timestamp:Date.now(),nonce:'schedule-' + $execution.id}}];"}),
http('Schedule due notifications',[480,40],"={{ $json.origin + '/api/integration/schedule' }}",'={{ { timestamp: $json.timestamp, nonce: $json.nonce } }}',[],{parameters:{authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth'}})
],connections:{'Every 15 minutes':{main:[[edge('App URL')]]},'App URL':{main:[[edge('Schedule due notifications')]]}}};
const fixtureCode=validate+'\n'+classify+`
const origin='https://helm.example';
const payload={schema_version:1,delivery_id:'11111111-1111-4111-8111-111111111111',event_id:'22222222-2222-4222-8222-222222222222',capability:'a'.repeat(64),timestamp:Date.now(),base_url:origin};
let passed=0;
function check(condition,name){if(!condition)throw new Error('FAILED: '+name);passed++;}
check(validateDispatch(payload,origin).event_id===payload.event_id,'valid event');
for(const [name,change] of [['replay',{timestamp:0}],['untrusted origin',{base_url:'https://evil.example'}],['invalid capability',{capability:'short'}],['wrong schema',{schema_version:2}]]){let rejected=false;try{validateDispatch({...payload,...change},origin);}catch{rejected=true;}check(rejected,name);}
check(classifyOutcome({statusCode:200,body:{id:'test-message'}},'test').state==='provider-accepted','provider accepted');
check(classifyOutcome({statusCode:429},'test').state==='uncertain','rate limit');
check(classifyOutcome({statusCode:503},'test').state==='uncertain','provider outage');
check(classifyOutcome({error:'network'},'test').state==='uncertain','network uncertainty');
check(classifyOutcome({statusCode:422},'test').state==='failed','validation rejection');
check(classifyOutcome({statusCode:200,body:{}},'test').state==='uncertain','missing provider id');
return [{json:{result:'PASS',checks:passed,scope:'Envelope validation and provider outcome classification only. No email sent; no live backend connection tested.'}}];`;
const contract={name:'Helm Track — Safe contract checks (no emails)',active:false,settings,nodes:[node('Run checks','manualTrigger',1,[0,0],{}),node('Contract checks','code',2,[240,0],{jsCode:fixtureCode})],connections:{'Run checks':{main:[[edge('Contract checks')]]}}};
for(const [file,workflow] of [['notification-delivery.json',delivery],['reminders-and-digest.json',scheduler],['contract-checks.json',contract]] as const)fs.writeFileSync(`n8n/${file}`,JSON.stringify(workflow,null,2)+'\n');
console.log('Generated three secret-free n8n workflows. Production origins and credentials remain intentionally unconfigured.');
