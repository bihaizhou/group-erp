import { textValue } from './model.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, Outlet, useLocation, useParams } from 'react-router';
import { RouteChildPage } from '#components/route-child-page';
import { RouteDrawer } from '#components/route-drawer';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { StatusBadge } from '#components/status-badge';
import { LongText } from '#components/long-text';
import { Button } from '#components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { usePeopleRecord, usePeopleOptions, usePeopleCan } from './hooks.js';
import { PeopleErrorNotice, PeopleLoading, PeopleRefresh } from './controls.js';
import { TalentCard } from './talent-card.js';
import { CareerTimeline } from './career.js';
import { WorkflowActions } from './workflow-action.js';
import { ApprovalTimeline } from './approval-timeline.js';
import { ContractEndAction } from './contract-end.js';
import { ChangeChecklist } from './change-checklist.js';
import {
  fields,
  kindFromPath,
  recordValue,
  workflows,
  readOnly,
  type Data,
  type Value,
  type Kind,
} from './model.js';

export default function PeopleDetailPage({
  kind: fixedKind,
  idParam = 'recordId',
}: { kind?: Kind; idParam?: 'recordId' | 'relatedId' } = {}) {
  const { t, i18n } = useTranslation(),
    location = useLocation(),
    params = useParams();
  const kind = fixedKind ?? kindFromPath(location.pathname),
    id = params[idParam];
  const record = usePeopleRecord(kind, id),
    options = usePeopleOptions(kind),
    canWrite = usePeopleCan(kind);
  const row = record.data?.data;
  const cache = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const name = (source: string, id: Value) =>
    options.data?.data[source]?.rows.find((r) => r.id === id)?.name ?? '—';
  const display = (key: string, value: Value): string => {
    if (value === null || value === undefined || value === '') return '—';
    const field = fields[kind].find((f) => f.key === key);
    if (field?.source) return name(field.source, value);
    if (field?.type === 'boolean') return t(value ? 'people.yes' : 'people.no');
    if (field?.choices) return t(`people.values.${textValue(value)}`);
    if (field?.type === 'date')
      return new Date(`${textValue(value)}T00:00:00`).toLocaleDateString(
        i18n.language,
      );
    if (typeof value === 'number') return value.toLocaleString(i18n.language);
    return textValue(value);
  };
  const actions = (
    <>
      {row &&
      canWrite &&
      !record.isError &&
      !options.isError &&
      !readOnly.includes(kind) &&
      (!workflows.includes(kind) || row.status === 'draft') ? (
        <Button
          nativeButton={false}
          render={<Link to={{ pathname: 'edit', search: location.search }} />}
        >
          {t('people.edit')}
        </Button>
      ) : null}
      {kind === 'employments' && row && canWrite && !record.isError ? (
        <ContractEndAction row={row} onSaved={() => void record.refetch()} />
      ) : null}
      <PeopleRefresh
        busy={refreshing || record.isFetching || options.isFetching}
        onClick={() => {
          setRefreshing(true);
          void Promise.all([
            record.refetch(),
            options.refetch(),
            kind === 'profiles' && row?.personId
              ? cache.invalidateQueries({
                  queryKey: ['people-talent', row.personId],
                })
              : kind === 'employees' && row
                ? cache.invalidateQueries({
                    queryKey: ['people-career', row.id],
                  })
                : Promise.resolve(),
          ]).finally(() => setRefreshing(false));
        }}
      />
    </>
  );
  const body =
    record.isError || options.isError ? (
      <PeopleErrorNotice
        error={record.error ?? options.error}
        retry={() => {
          void record.refetch();
          void options.refetch();
        }}
      />
    ) : !row ? (
      <PeopleLoading />
    ) : (
      <div className='flex flex-col gap-6'>
        {kind === 'profiles' ? (
          <TalentCard profile={row} />
        ) : (
          <>
            <div className='flex items-center gap-2'>
              <StatusBadge>{t(`people.states.${row.status}`)}</StatusBadge>
              <span className='text-sm text-muted-foreground'>{row.code}</span>
            </div>
            <dl className='flex flex-col gap-4'>
              {fields[kind].map((field) => (
                <div
                  key={field.key}
                  className='grid gap-1 sm:grid-cols-[8rem_1fr] sm:gap-4'
                >
                  <dt className='text-sm text-muted-foreground'>
                    {t(`people.fields.${field.key}`)}
                  </dt>
                  <dd className='min-w-0 text-sm break-words'>
                    <LongText>
                      {display(field.key, recordValue(row, field.key))}
                    </LongText>
                  </dd>
                </div>
              ))}
            </dl>
            {kind === 'employees' ? (
              <CareerTimeline personId={row.id} options={options.data?.data} />
            ) : null}
            {kind === 'dimensions' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('people.standards')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  {(row.data.standards as string[]).map((s, index) => (
                    <div key={s}>
                      <p className='text-sm font-medium'>
                        {t('people.scoreStandard', { score: index + 1 })}
                      </p>
                      <LongText>{s}</LongText>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {kind === 'models' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('people.fields.items')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-3'>
                  {(row.data.items as Data[]).map((item) => (
                    <div
                      key={textValue(item.dimensionId)}
                      className='flex justify-between gap-4 text-sm'
                    >
                      <span>{name('dimensions', item.dimensionId)}</span>
                      <span className='tabular-nums'>
                        {t('people.targetScore', { score: item.target })}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
            {kind === 'evaluations' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('people.dimensionTable')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-4'>
                  {(row.data.ratings as Data[]).map((rating) => {
                    const dimension = (
                      (row.snapshot?.dimensions as Data[] | undefined) ?? []
                    ).find((d) => d.dimensionId === rating.dimensionId);
                    return (
                      <div
                        key={textValue(rating.dimensionId)}
                        className='flex flex-col gap-2 rounded-lg border p-4'
                      >
                        <p className='text-sm font-medium'>
                          {textValue(
                            dimension?.name ??
                              name('dimensions', rating.dimensionId),
                          )}
                        </p>
                        <div className='grid gap-3 sm:grid-cols-3'>
                          {['selfScore', 'managerScore', 'confirmedScore'].map(
                            (key) => (
                              <div key={key}>
                                <p className='text-xs text-muted-foreground'>
                                  {t(`people.fields.${textValue(key)}`)}
                                </p>
                                <p className='text-sm tabular-nums'>
                                  {typeof rating[key] === 'number'
                                    ? rating[key].toLocaleString(
                                        i18n.language,
                                        { maximumFractionDigits: 1 },
                                      )
                                    : t('people.unrated')}
                                </p>
                                <LongText>
                                  {textValue(
                                    rating[`${textValue(key)}Evidence`] ?? '—',
                                  )}
                                </LongText>
                              </div>
                            ),
                          )}
                        </div>
                        {dimension ? (
                          <p className='text-sm text-muted-foreground'>
                            {t('people.targetScore', {
                              score: dimension.target,
                            })}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}
            {kind === 'workforcePlans' ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('people.fields.items')}</CardTitle>
                </CardHeader>
                <CardContent className='flex flex-col gap-4'>
                  {(row.data.items as Data[]).map((item) => {
                    const baseline = (
                      (row.snapshot?.items as Data[] | undefined) ?? []
                    ).find((v) => v.positionId === item.positionId);
                    return (
                      <div
                        key={textValue(item.positionId)}
                        className='flex flex-col gap-2 rounded-lg border p-4'
                      >
                        <p className='text-sm font-medium'>
                          {textValue(
                            baseline?.positionName ??
                              name('orgPositions', item.positionId),
                          )}
                        </p>
                        <div className='grid gap-3 sm:grid-cols-3'>
                          {[
                            ['baseline', baseline?.baseline],
                            ['requested', item.requested],
                            ['approved', item.approved],
                            [
                              'currentStaffing',
                              row.currentStaffing?.[textValue(item.positionId)],
                            ],
                          ].map(([key, value]) => (
                            <div key={textValue(key)}>
                              <p className='text-xs text-muted-foreground'>
                                {t(`people.fields.${textValue(key)}`)}
                              </p>
                              <p className='text-lg font-medium tabular-nums'>
                                {textValue(value ?? '—')}
                              </p>
                            </div>
                          ))}
                        </div>
                        <LongText>{textValue(item.basis)}</LongText>
                        {((row.data.taskResults as Data[] | undefined) ?? [])
                          .filter((task) => task.positionId === item.positionId)
                          .map((task) => (
                            <div
                              key={textValue(task.positionId)}
                              className='flex flex-col gap-2'
                            >
                              <p className='text-sm'>
                                {t('people.fields.owner')} ·{' '}
                                {textValue(task.owner)}
                              </p>
                              <StatusBadge>
                                {t(`people.states.${textValue(task.status)}`)}
                              </StatusBadge>
                              <LongText>
                                {textValue(task.result || '—')}
                              </LongText>
                              <p className='text-xs text-muted-foreground'>
                                {t('people.linkedAssignments', {
                                  count: (task.assignmentIds as string[])
                                    .length,
                                })}
                              </p>
                            </div>
                          ))}
                        <p className='text-sm text-muted-foreground'>
                          {t(`people.values.${textValue(item.approach)}`)} ·{' '}
                          {textValue(item.dueDate)}
                        </p>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ) : null}
          </>
        )}
        {kind === 'changes' && row.checklist?.items.length ? (
          <ChangeChecklist
            changeId={row.id}
            checklist={row.checklist}
            canEdit={canWrite}
          />
        ) : null}
        {kind === 'changes' && row.approval ? (
          <ApprovalTimeline approval={row.approval} />
        ) : null}
        {workflows.includes(kind) ? (
          <WorkflowActions kind={kind} row={row} />
        ) : null}
        {row.workflow ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('people.processingHistory')}</CardTitle>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              {row.workflow.history.map((entry) => (
                <div
                  key={entry.at + entry.transition}
                  className='flex flex-col gap-1 border-b pb-3 last:border-0'
                >
                  <p className='text-sm font-medium'>
                    {t(
                      entry.transition === '$create'
                        ? 'people.create'
                        : `people.transitions.${entry.transition}`,
                    )}
                  </p>
                  <p className='text-xs text-muted-foreground'>
                    {new Date(entry.at).toLocaleString(i18n.language)} ·{' '}
                    {entry.actorId}
                  </p>
                  <LongText>{textValue(entry.input.reason ?? '—')}</LongText>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  if (['profiles', 'evaluations', 'workforcePlans'].includes(kind))
    return (
      <RouteChildPage>
        <PageContainer
          className={kind === 'profiles' ? 'max-w-7xl' : 'max-w-4xl'}
        >
          <BackButton />
          <PageHeader
            title={row?.name ?? t(`people.${kind}`)}
            actions={actions}
          />
          {body}
          <Outlet />
        </PageContainer>
      </RouteChildPage>
    );
  return (
    <RouteDrawer
      title={row?.name ?? t(`people.${kind}`)}
      footer={actions}
      className='sm:max-w-2xl'
    >
      {body}
      <Outlet />
    </RouteDrawer>
  );
}
