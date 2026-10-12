import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Item') => new HttpError(404, `${what} not found.`);
export const badRequest = (message: string) => new HttpError(400, message);
export const forbidden = (message = 'You do not have access to this.') => new HttpError(403, message);

/** Wraps an async route handler so rejected promises reach the error middleware. */
export function h(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export function str(value: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw badRequest(`${field} is required.`);
    return '';
  }
  if (typeof value !== 'string') throw badRequest(`${field} must be text.`);
  const trimmed = value.trim();
  if (opts.required && !trimmed) throw badRequest(`${field} is required.`);
  if (opts.max && trimmed.length > opts.max) throw badRequest(`${field} must be at most ${opts.max} characters.`);
  return trimmed;
}

export function num(value: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | undefined {
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw badRequest(`${field} is required.`);
    return undefined;
  }
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw badRequest(`${field} must be a number.`);
  if (opts.min !== undefined && n < opts.min) throw badRequest(`${field} must be at least ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) throw badRequest(`${field} must be at most ${opts.max}.`);
  return n;
}

export function isoDate(value: unknown, field: string, required = false): string | undefined {
  const s = str(value, field, { required });
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw badRequest(`${field} must be a valid date.`);
  return d.toISOString();
}

export function httpUrl(value: unknown, field: string, required = false): string {
  const s = str(value, field, { required, max: 2000 });
  if (!s) return '';
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw badRequest(`${field} must be a valid link starting with https://`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest(`${field} must be a web link.`);
  return url.toString();
}

/** Parses a JSON-encoded form field (used with multipart uploads). */
export function jsonField<T>(value: unknown, fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw badRequest('Malformed form data.');
  }
}
