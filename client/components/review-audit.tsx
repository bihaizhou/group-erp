import { useTranslation } from '@nocobase/i18n/client';
import { StatusBadge } from '#components/status-badge';
import { LongText } from '#components/long-text';

export interface ReviewAuditTask {
  readonly id: string;
  readonly round: number;
  readonly status: string;
  readonly versionId?: string | null;
  readonly createdAt?: string | null;
  readonly decidedAt?: string | null;
  readonly candidates: readonly string[];
  readonly decidedBy: string | null;
  readonly reason: string;
}

interface ReviewAuditProps {
  readonly tasks: readonly ReviewAuditTask[];
  readonly accounts: Readonly<
    Record<string, { readonly name?: string | null } | null>
  >;
  readonly versionNumber?: (versionId: string) => number | undefined;
  readonly ruleRevision?: (versionId: string) => number | undefined;
}

const tone = (status: string) =>
  status === 'approved'
    ? 'success'
    : status === 'returned'
      ? 'warning'
      : status === 'pending'
        ? 'info'
        : 'neutral';

const time = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString() : '—';

/** One chronological, read-only view of every review round on a document. */
export function ReviewAudit({
  tasks,
  accounts,
  versionNumber,
  ruleRevision,
}: ReviewAuditProps) {
  const { t } = useTranslation(),
    ui = (key: string) => `reviewAudit.${key}`,
    name = (id: string) => accounts[id]?.name ?? t(ui('unavailable'));
  return (
    <section className='flex flex-col gap-3'>
      <h2 className='text-base font-medium'>{t(ui('title'))}</h2>
      {tasks.length === 0 ? (
        <p className='text-sm text-muted-foreground'>{t(ui('empty'))}</p>
      ) : (
        tasks.map((task) => {
          const version = task.versionId
              ? versionNumber?.(task.versionId)
              : undefined,
            revision = task.versionId
              ? ruleRevision?.(task.versionId)
              : undefined;
          return (
            <article
              key={task.id}
              className='flex flex-col gap-3 rounded-lg border p-4'
            >
              <header className='flex flex-wrap items-center gap-2'>
                <h3 className='text-sm font-medium'>
                  {t(ui('round'), { round: task.round })}
                </h3>
                <StatusBadge tone={tone(task.status)}>
                  {t(ui(`states.${task.status}`))}
                </StatusBadge>
                {version !== undefined && (
                  <span className='text-xs text-muted-foreground'>
                    {t(ui('version'))} {version}
                  </span>
                )}
                {revision !== undefined && (
                  <span className='text-xs text-muted-foreground'>
                    {t(ui('ruleRevision'), { version: revision })}
                  </span>
                )}
              </header>
              <dl className='grid gap-2 text-sm sm:grid-cols-2'>
                <div>
                  <dt className='text-muted-foreground'>
                    {t(ui('createdAt'))}
                  </dt>
                  <dd>{time(task.createdAt)}</dd>
                </div>
                <div>
                  <dt className='text-muted-foreground'>
                    {t(ui('decidedAt'))}
                  </dt>
                  <dd>{time(task.decidedAt)}</dd>
                </div>
                <div>
                  <dt className='text-muted-foreground'>
                    {t(ui('candidates'))}
                  </dt>
                  <dd>
                    {task.candidates.map(name).join('、') ||
                      t(ui('noCandidates'))}
                  </dd>
                </div>
                <div>
                  <dt className='text-muted-foreground'>
                    {t(ui('decidedBy'))}
                  </dt>
                  <dd>{task.decidedBy ? name(task.decidedBy) : '—'}</dd>
                </div>
              </dl>
              {task.reason && <LongText>{task.reason}</LongText>}
            </article>
          );
        })
      )}
    </section>
  );
}
