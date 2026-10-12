import multer from 'multer';

export type Upload = multer.Multer;

/** Multipart parser that keeps files in memory (they are streamed to storage right after). */
export function createUpload(maxUploadMb: number): Upload {
  return multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadMb * 1024 * 1024, files: 10 } });
}
