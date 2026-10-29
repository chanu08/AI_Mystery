import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCase, findCase, listCases, resolveAccusation, revealCase, caseStatus, persistCase } from './services/cases.js';
import { safeCase } from './services/serialization.js';
import { databaseStatus, databaseErrorCode } from './config/db.js';

export function createApp() {
  const app = express();
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:5173', credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'ai-mystery-room', database: databaseStatus(), databaseErrorCode:databaseErrorCode() }));
  app.post('/api/auth/guest', (_req, res) => {
    const guestId = crypto.randomUUID();
    res.cookie('guestId', guestId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
    res.json({ guestId });
  });
  app.get('/api/auth/me', (req, res) => res.json({ user: null, guest: Boolean(req.cookies.guestId) }));
  app.post('/api/cases', async (req, res, next) => {
    try {
      const input = z.object({ seed: z.string().trim().min(10).max(1000), difficulty: z.enum(['easy','medium','hard']).default('medium'), tone: z.enum(['realistic','noir','cozy','thriller']).default('realistic') }).parse(req.body);
      const guestId = req.cookies.guestId || crypto.randomUUID();
      if (!req.cookies.guestId) res.cookie('guestId', guestId, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
      const record = await createCase(input, guestId);
      res.status(202).json({ caseId: record.id, status: record.status });
    } catch (e) { next(e); }
  });
  app.get('/api/cases', (req, res) => res.json({ cases: listCases(req.cookies.guestId || '__anonymous__').map(safeCase) }));
  app.use('/api/cases/:id', (req, res, next) => {
    const c = findCase(req.params.id);
    if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } });
    if (!req.cookies.guestId || req.cookies.guestId !== c.guestId) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not have access to this case.' } });
    next();
  });
  app.get('/api/cases/:id/status', (req, res) => { const c = findCase(req.params.id); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }); res.json(caseStatus(c)); });
  app.get('/api/cases/:id', (req, res) => { const c = findCase(req.params.id); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }); res.json(safeCase(c)); });
  app.get('/api/cases/:id/evidence', (req, res) => { const c = findCase(req.params.id); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }); res.json({ evidence: c.evidence }); });
  app.get('/api/cases/:id/reveal', (req, res) => { const c = findCase(req.params.id); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }); if (!['solved','failed_attempts','abandoned'].includes(c.status)) return res.status(403).json({ error: { code: 'CASE_ACTIVE', message: 'The case is still active.' } }); res.json({ solution: c.solution, status: c.status }); });
  app.post('/api/cases/:id/hints', (req, res) => { const c = findCase(req.params.id); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }); if (c.hintsUsed >= 3) return res.status(400).json({ error: { code: 'HINT_LIMIT', message: 'No hints remain.' } }); const hint = c.solution.hints[c.hintsUsed++]; void persistCase(c); res.json({ hint, hintsUsed: c.hintsUsed }); });
  app.post('/api/cases/:id/accuse', (req, res) => { try { const { suspectId, reasoning = '' } = z.object({ suspectId: z.string(), reasoning: z.string().max(1000).optional() }).parse(req.body); const c = findCase(req.params.id); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }); const result=resolveAccusation(c, suspectId, reasoning); void persistCase(c); res.json(result); } catch (e) { res.status(400).json({ error: { code: 'INVALID_INPUT', message: e.message } }); } });
  app.post('/api/cases/:id/giveup', (req, res) => { const c = findCase(req.params.id); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Case not found' } }); c.status = 'abandoned'; void persistCase(c); res.json(revealCase(c)); });
  app.post('/api/cases/:id/share', (req, res) => { const c = findCase(req.params.id); if (!c || !['solved','failed_attempts','abandoned'].includes(c.status)) return res.status(400).json({ error: { code: 'CASE_UNRESOLVED', message: 'Resolve the case before sharing.' } }); c.shareToken ||= crypto.randomUUID(); void persistCase(c); res.json({ shareToken: c.shareToken, url: `/shared/${c.shareToken}` }); });
  app.get('/api/shared/:token', (req, res) => { const c = [...listCases()].find(x => x.shareToken === req.params.token); if (!c) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Shared case not found' } }); res.json({ ...safeCase(c), solution: c.solution }); });
  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'API route not found.' } }));
  app.use((err, _req, res, _next) => {
    const status = err.name === 'ZodError' ? 400 : 500;
    res.status(status).json({ error: { code: status === 400 ? 'INVALID_INPUT' : 'SERVER_ERROR', message: status === 400 ? err.message : 'Something went wrong.', details: status === 400 ? err.issues : undefined } });
  });
  if (process.env.NODE_ENV === 'production') {
    const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }
  return app;
}
