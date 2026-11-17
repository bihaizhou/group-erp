import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { usePageFieldVisibility } from '#components/page-field-visibility';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { useSettingsAccess } from '#hooks/use-settings-access';
import { businessMonth } from '#hooks/business-date';
import { operationsErrorKey } from './errors.js';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import type { OperationsTargets } from './model.js';
import { nativeSelectClass } from '#components/native-controls';

const metrics = ['processed', 'metal', 'sand', 'metalRate'] as const;
const currentPeriod = () => businessMonth();

export default function OperationsTargetsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const pageFields = usePageFieldVisibility('operations-targets');
  const showField = (field: string) =>
    pageFields.visible('operations.target', field);
  const optionalColumns = [
    'actualValue',
    'achievementPct',
    'progressPct',
    'varianceValue',
    'status',
    'updatedAt',
  ] as const;
  const columnCount =
    8 - optionalColumns.filter((field) => !showField(field)).length;
  const [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '';
  const [period, setPeriod] = useState(currentPeriod);
  const [metric, setMetric] = useState<(typeof metrics)[number]>('processed');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const targets = useQuery({
    retry: false,
    queryKey: ['operations-targets', subjectId, period],
    queryFn: ({ signal }) =>
      api.request<{ data: OperationsTargets }>({
        path: 'operations/targets',
        query: {
          ...(subjectId ? { subjectId: subjectId } : {}),
          period,
        },
        signal,
      }),
  });
  const save = useMutation({
    mutationFn: () =>
      api.request({
        path: 'operations/targets',
        method: 'PUT',
        json: {
          subjectId: subjectId,
          period,
          metric,
          targetValue: value.trim(),
        },
      }),
    onSuccess: async () => {
      setError('');
      await queryClient.invalidateQueries({ queryKey: ['operations-targets'] });
    },
    onError: (reason) => setError(operationsErrorKey(reason)),
  });
  const access = useSettingsAccess('operations');
  return (
    <PageContainer>
      <PageHeader
        title={t('operations.targets')}
        description={t('operations.targetsDescription')}
      />
      <ReadOnlyNotice canManage={access.canManage} />
      <div className='mb-4 flex flex-wrap items-end gap-3'>
        <fieldset className='contents' disabled={!access.canManage}>
          <label className='text-sm'>
            <span className='mb-1 block text-muted-foreground'>
              {t('operations.period')}
            </span>
            <Input
              type='month'
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            />
          </label>
          <label className='text-sm'>
            <span className='mb-1 block text-muted-foreground'>
              {t('operations.metric')}
            </span>
            <select
              className={nativeSelectClass}
              value={metric}
              onChange={(event) => {
                setMetric(event.target.value as (typeof metrics)[number]);
                setValue('');
              }}
            >
              {metrics.map((item) => (
                <option key={item} value={item}>
                  {t(`operations.metric_${item}`)}
                </option>
              ))}
            </select>
          </label>
          <label className='text-sm'>
            <span className='mb-1 block text-muted-foreground'>
              {t('operations.targetValue')}
            </span>
            <Input
              inputMode='decimal'
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder='0'
            />
          </label>
          <Button
            disabled={
              !access.canManage || !subjectId || !value.trim() || save.isPending
            }
            onClick={() => save.mutate()}
          >
            {t('operations.saveTarget')}
          </Button>
        </fieldset>
      </div>
      {error ? (
        <p className='mb-3 text-sm text-destructive'>
          {t(`operations.error.${error}`)}
        </p>
      ) : null}
      <p className='mb-3 text-sm text-muted-foreground'>
        {t('operations.targetsTotal', {
          count: targets.data?.data.total ?? 0,
        })}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('operations.metric')}</TableHead>
            <TableHead>{t('operations.targetValue')}</TableHead>
            {showField('actualValue') ? (
              <TableHead>{t('operations.actualValue')}</TableHead>
            ) : null}
            {showField('achievementPct') ? (
              <TableHead>{t('operations.achievement')}</TableHead>
            ) : null}
            {showField('progressPct') ? (
              <TableHead>{t('operations.progress')}</TableHead>
            ) : null}
            {showField('varianceValue') ? (
              <TableHead>{t('operations.variance')}</TableHead>
            ) : null}
            {showField('status') ? (
              <TableHead>{t('operations.status')}</TableHead>
            ) : null}
            {showField('updatedAt') ? (
              <TableHead>{t('operations.updatedAt')}</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {(targets.data?.data.items ?? []).map((target) => (
            <TableRow key={target.id}>
              <TableCell>{t(`operations.metric_${target.metric}`)}</TableCell>
              <TableCell>{target.targetValue}</TableCell>
              {showField('actualValue') ? (
                <TableCell>{target.actualValue ?? '—'}</TableCell>
              ) : null}
              {showField('achievementPct') ? (
                <TableCell>
                  {target.achievementPct === null
                    ? '—'
                    : `${target.achievementPct}%`}
                </TableCell>
              ) : null}
              {showField('progressPct') ? (
                <TableCell>{`${target.progressPct}%`}</TableCell>
              ) : null}
              {showField('varianceValue') ? (
                <TableCell>{target.varianceValue ?? '—'}</TableCell>
              ) : null}
              {showField('status') ? (
                <TableCell>
                  {t(`operations.targetStatus_${target.status}`)}
                </TableCell>
              ) : null}
              {showField('updatedAt') ? (
                <TableCell>{target.updatedAt.slice(0, 19)}</TableCell>
              ) : null}
            </TableRow>
          ))}
          {targets.data?.data.items.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columnCount}
                className='py-8 text-center text-sm text-muted-foreground'
              >
                {t('operations.noTargets')}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </PageContainer>
  );
}
