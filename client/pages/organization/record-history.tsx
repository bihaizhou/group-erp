import { useTranslation } from '@nocobase/i18n/client';
import { cn } from 'cn';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { LongText } from '#components/long-text';
import { ErrorNotice } from './shared.js';
import { displayValue } from './formatting.js';
import { useRecordHistory } from './hooks.js';
import type { OrgOptions } from './model.js';

const ignored = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'version',
  'revision',
  'createdBy',
  'statusChangedAt',
]);

function changedFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) {
  return Object.entries(after)
    .filter(([key]) => !ignored.has(key))
    .filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(before?.[key] ?? null),
    );
}

function changeLabel(key: string, t: (key: string) => string) {
  return t(`org.fields.${key}`);
}

function reasonLabel(reason: string) {
  return reason === 'Initial creation' ? '' : reason;
}

export function OrganizationRecordHistory({
  recordId,
  options,
}: {
  readonly recordId: string;
  readonly options?: OrgOptions;
}) {
  const { t, i18n } = useTranslation();
  const history = useRecordHistory(recordId);
  const rows = history.data?.data ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('org.timeline')}</CardTitle>
        <CardDescription>{t('org.timelineDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        {history.isError ? (
          <ErrorNotice
            error={history.error}
            retry={() => void history.refetch()}
          />
        ) : history.isPending ? (
          <p className='text-sm text-muted-foreground'>{t('org.loading')}</p>
        ) : !rows.length ? (
          <p className='text-sm text-muted-foreground'>{t('org.noChanges')}</p>
        ) : (
          <ol className='flex flex-col'>
            {rows.map((entry, index) => {
              const changes = entry.beforeValue
                ? changedFields(entry.beforeValue, entry.afterValue)
                : [];
              const created = !entry.beforeValue;
              const reason = reasonLabel(entry.reason);
              return (
                <li
                  key={entry.id}
                  className='grid gap-1 sm:grid-cols-[7rem_1fr] sm:gap-4'
                >
                  <div className='text-xs text-muted-foreground sm:pt-0.5 sm:text-right'>
                    <p>
                      {new Date(entry.createdAt).toLocaleDateString(
                        i18n.language,
                      )}
                    </p>
                    <p className='text-[11px]'>
                      {new Date(entry.createdAt).toLocaleTimeString(
                        i18n.language,
                        { hour: '2-digit', minute: '2-digit' },
                      )}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'relative border-l border-muted-foreground/25 pl-6',
                      index === rows.length - 1 ? 'pb-0' : 'pb-6',
                    )}
                  >
                    <span className='absolute -left-[5px] top-1 size-2.5 rounded-full border-2 border-muted-foreground bg-card' />
                    <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
                      <p className='text-sm font-medium'>
                        {t(`org.operations.${entry.operation}`, {
                          defaultValue: entry.operation,
                        })}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        {entry.actorName || '—'}
                      </p>
                    </div>
                    {reason ? (
                      <LongText
                        lines={2}
                        className='mt-1 text-sm text-muted-foreground'
                      >
                        {reason}
                      </LongText>
                    ) : null}
                    {created ? (
                      <p className='mt-2 text-sm text-muted-foreground'>
                        {t('org.recordCreated')}
                      </p>
                    ) : changes.length ? (
                      <dl className='mt-2 flex flex-col gap-2'>
                        {changes.map(([key, value]) => (
                          <div key={key}>
                            <dt className='text-xs text-muted-foreground'>
                              {changeLabel(key, t)}
                            </dt>
                            <dd className='text-sm break-words'>
                              <span className='text-muted-foreground line-through decoration-muted-foreground/40'>
                                {displayValue(
                                  key,
                                  entry.beforeValue?.[key],
                                  options,
                                  t,
                                  i18n.language,
                                )}
                              </span>
                              <span className='mx-1 text-muted-foreground'>
                                →
                              </span>
                              <span>
                                {displayValue(
                                  key,
                                  value,
                                  options,
                                  t,
                                  i18n.language,
                                )}
                              </span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : (
                      <p className='mt-2 text-sm text-muted-foreground'>
                        {t('org.noFieldChanges')}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
