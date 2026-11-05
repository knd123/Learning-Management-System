import type { App } from 'firebase-admin/app';
import { FieldValue, getFirestore, type Firestore, type Query } from 'firebase-admin/firestore';
import { inRange, type FindOptions, type Range, type Store, type Where } from './store.ts';

let warnedMissingIndex = false;

/** Firestore-backed store used in production (Cloud Run uses application default credentials). */
export class FirestoreStore implements Store {
  private readonly db: Firestore;

  constructor(app: App, databaseId: string) {
    this.db = databaseId && databaseId !== '(default)' ? getFirestore(app, databaseId) : getFirestore(app);
    this.db.settings({ ignoreUndefinedProperties: true });
  }

  async get<T>(collection: string, id: string): Promise<T | null> {
    const snap = await this.db.collection(collection).doc(id).get();
    return snap.exists ? (snap.data() as T) : null;
  }

  async find<T>(collection: string, where: Where = {}, options: FindOptions = {}): Promise<T[]> {
    let query: Query = this.db.collection(collection);
    for (const [key, value] of Object.entries(where)) query = query.where(key, '==', value);
    if (options.arrayContains) {
      query = query.where(options.arrayContains.field, 'array-contains', options.arrayContains.value);
    }
    const snap = await query.get();
    return snap.docs.map((d) => d.data() as T);
  }

  async findRange<T>(collection: string, where: Where, range: Range): Promise<T[]> {
    let query: Query = this.db.collection(collection);
    for (const [key, value] of Object.entries(where)) query = query.where(key, '==', value);
    if (range.from !== undefined) query = query.where(range.field, '>=', range.from);
    if (range.to !== undefined) query = query.where(range.field, '<', range.to);
    try {
      const snap = await query.get();
      return snap.docs.map((d) => d.data() as T);
    } catch (err) {
      // An equality filter plus a range needs a composite index (deploy/gcp/deploy.sh creates it).
      // Until it exists, read the matching documents and filter here, so nothing breaks.
      if ((err as { code?: number }).code !== 9) throw err; // FAILED_PRECONDITION
      if (!warnedMissingIndex) {
        warnedMissingIndex = true;
        console.warn(`[firestore] missing index for ${collection} (${Object.keys(where).join(', ')} + ${range.field}); reading without it`);
      }
      return (await this.find<Record<string, unknown>>(collection, where)).filter((d) => inRange(d[range.field], range)) as T[];
    }
  }

  async put<T extends { id: string }>(collection: string, doc: T): Promise<T> {
    await this.db.collection(collection).doc(doc.id).set(doc);
    return doc;
  }

  async patch<T>(collection: string, id: string, changes: Partial<T>): Promise<T | null> {
    const ref = this.db.collection(collection).doc(id);
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(changes)) {
      update[key] = value === undefined ? FieldValue.delete() : value;
    }
    try {
      await ref.update(update);
    } catch (err) {
      if ((err as { code?: number }).code === 5) return null; // NOT_FOUND
      throw err;
    }
    const snap = await ref.get();
    return snap.data() as T;
  }

  async remove(collection: string, id: string): Promise<void> {
    await this.db.collection(collection).doc(id).delete();
  }

  async createIfAbsent<T extends { id: string }>(collection: string, doc: T): Promise<boolean> {
    try {
      await this.db.collection(collection).doc(doc.id).create(doc);
      return true;
    } catch (err) {
      if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
      throw err;
    }
  }
}
