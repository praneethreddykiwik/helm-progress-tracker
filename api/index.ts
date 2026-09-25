import type {IncomingMessage, ServerResponse} from 'node:http';
import {migrate} from '../server/db.js';
import {createApp} from '../server/app.js';

const ready = migrate().then(() => createApp());

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready;
  app(req as any, res as any);
}
