// Local server: serves public/ and the same API handlers Vercel deploys from api/.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import run from './api/run.js';
import health from './api/health.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.post('/api/run', run);
app.get('/api/health', health);
// pretty routes (mirrors vercel.json rewrites)
app.get('/p/:id', (req, res) => res.sendFile(path.join(here, 'public', 'person.html')));
app.get('/date/:id', (req, res) => res.sendFile(path.join(here, 'public', 'date.html')));
app.use(express.static(path.join(here, 'public'), { extensions: ['html'] }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Standin on http://localhost:${port}`));
