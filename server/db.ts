import 'dotenv/config';
import knex from 'knex';
import fs from 'node:fs';
import path from 'node:path';
export const dataDir = path.resolve(process.env.DATA_DIR || '.data');
fs.mkdirSync(dataDir,{recursive:true});
export const production = process.env.NODE_ENV === 'production';
const postgres = !!process.env.DATABASE_URL;
if(production && (!postgres || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length<32 || !process.env.APP_URL?.startsWith('https://') || !process.env.S3_ENDPOINT)) throw new Error('Production requires Postgres, SESSION_SECRET (32+ characters), HTTPS APP_URL and private S3 storage');
export const db = knex(postgres ? {client:'pg',connection:{connectionString:process.env.DATABASE_URL,ssl:production?{rejectUnauthorized:true,...(process.env.DATABASE_CA_FILE?{ca:fs.readFileSync(process.env.DATABASE_CA_FILE,'utf8')}:{})}:undefined},searchPath:[process.env.DATABASE_SCHEMA||'helm'],pool:{min:0,max:8}} : {client:'better-sqlite3',connection:{filename:path.join(dataDir,'helm.sqlite')},useNullAsDefault:true,pool:{min:1,max:1,afterCreate:(conn:any,done:any)=>{conn.pragma('foreign_keys = ON');conn.pragma('journal_mode = WAL');done(null,conn);}}});
export const now = () => new Date().toISOString();
export async function migrate(){
  if(postgres){const schema=process.env.DATABASE_SCHEMA||'helm';if(!/^[a-z_][a-z0-9_]*$/.test(schema))throw new Error('Invalid schema');await db.raw(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);}
  const m001 = {
    up: async (k:any) => {
      await k.schema.createTable('users',(t:any)=>{t.uuid('id').primary();t.string('email').unique().notNullable();t.string('name').notNullable();t.string('password_hash');t.string('role').notNullable();t.boolean('verified').defaultTo(false);t.boolean('active').defaultTo(true);t.string('created_at').notNullable();});
      await k.schema.createTable('sessions',(t:any)=>{t.string('id').primary();t.uuid('user_id').references('users.id').onDelete('CASCADE');t.string('expires_at').index();});
      await k.schema.createTable('projects',(t:any)=>{t.uuid('id').primary();t.string('name').notNullable().unique();t.string('description');t.boolean('active').defaultTo(true);t.string('created_at');});
      await k.schema.createTable('memberships',(t:any)=>{t.uuid('project_id').references('projects.id');t.uuid('user_id').references('users.id');t.primary(['project_id','user_id']);});
      await k.schema.createTable('invites',(t:any)=>{t.string('id').primary();t.uuid('user_id').references('users.id');t.string('expires_at');t.boolean('used').defaultTo(false);});
      await k.schema.createTable('issues',(t:any)=>{t.increments('number');t.uuid('id').unique().notNullable();t.string('reference').unique();t.uuid('project_id').references('projects.id').notNullable();t.uuid('reporter_id').references('users.id').notNullable();t.uuid('assignee_id').references('users.id');t.string('type');t.string('title');t.text('description');t.text('steps');t.text('expected');t.text('actual');t.text('reason');t.text('desired');t.text('notes');t.string('url',2048);t.string('environment');t.string('build');t.string('severity');t.string('priority');t.string('category');t.string('status').index();t.integer('version').defaultTo(1);t.integer('cycle').defaultTo(0);t.boolean('archived').defaultTo(false);t.uuid('duplicate_of').references('issues.id');t.text('device');t.string('idempotency_key');t.string('created_at').index();t.string('updated_at');t.unique(['reporter_id','idempotency_key']);});
      await k.schema.createTable('comments',(t:any)=>{t.uuid('id').primary();t.uuid('issue_id').references('issues.id').index();t.uuid('user_id').references('users.id');t.text('body');t.boolean('internal').defaultTo(false);t.string('created_at');});
      await k.schema.createTable('activity',(t:any)=>{t.uuid('id').primary();t.uuid('issue_id').references('issues.id').index();t.uuid('user_id').references('users.id');t.string('action');t.text('detail');t.boolean('internal').defaultTo(false);t.string('created_at');});
      await k.schema.createTable('approvals',(t:any)=>{t.uuid('id').primary();t.uuid('issue_id').references('issues.id');t.uuid('admin_id').references('users.id');t.integer('cycle');t.text('summary');t.string('build');t.string('test_url',2048);t.string('created_at');t.unique(['issue_id','cycle']);});
      await k.schema.createTable('attachments',(t:any)=>{t.uuid('id').primary();t.uuid('issue_id').references('issues.id');t.uuid('user_id').references('users.id');t.string('name');t.string('mime');t.integer('size');t.string('storage_key').unique();t.string('created_at').index();});
      await k.schema.createTable('events',(t:any)=>{t.uuid('id').primary();t.uuid('issue_id').references('issues.id');t.string('kind');t.integer('cycle');t.string('dedupe').unique();t.string('created_at');});
      await k.schema.createTable('deliveries',(t:any)=>{t.uuid('id').primary();t.uuid('event_id').references('events.id').index();t.string('recipient');t.string('subject');t.text('html');t.text('text');t.string('state').index();t.integer('attempts').defaultTo(0);t.string('next_attempt').index();t.string('lease_until');t.string('first_claim_at');t.string('provider_id').index();t.string('error');t.string('token_hash');t.string('token_expires');t.string('created_at');t.string('updated_at');t.unique(['event_id','recipient']);});
      await k.schema.createTable('attempts',(t:any)=>{t.uuid('id').primary();t.uuid('delivery_id').references('deliveries.id').index();t.string('state');t.string('error');t.string('execution_id');t.string('created_at');});
      await k.schema.createTable('settings',(t:any)=>{t.integer('id').primary();t.integer('reminder_hours').defaultTo(48);t.boolean('digest_enabled').defaultTo(false);t.string('timezone').defaultTo('America/Chicago');t.string('digest_time').defaultTo('09:00');t.text('recipients').defaultTo('[]');});
      await k('settings').insert({id:1,reminder_hours:48,timezone:'America/Chicago',digest_enabled:false,recipients:'[]',digest_time:'09:00'});
      await k.schema.createTable('audit',(t:any)=>{t.uuid('id').primary();t.uuid('user_id').references('users.id');t.string('action');t.text('detail');t.string('created_at');});
      await k.schema.createTable('limits',(t:any)=>{t.string('key').primary();t.integer('count');t.string('expires_at').index();});
    },
    down: async () => { throw new Error('Destructive rollback is intentionally unsupported; restore a verified backup.'); }
  };
  // Migration 002: add assigned_to / assigned_role columns for the no-login workflow
  const m002 = {
    up: async (k:any) => {
      const hasCol = await k.schema.hasColumn('issues','assigned_to');
      if(!hasCol){
        await k.schema.table('issues',(t:any)=>{
          t.string('assigned_to').defaultTo('');
          t.string('assigned_role').defaultTo(''); // 'tester' | 'developer' | ''
        });
      }
    },
    down: async () => {}
  };
  await db.migrate.latest({migrationSource:{
    getMigrations: async () => ['001','002'],
    getMigrationName: (m:string) => m,
    getMigration: async (m:string) => m==='001' ? m001 : m002,
  }});
}
