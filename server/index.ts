import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.ts';
import { hashPassword, type UserRecord } from './auth.ts';
import { config } from './config.ts';
import { C, type Store } from './db/store.ts';
import type { Deps } from './deps.ts';
import { DisabledAi, GeminiAi } from './services/ai.ts';
import { GoogleDriveService } from './services/drive.ts';
import { LogMailer, SmtpMailer } from './services/email.ts';
import { runScheduledJobs } from './services/jobs.ts';
import { getSettings } from './services/settings.ts';
import { buildStorage } from './storage.ts';

/** Creates the first admin account from ADMIN_USERNAME / ADMIN_PASSWORD when none exists. */
async function bootstrapAdmin(store: Store) {
  const admins = await store.find<UserRecord>(C.users, { role: 'admin' });
  if (admins.length) return;
  const { username, password, email, name } = config.bootstrapAdmin;
  if (!username || !password) {
    console.warn('[setup] No admin account exists yet. Set ADMIN_USERNAME and ADMIN_PASSWORD and restart to create one.');
    return;
  }
  const settings = await getSettings(store);
  await store.put<UserRecord>(C.users, {
    id: crypto.randomUUID(),
    username: username.trim().toLowerCase(),
    role: 'admin',
    displayName: name,
    email: email || undefined,
    timezone: settings.timezone,
    active: true,
    createdAt: new Date().toISOString(),
    passwordHash: await hashPassword(password),
    tokenVersion: 1,
  });
  console.log(`[setup] Created admin account "${username}".`);
}

async function main() {
  const { store, blobs } = await buildStorage();
  const deps: Deps = {
    store,
    blobs,
    mailer: config.smtp.host ? new SmtpMailer(config.smtp, config.emailFrom) : new LogMailer(),
    ai: config.geminiApiKey ? new GeminiAi(config.geminiApiKey, config.geminiModel) : new DisabledAi(),
    drive: config.driveEnabled ? new GoogleDriveService() : null,
    now: () => new Date(),
    appUrl: config.appUrl,
    sessionSecret: config.sessionSecret,
    sessionDays: config.sessionDays,
    secureCookies: config.isProduction,
    maxUploadMb: config.maxUploadMb,
    cronSecret: config.cronSecret,
    dataBackend: config.dataBackend,
  };
  await bootstrapAdmin(store);

  const app = createApp(deps);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  if (config.isProduction) {
    const clientDir = fs.existsSync(path.join(root, 'client')) ? path.join(root, 'client') : path.join(root, 'dist', 'client');
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  const server = app.listen(config.port, () => {
    console.log(`Abugida LMS running on http://localhost:${config.port}`);
    console.log(`  data: ${config.dataBackend} | files: ${config.fileBackend} | email: ${deps.mailer.live ? 'SMTP' : 'log only'} | AI: ${deps.ai.enabled ? config.geminiModel : 'off'} | Drive: ${deps.drive ? 'on' : 'off'}`);
  });

  let timer: NodeJS.Timeout | undefined;
  if (config.internalScheduler) {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const result = await runScheduledJobs(deps);
        await store.put(C.meta, { id: 'last_job_run', result });
      } catch (err) {
        console.error('[scheduler] run failed', err);
      } finally {
        running = false;
      }
    };
    setTimeout(tick, 15_000);
    timer = setInterval(tick, config.schedulerIntervalMinutes * 60_000);
  }

  const shutdown = async () => {
    if (timer) clearInterval(timer);
    server.close();
    await store.close?.();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
