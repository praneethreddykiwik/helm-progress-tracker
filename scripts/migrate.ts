import {migrate,db} from '../server/db.js';
await migrate();await db.destroy();console.log('Database migrations applied.');
