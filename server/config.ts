import fs from 'node:fs';
import path from 'node:path';

// Load .env / .env.local for local development (production gets real env vars).
for (const file of ['.env.local', '.env']) {
  const full = path.resolve(process.cwd(), file);
  if (fs.existsSync(full)) process.loadEnvFile(full);
}

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function sessionSecret(): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (isProduction) {
    throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters in production.');
  }
  return 'dev-only-session-secret-change-me-0123456789';
}

export const config = {
  isProduction,
  port: Number(env.PORT || 3000),
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  sessionSecret: sessionSecret(),
  sessionDays: Number(env.SESSION_DAYS || 14),

  dataBackend: (env.DATA_BACKEND || 'file') as 'file' | 'firestore' | 'memory',
  dataDir: path.resolve(env.DATA_DIR || './data'),
  firebaseProjectId: env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || undefined,
  firestoreDatabaseId: env.FIRESTORE_DATABASE_ID || '(default)',
  fileBackend: (env.FILE_BACKEND || (env.DATA_BACKEND === 'firestore' ? 'gcs' : 'local')) as 'local' | 'gcs',
  storageBucket: env.STORAGE_BUCKET || undefined,
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 25),

  geminiApiKey: env.GEMINI_API_KEY || '',
  geminiModel: env.GEMINI_MODEL || 'gemini-flash-latest',

  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: bool(env.SMTP_SECURE, false),
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
  },
  emailFrom: env.EMAIL_FROM || 'Abugida Education <info@abugidaeducation.com>',

  cronSecret: env.CRON_SECRET || '',
  internalScheduler: bool(env.INTERNAL_SCHEDULER, true),
  schedulerIntervalMinutes: Number(env.SCHEDULER_INTERVAL_MINUTES || 10),

  driveEnabled: bool(env.GOOGLE_DRIVE_ENABLED, false),

  bootstrapAdmin: {
    username: env.ADMIN_USERNAME || '',
    password: env.ADMIN_PASSWORD || '',
    email: env.ADMIN_EMAIL || '',
    name: env.ADMIN_NAME || 'Abugida Admin',
  },
};

export type Config = typeof config;
