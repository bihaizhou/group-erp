import { useMemo } from 'react';
import { Badge } from '#components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { LongText } from '#components/long-text';
import { SupplierError, SupplierLoading } from './controls.js';
import { useSupplierQuery } from './hooks.js';
import type { Audit, Choice, Page } from './model.js';
import { usePartnerTranslation as useTranslation } from './partner-domain.js';

type Source = 'relationship' | 'identity' | 'scope';
type AuditChange = { key: string; before: unknown; after: unknown };
type References = { regions: Choice[]; companies: Choice[] };

const ignored = new Set([
  'id',
  'recordId',
  'subjectId',
  'partnerId',
  'partnerRole',
  'revision',
  'lifecycleVersion',
  'statusChangedAt',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
  'requestKey',
]);

function auditChanges(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): AuditChange[] {
  const keys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  return [...keys]
    .filter((key) => !ignored.has(key))
    .map((key) => ({ key, before: before?.[key], after: after?.[key] }))
    .filter(
      (change) =>
        JSON.stringify(change.before) !== JSON.stringify(change.after),
    );
}

const statusKey = (kind: string) =>
  kind === 'businessPartners'
    ? 'identityStatus'
    : kind === 'partnerRolePolicies'
      ? 'supplierStatus'
      : 'companyStatus';

function fieldLabel(key: string, kind: string) {
  if (key === 'status') return statusKey(kind);
  if (key === 'regionIds') return 'regions';
  if (key === 'subjectIds') return 'companies';
  return key;
}

function useScopeReferences(rows: Audit[]) {
  const regionId = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows)
      for (const value of [row.beforeValue, row.afterValue])
        if (Array.isArray(value?.regionIds))
          value.regionIds.forEach(
            (id) => typeof id === 'string' && ids.add(id),
          );
    return [...ids];
  }, [rows]);
  const subjectId = useMemo(() => {
    const ids = new Set<string>();
    for (const row of rows)
      for (const value of [row.beforeValue, row.afterValue])
        if (Array.isArray(value?.subjectIds))
          value.subjectIds.forEach(
            (id) => typeof id === 'string' && ids.add(id),
          );
    return [...ids];
  }, [rows]);
  const query = useSupplierQuery<{ data: References }>(
    'supplierScopeReferences',
    { regionId, subjectId },
    Boolean(regionId.length || subjectId.length),
  );
  return query.data?.data;
}

function displayValue(
  key: string,
  value: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
  references?: References,
) {
  if (value === null || value === undefined || value === '') return '—';
  if (key === 'regionIds' || key === 'subjectIds') {
    if (!Array.isArray(value) || !value.length) return '—';
    const choices =
      key === 'regionIds' ? references?.regions : references?.companies;
    return value
      .map((id) => {
        const choice = choices?.find((item) => item.id === id);
        if (!choice) return t('procurement.unavailable');
        return `${choice.name}${
          choice.status === 'inactive' ? ` (${t('procurement.inactive')})` : ''
        }`;
      })
      .join('、');
  }
  if (Array.isArray(value)) {
    return t('procurement.itemCount', { count: value.length });
  }
  if (typeof value === 'object') {
    return t('procurement.itemCount', {
      count: Object.keys(value).length,
    });
  }
  if (key === 'scopeMode') {
    return t(`procurement.${value === 'all' ? 'all' : 'selected'}`);
  }
  if (key === 'status') {
    return t(`procurement.${value === 'active' ? 'active' : 'inactive'}`);
  }
  if (typeof value === 'boolean') {
    return t(`procurement.${value ? 'yes' : 'no'}`);
  }
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? String(value)
    : '';
}

