import { Link, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { useExecutionCan, useExecutionQuery, ui } from './hooks.js';
import { Loading, ErrorNotice } from './controls.js';
import type { ReviewKind, ReviewSettings } from './settings-model.js';
export function QuantitySettingsSection({
  kinds,
}: {
  kinds: readonly ReviewKind[];
}) {
  const [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '',
    { t } = useTranslation(),
    read = useExecutionCan('warehouse.settings', 'read');
  if (read.isPending) return <Loading kind='form' />;
  if (!read.can) return null;
  return (
    <section
      className='grid min-w-0 gap-6'
      aria-label={t(ui('reviewSettings'))}
    >
      {kinds.map((kind) => (
        <ReviewCard
          key={`${subjectId}:${kind}`}
          subjectId={subjectId}
          kind={kind}
        />
      ))}
    </section>
  );
}
function ReviewCard({
  subjectId,
  kind,
}: {
  subjectId: string;
  kind: ReviewKind;
}) {
  const { t } = useTranslation(),
    location = useLocation(),
    update = useExecutionCan('warehouse.settings', 'update'),
    result = useExecutionQuery<{ data: ReviewSettings }>(
      'warehouse/settings',
      { subjectId, kind },
      !!subjectId,
    ),
    value = result.data?.data;
  return (
    <Card>
      <CardHeader>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <CardTitle>{t(ui(`reviewKinds.${kind}`))}</CardTitle>
          {value && (
            <StatusBadge
              tone={
                value.values.reviewerSelections.length ? 'success' : 'warning'
              }
            >
              {t(
                ui(
                  value.values.reviewerSelections.length
                    ? 'configured'
                    : 'notConfigured',
                ),
              )}
            </StatusBadge>
          )}
        </div>
        <CardDescription>{t(ui('frozenRulesHint'))}</CardDescription>
      </CardHeader>
      <CardContent>
        {!subjectId ? null : result.error ? (
          <ErrorNotice
            error={result.error}
            retry={() => void result.refetch()}
          />
        ) : result.isPending ? (
          <Loading />
        ) : value?.references.length ? (
          <ul className='grid gap-3'>
            {value.references.map((reference) => (
              <li
                key={`${reference.group}:${reference.type}:${reference.referenceId}`}
                className='flex flex-wrap items-center gap-2 text-sm'
              >
                <span className='text-muted-foreground'>
                  {t(ui('reviewGroup'), { group: reference.group })}
                </span>
                <StatusBadge tone='neutral'>
                  {t(
                    ui(reference.type === 'position' ? 'position' : 'account'),
                  )}
                </StatusBadge>
                <span>{reference.name ?? t(ui('unavailableReference'))}</span>
                {reference.availability !== 'active' && (
                  <StatusBadge tone='warning'>
                    {t(ui('unavailableReference'))}
                  </StatusBadge>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-muted-foreground'>{t(ui('noReviewer'))}</p>
        )}
      </CardContent>
      {update.can && (
        <CardFooter className='justify-end'>
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link
                to={{ pathname: `edit/${kind}`, search: location.search }}
              />
            }
          >
            {t(ui('edit'))}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
