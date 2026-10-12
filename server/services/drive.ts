import { GoogleAuth } from 'google-auth-library';

/** Extracts the Google Drive file id from the common share-link formats. */
export function parseDriveFileId(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (!/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(u.hostname)) return undefined;
    const fromPath = u.pathname.match(/\/(?:file\/d|document\/d|presentation\/d|spreadsheets\/d)\/([\w-]{10,})/);
    if (fromPath) return fromPath[1];
    const fromQuery = u.searchParams.get('id');
    return fromQuery && /^[\w-]{10,}$/.test(fromQuery) ? fromQuery : undefined;
  } catch {
    return undefined;
  }
}

/** Google Drive preview URL that can be embedded in an iframe. */
export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/preview`;
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
