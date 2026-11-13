import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useProductionAccess } from './access.js';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Input } from '#components/ui/input';
import { nativeSelectClass } from '#components/native-controls';
import type {
  OvertimeStatus,
  ProductionOptions,
  ProductionOvertime,
} from './model.js';

type OptionsResult = { data: ProductionOptions };
type OvertimeResult = { data: { records: ProductionOvertime[] } };

const today = () => new Date().toISOString().slice(0, 10);

export default function ProductionOvertimePage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const access = useProductionAccess();
  const canApprove = access.canApprove;
  const [unitId, setUnitId] = useState('');
  const [businessDate, setBusinessDate] = useState(() => today());
  const [status, setStatus] = useState<OvertimeStatus | ''>('');
  const [notice, setNotice] = useState('');
  const [rejectingId, setRejectingId] = useState('');
  const [rejectReason, setRejectReason] = useState('');

  const options = useQuery({
    retry: false,
    queryKey: ['production-options'],
    queryFn: ({ signal }) =>
      api.request<OptionsResult>({ path: 'production/options', signal }),
  });
  const units = options.data?.data.units ?? [];
  const selectedUnit = unitId || units[0]?.id || '';

  const overtime = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-overtime', selectedUnit, businessDate, status],
    queryFn: ({ signal }) =>
      api.request<OvertimeResult>({
        path: 'production/overtime',
        query: {
          unitId: selectedUnit,
          businessDate,
          ...(status ? { status } : {}),
        },
        signal,
      }),
  });
  const records = overtime.data?.data.records ?? [];
  const submitted = records.filter((row) => row.status === 'submitted').length;
  const approved = records.filter((row) => row.status === 'approved').length;
  const rejected = records.filter((row) => row.status === 'rejected').length;

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['production-overtime'] });
  };

  const decide = useMutation({
    retry: false,
    mutationFn: (input: {
      id: string;
      decision: 'approve' | 'reject';
      version: number;
      reason?: string;
    }) =>
      api.request<{ data: ProductionOvertime }>({
        path: `production/overtime/${input.id}/decision`,
        method: 'POST',
        json: {
          decision: input.decision,
          version: input.version,
          reason: input.reason ?? null,
        },
      }),
    onSuccess: (_result, variables) => {
      setRejectingId('');
      setRejectReason('');
      setNotice(
        variables.decision === 'approve'
          ? t('production.overtimeApproved')
          : t('production.overtimeRejected'),
      );
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });

  return (
    <PageContainer>
      <PageHeader
        title={t('production.overtimeTitle')}
        description={t('production.overtimeDescription')}
        actions={
          <div className='flex flex-wrap items-end gap-2'>
            <label className='grid w-full gap-1 text-sm sm:w-40'>
              <span className='text-muted-foreground'>
                {t('production.unit')}
              </span>
              <select
                className={`${nativeSelectClass} w-full sm:w-40`}
                value={selectedUnit}
                onChange={(event) => setUnitId(event.target.value)}
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <label className='grid w-full gap-1 text-sm sm:w-40'>
              <span className='text-muted-foreground'>
                {t('production.businessDate')}
              </span>
              <Input
                type='date'
                className='w-full sm:w-40'
                value={businessDate}
                onChange={(event) => setBusinessDate(event.target.value)}
              />
            </label>
            <label className='grid w-full gap-1 text-sm sm:w-40'>
              <span className='text-muted-foreground'>
                {t('production.statusLabel')}
              </span>
              <select
                className={`${nativeSelectClass} w-full sm:w-40`}
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as OvertimeStatus | '')
                }
              >
                <option value=''>{t('production.overtimeAllStatuses')}</option>
                {(
                  [
                    'submitted',
                    'approved',
                    'rejected',
                    'cancelled',
                  ] as OvertimeStatus[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {t(`production.overtimeStatus_${value}`)}
                  </option>
                ))}
              </select>
            </label>
            <Button variant='outline' onClick={refresh}>
              <RefreshCw className='mr-1 size-4' />
              {t('production.refresh')}
            </Button>
          </div>
        }
      />
      {notice ? (
        <p className='mb-3 text-sm text-muted-foreground'>{notice}</p>
      ) : null}
      <ReadOnlyNotice
        canManage={access.canManage}
        canApprove={access.canApprove}
      />
      {units.length === 0 ? (
        <p className='mb-4 rounded-md border p-3 text-sm text-muted-foreground'>
          {t('production.overtimeNoUnits')}{' '}
          <a
            className='underline underline-offset-4'
            href='/functions/production/setup'
          >
            {t('production.goProductionSetup')}
          </a>
        </p>
      ) : null}

      <div className='mb-4 grid gap-3 sm:grid-cols-3'>
        <div className='rounded-md border p-3'>
          <div className='text-sm text-muted-foreground'>
            {t('production.overtimePending')}
          </div>
          <div className='text-2xl font-semibold'>{submitted}</div>
        </div>
        <div className='rounded-md border p-3'>
          <div className='text-sm text-muted-foreground'>
            {t('production.overtimeStatus_approved')}
          </div>
          <div className='text-2xl font-semibold'>{approved}</div>
        </div>
        <div className='rounded-md border p-3'>
          <div className='text-sm text-muted-foreground'>
            {t('production.overtimeStatus_rejected')}
          </div>
          <div className='text-2xl font-semibold'>{rejected}</div>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('production.overtimeListTitle')}</CardTitle>
          <CardDescription>{t('production.overtimeListHint')}</CardDescription>
        </CardHeader>
        <div className='space-y-3 px-6 pb-6'>
          {records.map((record) => (
            <div key={record.id} className='rounded-md border p-3 text-sm'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <span className='font-medium'>{record.personName}</span>
                  <span className='ml-2 text-muted-foreground'>
                    {record.positionName} · {record.unitName}
                  </span>
                </div>
                <span
                  className={
                    record.status === 'rejected'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }
                >
                  {t(`production.overtimeStatus_${record.status}`)}
                </span>
              </div>
              <div className='mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground'>
                <span>
                  {record.businessDate} · {record.hours}
                  {t('production.overtimeHourUnit')}
                </span>
                <span>{t(`production.overtimeType_${record.type}`)}</span>
                <span>
                  {t(`production.overtimeCompensation_${record.compensation}`)}
                </span>
                <span>{record.requestNo}</span>
              </div>
              <p className='mt-1'>{record.reason}</p>
              {record.rejectReason ? (
                <p className='mt-1 text-destructive'>
                  {t('production.overtimeRejectReason')}: {record.rejectReason}
                </p>
              ) : null}
              {record.status === 'submitted' && canApprove ? (
                <div className='mt-2 flex flex-wrap items-center gap-2'>
                  <Button
                    size='sm'
                    disabled={decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        id: record.id,
                        decision: 'approve',
                        version: record.version,
                      })
                    }
                  >
                    {t('production.overtimeApprove')}
                  </Button>
                  {rejectingId === record.id ? (
                    <>
                      <Input
                        className='w-64'
                        placeholder={t('production.overtimeRejectReason')}
                        value={rejectReason}
                        onChange={(event) =>
                          setRejectReason(event.target.value)
                        }
                      />
                      <Button
                        size='sm'
                        variant='destructive'
                        disabled={!rejectReason.trim() || decide.isPending}
                        onClick={() =>
                          decide.mutate({
                            id: record.id,
                            decision: 'reject',
                            version: record.version,
                            reason: rejectReason.trim(),
                          })
                        }
                      >
                        {t('production.overtimeConfirmReject')}
                      </Button>
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => {
                          setRejectingId('');
                          setRejectReason('');
                        }}
                      >
                        {t('production.overtimeCancel')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => {
                        setRejectingId(record.id);
                        setRejectReason('');
                      }}
                    >
                      {t('production.overtimeReject')}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>
          ))}
          {records.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              {t('production.overtimeEmpty')}
            </p>
          ) : null}
        </div>
      </Card>
    </PageContainer>
  );
}
