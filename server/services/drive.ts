import { GoogleAuth } from 'google-auth-library';

/**
 * A link to one file in Google Drive (".../file/d/<id>/view", "open?id=<id>"): its id and, for
 * links shared before Google's 2021 security update, the resource key. Folder and Docs links don't count.
 */
export function parseDriveVideoLink(url: string): { fileId: string; resourceKey?: string } | undefined {
  try {
    const u = new URL(url);
    if (!/^drive(\.usercontent)?\.google\.com$/.test(u.hostname)) return undefined;
    const fromPath = u.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([\w-]{10,})/)?.[1];
    const fromQuery = /^\/(open|uc|download)$/.test(u.pathname) ? u.searchParams.get('id') : null;
    const fileId = fromPath || fromQuery;
    if (!fileId || !/^[\w-]{10,}$/.test(fileId)) return undefined;
    const key = u.searchParams.get('resourcekey');
    return { fileId, resourceKey: key && /^[\w-]{1,100}$/.test(key) ? key : undefined };
  } catch {
    return undefined;
  }
}

/** One piece of a video: 206 with the bytes, 416 when `start` is past the end, or Drive's error status. */
export interface VideoChunk {
  status: number;
  contentType?: string;
  /** "bytes <start>-<end>/<total>" */
  contentRange?: string;
  contentLength?: string;
  body?: ReadableStream<Uint8Array>;
}

/**
 * Reads videos that mentors share "Anyone with the link" in their own Google Drive, so the portal
 * can play them itself: students never get the Drive link or see Drive's page about the file.
 */
export interface DriveVideos {
  /** The file's type, or the status Drive answered with (404 when it isn't shared by link). */
  check(fileId: string, resourceKey?: string): Promise<{ mimeType: string } | { status: number }>;
  /** Bytes `start` to `end` (inclusive) of the file. */
  read(fileId: string, resourceKey: string | undefined, start: number, end: number): Promise<VideoChunk>;
}

/** Reads link-shared files through the Drive API with the server's own Google account (on Cloud Run: the runtime service account). */
export class GoogleDriveVideos implements DriveVideos {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });

  private async headers(fileId: string, resourceKey?: string): Promise<Record<string, string>> {
    const { token } = await (await this.auth.getClient()).getAccessToken();
    return { authorization: `Bearer ${token}`, ...(resourceKey ? { 'x-goog-drive-resource-keys': `${fileId}/${resourceKey}` } : {}) };
  }

  private url(fileId: string, query: string): string {
    return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&${query}`;
  }

  async check(fileId: string, resourceKey?: string) {
    const res = await fetch(this.url(fileId, 'fields=mimeType'), { headers: await this.headers(fileId, resourceKey) });
    if (!res.ok) return { status: res.status };
    return { mimeType: String(((await res.json()) as { mimeType?: string }).mimeType || '') };
  }

  async read(fileId: string, resourceKey: string | undefined, start: number, end: number): Promise<VideoChunk> {
    const res = await fetch(this.url(fileId, 'alt=media'), { headers: { ...(await this.headers(fileId, resourceKey)), range: `bytes=${start}-${end}` } });
    const header = (name: string) => res.headers.get(name) || undefined;
    return { status: res.status, contentType: header('content-type'), contentRange: header('content-range'), contentLength: header('content-length'), body: res.body ?? undefined };
  }
}

export interface DriveService {
  /** Gives `email` view access to a file until `expiresAt`. Returns the permission id. */
  grantReader(fileId: string, email: string, expiresAt: Date): Promise<string>;
  revoke(fileId: string, permissionId: string): Promise<void>;
}

/**
 * Talks to the Drive REST API with the server's Google credentials (on Cloud Run:
 * the runtime service account). Student folders must be shared with that account
 * as "Editor" so it can manage access to recordings.
 */
export class GoogleDriveService implements DriveService {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive'] });

  private async request<T>(method: 'POST' | 'DELETE', url: string, data?: unknown): Promise<T> {
    const client = await this.auth.getClient();
    const res = await client.request<T>({ method, url, data });
    return res.data;
  }

  async grantReader(fileId: string, email: string, expiresAt: Date): Promise<string> {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?sendNotificationEmail=false&supportsAllDrives=true`;
    try {
      const out = await this.request<{ id: string }>('POST', url, { type: 'user', role: 'reader', emailAddress: email, expirationTime: expiresAt.toISOString() });
      return out.id;
    } catch (err) {
      // Some Drive setups (e.g. shared drives) reject expiration times; the
      // revocation job removes access at the deadline in that case.
      if ((err as { response?: { status?: number } }).response?.status !== 400) throw err;
      const out = await this.request<{ id: string }>('POST', url, { type: 'user', role: 'reader', emailAddress: email });
      return out.id;
    }
  }

  async revoke(fileId: string, permissionId: string): Promise<void> {
    try {
      await this.request('DELETE', `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(permissionId)}?supportsAllDrives=true`);
    } catch (err) {
      if ((err as { response?: { status?: number } }).response?.status !== 404) throw err;
    }
  }
}
