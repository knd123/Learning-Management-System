import { FileText, Link2, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import type { Attachment } from '../../shared/types.ts';
import { fileUrl } from '../lib/api.ts';
import { fmtBytes } from '../lib/format.ts';
import { Button, Input } from './ui.tsx';

export function AttachmentLink({ attachment }: { attachment: Attachment }) {
  const href = attachment.kind === 'file' ? fileUrl(attachment.fileId) : attachment.url;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex max-w-full items-center gap-2 rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm font-medium text-brand-800 hover:border-brand-300 hover:bg-brand-50"
    >
      {attachment.kind === 'file' ? <FileText className="size-4 shrink-0" aria-hidden /> : <Link2 className="size-4 shrink-0" aria-hidden />}
      <span className="truncate">{attachment.name}</span>
      {attachment.kind === 'file' && <span className="shrink-0 text-xs text-ink-muted">{fmtBytes(attachment.size)}</span>}
    </a>
  );
}

export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {attachments.map((a, i) => (
        <AttachmentLink key={a.kind === 'file' ? a.fileId : `${a.url}-${i}`} attachment={a} />
      ))}
    </div>
  );
}

export interface PickedLinks {
  url: string;
  name: string;
}

/** Lets users attach files from their device and/or paste links (Google Docs, Slides…). */
export function AttachmentPicker({
  files,
  onFiles,
  links,
  onLinks,
  accept,
  label = 'Attach files',
}: {
  files: File[];
  onFiles(files: File[]): void;
  links: PickedLinks[];
  onLinks(links: PickedLinks[]): void;
  accept?: string;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');

  const addLink = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    const full = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let name = full;
    try {
      name = new URL(full).hostname.replace(/^www\./, '');
    } catch {
      /* validated by the server */
    }
    onLinks([...links, { url: full, name }]);
    setUrl('');
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <input
          ref={input}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => {
            onFiles([...files, ...Array.from(e.target.files || [])]);
            e.target.value = '';
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <Paperclip className="size-4" /> {label}
        </Button>
      </div>
      <div className="flex gap-2">
        <Input
          type="url"
          inputMode="url"
          placeholder="Or paste a link (Google Docs, Slides, Drive…)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addLink();
            }
          }}
        />
        <Button type="button" variant="secondary" onClick={addLink} aria-label="Add link">
          <Plus className="size-4" />
        </Button>
      </div>
      {(files.length > 0 || links.length > 0) && (
        <ul className="flex flex-col gap-1.5">
          {files.map((f, i) => (
            <li key={`f-${i}`} className="flex items-center justify-between gap-3 rounded-lg bg-sand-50 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-brand-700" />
                <span className="truncate">{f.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">{fmtBytes(f.size)}</span>
              </span>
              <button type="button" onClick={() => onFiles(files.filter((_, j) => j !== i))} className="text-ink-muted hover:text-red-600" aria-label={`Remove ${f.name}`}>
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
          {links.map((l, i) => (
            <li key={`l-${i}`} className="flex items-center justify-between gap-3 rounded-lg bg-sand-50 px-3 py-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <Link2 className="size-4 shrink-0 text-brand-700" />
                <span className="truncate">{l.url}</span>
              </span>
              <button type="button" onClick={() => onLinks(links.filter((_, j) => j !== i))} className="text-ink-muted hover:text-red-600" aria-label="Remove link">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
