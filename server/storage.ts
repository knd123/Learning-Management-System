import path from 'node:path';
import { config } from './config.ts';
import { MemoryStore, type Store } from './db/store.ts';
import { GcsBlobStore, LocalBlobStore, type BlobStore } from './files/blobStore.ts';

/** Picks the database and file storage from the environment (see .env.example). */
export async function buildStorage(): Promise<{ store: Store; blobs: BlobStore }> {
  if (config.dataBackend === 'firestore' || config.fileBackend === 'gcs') {
    const { initializeApp, getApps } = await import('firebase-admin/app');
    const app = getApps()[0] || initializeApp({ projectId: config.firebaseProjectId, storageBucket: config.storageBucket });
    const { FirestoreStore } = await import('./db/firestoreStore.ts');
    return {
      store: config.dataBackend === 'firestore' ? new FirestoreStore(app, config.firestoreDatabaseId) : new MemoryStore(path.join(config.dataDir, 'db.json')),
      blobs: config.fileBackend === 'gcs' ? new GcsBlobStore(app, config.storageBucket) : new LocalBlobStore(path.join(config.dataDir, 'uploads')),
    };
  }
  return {
    store: config.dataBackend === 'memory' ? new MemoryStore() : new MemoryStore(path.join(config.dataDir, 'db.json')),
    blobs: new LocalBlobStore(path.join(config.dataDir, 'uploads')),
  };
}
