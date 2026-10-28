import { ChevronRight, Handshake, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { MatchRequestRow } from '../../../shared/api.ts';
import { Badge, Button, EmptyState, ErrorBox, Loading, Modal, PageHeader, Tabs } from '../../components/ui.tsx';
import { fmtDate, fmtRelative, REQUEST_KIND_LABEL } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { AssignMentor } from './AssignMentor.tsx';

export default function AdminMatches() {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const { data, error, loading, reload } = useApi<MatchRequestRow[]>(`/api/admin/matches?status=${tab}`);
  const [assigning, setAssigning] = useState(false);

  return (
    <>
      <PageHeader
        title="Match requests"
        subtitle="New students, subject changes and students asking for a specific mentor. The platform suggests the best mentor; nothing is final until you approve it. You can also pair any student with any mentor by hand."
        actions={
          <Button onClick={() => setAssigning(true)}>
            <UserPlus className="size-4" /> Assign a mentor
          </Button>
        }
      />
      <Tabs
        tabs={[
          { id: 'open', label: 'Waiting for review', count: tab === 'open' ? data?.length : undefined },
          { id: 'closed', label: 'Done' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <div className="flex flex-col gap-3">
          {data.map(({ request, student, mentorNames, requestedNames, teamPickNames }) => (
            <Link key={request.id} to={`/admin/matches/${request.id}`} className="group flex items-center gap-4 rounded-2xl border border-sand-200 bg-white p-4 transition hover:border-brand-300">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold group-hover:text-brand-800">{student.displayName}</p>
                  <Badge tone={request.kind === 'new_student' ? 'blue' : request.kind === 'mentor_request' ? 'amber' : 'gray'}>{REQUEST_KIND_LABEL[request.kind]}</Badge>
                </div>
                <p className="text-sm text-ink-soft">
                  {[student.grade && `Grade ${student.grade}`, student.schoolName, [student.city, student.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                </p>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {request.items.map((i) => (
                    <li key={i.id}>
                      <Badge tone={i.status === 'approved' ? 'green' : i.status === 'declined' ? 'gray' : 'amber'}>
                        {i.subject} · {i.hoursPerWeek}h
                        {i.status === 'pending'
                          ? teamPickNames?.[i.id]
                            ? ` → your pick: ${teamPickNames[i.id]}`
                            : requestedNames?.[i.id]
                            ? ` → student asked for ${requestedNames[i.id]}`
                            : mentorNames[i.id]
                              ? ` → suggested: ${mentorNames[i.id]}`
                              : ' → no available mentor yet'
                          : i.status === 'approved'
                            ? ` → ${mentorNames[i.id] || 'paired'}`
                            : ' · declined'}
                      </Badge>
                    </li>
                  ))}
                  {request.removedSubjects.map((s) => (
                    <li key={s}>
                      <Badge tone="red">Drop {s}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hidden shrink-0 text-right text-sm text-ink-muted sm:block">
                {tab === 'open' ? `Requested ${fmtRelative(request.createdAt)}` : `Closed ${fmtDate(request.closedAt || request.updatedAt)}`}
              </div>
              <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Handshake className="size-8" />} title={tab === 'open' ? 'No requests waiting' : 'Nothing here yet'}>
          {tab === 'open' && 'New sign-ups and subject changes show up here with suggested mentors. Use “Assign a mentor” to pair any student by hand.'}
        </EmptyState>
      )}
      <Modal open={assigning} onClose={() => setAssigning(false)} title="Assign a mentor">
        {assigning && <AssignMentor onClose={() => setAssigning(false)} />}
      </Modal>
    </>
  );
}
