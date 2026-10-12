import { Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { EmailLog } from '../../../shared/types.ts';
import { Badge, Button, ErrorBox, Input, Loading, Modal, PageHeader, Select, Table, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

const KIND_LABEL: Record<EmailLog['kind'], string> = {
  recording_reminder: 'Recording reminder',
  parent_report: 'Parent report',
  curriculum_window: 'Curriculum window',
  new_student: 'New sign-up',
  subject_change: 'Subject change',
  pairing: 'Mentor pairing',
  test: 'Test',
};

export default function AdminEmails() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<EmailLog[]>('/api/admin/emails?limit=300');
  const [kind, setKind] = useState<string>('');
  const [open, setOpen] = useState<EmailLog | null>(null);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const sendTest = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const log = await api.post<EmailLog>('/api/admin/emails/test', { to });
      toast(log.status === 'sent' ? `Test email sent to ${to}.` : log.status === 'logged' ? 'SMTP is not configured, so the email was only logged.' : `Sending failed: ${log.error}`, log.status === 'failed' ? 'error' : 'success');
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const rows = (data || []).filter((e) => !kind || e.kind === kind);

  return (
    <>
      <PageHeader title="Email log" subtitle="Every reminder and report the platform has sent." />
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="w-56" aria-label="Filter by type">
          <option value="">All emails</option>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <form onSubmit={sendTest} className="flex gap-2">
          <Input type="email" required placeholder="you@example.com" value={to} onChange={(e) => setTo(e.target.value)} className="w-56" aria-label="Test email address" />
          <Button type="submit" variant="secondary" loading={busy}>
            <Send className="size-4" /> Send test
          </Button>
        </form>
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>To</th>
              <th>Subject</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-sand-50" onClick={() => setOpen(e)}>
                <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(e.createdAt)}</td>
                <td>{KIND_LABEL[e.kind] || e.kind}</td>
                <td className="text-ink-soft">{e.to.join(', ') || '—'}</td>
                <td className="font-medium">{e.subject}</td>
                <td>
                  {e.status === 'sent' ? <Badge tone="green">Sent</Badge> : e.status === 'logged' ? <Badge tone="amber">Logged only</Badge> : <Badge tone="red">Failed</Badge>}
                  {e.error && <p className="mt-1 max-w-xs text-xs text-red-700">{e.error}</p>}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-muted">
                  No emails yet.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open?.subject || ''} wide>
        {open && (open.html ? <iframe title="Email" srcDoc={open.html} sandbox="" className="h-[60vh] w-full rounded-xl border border-sand-200" /> : <pre className="whitespace-pre-wrap font-sans text-sm">{open.text}</pre>)}
      </Modal>
    </>
  );
}
