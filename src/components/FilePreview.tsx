import { useEffect, useRef, useState } from 'react';
import type { Attachment } from '../../shared/types.ts';
import { fileUrl } from '../lib/api.ts';
import { AttachmentLink } from './Attachments.tsx';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function kindOf(a: Attachment): 'pptx' | 'pdf' | 'image' | 'other' {
  if (a.kind !== 'file') return 'other';
  const name = a.name.toLowerCase();
  if (a.mime === PPTX || name.endsWith('.pptx')) return 'pptx';
  if (a.mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (a.mime.startsWith('image/')) return 'image';
  return 'other';
}

/** An uploaded file shown in the page: every PowerPoint slide, the pages of a PDF or a photo. Other files are for download. */
export function FilePreview({ attachment }: { attachment: Attachment }) {
  const kind = kindOf(attachment);
  const [note, setNote] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <AttachmentLink attachment={attachment} />
        {note && <span className="text-xs text-ink-muted">{note}</span>}
      </div>
      {attachment.kind === 'file' && kind === 'pptx' && <SlideFrame fileId={attachment.fileId} onNote={setNote} />}
      {attachment.kind === 'file' && kind === 'pdf' && <PdfFrame fileId={attachment.fileId} title={attachment.name} />}
      {attachment.kind === 'file' && kind === 'image' && <img src={fileUrl(attachment.fileId)} alt={attachment.name} className="max-h-[75vh] w-fit max-w-full rounded-xl border border-sand-200" />}
      {attachment.kind === 'file' && kind === 'other' && <p className="text-sm text-ink-muted">This type of file can’t be shown in the portal. Download it to open it.</p>}
    </div>
  );
}

// Runs inside the slide frame: draws every slide of the file the portal sends, then reports its height.
const VIEWER = `(function () {
  var box = document.getElementById('slides');
  var msg = document.getElementById('msg');
  var tell = function (data) { parent.postMessage(Object.assign({ source: 'abugida-slides' }, data), '*'); };
  var height = function () { tell({ type: 'height', height: document.documentElement.scrollHeight }); };
  var fail = function () { msg.textContent = 'These slides could not be shown here.'; tell({ type: 'failed' }); height(); };
  window.addEventListener('message', function (event) {
    if (event.source !== parent || !event.data || event.data.type !== 'abugida-slides-file') return;
    var width = Math.max(320, Math.min(960, event.data.width || 960));
    try {
      var viewer = window.pptxPreview.init(box, { width: width, height: Math.round((width * 9) / 16), mode: 'list' });
      viewer.preview(event.data.file).then(function () {
        msg.style.display = 'none';
        tell({ type: 'shown', slides: viewer.slideCount });
        height();
      }, fail);
    } catch (err) { fail(); }
  });
  if (window.ResizeObserver) new ResizeObserver(height).observe(document.body);
  tell({ type: 'ready' });
})();`;

let renderer: Promise<string> | null = null;
/** The PowerPoint renderer (about 1.4 MB), downloaded the first time slides are shown. */
function loadRenderer(): Promise<string> {
  renderer ??= fetch('/slides/pptx-preview.js')
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .catch((err) => {
      renderer = null;
      throw err;
    });
  return renderer;
}

const script = (js: string) => `<script>${js.replace(/<\/(script)/gi, '<\\/$1')}</script>`;
const viewerPage = (lib: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#f4f1ea;font-family:system-ui,sans-serif}#slides{padding:8px 0}.pptx-preview-wrapper{height:auto!important;overflow:visible!important;background:none!important}.pptx-preview-slide-wrapper{box-shadow:0 1px 4px rgba(0,0,0,.18)}#msg{margin:0;padding:24px;color:#55605c;font-size:14px;text-align:center}</style></head><body><div id="slides"></div><p id="msg">Loading slides…</p>${script(lib)}${script(VIEWER)}</body></html>`;

/**
 * PowerPoint slides are drawn in a sandboxed frame with a blank origin: the renderer inserts slide text
 * as HTML, so a crafted file must not run inside the signed-in portal. The frame gets its whole page
 * (renderer included) from the portal and the file's bytes by message; it can't reach the portal or the network on its own.
 */
function SlideFrame({ fileId, onNote }: { fileId: string; onNote(note: string): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [page, setPage] = useState<string | null>(null);
  const [height, setHeight] = useState(420);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let file: ArrayBuffer | null = null;
    let ready = false;
    let live = true;
    const send = () => {
      const target = frame.current?.contentWindow;
      if (!file || !ready || !target) return;
      target.postMessage({ type: 'abugida-slides-file', file, width: (frame.current?.clientWidth || 960) - 16 }, '*', [file]);
      file = null;
    };
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow || e.data?.source !== 'abugida-slides') return;
      if (e.data.type === 'ready') {
        ready = true;
        send();
      } else if (e.data.type === 'height') {
        setHeight(Math.min(Math.max(Number(e.data.height) || 0, 120), 60000));
      } else if (e.data.type === 'shown') {
        const count = Number(e.data.slides);
        if (count > 0) onNote(`${count} slide${count === 1 ? '' : 's'}`);
      } else if (e.data.type === 'failed') {
        setFailed(true);
      }
    };
    window.addEventListener('message', onMessage);
    Promise.all([loadRenderer(), fetch(fileUrl(fileId)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))]).then(
      ([lib, buf]) => {
        if (!live) return;
        file = buf;
        setPage(viewerPage(lib));
      },
      () => live && setFailed(true),
    );
    return () => {
      live = false;
      window.removeEventListener('message', onMessage);
    };
  }, [fileId, onNote]);

  if (failed) return <p className="text-sm text-ink-muted">These slides couldn’t be shown here. Download the file to open it.</p>;
  if (!page) return <div className="h-40 animate-pulse rounded-xl bg-sand-100" />;
  return <iframe ref={frame} title="Slides" srcDoc={page} sandbox="allow-scripts" style={{ height }} className="w-full rounded-xl border border-sand-200 bg-sand-50" />;
}

/** The browser's own PDF viewer, given the file's bytes so the download link's headers don't apply. */
function PdfFrame({ fileId, title }: { fileId: string; title: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    let made = '';
    fetch(fileUrl(fileId))
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(
        (buf) => {
          if (!live) return;
          made = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
          setUrl(made);
        },
        () => live && setFailed(true),
      );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [fileId]);
  if (failed) return <p className="text-sm text-ink-muted">This PDF couldn’t be shown here. Download it to open it.</p>;
  return url ? <iframe title={title} src={url} className="h-[75vh] w-full rounded-xl border border-sand-200" /> : <div className="h-40 animate-pulse rounded-xl bg-sand-100" />;
}
