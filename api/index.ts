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
    console.error('API startup failed:', e);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({error: 'Server failed to start. Check function logs.'}));
  }
}
