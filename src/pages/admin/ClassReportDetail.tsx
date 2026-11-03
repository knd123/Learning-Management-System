import { CheckCircle2, ExternalLink, Star } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { ClassReportDetail } from '../../../shared/api.ts';
import { FilePreview } from '../../components/FilePreview.tsx';
import { Badge, Button, Card, ErrorBox, Loading, PageHeader, SectionTitle, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, fmtDay, fmtTimeRange } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { lateBy } from './ClassReports.tsx';

const MARK = { present: { label: 'Present', tone: 'green' }, late: { label: 'Joined late', tone: 'amber' }, absent: { label: 'Absent', tone: 'red' } } as const;
const DIFFICULTY = { easier: 'Easier', standard: 'Standard', challenging: 'Challenging' } as const;

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** One class report in full, for quality control: everything the mentor sent, plus attendance and the student's rating. */
export default function AdminClassReport() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<ClassReportDetail>(`/api/admin/class-reports/${id}`);
  const [busy, setBusy] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this class report.'} onRetry={reload} />;
  const { row, homework, recording } = data;
  const late = lateBy(row);

  const review = async (reviewed: boolean) => {
    setBusy(true);
    try {
      setData(await api.put<ClassReportDetail>(`/api/admin/class-reports/${row.sessionId}/review`, { reviewed }));
      toast(reviewed ? 'Marked as reviewed.' : 'Marked as not reviewed.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title={row.courseTitle}
        subtitle={`${fmtDay(row.startAt)} · ${row.mentorName} with ${row.studentNames.join(', ')}`}
        back={{ to: '/admin/class-reports', label: 'Class reports' }}
        actions={
          row.reviewedAt ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="green">
                <CheckCircle2 className="size-3" /> Reviewed by {row.reviewedByName} · {fmtDateTime(row.reviewedAt)}
              </Badge>
              <Button variant="secondary" size="sm" onClick={() => review(false)} loading={busy}>
                Mark as not reviewed
              </Button>
            </div>
          ) : (
            <Button onClick={() => review(true)} loading={busy}>
              <CheckCircle2 className="size-4" /> Mark as reviewed
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <SectionTitle>What was covered</SectionTitle>
            <p className="whitespace-pre-wrap">{data.topicsCovered}</p>
            {data.notes && (
              <div className="mt-4 rounded-xl bg-sand-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Notes for the Abugida team</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{data.notes}</p>
              </div>
            )}
          </Card>

          <Card>
            <SectionTitle>Slides</SectionTitle>
            {data.slides ? <FilePreview attachment={data.slides} /> : <p className="text-sm text-ink-muted">No slides were attached.</p>}
          </Card>

          <Card>
            <SectionTitle>Homework</SectionTitle>
            {homework ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-lg font-semibold">
                    {homework.title} {homework.aiGenerated && <Badge tone="blue">Drafted with AI</Badge>}
                  </p>
                  <div className="mt-2">
                    <Facts
                      rows={[
                        ['Practises', homework.topic !== homework.title ? homework.topic : undefined],
                        ['Goal', homework.learningGoal],
                        ['Level', homework.difficulty ? DIFFICULTY[homework.difficulty] : undefined],
                        ['Time needed', homework.estimatedMinutes ? `About ${homework.estimatedMinutes} minutes` : undefined],
                        ['Assigned', fmtDateTime(homework.assignedAt)],
                        ['Due', homework.dueAt ? fmtDateTime(homework.dueAt) : 'No due date'],
                      ]}
                    />
                  </div>
                </div>
                {homework.instructions && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Instructions</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{homework.instructions}</p>
                  </div>
                )}
                {homework.attachments.length > 0 && (
                  <div className="flex flex-col gap-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Worksheet{homework.attachments.length > 1 ? 's' : ''}</p>
                    {homework.attachments.map((a, i) => (
                      <FilePreview key={a.kind === 'file' ? a.fileId : `${a.url}-${i}`} attachment={a} />
                    ))}
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Handed in</p>
                  <ul className="mt-1 flex flex-col gap-1 text-sm">
                    {homework.submissions.map((s) => (
                      <li key={s.studentName}>
                        {s.studentName}:{' '}
                        {s.submittedAt ? `handed in ${fmtDateTime(s.submittedAt)}${typeof s.score === 'number' ? ` · score ${s.score}` : s.reviewedAt ? ' · reviewed' : ' · not reviewed yet'}` : 'not handed in yet'}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No homework was assigned with this report.</p>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <SectionTitle>Class</SectionTitle>
            <Facts
              rows={[
                ['Subject', `${row.subject} · Grade ${data.gradeLevel}`],
                ['Mentor', row.mentorName],
                ['Scheduled', `${fmtDay(row.startAt)}, ${fmtTimeRange(row.startAt, row.endAt)}`],
                ['Moved from', data.originalStartAt ? fmtDateTime(data.originalStartAt) : undefined],
                ['Held', `${data.date} · ${row.durationMinutes} minutes`],
                [
                  'Report sent',
                  <>
                    {fmtDateTime(row.firstSubmittedAt)}
                    {late && (
                      <Badge tone="amber" className="ml-2">
                        {late}
                      </Badge>
                    )}
                  </>,
                ],
                ['Last edited', row.submittedAt !== row.firstSubmittedAt ? fmtDateTime(row.submittedAt) : undefined],
              ]}
            />
          </Card>

          <Card>
            <SectionTitle>Attendance</SectionTitle>
            <ul className="flex flex-col gap-2 text-sm">
              {data.attendance.map((a) => (
                <li key={a.studentName} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{a.studentName}</span>
                  <Badge tone={MARK[a.mark].tone}>{MARK[a.mark].label}</Badge>
                  <span className="text-xs text-ink-muted">{a.joinedAt ? `Joined from the portal ${fmtDateTime(a.joinedAt)}` : 'Didn’t use the portal’s join button'}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <SectionTitle>Recording</SectionTitle>
            {recording ? (
              <div className="flex flex-col gap-3">
                <a href={recording.url} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-2 rounded-xl border border-sand-200 bg-sand-50 px-3 py-2 text-sm font-medium text-brand-800 hover:border-brand-300 hover:bg-brand-50">
                  <ExternalLink className="size-4" aria-hidden /> Open the recording in Google Drive
                </a>
                <p className="break-all text-xs text-ink-muted">{recording.url}</p>
                <Facts
                  rows={[
                    ['Added', `${fmtDateTime(recording.addedAt)} by ${recording.addedByName}`],
                    ['Students can watch until', fmtDateTime(recording.availableUntil)],
                  ]}
                />
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No recording link yet.</p>
            )}
          </Card>

          <Card>
            <SectionTitle>Student rating</SectionTitle>
            {data.feedback.length ? (
              <ul className="flex flex-col gap-3 text-sm">
                {data.feedback.map((f) => (
                  <li key={f.studentName + f.createdAt}>
                    <span className="flex items-center gap-1 font-medium">
                      {f.studentName}
                      <span className="ml-1 inline-flex text-amber-500" aria-label={`${f.rating} out of 5`}>
                        {Array.from({ length: 5 }, (_, i) => (
                          <Star key={i} className="size-3.5" fill={i < f.rating ? 'currentColor' : 'none'} aria-hidden />
                        ))}
                      </span>
                    </span>
                    {f.comment && <p className="mt-1 whitespace-pre-wrap text-ink-soft">{f.comment}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">The student hasn’t rated this class.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
