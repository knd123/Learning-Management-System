import { CheckCircle2, CircleAlert, Play } from 'lucide-react';
import { useState } from 'react';
import type { AdminOverview } from '../../../shared/api.ts';
import { Button, ButtonLink, Card, ErrorBox, Loading, PageHeader, SectionTitle, StatTile, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-3 py-3">
      {ok ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-label="Working" /> : <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-label="Needs setup" />}
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-ink-soft">{detail}</p>
      </div>
    </li>
  );
}

export default function AdminHome() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<AdminOverview>('/api/admin/overview');
  const [running, setRunning] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load overview.'} onRetry={reload} />;
  const { counts, status } = data;

  const runJobs = async () => {
    setRunning(true);
    try {
      const r = await api.post<{ remindersSent: number; quizzesGenerated: number; reportsSent: number; notes: string[] }>('/api/admin/jobs/run');
      toast(`Done: ${r.remindersSent} reminders, ${r.quizzesGenerated} quizzes, ${r.reportsSent} parent reports sent.`);
      reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHeader title="Overview" subtitle="Abugida Education at a glance." actions={<ButtonLink to="/admin/users" variant="secondary">Add people</ButtonLink>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Active students" value={counts.students} />
        <StatTile label="Active mentors" value={counts.mentors} />
        <StatTile label="Active classes" value={counts.classes} />
        <StatTile label="Classes in the next 7 days" value={counts.sessionsThisWeek} />
        <StatTile label="Reports missing (last 7 days)" value={counts.pendingReports} hint="Classes without a mentor report" />
        <StatTile label="Recordings missing" value={counts.pendingRecordings} hint="Still inside the viewing window" />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle>Platform setup</SectionTitle>
          <ul className="divide-y divide-sand-100">
            <StatusRow ok={status.emailLive} label="Email delivery" detail={status.emailLive ? 'Reminders and parent reports are emailed via SMTP.' : 'SMTP is not configured: emails are only recorded in the email log. Set SMTP_HOST, SMTP_USER and SMTP_PASS.'} />
            <StatusRow ok={status.aiEnabled} label="AI (quizzes, homework drafts, report writing)" detail={status.aiEnabled ? 'Gemini is connected.' : 'Add GEMINI_API_KEY to enable AI quizzes and homework drafts. Parent reports use a standard template until then.'} />
            <StatusRow ok={status.driveEnabled} label="Google Drive access control" detail={status.driveEnabled ? 'Students get time-limited view access to recordings on Drive automatically.' : 'Optional. Recordings are shown in the app only during the viewing window; enable GOOGLE_DRIVE_ENABLED to also expire students\' Drive access automatically.'} />
            <StatusRow ok={status.dataBackend === 'firestore'} label="Database" detail={status.dataBackend === 'firestore' ? 'Firestore (production).' : `Local ${status.dataBackend} storage — fine for testing; use Firestore in production.`} />
          </ul>
        </Card>
        <Card>
          <SectionTitle>Automations</SectionTitle>
          <p className="text-sm text-ink-soft">
            Recording reminders (12h and 24h after class), monthly quizzes, parent reports and curriculum-window emails run automatically every few minutes. You can also run them now.
          </p>
          <Button className="mt-4" variant="secondary" onClick={runJobs} loading={running}>
            <Play className="size-4" /> Run automations now
          </Button>
          {data.lastJobRun ? (
            <div className="mt-4 text-sm">
              <p className="text-ink-soft">Last run: {fmtDateTime(data.lastJobRun.ranAt)}</p>
              {data.lastJobRun.notes.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-800">
                  {data.lastJobRun.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">Automations have not run yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
