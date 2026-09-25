import {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import fs from 'node:fs/promises';
import path from 'node:path';
import {dataDir} from './db.js';
import {fail} from './auth.js';
const s3=process.env.S3_ENDPOINT?new S3Client({endpoint:process.env.S3_ENDPOINT,region:process.env.S3_REGION||'us-east-1',forcePathStyle:true,credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID||'',secretAccessKey:process.env.S3_SECRET_ACCESS_KEY||''}}):null;
const bucket=process.env.S3_BUCKET||'helm-screenshots';
export async function validateImage(buffer:Buffer,mime:string){
 const format=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':buffer[0]===255&&buffer[1]===216&&buffer[2]===255?'jpeg':buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP'?'webp':null;
 if(!format||mime!==`image/${format}`)throw fail(400,'Only valid PNG, JPEG and WebP screenshots are allowed.');
 try{const {default:sharp}=await import('sharp');const meta=await sharp(buffer,{limitInputPixels:40_000_000}).metadata();if(meta.pages&&meta.pages>1)throw new Error('Animated image');return await sharp(buffer,{limitInputPixels:40_000_000}).toFormat(format).toBuffer();}catch{throw fail(400,'The image is invalid, animated, or exceeds 40 megapixels.');}
}
export async function put(key:string,buffer:Buffer,mime:string){if(s3)await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:buffer,ContentType:mime}));else{await fs.mkdir(path.join(dataDir,'uploads'),{recursive:true});await fs.writeFile(path.join(dataDir,'uploads',key),buffer,{mode:0o600});}}
export async function remove(key:string){if(s3)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key}));else await fs.rm(path.join(dataDir,'uploads',key),{force:true});}
export async function download(key:string){return s3?{url:await getSignedUrl(s3,new GetObjectCommand({Bucket:bucket,Key:key}),{expiresIn:60})}:{file:path.join(dataDir,'uploads',key)};}
