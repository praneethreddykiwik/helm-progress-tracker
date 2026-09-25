import type {IncomingMessage, ServerResponse} from 'node:http';

const ready = (async () => {
  const {migrate} = await import('../server/db.js');
  const {createApp} = await import('../server/app.js');
  await migrate();
  return createApp();
})();

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await ready;
    app(req as any, res as any);
  } catch (e: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({error: e?.message || 'startup failed', name: e?.name, stack: String(e?.stack || '').split('\n').slice(0, 6)}));
  }
}
