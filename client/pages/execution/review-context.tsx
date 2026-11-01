import { useTranslation } from '@nocobase/i18n/client';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { StatusBadge } from '#components/status-badge';
import { EmptyState } from './controls.js';
import { ui } from './hooks.js';
import type { ReviewContext } from './model.js';
export function FrozenReviewContext({ context }: { context?: ReviewContext }) {
  const { t } = useTranslation();
  if (!context || (!context.restricted && !context.tasks?.length)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(ui('frozenReview'))}</CardTitle>
      </CardHeader>
      <CardContent>
        {context.restricted ? (
          <EmptyState type='restricted' />
        ) : (
          <div className='grid gap-5'>
            {context.tasks?.map((task) => (
              <section
                key={task.id}
                className='grid gap-3 rounded-lg border p-4'
              >
                <div className='flex flex-wrap items-center gap-2'>
                  <h3 className='text-sm font-medium'>
                    {t(ui('reviewRound'), { round: task.round })}
                  </h3>
                  <StatusBadge
                    tone={
                      task.status === 'approved'
                        ? 'success'
                        : task.status === 'pending'
                          ? 'info'
                          : 'neutral'
                    }
                  >
                    {t(ui(`reviewStates.${task.status}`))}
                  </StatusBadge>
                </div>
                <p className='text-sm text-muted-foreground'>
                  {t(ui('readOnly'))} · {t(ui('frozenRulesHint'))}
                  {task.parameterSnapshot?.revision != null
                    ? ` · ${t(ui('reviewRuleRevision'), {
                        version: task.parameterSnapshot.revision,
                      })}`
                    : ''}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {t(ui('submittedAt'))}:{' '}
                  {task.createdAt
                    ? new Date(task.createdAt).toLocaleString()
                    : '—'}{' '}
                  · {t(ui('decidedAt'))}:{' '}
                  {task.decidedAt
                    ? new Date(task.decidedAt).toLocaleString()
                    : '—'}
                </p>
                <ul className='grid gap-2 text-sm'>
                  {task.parameterSnapshot?.references?.map((reference) => (
                    <li
                      key={`${reference.group}:${reference.type}:${reference.code ?? reference.name}`}
                    >
                      {t(ui('reviewGroup'), { group: reference.group })} ·{' '}
                      {t(
                        ui(
                          reference.type === 'position'
                            ? 'position'
                            : 'account',
                        ),
                      )}{' '}
                      · {reference.name ?? t(ui('unavailableReference'))}
                    </li>
                  ))}
                </ul>
                <div>
                  <p className='mb-2 text-sm text-muted-foreground'>
                    {t(ui('reviewCandidates'))}
                  </p>
                  <div className='flex flex-wrap gap-2'>
                    {task.reviewers?.map((person) => (
                      <StatusBadge key={person.id} tone='neutral'>
                        {person.name ?? t(ui('unavailableReference'))}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
                {task.reason && (
                  <p className='whitespace-pre-wrap break-words text-sm'>
                    {task.reason}
                  </p>
                )}
              </section>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
