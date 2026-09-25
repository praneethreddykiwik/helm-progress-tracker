import {migrate} from './db.js';
import {createApp} from './app.js';
await migrate();
const port=Number(process.env.PORT||3001);
createApp().listen(port,process.env.NODE_ENV==='production'?'0.0.0.0':'127.0.0.1',()=>console.log(`Helm Track server listening on port ${port}`));
