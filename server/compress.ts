import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

/**
 * Google bills every byte the portal sends. The portal's own script is about 690 KB, and API answers
 * are JSON: both shrink by 70–80% compressed. Cloud Run doesn't compress responses itself, so the
 * portal does: answers sent with res.send / res.json are compressed on the way out, and the built
 * files are compressed once at build time (server/scripts/precompress.mjs) and served as they are.
 * Streams (recordings, downloads) are left alone: videos, PDFs and images are already compressed.
 */

const COMPRESSIBLE = /^(application\/(json|javascript|xml)|text\/|image\/svg\+xml)/i;
/** Smaller answers aren't worth compressing. */
export const MIN_COMPRESS_BYTES = 1024;

/** "br" or "gzip" when the browser accepts it (br preferred), otherwise null. */
export function preferredEncoding(header: string | string[] | undefined): 'br' | 'gzip' | null {
  const accepted = new Map<string, number>();
  for (const part of String(header || '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
    accepted.set(name, q === undefined ? 1 : Number(q));
  }
  const ok = (name: string) => (accepted.get(name) ?? accepted.get('*') ?? 0) > 0;
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : null;
}

export function compress(data: Buffer, encoding: 'br' | 'gzip'): Buffer {
  return encoding === 'br'
    ? zlib.brotliCompressSync(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } })
    : zlib.gzipSync(data, { level: 6 });
}

/** Compresses answers sent with res.send or res.json (JSON, HTML pages such as agreements). */
export function compressAnswers() {
  return (req: Request, res: Response, next: NextFunction) => {
    const encoding = preferredEncoding(req.headers['accept-encoding']);
    if (!encoding) return next();
    const send = res.send.bind(res);
    res.send = (body?: unknown) => {
      const type = String(res.getHeader('Content-Type') || '');
      const data = typeof body === 'string' ? Buffer.from(body) : Buffer.isBuffer(body) ? body : null;
      if (!data || data.length < MIN_COMPRESS_BYTES || !COMPRESSIBLE.test(type) || res.getHeader('Content-Encoding') || res.statusCode === 204 || res.statusCode === 304) {
        return send(body as never);
      }
      res.setHeader('Content-Encoding', encoding);
      res.vary('Accept-Encoding');
      return send(compress(data, encoding));
    };
    next();
  };
}

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Vite names the built files after their content (/assets/index-BUeSu-lR.js), so a browser can keep
 * them for a year: a new version gets a new name. Other files are kept for an hour.
 */
export function cacheControlFor(urlPath: string): string {
  return urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
}

/** Serves the built portal: compressed copies where the browser takes them, long caching for named files. */
export function serveClient(app: Express, clientDir: string) {
  const root = path.resolve(clientDir);
  // Which files have compressed copies, found once at start-up.
  const variants = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(br|gz)$/.test(entry.name)) variants.add(full);
    }
  };
  if (fs.existsSync(root)) walk(root);

  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !variants.size) return next();
    const encoding = preferredEncoding(req.headers['accept-encoding']);
    if (!encoding) return next();
    let file: string;
    try {
      file = path.join(root, decodeURIComponent(req.path));
    } catch {
      return next();
    }
    const variant = `${file}.${encoding === 'br' ? 'br' : 'gz'}`;
    if (!file.startsWith(root + path.sep) || !variants.has(variant)) return next();
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Content-Encoding', encoding);
    res.setHeader('Cache-Control', cacheControlFor(req.path));
    res.vary('Accept-Encoding');
    res.sendFile(variant, { cacheControl: false }, (err) => {
      if (err && !res.headersSent) next();
    });
  });
  app.use(
    express.static(root, {
      index: false,
      cacheControl: false,
      setHeaders: (res, filePath) => res.setHeader('Cache-Control', cacheControlFor('/' + path.relative(root, filePath).split(path.sep).join('/'))),
    }),
  );
}
