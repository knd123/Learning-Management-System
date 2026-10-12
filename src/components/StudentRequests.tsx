import { CheckCircle2, Hourglass, XCircle } from 'lucide-react';
import type { StudentRequestView } from '../../shared/api.ts';
import { fmtDate } from '../lib/format.ts';
import { Badge, Card } from './ui.tsx';

/** A student's pairing requests and where each subject stands. */
export function StudentRequests({ requests, title = 'Mentor pairing' }: { requests: StudentRequestView[]; title?: string }) {
  if (!requests.length) return null;
  return (
    <Card>
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-3 flex flex-col gap-4">
        {requests.map((r) => (
          <div key={r.id}>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {r.kind === 'new_student' ? 'Sign-up request' : 'Subject change'} · {fmtDate(r.createdAt)}
            </p>
            <ul className="flex flex-col gap-2">
              {r.items.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2.5 text-sm">
                  <span className="font-medium">
                    {i.subject} <span className="font-normal text-ink-muted">· {i.hoursPerWeek}h/week</span>
                  </span>
                  {i.status === 'approved' ? (
                    <Badge tone="green">
                      <CheckCircle2 className="size-3" /> Paired with {i.mentorName}
                    </Badge>
                  ) : i.status === 'declined' ? (
                    <Badge tone="gray">
                      <XCircle className="size-3" /> Our team will contact you
                    </Badge>
                  ) : (
                    <Badge tone="amber">
                      <Hourglass className="size-3" /> Finding your mentor
                    </Badge>
                  )}
                </li>
              ))}
              {r.removedSubjects.map((s) => (
                <li key={s} className="flex items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2.5 text-sm">
                  <span className="font-medium text-ink-soft line-through">{s}</span>
                  <Badge tone="gray">{r.status === 'open' ? 'Removal requested' : 'Removed'}</Badge>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
