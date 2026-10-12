import type { Store } from './db/store.ts';
import type { BlobStore } from './files/blobStore.ts';
import type { AiService } from './services/ai.ts';
import type { DriveService } from './services/drive.ts';
import type { Mailer } from './services/email.ts';

/** Everything the services need from the outside world; swapped for fakes in tests. */
export interface Deps {
  store: Store;
  blobs: BlobStore;
  mailer: Mailer;
  ai: AiService;
  drive: DriveService | null;
  now: () => Date;
  appUrl: string;
  sessionSecret: string;
  sessionDays: number;
  secureCookies: boolean;
  maxUploadMb: number;
  cronSecret: string;
  dataBackend: string;
}
