import { ExternalLink, PlayCircle, TimerOff } from 'lucide-react';
import { useState } from 'react';
import type { SessionView } from '../../../shared/api.ts';
import { Badge, Card, EmptyState, ErrorBox, ExternalButton, Loading, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { fmtDateTime, fmtRelative } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function StudentRecordings() {
  const { data, error, loading, reload } = useApi<{ available: SessionView[]; expired: SessionView[] }>('/api/student/recordings');
  const [playing, setPlaying] = useState<string | null>(null);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load recordings.'} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Class recordings" subtitle="Rewatch your classes to revise. Recordings stay here for a limited time after each class — check the date on each one." />
      {data.available.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.available.map((s) => {
            const rec = s.recording!;
            return (
              <Card key={s.id} className="flex flex-col gap-3">
                {playing === s.id && rec.embedUrl ? (
                  <div className="aspect-video overflow-hidden rounded-xl bg-ink">
                    <iframe src={rec.embedUrl} title={`Recording of ${s.courseTitle}`} allow="autoplay; fullscreen" allowFullScreen className="size-full" />
                  </div>
                ) : (
                  <button onClick={() => (rec.embedUrl ? setPlaying(s.id) : window.open(rec.url, '_blank', 'noopener'))} className="grid aspect-video place-items-center rounded-xl bg-brand-800 text-white hover:bg-brand-700">
                    <span className="flex flex-col items-center gap-2">
                      <PlayCircle className="size-14 text-sun" />
                      <span className="font-semibold">Play recording</span>
                    </span>
                  </button>
                )}
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{s.courseTitle}</p>
                    <p className="text-sm text-ink-soft">Class on {fmtDateTime(s.startAt)}</p>
                    {s.topicsCovered && <p className="mt-1 text-sm text-ink-soft">{s.topicsCovered}</p>}
                  </div>
                  <Badge tone="amber">Gone {fmtRelative(rec.availableUntil)}</Badge>
                </div>
                <ExternalButton href={rec.url} variant="secondary" size="sm" className="self-start">
                  <ExternalLink className="size-4" /> Open in a new tab
                </ExternalButton>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<PlayCircle className="size-8" />} title="No recordings right now">
          After each class, your mentor uploads the recording here so you can rewatch it during the following week.
        </EmptyState>
      )}

      {data.expired.length > 0 && (
        <section className="mt-10">
          <SectionTitle>Recently expired</SectionTitle>
          <ul className="flex flex-col gap-2">
            {data.expired.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-sand-200 bg-white px-4 py-3 text-sm text-ink-soft">
                <TimerOff className="size-4 shrink-0" />
                <span className="flex-1">
                  {s.courseTitle} · {fmtDateTime(s.startAt)}
                </span>
                <span className="text-xs">Expired {fmtDateTime(s.recording!.availableUntil)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
