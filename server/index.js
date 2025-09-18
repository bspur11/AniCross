// server/index.js (ESM)
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8000;

// ! API routes
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'ocr-app', time: new Date().toISOString() });
});

// ! Serve built frontend (dist) in prod
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');

app.use(express.static(DIST_DIR));

// * SPA fallback: send index.html for unknown routes (after /api routes)
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
