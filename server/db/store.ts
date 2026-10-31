import fs from 'node:fs';
import path from 'node:path';

export type Scalar = string | number | boolean | null;
export type Where = Record<string, Scalar>;

export interface FindOptions {
  /** Matches documents whose array field contains the value (Firestore array-contains). */
  arrayContains?: { field: string; value: Scalar };
}

/**
 * Minimal document store used by every service. Keeping the surface this small
 * lets the same business logic run on Firestore in production and on a local
 * JSON file (or pure memory, for tests) during development.
 */
export interface Store {
  get<T>(collection: string, id: string): Promise<T | null>;
  find<T>(collection: string, where?: Where, options?: FindOptions): Promise<T[]>;
  put<T extends { id: string }>(collection: string, doc: T): Promise<T>;
  patch<T>(collection: string, id: string, changes: Partial<T>): Promise<T | null>;
  remove(collection: string, id: string): Promise<void>;
  /** Creates the document only if it does not exist yet. Returns false if it already existed. */
  createIfAbsent<T extends { id: string }>(collection: string, doc: T): Promise<boolean>;
  close?(): Promise<void>;
}

export const C = {
  users: 'users',
  courses: 'courses',
  sessions: 'sessions',
  homework: 'homework',
  submissions: 'submissions',
  curricula: 'curricula',
  quizzes: 'quizzes',
  attempts: 'quizAttempts',
  reports: 'parentReports',
  emails: 'emails',
  files: 'files',
  settings: 'settings',
  locks: 'locks',
  meta: 'meta',
  matchRequests: 'matchRequests',
  notifications: 'notifications',
  feedback: 'classFeedback',
  quizSessions: 'quizSessions',
  parentRequests: 'parentRequests',
  rewards: 'rewards',
  passwordResets: 'passwordResets',
  invites: 'invites',
  homeworkDrafts: 'homeworkDrafts',
} as const;

function matches(doc: Record<string, unknown>, where: Where = {}, options: FindOptions = {}): boolean {
  for (const [key, value] of Object.entries(where)) {
    if ((doc[key] ?? null) !== value) return false;
  }
  if (options.arrayContains) {
    const arr = doc[options.arrayContains.field];
    if (!Array.isArray(arr) || !arr.includes(options.arrayContains.value)) return false;
  }
  return true;
}

function stripUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** In-memory store, optionally persisted to a JSON file. */
export class MemoryStore implements Store {
  private data: Record<string, Record<string, Record<string, unknown>>> = {};
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly filePath?: string) {
    if (filePath && fs.existsSync(filePath)) {
      this.data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  }

  private col(name: string) {
    return (this.data[name] ??= {});
  }

  private scheduleSave() {
    if (!this.filePath || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 150);
  }

  flush() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.filePath);
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const doc = this.col(collection)[id];
    return doc ? (structuredClone(doc) as T) : null;
  }

  async find<T>(collection: string, where?: Where, options?: FindOptions): Promise<T[]> {
    return Object.values(this.col(collection))
      .filter((doc) => matches(doc, where, options))
      .map((doc) => structuredClone(doc) as T);
  }

  async put<T extends { id: string }>(collection: string, doc: T): Promise<T> {
    this.col(collection)[doc.id] = stripUndefined(doc) as Record<string, unknown>;
    this.scheduleSave();
    return structuredClone(doc);
  }

  async patch<T>(collection: string, id: string, changes: Partial<T>): Promise<T | null> {
    const existing = this.col(collection)[id];
    if (!existing) return null;
    const merged = stripUndefined({ ...existing, ...changes }) as Record<string, unknown>;
    for (const [key, value] of Object.entries(changes)) if (value === undefined) delete merged[key];
    this.col(collection)[id] = merged;
    this.scheduleSave();
    return structuredClone(merged) as T;
  }

  async remove(collection: string, id: string): Promise<void> {
    delete this.col(collection)[id];
    this.scheduleSave();
  }

  async createIfAbsent<T extends { id: string }>(collection: string, doc: T): Promise<boolean> {
    if (this.col(collection)[doc.id]) return false;
    await this.put(collection, doc);
    return true;
  }

  async close() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.flush();
  }
}
