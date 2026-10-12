import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { requireRole, sessionMiddleware } from './auth.ts';
import { C } from './db/store.ts';
import type { Deps } from './deps.ts';
import { h, HttpError, notFound } from './http.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { mentorRoutes } from './routes/mentor.ts';
import { studentRoutes } from './routes/student.ts';
import { createUpload } from './routes/upload.ts';
import { canDownload, contentDisposition, type StoredFile } from './services/files.ts';
import { markRead, notificationsFor } from './services/notifications.ts';
import { runScheduledJobs } from './services/jobs.ts';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Builds the API app. Static files / Vite are mounted by the entry point. */
export function createApp(deps: Deps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Scheduled jobs: call every 5–15 minutes (Cloud Scheduler, cron, uptime pinger…).
  app.all(
    '/api/cron/tick',
    h(async (req, res) => {
      const provided = String(req.headers['x-cron-secret'] || req.query.secret || '');
      if (!deps.cronSecret || !safeEqual(provided, deps.cronSecret)) throw new HttpError(401, 'Invalid cron secret.');
      const result = await runScheduledJobs(deps);
      await deps.store.put(C.meta, { id: 'last_job_run', result });
      res.json(result);
    }),
  );

  // CSRF defence in depth (on top of SameSite cookies): browsers cannot add this
  // header to cross-site requests without a CORS preflight, which we never allow.
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.headers['x-abugida-client'] === '1') return next();
    next(new HttpError(403, 'Request blocked.'));
  });

  const upload = createUpload(deps.maxUploadMb);
  app.use('/api', sessionMiddleware(deps));
  app.use('/api/auth', authRoutes(deps));
  app.use('/api/student', studentRoutes(deps, upload));
  app.use('/api/mentor', mentorRoutes(deps, upload));
  app.use('/api/admin', adminRoutes(deps));

  app.get(
    '/api/notifications',
    requireRole('student', 'mentor', 'admin'),
    h(async (req, res) => {
      res.json(await notificationsFor(deps, req.user!.id));
    }),
  );

  app.post(
    '/api/notifications/read',
    requireRole('student', 'mentor', 'admin'),
    h(async (req, res) => {
      await markRead(deps, req.user!.id, typeof req.body?.id === 'string' ? req.body.id : undefined);
      res.json(await notificationsFor(deps, req.user!.id));
    }),
  );

  app.get(
    '/api/files/:id',
    requireRole('student', 'mentor', 'admin'),
    h(async (req, res) => {
      const file = await deps.store.get<StoredFile>(C.files, req.params.id);
      if (!file || !(await canDownload(deps, req.user!, file))) throw notFound('File');
      res.setHeader('Content-Type', file.mime);
      res.setHeader('Content-Disposition', contentDisposition(file));
      res.setHeader('Cache-Control', 'private, max-age=300');
      const stream = await deps.blobs.read(file.storageKey);
      stream.on('error', (err) => {
        console.error('[files] read failed', err);
        if (!res.headersSent) res.status(404).end();
        else res.destroy();
      });
      stream.pipe(res);
    }),
  );

  app.use('/api', (_req, _res, next) => next(notFound('API route')));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `Files must be smaller than ${deps.maxUploadMb} MB.` : `Upload problem: ${err.message}`;
      res.status(400).json({ error: message });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed request.' });
      return;
    }
    console.error('[api] unexpected error', err);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}
