import crypto from 'node:crypto';
import path from 'node:path';
import type { Attachment, ClassSession, Course } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest } from '../http.ts';

export type FilePurpose = 'homework' | 'submission' | 'slides' | 'curriculum';

export interface StoredFile {
  id: string;
  name: string;
  mime: string;
  size: number;
  storageKey: string;
  uploadedBy: string;
  courseId?: string;
  /** Session id for slides; homework id for submissions. */
  relatedId?: string;
  purpose: FilePurpose;
  createdAt: string;
}

const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.ppt', '.pptx', '.key', '.odp', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md',
  '.xls', '.xlsx', '.ods', '.csv', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic',
  '.mp3', '.m4a', '.wav', '.mp4', '.mov', '.zip',
]);

const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Multipart filenames arrive latin1-decoded; restore UTF-8 names (e.g. Amharic) when that is what they were. */
export function decodeFilename(raw: string): string {
  if ([...raw].some((ch) => ch.charCodeAt(0) > 0xff)) return raw;
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('�') ? raw : decoded;
}

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export async function saveUpload(
  deps: Deps,
  file: UploadedFile,
  meta: { uploadedBy: string; purpose: FilePurpose; courseId?: string; relatedId?: string },
): Promise<Attachment & { kind: 'file' }> {
  const name = decodeFilename(file.originalname).replace(/[\\/\0]/g, '_').slice(0, 200) || 'file';
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw badRequest(`Files of type "${ext || 'unknown'}" cannot be uploaded.`);
  const id = crypto.randomUUID();
  const storageKey = `${meta.purpose}/${id}${ext}`;
  await deps.blobs.save(storageKey, file.buffer, file.mimetype || 'application/octet-stream');
  const record: StoredFile = {
    id,
    name,
    mime: file.mimetype || 'application/octet-stream',
    size: file.size,
    storageKey,
    uploadedBy: meta.uploadedBy,
    courseId: meta.courseId,
    relatedId: meta.relatedId,
    purpose: meta.purpose,
    createdAt: deps.now().toISOString(),
  };
  await deps.store.put(C.files, record);
  return { kind: 'file', fileId: id, name, size: file.size, mime: record.mime };
}

/** Normalises user-supplied link attachments ({ url, name }). */
export function linkAttachments(raw: unknown): Attachment[] {
  if (!Array.isArray(raw)) return [];
  const out: Attachment[] = [];
  for (const item of raw.slice(0, 20)) {
    const url = String((item as { url?: string })?.url || '').trim();
    if (!url) continue;
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw badRequest(`"${url}" is not a valid link.`);
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw badRequest('Links must start with https://');
    const name = String((item as { name?: string })?.name || '').trim().slice(0, 200) || parsed.hostname;
    out.push({ kind: 'link', url: parsed.toString(), name });
  }
  return out;
}

export async function canDownload(deps: Deps, user: UserRecord, file: StoredFile): Promise<boolean> {
  if (user.role === 'admin' || file.uploadedBy === user.id) return true;
  if (!file.courseId) return false;
  const course = await deps.store.get<Course>(C.courses, file.courseId);
  if (!course) return false;
  if (user.role === 'mentor') return course.mentorId === user.id;
  if (!course.studentIds.includes(user.id)) return false;
  switch (file.purpose) {
    case 'homework':
      return true;
    case 'slides': {
      if (!file.relatedId) return false;
      const session = await deps.store.get<ClassSession>(C.sessions, file.relatedId);
      return Boolean(session?.report?.shareSlidesWithStudents && session.report.slides?.kind === 'file' && session.report.slides.fileId === file.id);
    }
    default:
      // Curricula are for the Abugida team only; submissions are private to their author.
      return false;
  }
}

export function contentDisposition(file: StoredFile): string {
  const type = INLINE_TYPES.has(file.mime) ? 'inline' : 'attachment';
  const ascii = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.name)}`;
}
