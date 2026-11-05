import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
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

const metrics = ['processed', 'metal', 'sand', 'metalRate'] as const;
const currentPeriod = () => new Date().toISOString().slice(0, 7);

export default function OperationsTargetsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
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
    onError: (reason) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
  });
  return (
    <PageContainer>
      <PageHeader
        title={t('operations.targets')}
        description={t('operations.targetsDescription')}
      />
      <div className='mb-4 flex flex-wrap items-end gap-3'>
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
            className='h-9 rounded-md border bg-background px-3'
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
          disabled={!subjectId || !value.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          {t('operations.saveTarget')}
        </Button>
      </div>
      {error ? <p className='mb-3 text-sm text-destructive'>{error}</p> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('operations.metric')}</TableHead>
            <TableHead>{t('operations.targetValue')}</TableHead>
            <TableHead>{t('operations.actualValue')}</TableHead>
            <TableHead>{t('operations.achievement')}</TableHead>
            <TableHead>{t('operations.progress')}</TableHead>
            <TableHead>{t('operations.variance')}</TableHead>
            <TableHead>{t('operations.status')}</TableHead>
            <TableHead>{t('operations.updatedAt')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(targets.data?.data.items ?? []).map((target) => (
            <TableRow key={target.id}>
              <TableCell>{t(`operations.metric_${target.metric}`)}</TableCell>
              <TableCell>{target.targetValue}</TableCell>
              <TableCell>{target.actualValue ?? '—'}</TableCell>
              <TableCell>
                {target.achievementPct === null
                  ? '—'
                  : `${target.achievementPct}%`}
              </TableCell>
              <TableCell>{`${target.progressPct}%`}</TableCell>
              <TableCell>{target.varianceValue ?? '—'}</TableCell>
              <TableCell>
                {t(`operations.targetStatus_${target.status}`)}
              </TableCell>
              <TableCell>{target.updatedAt.slice(0, 19)}</TableCell>
            </TableRow>
          ))}
          {targets.data?.data.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className='text-muted-foreground'>
                {t('operations.noTargets')}
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </PageContainer>
  );
}
