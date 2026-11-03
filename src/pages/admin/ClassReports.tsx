import { Check, Minus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ClassReportRow } from '../../../shared/api.ts';
import type { PublicUser } from '../../../shared/types.ts';
import { Badge, Checkbox, ErrorBox, Loading, PageHeader, Select, Table } from '../../components/ui.tsx';
import { fmtDateTime, fmtShortDay, fmtTime } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

/** "2 days after class" when the report came in more than a day after the class ended. */
export function lateBy(row: Pick<ClassReportRow, 'endAt' | 'firstSubmittedAt'>): string | null {
  const hours = (new Date(row.firstSubmittedAt).getTime() - new Date(row.endAt).getTime()) / 3_600_000;
  if (hours <= 24) return null;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} after class`;
}

function Included({ yes, label }: { yes: boolean; label: string }) {
  return (
    <span className={yes ? 'inline-flex items-center gap-1 text-emerald-700' : 'inline-flex items-center gap-1 text-ink-muted'}>
      {yes ? <Check className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
      {label}
      <span className="sr-only">{yes ? ' included' : ' missing'}</span>
    </span>
  );
}

/** Every class report mentors submit, for the team's quality control. */
export default function AdminClassReports() {
  const navigate = useNavigate();
  const [days, setDays] = useState('30');
  const [mentorId, setMentorId] = useState('');
  const [toReview, setToReview] = useState(false);
  const { data, error, loading, reload } = useApi<ClassReportRow[]>(`/api/admin/class-reports?days=${days}&mentorId=${encodeURIComponent(mentorId)}&reviewed=${toReview ? 'no' : 'all'}`);
  const mentors = useApi<PublicUser[]>('/api/admin/users?role=mentor');
  const rows = data || [];
  const open = rows.filter((r) => !r.reviewedAt).length;

  return (
    <>
      <PageHeader title="Class reports" subtitle="Every report a mentor sends after class, with the slides, homework and recording, for quality control." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={days} onChange={(e) => setDays(e.target.value)} className="w-44" aria-label="Period">
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="0">All reports</option>
        </Select>
        <Select value={mentorId} onChange={(e) => setMentorId(e.target.value)} className="w-56" aria-label="Mentor">
          <option value="">All mentors</option>
          {(mentors.data || [])
            .filter((m) => m.mentorStatus !== 'pending' && m.mentorStatus !== 'declined')
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
        </Select>
        <Checkbox label="Not reviewed yet" checked={toReview} onChange={setToReview} />
        {data && (
          <p className="ml-auto text-sm text-ink-soft">
            {rows.length} report{rows.length === 1 ? '' : 's'} · {open} to review
          </p>
        )}
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Mentor</th>
              <th>Student</th>
              <th>Sent</th>
              <th>In the report</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const late = lateBy(r);
              return (
                <tr key={r.sessionId} className="cursor-pointer hover:bg-sand-50" onClick={() => navigate(`/admin/class-reports/${r.sessionId}`)}>
                  <td>
                    <Link to={`/admin/class-reports/${r.sessionId}`} className="font-medium text-brand-800 hover:underline" onClick={(e) => e.stopPropagation()}>
                      {r.courseTitle}
                    </Link>
                    <p className="text-xs text-ink-muted">
                      {fmtShortDay(r.startAt)} · {fmtTime(r.startAt)} · {r.durationMinutes} min
                    </p>
                  </td>
                  <td>{r.mentorName}</td>
                  <td>
                    {r.studentNames.join(', ')}
                    {r.absent > 0 && (
                      <Badge tone="red" className="ml-2">
                        Absent
                      </Badge>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="text-ink-soft">{fmtDateTime(r.firstSubmittedAt)}</span>
                    {late && (
                      <Badge tone="amber" className="ml-2">
                        {late}
                      </Badge>
                    )}
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <Included yes={Boolean(r.slidesName)} label="Slides" />
                      <Included yes={Boolean(r.homeworkTitle)} label="Homework" />
                      <Included yes={r.hasRecording} label="Recording" />
                    </span>
                  </td>
                  <td>{r.reviewedAt ? <Badge tone="green">Reviewed</Badge> : <Badge tone="amber">To review</Badge>}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-ink-muted">
                  No class reports {toReview ? 'waiting for review' : 'in this period'}.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
    </>
  );
}
