import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { CalendarClock, Plus, RefreshCw } from 'lucide-react';
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
import { useProductionAccess } from './access.js';
import { ReadOnlyNotice } from '#components/read-only-notice';
import type {
  MaintenancePlanType,
  ProductionEquipment,
  ProductionMaintenanceOrder,
  ProductionMaintenancePlan,
  ProductionOptions,
} from './model.js';

type OptionsResult = { data: ProductionOptions };
type EquipmentResult = { data: { equipment: ProductionEquipment[] } };
type PlansResult = { data: { plans: ProductionMaintenancePlan[] } };

const today = () => new Date().toISOString().slice(0, 10);

export default function ProductionMaintenancePlansPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const access = useProductionAccess();
  const [unitId, setUnitId] = useState('');
  const [notice, setNotice] = useState('');
  const [equipmentId, setEquipmentId] = useState('');
  const [name, setName] = useState('');
  const [planType, setPlanType] = useState<MaintenancePlanType>('preventive');
  const [intervalDays, setIntervalDays] = useState('30');
  const [nextDueOn, setNextDueOn] = useState(() => today());
  const [checklist, setChecklist] = useState('');
  const [assigneeName, setAssigneeName] = useState('');

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
  const effectiveEquipmentId = equipmentRows.some(
    (row) => row.id === equipmentId,
  )
    ? equipmentId
    : (equipmentRows[0]?.id ?? '');

  const plans = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-maintenance-plans', selectedUnit],
    queryFn: ({ signal }) =>
      api.request<PlansResult>({
        path: 'production/maintenance-plans',
        query: { unitId: selectedUnit },
        signal,
      }),
  });
  const planRows = plans.data?.data.plans ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: ['production-maintenance-plans'],
    });
    void queryClient.invalidateQueries({
      queryKey: ['production-maintenance'],
    });
  };

  const createPlan = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ProductionMaintenancePlan }>({
        path: 'production/maintenance-plans',
        method: 'POST',
        json: {
          unitId: selectedUnit,
          equipmentId: effectiveEquipmentId,
          name: name.trim(),
          type: planType,
          intervalDays: Number(intervalDays),
          nextDueOn,
          checklist: checklist.trim() || null,
          assigneeName: assigneeName.trim() || null,
        },
      }),
    onSuccess: () => {
      setName('');
      setChecklist('');
      setNotice(t('production.planCreated'));
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });

  const togglePlan = useMutation({
    retry: false,
    mutationFn: (plan: ProductionMaintenancePlan) =>
      api.request<{ data: ProductionMaintenancePlan }>({
        path: `production/maintenance-plans/${plan.id}`,
        method: 'PATCH',
        json: {
          status: plan.status === 'active' ? 'paused' : 'active',
          version: plan.version,
        },
      }),
    onSuccess: () => {
      setNotice(t('production.planUpdated'));
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });

  const generateOrder = useMutation({
    retry: false,
    mutationFn: (plan: ProductionMaintenancePlan) =>
      api.request<{ data: ProductionMaintenanceOrder & { existing: boolean } }>(
        {
          path: `production/maintenance-plans/${plan.id}/generate`,
          method: 'POST',
        },
      ),
    onSuccess: (result) => {
      setNotice(
        result.data.existing
          ? t('production.planOrderExists', { orderNo: result.data.orderNo })
          : t('production.planOrderCreated', { orderNo: result.data.orderNo }),
      );
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });

  return (
    <PageContainer>
      <PageHeader
        title={t('production.maintenancePlansTitle')}
        description={t('production.maintenancePlansDescription')}
        actions={
          <div className='flex flex-wrap items-end gap-2'>
            <label className='grid w-full gap-1 text-sm sm:w-44'>
              <span className='text-muted-foreground'>
                {t('production.planFilter')}
              </span>
              <select
                className={`${nativeSelectClass} w-full sm:w-44`}
                value={selectedUnit}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  setEquipmentId('');
                }}
              >
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.name}
                  </option>
                ))}
              </select>
            </label>
            <Button variant='outline' size='sm' onClick={refresh}>
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
      {!options.isPending && units.length === 0 ? (
        <Card className='mb-4 border-dashed'>
          <div className='px-6 py-5 text-sm text-muted-foreground'>
            {t('production.planNoUnit')}{' '}
            <Link
              className='font-medium text-foreground underline'
              to='/functions/production/setup'
            >
              {t('production.planGoSetup')}
            </Link>
          </div>
        </Card>
      ) : null}
      <Card className='mb-4'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <CalendarClock className='size-4' />
            {t('production.planCreateTitle')}
          </CardTitle>
          <CardDescription>{t('production.planCreateHint')}</CardDescription>
        </CardHeader>
        <div className='space-y-3 px-6 pb-6'>
          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            <label className='space-y-1 text-sm'>
              <span>{t('production.equipmentName')}</span>
              <select
                className={nativeSelectClass}
                value={effectiveEquipmentId}
                onChange={(event) => setEquipmentId(event.target.value)}
              >
                {equipmentRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.planName')}</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.maintenanceType')}</span>
              <select
                className={nativeSelectClass}
                value={planType}
                onChange={(event) =>
                  setPlanType(event.target.value as MaintenancePlanType)
                }
              >
                <option value='preventive'>
                  {t('production.planType_preventive')}
                </option>
                <option value='inspection'>
                  {t('production.planType_inspection')}
                </option>
              </select>
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.planIntervalDays')}</span>
              <Input
                type='number'
                min={1}
                max={3650}
                value={intervalDays}
                onChange={(event) => setIntervalDays(event.target.value)}
              />
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.planNextDue')}</span>
              <Input
                type='date'
                value={nextDueOn}
                onChange={(event) => setNextDueOn(event.target.value)}
              />
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.planAssignee')}</span>
              <Input
                value={assigneeName}
                onChange={(event) => setAssigneeName(event.target.value)}
              />
            </label>
            <label className='space-y-1 text-sm sm:col-span-2 xl:col-span-3'>
              <span>{t('production.planChecklist')}</span>
              <Input
                value={checklist}
                onChange={(event) => setChecklist(event.target.value)}
              />
            </label>
          </div>
          <Button
            size='sm'
            disabled={
              !access.canManage ||
              !selectedUnit ||
              !effectiveEquipmentId ||
              !name.trim() ||
              !nextDueOn ||
              createPlan.isPending
            }
            onClick={() => createPlan.mutate()}
          >
            <Plus className='mr-1 size-4' />
            {t('production.planCreate')}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('production.planListTitle')}</CardTitle>
          <CardDescription>{t('production.planListHint')}</CardDescription>
        </CardHeader>
        <div className='space-y-3 px-6 pb-6'>
          {planRows.map((plan) => (
            <div key={plan.id} className='rounded-md border p-3 text-sm'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div>
                  <span className='font-medium'>{plan.name}</span>
                  <span className='ml-2 text-muted-foreground'>
                    {plan.equipmentName}
                  </span>
                </div>
                <span
                  className={
                    plan.dueStatus === 'overdue'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }
                >
                  {t(`production.planDue_${plan.dueStatus}`)}
                </span>
              </div>
              <div className='mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground'>
                <span>
                  {t(`production.planType_${plan.type}`)} ·{' '}
                  {t('production.planEveryDays', {
                    days: plan.intervalDays,
                  })}
                </span>
                <span>
                  {t('production.planNextDue')}: {plan.nextDueOn}
                </span>
                <span>{t(`production.planStatus_${plan.status}`)}</span>
                {plan.lastCompletedOn ? (
                  <span>
                    {t('production.planLastCompleted')}: {plan.lastCompletedOn}
                  </span>
                ) : null}
              </div>
              {plan.checklist ? (
                <p className='mt-1 text-muted-foreground'>{plan.checklist}</p>
              ) : null}
              <div className='mt-2 flex flex-wrap items-center gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={
                    !access.canManage ||
                    plan.status !== 'active' ||
                    generateOrder.isPending
                  }
                  onClick={() => generateOrder.mutate(plan)}
                >
                  {plan.openOrderNo
                    ? t('production.planOpenOrder', {
                        orderNo: plan.openOrderNo,
                      })
                    : t('production.planGenerateOrder')}
                </Button>
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={togglePlan.isPending || !access.canManage}
                  onClick={() => togglePlan.mutate(plan)}
                >
                  {plan.status === 'active'
                    ? t('production.planPause')
                    : t('production.planResume')}
                </Button>
              </div>
            </div>
          ))}
          {planRows.length === 0 ? (
            <p className='text-sm text-muted-foreground'>
              {t('production.planEmpty')}
            </p>
          ) : null}
        </div>
      </Card>
    </PageContainer>
  );
}
