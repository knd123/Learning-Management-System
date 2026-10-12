import crypto from 'node:crypto';
import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailKind, EmailLog } from '../../shared/types.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { getSettings } from './settings.ts';

export interface OutgoingEmail {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  /** Where replies go: the company email address. */
  replyTo?: string;
}

export interface Mailer {
  /** True when emails actually leave the server (SMTP configured). */
  readonly live: boolean;
  send(email: OutgoingEmail): Promise<void>;
}

export class SmtpMailer implements Mailer {
  readonly live = true;
  private transport: Transporter;

  constructor(
    opts: { host: string; port: number; secure: boolean; user: string; pass: string },
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({ from: this.from, replyTo: email.replyTo, to: email.to.join(', '), subject: email.subject, text: email.text, html: email.html });
  }
}

/** Used when SMTP is not configured: emails are only recorded in the email log. */
export class LogMailer implements Mailer {
  readonly live = false;
  readonly sent: OutgoingEmail[] = [];

  async send(email: OutgoingEmail): Promise<void> {
    this.sent.push(email);
    console.log(`[email:not-sent] to=${email.to.join(',')} subject="${email.subject}"`);
  }
}

/** Sends an email and records it in the email log visible to admins. */
export async function sendEmail(
  deps: Deps,
  kind: EmailKind,
  email: OutgoingEmail,
  relatedId?: string,
): Promise<EmailLog> {
  const to = [...new Set(email.to.map((e) => e.trim()).filter(Boolean))];
  const log: EmailLog = {
    id: crypto.randomUUID(),
    kind,
    to,
    subject: email.subject,
    text: email.text,
    html: email.html,
    status: 'logged',
    relatedId,
    createdAt: deps.now().toISOString(),
  };
  if (!to.length) {
    log.status = 'failed';
    log.error = 'No recipient email address on file.';
  } else {
    try {
      const { adminNotificationEmail } = await getSettings(deps.store);
      await deps.mailer.send({ ...email, to, replyTo: email.replyTo || adminNotificationEmail });
      log.status = deps.mailer.live ? 'sent' : 'logged';
    } catch (err) {
      log.status = 'failed';
      log.error = err instanceof Error ? err.message : String(err);
    }
  }
  await deps.store.put(C.emails, log);
  return log;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Wraps email body HTML in a simple branded layout that renders well in most clients. */
export function emailLayout(title: string, bodyHtml: string, orgName: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2a2a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#0f5e57;color:#ffffff;padding:20px 28px;font-size:18px;font-weight:600">${escapeHtml(orgName)}</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 16px;font-size:20px;color:#0f5e57">${escapeHtml(title)}</h1>
${bodyHtml}
</td></tr>
<tr><td style="padding:16px 28px;background:#faf8f3;color:#6b7470;font-size:12px">This message was sent by the ${escapeHtml(orgName)} learning platform.</td></tr>
</table></td></tr></table></body></html>`;
}

export function emailButton(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#0f5e57;color:#ffffff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600;display:inline-block">${escapeHtml(label)}</a></p>`;
}

/** Bulleted list for email bodies. */
export function emailList(items: string[]): string {
  return `<ul style="line-height:1.6;margin:0 0 16px;padding-left:20px">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

/** Two-column key/value table for email bodies; empty values are skipped. */
export function emailTable(pairs: Array<[string, string | undefined]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;margin:0 0 16px;font-size:14px">${pairs
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#55605c;width:40%">${escapeHtml(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee">${escapeHtml(v!)}</td></tr>`)
    .join('')}</table>`;
}
