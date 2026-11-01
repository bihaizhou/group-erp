import { Link } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useSourceReason } from '#hooks/use-source-reason';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { LongText } from '#components/long-text';
import { ErrorNotice } from './controls.js';
import { fields, text, type Kind, type Options } from './model.js';
import {
  useMaterialCan,
  useMaterialRecordHistory,
  type MaterialAudit,
} from './hooks.js';

const ignored = new Set([
  'id',
  'createdBy',
  'identityKey',
  'searchText',
  'scopeKey',
  'searchKey',
  'createdAt',
  'updatedAt',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
]);

const enumFields = new Set([
  'unitType',
  'appliesTo',
  'managementMode',
  'targetKind',
  'sourceType',
]);

const historicalFields = new Set(['categoryId', 'parentId', 'sortOrder']);

export type MaterialChange = {
  key: string;
  before: unknown;
  after: unknown;
};

function materialChanges(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): MaterialChange[] {
  if (!before || !after) return [];
  return Object.entries(after)
    .filter(([key]) => !ignored.has(key))
    .filter(
      ([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(before[key] ?? null),
    )
    .map(([key, value]) => ({ key, before: before[key], after: value }));
}

function fieldLabel(key: string, t: (key: string) => string) {
  return t(
    `materials.${historicalFields.has(key) ? 'historicalFields' : 'fields'}.${key}`,
  );
}

function isStructured(value: unknown) {
  return typeof value === 'object' && value !== null;
}

function formatValue(
  kind: Kind | undefined,
  key: string,
  value: unknown,
  options: Options | undefined,
  t: (key: string) => string,
) {
  if (value === null || value === undefined || value === '') return '—';
  const spec = kind
    ? fields[kind].find((field) => field.key === key)
    : undefined;
  if (spec?.type === 'ref') {
    const source = spec.source;
    if (!source) return t('materials.unavailable');
    return (
      options?.[source]?.rows.find((row) => row.id === value)?.name ??
      t('materials.unavailable')
    );
  }
  if (spec?.choices) return t(`materials.enums.${text(value)}`);
  if (key === 'status') return t(`materials.states.${text(value)}`);
  if (enumFields.has(key)) return t(`materials.enums.${text(value)}`);
  if (typeof value === 'boolean')
    return t(value ? 'materials.yes' : 'materials.no');
  return text(value) || '—';
}

function structuredLabel(
  before: unknown,
  after: unknown,
  t: (key: string) => string,
) {
  const beforeCount = Array.isArray(before)
    ? before.length
    : isStructured(before)
      ? Object.keys(before).length
      : null;
  const afterCount = Array.isArray(after)
    ? after.length
    : isStructured(after)
      ? Object.keys(after).length
      : null;
  if (beforeCount !== null && afterCount !== null && beforeCount !== afterCount)
    return t('materials.itemCount')
      .replace('{{before}}', String(beforeCount))
      .replace('{{after}}', String(afterCount));
  return t('materials.detailUpdated');
}

export function MaterialAuditChanges({
  kind,
  before,
  after,
  options,
}: {
  readonly kind?: Kind;
  readonly before: Record<string, unknown> | null | undefined;
  readonly after: Record<string, unknown> | null | undefined;
  readonly options?: Options;
}) {
  const { t } = useTranslation();
  const changes = materialChanges(before, after);
  if (!before) {
    return (
      <p className='text-sm text-muted-foreground'>
        {t('materials.initialCreation')}
      </p>
    );
  }
  if (!changes.length) {
    return (
      <p className='text-sm text-muted-foreground'>
        {t('materials.noFieldChanges')}
      </p>
    );
  }
  return (
    <dl className='flex flex-col gap-3'>
      {changes.map((change) => (
        <div key={change.key}>
          <dt className='text-xs text-muted-foreground'>
            {fieldLabel(change.key, t)}
          </dt>
          <dd className='mt-1 text-sm break-words'>
            {isStructured(change.before) || isStructured(change.after) ? (
              <span>{structuredLabel(change.before, change.after, t)}</span>
            ) : (
              <>
                <span className='text-muted-foreground line-through decoration-muted-foreground/40'>
                  {formatValue(kind, change.key, change.before, options, t)}
                </span>
                <span className='mx-1 text-muted-foreground'>→</span>
                <span>
                  {formatValue(kind, change.key, change.after, options, t)}
                </span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function operationLabel(
  audit: MaterialAudit,
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  if (audit.operation === 'create') return t('materials.transitions.create');
  return t(`materials.transitions.${audit.operation}`, {
    defaultValue: t('materials.updated'),
  });
}

function auditReason(
  audit: MaterialAudit,
  sourceReason: (reason?: string) => string,
  t: (key: string) => string,
) {
  if (audit.reason === 'categoryMigration')
    return t('materials.categoryMigration');
  if (audit.operation === 'create' && audit.reason === 'create') return '';
  return sourceReason(audit.reason);
}

export function MaterialRecordHistory({
  kind,
  recordId,
  options,
}: {
  readonly kind: Kind;
  readonly recordId: string;
  readonly options?: Options;
}) {
  const { t, i18n } = useTranslation();
  const sourceReason = useSourceReason();
  const canRead = useMaterialCan('history', 'read');
  const history = useMaterialRecordHistory(recordId, canRead.can);
  if (!canRead.can) return null;
  const rows = history.data?.data ?? [];
  const total = history.data?.meta.total ?? 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('materials.auditHistory')}</CardTitle>
        <CardDescription>
          {t('materials.auditHistoryDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.isError ? (
          <ErrorNotice
            error={history.error}
            retry={() => void history.refetch()}
          />
        ) : history.isPending ? (
          <p className='text-sm text-muted-foreground'>
            {t('materials.loading')}
          </p>
        ) : !rows.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('materials.noAuditHistory')}
          </p>
        ) : (
          <>
            <ol className='flex flex-col'>
              {rows.map((entry, index) => {
                const reason = auditReason(entry, sourceReason, t);
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
                      className={
                        'relative border-l border-muted-foreground/25 pl-6 ' +
                        (index === rows.length - 1 ? 'pb-0' : 'pb-6')
                      }
                    >
                      <span className='absolute -left-[5px] top-1 size-2.5 rounded-full border-2 border-muted-foreground bg-card' />
                      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
                        <p className='text-sm font-medium'>
                          {operationLabel(entry, t)}
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
                      <div className='mt-2'>
                        <MaterialAuditChanges
                          kind={kind}
                          before={entry.beforeValue}
                          after={entry.afterValue}
                          options={options}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            {total > rows.length ? (
              <div className='mt-4 flex justify-end'>
                <Link
                  to={`/functions/warehouse/materials/history?recordId=${recordId}`}
                  className='text-sm text-primary hover:underline'
                >
                  {t('materials.viewFullHistory')}
                </Link>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
