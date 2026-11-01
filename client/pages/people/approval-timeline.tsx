import { useTranslation } from '@nocobase/i18n/client';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { StatusBadge } from '#components/status-badge';
import type { Row } from './model.js';

/** The stages of the current approval round, oldest first. */
export function ApprovalTimeline({
  approval,
}: {
  approval: NonNullable<Row['approval']>;
}) {
  const { t, i18n } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('people.approvalTimeline')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {approval.stages.map((stage) => (
          <div
            key={`${stage.key}-${stage.stageIndex}`}
            className='flex gap-3 border-b pb-3 last:border-0'
          >
            <span
              aria-hidden
              className={`mt-1.5 size-2.5 shrink-0 rounded-full ${
                stage.status === 'pending'
                  ? 'bg-primary'
                  : stage.status === 'approved'
                    ? 'bg-emerald-500'
                    : 'bg-muted-foreground/40'
              }`}
            />
            <div className='flex min-w-0 flex-col gap-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <p className='text-sm font-medium'>{stage.title}</p>
                <StatusBadge>
                  {t(`people.approvalStatuses.${stage.status}`)}
                </StatusBadge>
                <span className='text-xs text-muted-foreground'>
                  {t(`people.approvalModes.${stage.mode}`)}
                </span>
              </div>
              <p className='text-xs text-muted-foreground'>
                {t('people.approvalCandidates')}：
                {stage.candidates
                  .map((candidate) => candidate.name)
                  .join('、') || '—'}
              </p>
              {stage.decisions.map((decision) => (
                <p
                  key={`${decision.actorId}-${decision.at}`}
                  className='text-sm'
                >
                  {decision.actorName} ·{' '}
                  {t(`people.transitions.${decision.decision}`)} ·{' '}
                  {new Date(decision.at).toLocaleString(i18n.language)}
                  {decision.reason ? ` — ${decision.reason}` : ''}
                </p>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
