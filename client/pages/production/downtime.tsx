import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus, RefreshCw } from 'lucide-react';
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
import type {
  DowntimeCategory,
  DowntimeImpact,
  DowntimeStatus,
  ProductionDowntime,
  ProductionDowntimePage,
  ProductionEquipment,
  ProductionOptions,
} from './model.js';

type OptionsResult = { data: ProductionOptions };
type EquipmentResult = { data: { equipment: ProductionEquipment[] } };
type DowntimeResult = { data: ProductionDowntimePage };

const selectClass =
  'h-9 rounded-md border border-input bg-background px-3 text-sm';
const textareaClass =
  'min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm';

const today = () => new Date().toISOString().slice(0, 10);
const nowInput = () => new Date().toISOString().slice(0, 16);

export default function ProductionDowntimePage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const [date, setDate] = useState(() => today());
  const [status, setStatus] = useState<DowntimeStatus | ''>('');
  const [notice, setNotice] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [startedAt, setStartedAt] = useState(() => nowInput());
  const [category, setCategory] = useState<DowntimeCategory>('equipment');
  const [impact, setImpact] = useState<DowntimeImpact>('stop');
  const [description, setDescription] = useState('');
  const [closingId, setClosingId] = useState('');
  const [endedAt, setEndedAt] = useState(() => nowInput());
  const [resolution, setResolution] = useState('');

  const options = useQuery({
    retry: false,
    queryKey: ['production-options'],
    queryFn: ({ signal }) =>
      api.request<OptionsResult>({ path: 'production/options', signal }),
  });
  const units = options.data?.data.units ?? [];
  const selectedUnit = unitId || units[0]?.id || '';

  const equipment = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-equipment', selectedUnit],
    queryFn: ({ signal }) =>
      api.request<EquipmentResult>({
        path: 'production/equipment',
        query: { unitId: selectedUnit },
        signal,
      }),
  });
  const equipmentRows = equipment.data?.data.equipment ?? [];

  const events = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-downtime', selectedUnit, date, status],
    queryFn: ({ signal }) =>
      api.request<DowntimeResult>({
        path: 'production/downtime-events',
        query: {
          unitId: selectedUnit,
          date,
          ...(status ? { status } : {}),
        },
        signal,
      }),
  });
  const data = events.data?.data;
  const rows = data?.events ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['production-downtime'] });
    void queryClient.invalidateQueries({ queryKey: ['operations-overview'] });
  };

  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ProductionDowntime }>({
        path: 'production/downtime-events',
        method: 'POST',
        json: {
          unitId: selectedUnit,
          equipmentId: equipmentId || null,
          startedAt: new Date(startedAt).toISOString(),
          category,
          impact,
          description: description.trim(),
        },
      }),
    onSuccess: () => {
      setDescription('');
      setStartedAt(nowInput());
      setNotice(t('production.downtimeCreated'));
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });

  const close = useMutation({
    retry: false,
    mutationFn: (row: ProductionDowntime) =>
      api.request<{ data: ProductionDowntime }>({
        path: `production/downtime-events/${row.id}/close`,
        method: 'POST',
        json: {
          endedAt: new Date(endedAt).toISOString(),
          resolution: resolution.trim(),
          version: row.version,
        },
      }),
    onSuccess: () => {
      setClosingId('');
      setResolution('');
      setEndedAt(nowInput());
      setNotice(t('production.downtimeClosedMessage'));
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });

  return (
    <PageContainer>
      <PageHeader
        title={t('production.downtimeTitle')}
        description={t('production.downtimePageDescription')}
        actions={
          <Button
            variant='outline'
            size='sm'
            onClick={() => void events.refetch()}
          >
            <RefreshCw className='mr-1 size-4' />
            {t('production.refresh')}
          </Button>
        }
      />

      <Card className='mb-4'>
        <CardHeader>
          <CardTitle className='text-base'>
            {t('production.downtimeFilter')}
          </CardTitle>
          <CardDescription>
            {t('production.downtimeFilterHint')}
          </CardDescription>
        </CardHeader>
        <div className='grid gap-3 px-6 pb-6 sm:grid-cols-3'>
          <label className='grid gap-1 text-sm'>
            <span>{t('production.unit')}</span>
            <select
              className={selectClass}
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
          <label className='grid gap-1 text-sm'>
            <span>{t('production.businessDate')}</span>
            <Input
              type='date'
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-sm'>
            <span>{t('production.downtimeStatus')}</span>
            <select
              className={selectClass}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as DowntimeStatus | '')
              }
            >
              <option value=''>{t('production.allStatuses')}</option>
              <option value='open'>
                {t('production.downtimeStatus_open')}
              </option>
              <option value='closed'>
                {t('production.downtimeStatus_closed')}
              </option>
              <option value='cancelled'>
                {t('production.downtimeStatus_cancelled')}
              </option>
            </select>
          </label>
        </div>
      </Card>

      {units.length === 0 ? (
        <p className='mb-4 rounded-md border p-3 text-sm text-muted-foreground'>
          {t('production.downtimeNoUnits')}{' '}
          <a
            className='underline underline-offset-4'
            href='/functions/production/setup'
          >
            {t('production.goProductionSetup')}
          </a>
        </p>
      ) : null}

      <div className='mb-4 grid gap-3 sm:grid-cols-3'>
        <Card>
          <CardHeader>
            <CardDescription>{t('production.downtimeOpen')}</CardDescription>
            <CardTitle>{data?.summary.open ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>
              {t('production.downtimeClosedCount')}
            </CardDescription>
            <CardTitle>{data?.summary.closed ?? 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>
              {t('production.downtimeTotalMinutes')}
            </CardDescription>
            <CardTitle>{data?.summary.minutes ?? 0}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className='mb-4'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Plus className='size-4' />
            {t('production.downtimeCreate')}
          </CardTitle>
          <CardDescription>
            {t('production.downtimeCreateHint')}
          </CardDescription>
        </CardHeader>
        <div className='grid gap-3 px-6 pb-6 sm:grid-cols-2'>
          <label className='grid gap-1 text-sm'>
            <span>{t('production.equipmentName')}</span>
            <select
              className={selectClass}
              value={equipmentId}
              onChange={(event) => setEquipmentId(event.target.value)}
            >
              <option value=''>{t('production.downtimeNoEquipment')}</option>
              {equipmentRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.code} {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className='grid gap-1 text-sm'>
            <span>{t('production.downtimeStartedAt')}</span>
            <Input
              type='datetime-local'
              value={startedAt}
              onChange={(event) => setStartedAt(event.target.value)}
            />
          </label>
          <label className='grid gap-1 text-sm'>
            <span>{t('production.downtimeCategory')}</span>
            <select
              className={selectClass}
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as DowntimeCategory)
              }
            >
              {[
                'equipment',
                'production',
                'utility',
                'material',
                'quality',
                'other',
              ].map((key) => (
                <option key={key} value={key}>
                  {t(`production.downtimeCategory_${key}`)}
                </option>
              ))}
            </select>
          </label>
          <label className='grid gap-1 text-sm'>
            <span>{t('production.downtimeImpact')}</span>
            <select
              className={selectClass}
              value={impact}
              onChange={(event) =>
                setImpact(event.target.value as DowntimeImpact)
              }
            >
              {['stop', 'speed_loss', 'other'].map((key) => (
                <option key={key} value={key}>
                  {t(`production.downtimeImpact_${key}`)}
                </option>
              ))}
            </select>
          </label>
          <label className='grid gap-1 text-sm sm:col-span-2'>
            <span>{t('production.downtimeDescription')}</span>
            <textarea
              className={textareaClass}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <div className='sm:col-span-2'>
            <Button
              disabled={
                !selectedUnit || !description.trim() || create.isPending
              }
              onClick={() => create.mutate()}
            >
              <Plus className='mr-1 size-4' />
              {t('production.downtimeSubmit')}
            </Button>
          </div>
        </div>
      </Card>

      {notice ? <p className='mb-4 text-sm'>{notice}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Clock className='size-4' />
            {t('production.downtimeList')}
          </CardTitle>
          <CardDescription>{t('production.downtimeListHint')}</CardDescription>
        </CardHeader>
        <div className='overflow-x-auto px-6 pb-6'>
          <table className='w-full text-sm'>
            <thead>
              <tr className='border-b text-left'>
                <th className='py-2 pr-3'>
                  {t('production.downtimeStartedAt')}
                </th>
                <th className='py-2 pr-3'>{t('production.equipmentName')}</th>
                <th className='py-2 pr-3'>
                  {t('production.downtimeCategory')}
                </th>
                <th className='py-2 pr-3'>
                  {t('production.downtimeDescription')}
                </th>
                <th className='py-2 pr-3'>{t('production.downtimeStatus')}</th>
                <th className='py-2 pr-3'>{t('production.downtimeMinutes')}</th>
                <th className='py-2' />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td className='py-4 text-muted-foreground' colSpan={7}>
                    {t('production.downtimeEmpty')}
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className='border-b align-top'>
                    <td className='py-2 pr-3'>
                      {new Date(row.startedAt).toLocaleString('zh-CN', {
                        hour12: false,
                      })}
                    </td>
                    <td className='py-2 pr-3'>{row.equipmentName || '—'}</td>
                    <td className='py-2 pr-3'>
                      {t(`production.downtimeCategory_${row.category}`)}
                    </td>
                    <td className='max-w-72 py-2 pr-3'>{row.description}</td>
                    <td className='py-2 pr-3'>
                      {t(`production.downtimeStatus_${row.status}`)}
                    </td>
                    <td className='py-2 pr-3'>{row.durationMinutes}</td>
                    <td className='py-2'>
                      {row.status === 'open' ? (
                        <Button
                          variant='outline'
                          size='sm'
                          onClick={() => {
                            setClosingId(row.id);
                            setEndedAt(nowInput());
                            setResolution('');
                          }}
                        >
                          {t('production.downtimeClose')}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {closingId ? (
        <Card className='mt-4'>
          <CardHeader>
            <CardTitle className='text-base'>
              {t('production.downtimeCloseTitle')}
            </CardTitle>
            <CardDescription>
              {t('production.downtimeCloseHint')}
            </CardDescription>
          </CardHeader>
          <div className='grid gap-3 px-6 pb-6 sm:grid-cols-2'>
            <label className='grid gap-1 text-sm'>
              <span>{t('production.downtimeEndedAt')}</span>
              <Input
                type='datetime-local'
                value={endedAt}
                onChange={(event) => setEndedAt(event.target.value)}
              />
            </label>
            <label className='grid gap-1 text-sm sm:col-span-2'>
              <span>{t('production.downtimeResolution')}</span>
              <textarea
                className={textareaClass}
                value={resolution}
                onChange={(event) => setResolution(event.target.value)}
              />
            </label>
            <div className='flex gap-2 sm:col-span-2'>
              <Button
                disabled={!resolution.trim() || close.isPending}
                onClick={() => {
                  const row = rows.find((item) => item.id === closingId);
                  if (row) close.mutate(row);
                }}
              >
                {t('production.downtimeCloseConfirm')}
              </Button>
              <Button variant='outline' onClick={() => setClosingId('')}>
                {t('production.cancel')}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </PageContainer>
  );
}