export function SupplierAuditChanges({
  kind,
  before,
  after,
  references,
}: {
  kind: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  references?: References;
}) {
  const { t } = useTranslation();
  if (!before) {
    return (
      <p className='text-sm text-muted-foreground'>
        {t('procurement.recordCreated')}
      </p>
    );
  }
  const changes = auditChanges(before, after);
  if (!changes.length) {
    return (
      <p className='text-sm text-muted-foreground'>
        {t('procurement.noFieldChanges')}
      </p>
    );
  }
  return (
    <dl className='grid gap-2 text-sm'>
      {changes.map((change) => (
        <div
          key={change.key}
          className='grid grid-cols-[8rem_minmax(0,1fr)] gap-3'
        >
          <dt className='text-muted-foreground'>
            {t(`procurement.${fieldLabel(change.key, kind)}`, {
              defaultValue: change.key,
            })}
          </dt>
          <dd className='min-w-0 break-words'>
            <span className='text-muted-foreground line-through'>
              {displayValue(change.key, change.before, t, references)}
            </span>
            <span className='px-2 text-muted-foreground'>→</span>
            <span>{displayValue(change.key, change.after, t, references)}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AuditEntry({
  row,
  source,
  references,
}: {
  row: Audit;
  source?: Source;
  references?: References;
}) {
  const { t, i18n } = useTranslation();
  const reason =
    row.reason &&
    !['create', 'link'].includes(row.reason) &&
    row.reason !== row.operation
      ? row.reason
      : '';
  return (
    <article className='flex flex-col gap-2 border-l border-muted-foreground/25 py-1 pl-5'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='font-medium'>
            {t(`procurement.operation.${row.operation}`, {
              defaultValue: t('procurement.operation.edit'),
            })}
          </span>
          {source ? (
            <Badge variant='outline'>
              {t(`procurement.historySource.${source}`)}
            </Badge>
          ) : null}
        </div>
        <time className='text-xs text-muted-foreground'>
          {new Intl.DateTimeFormat(i18n.language, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(row.createdAt))}
        </time>
      </div>
      {row.actorName ? (
        <p className='text-xs text-muted-foreground'>
          {t('procurement.actor')}: {row.actorName}
        </p>
      ) : null}
      {reason ? (
        <LongText lines={2} className='text-sm'>
          {reason}
        </LongText>
      ) : null}
      <SupplierAuditChanges
        kind={row.kind}
        before={row.beforeValue}
        after={row.afterValue}
        references={references}
      />
    </article>
  );
}

export function SupplierHistory({
  title,
  path,
}: {
  title: string;
  path?: string;
}) {
  const { t } = useTranslation();
  const history = useSupplierQuery<Page<Audit>>(
    path ?? '',
    { page: 1, pageSize: 10 },
    Boolean(path),
  );
  const references = useScopeReferences(history.data?.data ?? []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`procurement.${title}`)}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {!path ? (
          <p className='text-sm text-muted-foreground'>
            {t('procurement.noHistory')}
          </p>
        ) : history.error ? (
          <SupplierError
            error={history.error}
            retry={() => void history.refetch()}
          />
        ) : history.isPending ? (
          <SupplierLoading />
        ) : !history.data?.data.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('procurement.noHistory')}
          </p>
        ) : (
          history.data.data.map((row) => (
            <AuditEntry key={row.id} row={row} references={references} />
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function SupplierTimeline({
  settingPath,
  identityPath,
  scopePath,
}: {
  settingPath?: string;
  identityPath?: string;
  scopePath?: string;
}) {
  const { t } = useTranslation();
  const relationship = useSupplierQuery<Page<Audit>>(
    settingPath ?? '',
    { page: 1, pageSize: 30 },
    Boolean(settingPath),
  );
  const identity = useSupplierQuery<Page<Audit>>(
    identityPath ?? '',
    { page: 1, pageSize: 30 },
    Boolean(identityPath),
  );
  const scope = useSupplierQuery<Page<Audit>>(
    scopePath ?? '',
    { page: 1, pageSize: 30 },
    Boolean(scopePath),
  );
  const active = [
    settingPath ? relationship : null,
    identityPath ? identity : null,
    scopePath ? scope : null,
  ].filter((query) => query !== null);
  const failed = active.find((query) => query.error)?.error;
  const loading = active.some((query) => query.isPending);
  const rows = useMemo(
    () =>
      [
        ...(relationship.data?.data ?? []).map((row) => ({
          row,
          source: 'relationship' as const,
        })),
        ...(identity.data?.data ?? []).map((row) => ({
          row,
          source: 'identity' as const,
        })),
        ...(scope.data?.data ?? []).map((row) => ({
          row,
          source: 'scope' as const,
        })),
      ]
        .sort((left, right) =>
          right.row.createdAt.localeCompare(left.row.createdAt),
        )
        .slice(0, 30),
    [relationship.data, identity.data, scope.data],
  );
  const references = useScopeReferences(rows.map(({ row }) => row));
  const total =
    (relationship.data?.meta.total ?? 0) +
    (identity.data?.meta.total ?? 0) +
    (scope.data?.meta.total ?? 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('procurement.historyAll')}</CardTitle>
        <CardDescription>
          {t('procurement.historyAllDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        {failed ? (
          <SupplierError
            error={failed}
            retry={() => active.forEach((query) => void query.refetch())}
          />
        ) : loading ? (
          <SupplierLoading />
        ) : !rows.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('procurement.noHistory')}
          </p>
        ) : (
          <>
            {rows.map(({ row, source }) => (
              <AuditEntry
                key={row.id}
                row={row}
                source={source}
                references={references}
              />
            ))}
            {total > rows.length ? (
              <p className='text-sm text-muted-foreground'>
                {t('procurement.historyLimited', {
                  shown: rows.length,
                  total,
                })}
              </p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
