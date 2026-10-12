import { ChevronLeft, ChevronRight, Send, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReportDetail, ReportRow } from '../../../shared/api.ts';
import type { ParentReportStatus, ReportNarrative } from '../../../shared/types.ts';
import { Badge, Button, ErrorBox, Field, Loading, Modal, Notice, PageHeader, Table, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { currentMonth, fmtDateTime, monthLabel, shiftMonth } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

const STATUS: Record<ParentReportStatus, { label: string; tone: 'green' | 'amber' | 'red' | 'gray' }> = {
  sent: { label: 'Sent', tone: 'green' },
  draft: { label: 'Ready to send', tone: 'amber' },
  failed: { label: 'Not delivered', tone: 'red' },
  skipped: { label: 'No activity', tone: 'gray' },
};

export default function AdminReports() {
  const toast = useToast();
  const [month, setMonth] = useState(shiftMonth(currentMonth(), -1));
  const { data, error, loading, reload } = useApi<ReportRow[]>(`/api/admin/reports?month=${month}`);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    if (!window.confirm(`Prepare reports for ${monthLabel(month)}? Existing drafts are rebuilt; reports already sent are kept.`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ generated: number; skipped: number }>('/api/admin/reports/generate', { month });
      toast(`${r.generated} reports prepared${r.skipped ? `, ${r.skipped} students had no activity` : ''}.`);
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendAll = async () => {
    const drafts = (data || []).filter((r) => r.report.status === 'draft');
    if (!drafts.length || !window.confirm(`Email ${drafts.length} report(s) to parents now?`)) return;
    setBusy(true);
    let sent = 0;
    for (const row of drafts) {
      try {
        await api.post(`/api/admin/reports/${encodeURIComponent(row.report.id)}/send`);
        sent++;
      } catch {
        /* shown as failed in the list */
      }
    }
    toast(`${sent} report(s) sent.`);
    setBusy(false);
    reload();
  };

  const drafts = (data || []).filter((r) => r.report.status === 'draft').length;

  return (
    <>
      <PageHeader
        title="Parent reports"
        subtitle="Monthly progress reports, written from attendance, homework and quiz results, emailed to parents."
        actions={
          <>
            <Button variant="secondary" onClick={generate} loading={busy}>
              <Sparkles className="size-4" /> Prepare reports
            </Button>
            {drafts > 0 && (
              <Button onClick={sendAll} loading={busy}>
                <Send className="size-4" /> Send {drafts} to parents
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
          <ChevronLeft className="size-4" />
        </Button>
        <p className="w-40 text-center font-semibold">{monthLabel(month)}</p>
        <Button variant="secondary" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= currentMonth()} aria-label="Next month">
          <ChevronRight className="size-4" />
        </Button>
      </div>
      <p className="mb-4 text-sm text-ink-soft">Reports are prepared automatically at the start of each month for the month before. Depending on Settings, they are emailed right away or wait here for review.</p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Status</th>
              <th>Attendance</th>
              <th>Homework</th>
              <th>Quiz scores</th>
              <th>Written by</th>
            </tr>
          </thead>
          <tbody>
            {(data || []).map(({ report, studentName, grade }) => (
              <tr key={report.id} className="cursor-pointer hover:bg-sand-50" onClick={() => setOpenId(report.id)}>
                <td>
                  <p className="font-medium text-brand-800">{studentName}</p>
                  {grade && <p className="text-xs text-ink-muted">Grade {grade}</p>}
                </td>
                <td>
                  <Badge tone={STATUS[report.status].tone}>{STATUS[report.status].label}</Badge>
                  {report.sentAt && <p className="mt-1 text-xs text-ink-muted">{fmtDateTime(report.sentAt)}</p>}
                </td>
                <td className="tabular-nums">{report.metrics.classesScheduled ? `${report.metrics.classesAttended}/${report.metrics.classesScheduled}` : '—'}</td>
                <td className="tabular-nums">{report.metrics.homeworkAssigned ? `${report.metrics.homeworkSubmitted}/${report.metrics.homeworkAssigned}` : '—'}</td>
                <td className="tabular-nums">{report.metrics.courses.map((c) => (c.quizScore === null ? null : `${c.subject} ${c.quizScore}%`)).filter(Boolean).join(', ') || '—'}</td>
                <td>{report.generatedBy === 'ai' ? <Badge tone="blue">AI</Badge> : <Badge>Template</Badge>}</td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-ink-muted">
                  No reports for {monthLabel(month)} yet. Use “Prepare reports” to create them now.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      {openId && <ReportModal id={openId} onClose={() => setOpenId(null)} onChanged={reload} />}
    </>
  );
}

function ReportModal({ id, onClose, onChanged }: { id: string; onClose(): void; onChanged(): void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<ReportDetail>(`/api/admin/reports/${encodeURIComponent(id)}`);
  const [editing, setEditing] = useState(false);
  const [narrative, setNarrative] = useState<ReportNarrative | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) setNarrative(data.report.narrative);
  }, [data]);

  const save = async () => {
    if (!narrative) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/reports/${encodeURIComponent(id)}`, { narrative });
      toast('Report updated.');
      setEditing(false);
      await reload();
      onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!data || !window.confirm(`Email this report to ${data.student.parentEmails?.join(', ') || 'the parents'}?`)) return;
    setBusy(true);
    try {
      const r = await api.post<{ status: string; error?: string }>(`/api/admin/reports/${encodeURIComponent(id)}/send`);
      if (r.status === 'sent') toast('Report sent to parents.');
      else toast(r.error || 'The email could not be delivered.', 'error');
      await reload();
      onChanged();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const lines = (v: string) => v.split('\n').map((s) => s.trim()).filter(Boolean);

  return (
    <Modal open onClose={onClose} title={data ? `${data.student.displayName} · ${monthLabel(data.report.month)}` : 'Report'} wide>
      {loading && !data ? (
        <Loading />
      ) : error || !data ? (
        <ErrorBox message={error || 'Could not load the report.'} />
      ) : (
        <div className="flex flex-col gap-4">
          {data.report.error && <Notice>{data.report.error}</Notice>}
          <p className="text-sm text-ink-soft">
            To: {data.student.parentEmails?.join(', ') || <Badge tone="red">No parent email on file</Badge>} · Subject: {data.email.subject}
          </p>
          {editing && narrative ? (
            <div className="flex flex-col gap-3">
              <Field label="Summary">{(fid) => <Textarea id={fid} rows={5} value={narrative.summary} onChange={(e) => setNarrative({ ...narrative, summary: e.target.value })} />}</Field>
              {(['strengths', 'focusAreas', 'recommendations'] as const).map((key) => (
                <Field key={key} label={{ strengths: 'Strengths', focusAreas: 'Areas to focus on', recommendations: 'How parents can help' }[key]} hint="One per line.">
                  {(fid) => <Textarea id={fid} rows={3} value={narrative[key].join('\n')} onChange={(e) => setNarrative({ ...narrative, [key]: lines(e.target.value) })} />}
                </Field>
              ))}
              <div className="flex gap-2">
                <Button onClick={save} loading={busy}>
                  Save changes
                </Button>
                <Button variant="secondary" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <iframe title="Email preview" srcDoc={data.email.html} sandbox="" className="h-[60vh] w-full rounded-xl border border-sand-200 bg-sand-100" />
          )}
          {!editing && data.report.status !== 'skipped' && (
            <div className="flex flex-wrap gap-2">
              <Button onClick={send} loading={busy}>
                <Send className="size-4" /> {data.report.status === 'sent' ? 'Send again' : 'Send to parents'}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit text
              </Button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
