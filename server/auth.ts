import {randomBytes,scryptSync,timingSafeEqual,createHash,createHmac} from 'node:crypto';
import type {Request,Response,NextFunction} from 'express';
import {db,now,production} from './db.js';
export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const token=()=>randomBytes(32).toString('hex');
export function passwordHash(password:string){const salt=token();return `${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function passwordValid(password:string,stored:string){const [salt,key]=stored.split(':');if(!salt||!key)return false;const a=scryptSync(password,salt,64),b=Buffer.from(key,'hex');return a.length===b.length&&timingSafeEqual(a,b);}
export const fail=(status:number,message:string)=>Object.assign(new Error(message),{status});
export function publicUser(u:any){return {id:u.id,name:u.name,email:u.email,role:u.role,active:!!u.active,verified:!!u.verified};}
export async function auth(req:Request,res:Response,next:NextFunction){try{const cookie=req.cookies?.helm_session;if(!cookie)throw fail(401,'Please sign in.');const session=await db('sessions').where({id:hash(cookie)}).where('expires_at','>',now()).first();const user=session&&await db('users').where({id:session.user_id,active:true,verified:true}).first();if(!user)throw fail(401,'Your session expired. Please sign in.');(req as any).user=user;next();}catch(e){next(e);}}
export const admin=(req:Request,res:Response,next:NextFunction)=>{if((req as any).user.role!=='admin')return next(fail(403,'Administrator access required.'));next();};
export async function session(res:Response,userId:string){const secret=token();await db('sessions').insert({id:hash(secret),user_id:userId,expires_at:new Date(Date.now()+7*86400000).toISOString()});res.cookie('helm_session',secret,{httpOnly:true,secure:production,sameSite:'lax',path:'/',maxAge:7*86400000});}
export async function accessible(q:any,user:any,id:string){const issue=await q('issues').where({id}).first();if(!issue|| (user.role!=='admin'&&issue.reporter_id!==user.id))throw fail(404,'Issue not found.');return issue;}
export function signDownload(id:string,userId:string,expires:number){return createHmac('sha256',process.env.SESSION_SECRET||'local-development-only').update(`${id}:${userId}:${expires}`).digest('hex');}
export async function rateLimit(key:string,max:number,minutes:number){const bucket=Math.floor(Date.now()/(minutes*60000));const k=hash(`${key}:${bucket}`);const [row]=await db('limits').insert({key:k,count:1,expires_at:new Date((bucket+1)*minutes*60000).toISOString()}).onConflict('key').merge({count:db.raw('?? + 1',['limits.count'])}).returning('count');if(row.count>max)throw fail(429,'Too many requests. Please try again later.');}
