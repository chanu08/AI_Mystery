import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { connectDatabase } from './config/db.js';
import { initializeCases } from './services/cases.js';

dotenv.config({ path:fileURLToPath(new URL('../.env',import.meta.url)) });
dotenv.config({ path:fileURLToPath(new URL('../../.env',import.meta.url)), override:false });

const app = createApp();
const port = Number(process.env.PORT || 5000);
const databaseConnected = await connectDatabase();
if (process.env.NODE_ENV === 'production' && !databaseConnected) {
  console.error('Production startup stopped: set a valid, reachable MONGODB_URI before deploying.');
  process.exit(1);
}
await initializeCases();
app.listen(port, '0.0.0.0', () => console.log(`AI Mystery Room listening on port ${port}`));
