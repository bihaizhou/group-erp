import { useSourceReason } from '#hooks/use-source-reason';
import { useTranslation } from '@nocobase/i18n/client';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { GovernanceTaskSource } from '#components/demand-governance/task-source';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { RouteDrawer } from '#components/route-drawer';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { LongText } from '#components/long-text';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import {
  kindFromPath,
  fields,
  large,
  referenceIds,
  canEdit,
  text,
  actionPermission,
  type Row,
  type Kind,
  type Attribute,
} from './model.js';
import {
  useMaterialCan,
  useMaterialOptions,
  useMaterialRecord,
} from './hooks.js';
import { ErrorNotice, Loading, Refresh } from './controls.js';
import { MaterialRecordHistory } from './record-history.js';
export function WorkflowActions({
  kind,
  row,
}: {
  kind: ReturnType<typeof kindFromPath>;
  row: Row;
}) {
  const { t } = useTranslation(),
    location = useLocation(),
    update = useMaterialCan(kind),
    review = useMaterialCan(kind, 'review');
  const actions = (row.workflow?.available ?? []).filter(
    (a) =>
      a.allowed &&
      (actionPermission(kind, a.name) === 'review' ? review.can : update.can) &&
      !a.name.startsWith('edit'),
  );
  return actions.length ? (
    <Card>
      <CardHeader>
        <CardTitle>{t('materials.availableActions')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-wrap gap-2'>
        {actions.map((a) => (
          <Button
            key={a.name}
            variant='outline'
            nativeButton={false}
            render={
              <Link
                to={{ pathname: `actions/${a.name}`, search: location.search }}
              />
            }
          >
            {t(`materials.transitions.${a.name}`)}
          </Button>
        ))}
      </CardContent>
    </Card>
  ) : null;
}
export default function MaterialDetail({
  kind: fixedKind,
  idParam,
}: { kind?: Kind; idParam?: 'linkedSkuId' } = {}) {
  const { t, i18n } = useTranslation(),
    sourceReason = useSourceReason(),
    cache = useQueryClient(),
    location = useLocation(),
    params = useParams(),
    kind = fixedKind ?? kindFromPath(location.pathname),
    id = idParam
      ? params[idParam]
      : (params.sourceRequestId ?? params.recordId);
  const read = useMaterialCan(kind, 'read'),
    write = useMaterialCan(kind),
    newSku = useMaterialCan('skus'),
    skuRead = useMaterialCan('skus', 'read'),
    historyRead = useMaterialCan('history', 'read'),
    catalog = kind === 'skus' && !read.can;
  const governanceBusy = useIsFetching({
    predicate: (query) =>
      (query.queryKey[0] === 'material-source' && query.queryKey[1] === id) ||
      (query.queryKey[1] === 'attachment-metadata' && query.queryKey[3] === id),
  });
  const record = useMaterialRecord(kind, id, catalog),
    row = record.data?.data,
    options = useMaterialOptions(kind, '', referenceIds(row ?? {}), read.can);
  const publicDetail = useMaterialRecord(
    'skus',
    kind === 'skus' && row?.status === 'active' && !catalog ? id : undefined,
    true,
  );
  const full = large.includes(kind),
    link = (pathname: string) => ({ pathname, search: location.search });
  const display = (key: string, value: unknown) => {
    const spec = fields[kind].find((v) => v.key === key);
    if (value === null || value === undefined || value === '') return '—';
    if (spec?.type === 'ref')
      return (
        options.data?.data[spec.source ?? text(row?.targetKind)]?.rows.find(
          (v) => v.id === value,
        )?.name ?? t('materials.unavailable')
      );
    if (spec?.choices) return t(`materials.enums.${text(value)}`);
    if (typeof value === 'boolean')
      return t(value ? 'materials.yes' : 'materials.no');
    return text(value) || '—';
  };
  const edit =
    row && write.can && canEdit(kind, row) && !row.sourceLinked ? (
      <Button nativeButton={false} render={<Link to={link('edit')} />}>
        {t('materials.edit')}
      </Button>
    ) : null;
  const extra = catalog ? row : publicDetail.data?.data;
  const content = record.isError ? (
    <ErrorNotice error={record.error} retry={() => void record.refetch()} />
  ) : !row ? (
    <Loading variant='detail' />
  ) : (
    <div className='flex flex-col gap-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('materials.basic')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-4 sm:grid-cols-2'>
            {['name', 'code', ...fields[kind].map((v) => v.key), 'notes']
              .filter(
                (key) =>
                  !catalog || ['name', 'code', 'managementMode'].includes(key),
              )
              .map((key) => (
                <div
                  key={key}
                  className={key === 'notes' ? 'sm:col-span-2' : undefined}
                >
                  <dt className='text-sm text-muted-foreground'>
                    {t(`materials.fields.${key}`)}
                  </dt>
                  <dd className='mt-1'>
                    <LongText>{display(key, row[key])}</LongText>
                  </dd>
                </div>
              ))}
            <div>
              <dt className='text-sm text-muted-foreground'>
                {t('materials.fields.status')}
              </dt>
              <dd className='mt-1'>
                <StatusBadge
                  tone={
                    ['active', 'resolved'].includes(row.status)
                      ? 'success'
                      : row.status === 'pending'
                        ? 'warning'
                        : 'neutral'
                  }
                >
                  {t(`materials.states.${row.status}`)}
                </StatusBadge>
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
      {kind === 'skus' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('materials.attributes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className='grid gap-4 sm:grid-cols-2'>
              {Object.entries(
                (row.attributeValues ?? {}) as Record<string, string>,
              ).map(([key, value]) => {
                const name = options.data?.data.names?.rows.find(
                  (v) => v.id === row.materialNameId,
                );
                const template = options.data?.data.templates?.rows.find(
                  (v) => v.id === name?.templateId,
                );
                const publicLabel = (
                  extra?.attributeLabels as
                    Record<string, { title: string; unit: string }> | undefined
                )?.[key];
                const attr = ((template?.fields ?? []) as Attribute[]).find(
                  (v) => v.key === key,
                );
                return (
                  <div key={key}>
                    <dt className='text-sm text-muted-foreground'>
                      {attr?.title ?? publicLabel?.title ?? key}
                      {attr?.unit || publicLabel?.unit
                        ? ` (${attr?.unit ?? publicLabel?.unit})`
                        : ''}
                    </dt>
                    <dd className='mt-1'>{value || '—'}</dd>
                  </div>
                );
              })}
            </dl>
            {Object.keys(row.attributeValues ?? {}).length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {t('materials.noAttributes')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {kind === 'templates' ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('materials.templateFields')}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            {(row.fields as Attribute[]).map((attr) => (
              <div key={attr.key} className='rounded-lg border p-4'>
                <p className='font-medium'>
                  {attr.title} · {attr.key}
                </p>
                <p className='text-sm text-muted-foreground'>
                  {t(`materials.enums.${attr.type}`)}
                  {attr.unit ? ` · ${attr.unit}` : ''} ·{' '}
                  {t(
                    attr.required
                      ? 'materials.attribute.required'
                      : 'materials.optional',
                  )}
                  {attr.identity
                    ? ` · ${t('materials.attribute.identity')}`
                    : ''}
                </p>
                {attr.options?.length ? (
                  <p>{attr.options.join(' / ')}</p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {extra ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('materials.catalogRelations')}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-4'>
            <p>
              {t('materials.unitValue', { name: text(extra.baseUnitName) })}
            </p>
            {((extra.packages ?? []) as Row[]).map((v) => (
              <p key={v.id}>
                {v.name} · {text(v.denominator)} : {text(v.numerator)}
              </p>
            ))}
            {((extra.aliases ?? []) as Row[]).map((v) => (
              <p key={v.id}>{t('materials.aliasValue', { name: v.name })}</p>
            ))}
            {((extra.tags ?? []) as Row[]).map((v) => (
              <p key={v.id}>
                {v.name}
                {v.inherited ? ` · ${t('materials.inherited')}` : ''}
              </p>
            ))}
            {extra.relationsTruncated ? (
              <p className='text-sm text-muted-foreground'>
                {t('materials.relationCap')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
      {kind === 'requests' &&
      Array.isArray(row.linkedSkus) &&
      row.linkedSkus.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('materials.linkedSkus')}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            {(row.linkedSkus as Row[]).map((sku) => (
              <div
                key={`${sku.id}-${text(sku.relation)}`}
                className='flex flex-wrap items-center justify-between gap-2'
              >
                <span>
                  {sku.name} · {sku.code} ·{' '}
                  {t(`materials.states.${sku.status}`)} ·{' '}
                  {t(`materials.relations.${text(sku.relation)}`)}
                </span>
                {skuRead.can ? (
                  <Button
                    variant='outline'
                    nativeButton={false}
                    render={<Link to={link(`skus/${sku.id}`)} />}
                  >
                    {t('materials.view')}
                  </Button>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
      {kind === 'requests' && Boolean(row.sourceLinked) && (
        <GovernanceTaskSource taskId={row.id} />
      )}
      {!catalog ? <WorkflowActions kind={kind} row={row} /> : null}
      {kind === 'requests' && row.status === 'pending' && newSku.can ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('materials.requestHandling')}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-col gap-3'>
            <p className='text-sm text-muted-foreground'>
              {t('materials.requestHandlingHelp')}
            </p>
            <Button
              nativeButton={false}
              variant='outline'
              render={<Link to={link('newSku')} />}
            >
              {t('materials.newSkuFromRequest')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {!catalog ? (
        historyRead.can ? (
          <MaterialRecordHistory
            kind={kind}
            recordId={row.id}
            options={options.data?.data}
          />
        ) : row.workflow?.history.length ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('materials.recordHistory')}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-3'>
              {[...row.workflow.history].reverse().map((entry) => (
                <div key={entry.id} className='border-b pb-3 last:border-0'>
                  <p>
                    {t(`materials.transitions.${entry.transition}`, {
                      defaultValue: t('materials.updated'),
                    })}
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {entry.at
                      ? new Date(entry.at).toLocaleString(i18n.language)
                      : ''}
                  </p>
                  <LongText>{sourceReason(entry.input?.reason)}</LongText>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null
      ) : null}
    </div>
  );
  return full ? (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader
          title={row?.name ?? t('materials.detail')}
          actions={
            <>
              {edit}
              <Refresh
                busy={
                  record.isFetching ||
                  options.isFetching ||
                  governanceBusy > 0 ||
                  publicDetail.isFetching
                }
                onClick={() => {
                  void cache.invalidateQueries({
                    queryKey: ['material-source', id],
                  });
                  void cache.invalidateQueries({
                    queryKey: ['material-record-history', id],
                  });
                  void cache.invalidateQueries({
                    predicate: (query) =>
                      query.queryKey[1] === 'attachment-metadata' &&
                      query.queryKey[3] === id,
                  });
                  void record.refetch();
                  void options.refetch();
                  if (kind === 'skus' && row?.status === 'active' && !catalog)
                    void publicDetail.refetch();
                }}
              />
            </>
          }
        />
        {content}
        <Outlet />
      </PageContainer>
    </RouteChildPage>
  ) : (
    <RouteDrawer title={row?.name ?? t('materials.detail')} footer={edit}>
      {content}
      <Outlet />
    </RouteDrawer>
  );
}
