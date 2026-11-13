import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Wrench } from 'lucide-react';
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from '#components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useProductionAccess } from './access.js';
import { ReadOnlyNotice } from '#components/read-only-notice';
import type {
  ProductionEquipment,
  ProductionMaintenanceOrder,
  ProductionOptions,
  MaintenanceStatus,
} from './model.js';

type OptionsResult = { data: ProductionOptions };
type EquipmentResult = { data: { equipment: ProductionEquipment[] } };
type OrdersResult = { data: { orders: ProductionMaintenanceOrder[] } };

export default function ProductionEquipmentPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const access = useProductionAccess();
  const [unitId, setUnitId] = useState('');
  const [notice, setNotice] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [criticality, setCriticality] = useState<'high' | 'normal' | 'low'>(
    'normal',
  );
  const [equipmentId, setEquipmentId] = useState('');
  const [orderType, setOrderType] = useState<
    'repair' | 'preventive' | 'inspection'
  >('repair');
  const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');
  const [description, setDescription] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [solutions, setSolutions] = useState<Record<string, string>>({});

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
  const orders = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-maintenance', selectedUnit],
    queryFn: ({ signal }) =>
      api.request<OrdersResult>({
        path: 'production/maintenance-orders',
        query: { unitId: selectedUnit },
        signal,
      }),
  });
  const equipmentRows = equipment.data?.data.equipment ?? [];
  const orderRows = orders.data?.data.orders ?? [];
  const effectiveEquipmentId = equipmentRows.some(
    (row) => row.id === equipmentId,
  )
    ? equipmentId
    : (equipmentRows[0]?.id ?? '');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['production-equipment'] });
    void queryClient.invalidateQueries({
      queryKey: ['production-maintenance'],
    });
  };
  const createEquipment = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ProductionEquipment }>({
        path: 'production/equipment',
        method: 'POST',
        json: {
          unitId: selectedUnit,
          code: code.trim(),
          name: name.trim(),
          category: category.trim() || null,
          criticality,
        },
      }),
    onSuccess: () => {
      setCode('');
      setName('');
      setCategory('');
      setNotice(t('production.equipmentCreated'));
      refresh();
    },
    onError: (error) =>
      setNotice(
        error instanceof Error ? error.message : t('production.actionFailed'),
      ),
  });
  const createOrder = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ProductionMaintenanceOrder }>({
        path: 'production/maintenance-orders',
        method: 'POST',
        json: {
          unitId: selectedUnit,
          equipmentId: effectiveEquipmentId,
          type: orderType,
          priority,
          description: description.trim(),
          assigneeName: assigneeName.trim() || null,
        },
      }),
    onSuccess: () => {
      setDescription('');
      setAssigneeName('');
      setNotice(t('production.orderCreated'));
      refresh();
    },
    onError: (error) =>
      setNotice(
        error instanceof Error ? error.message : t('production.actionFailed'),
      ),
  });
  const updateOrder = useMutation({
    retry: false,
    mutationFn: (input: {
      order: ProductionMaintenanceOrder;
      status: MaintenanceStatus;
      solution?: string;
    }) =>
      api.request<{ data: ProductionMaintenanceOrder }>({
        path: `production/maintenance-orders/${input.order.id}`,
        method: 'PATCH',
        json: {
          status: input.status,
          version: input.order.version,
          solution: input.solution ?? null,
        },
      }),
    onSuccess: () => {
      setNotice(t('production.orderUpdated'));
      refresh();
    },
    onError: (error) =>
      setNotice(
        error instanceof Error ? error.message : t('production.actionFailed'),
      ),
  });
  const move = (
    order: ProductionMaintenanceOrder,
    status: MaintenanceStatus,
  ) => {
    const solution = (solutions[order.id] ?? '').trim();
    if (status === 'completed' && !solution) {
      setNotice(t('production.solutionRequired'));
      return;
    }
    updateOrder.mutate({ order, status, solution: solution || undefined });
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('production.equipmentTitle')}
        description={t('production.equipmentDescription')}
        actions={
          <div className='flex flex-wrap items-end gap-2'>
            <label className='grid w-full gap-1 text-sm sm:w-44'>
              <span className='text-muted-foreground'>
                {t('production.equipmentFilter')}
              </span>
              <select
                className={`${nativeSelectClass} w-full sm:w-44`}
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

      <div className='grid gap-4 xl:grid-cols-2'>
        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Wrench className='size-4' />
              {t('production.equipmentList')}
            </CardTitle>
            <CardDescription>
              {t('production.equipmentListHint')}
            </CardDescription>
          </CardHeader>
          <div className='space-y-3 px-6 pb-6'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='space-y-1 text-sm'>
                <span>{t('production.equipmentCode')}</span>
                <Input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <label className='space-y-1 text-sm'>
                <span>{t('production.equipmentName')}</span>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label className='space-y-1 text-sm'>
                <span>{t('production.category')}</span>
                <Input
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                />
              </label>
              <label className='space-y-1 text-sm'>
                <span>{t('production.criticality')}</span>
                <select
                  className={nativeSelectClass}
                  value={criticality}
                  onChange={(event) =>
                    setCriticality(event.target.value as typeof criticality)
                  }
                >
                  <option value='high'>
                    {t('production.criticalityHigh')}
                  </option>
                  <option value='normal'>
                    {t('production.criticalityNormal')}
                  </option>
                  <option value='low'>{t('production.criticalityLow')}</option>
                </select>
              </label>
            </div>
            <Button
              size='sm'
              disabled={
                !selectedUnit ||
                !access.canManage ||
                !code.trim() ||
                !name.trim() ||
                createEquipment.isPending
              }
              onClick={() => createEquipment.mutate()}
            >
              <Plus className='mr-1 size-4' />
              {t('production.addEquipment')}
            </Button>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('production.equipmentCode')}</TableHead>
                  <TableHead>{t('production.equipmentName')}</TableHead>
                  <TableHead>{t('production.criticality')}</TableHead>
                  <TableHead>{t('production.equipmentStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipmentRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className='font-mono text-xs'>
                      {row.code}
                    </TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      {t(`production.criticality_${row.criticality}`)}
                    </TableCell>
                    <TableCell>
                      {t(`production.equipmentStatus_${row.status}`)}
                    </TableCell>
                  </TableRow>
                ))}
                {equipmentRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className='text-muted-foreground'>
                      {t('production.equipmentEmpty')}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              <Wrench className='size-4' />
              {t('production.maintenanceList')}
            </CardTitle>
            <CardDescription>
              {t('production.maintenanceListHint')}
            </CardDescription>
          </CardHeader>
          <div className='space-y-3 px-6 pb-6'>
            <div className='grid gap-3 sm:grid-cols-2'>
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
                <span>{t('production.maintenanceType')}</span>
                <select
                  className={nativeSelectClass}
                  value={orderType}
                  onChange={(event) =>
                    setOrderType(event.target.value as typeof orderType)
                  }
                >
                  <option value='repair'>
                    {t('production.maintenanceType_repair')}
                  </option>
                  <option value='preventive'>
                    {t('production.maintenanceType_preventive')}
                  </option>
                  <option value='inspection'>
                    {t('production.maintenanceType_inspection')}
                  </option>
                </select>
              </label>
              <label className='space-y-1 text-sm'>
                <span>{t('production.priority')}</span>
                <select
                  className={nativeSelectClass}
                  value={priority}
                  onChange={(event) =>
                    setPriority(event.target.value as typeof priority)
                  }
                >
                  <option value='high'>{t('production.priorityHigh')}</option>
                  <option value='normal'>
                    {t('production.priorityNormal')}
                  </option>
                  <option value='low'>{t('production.priorityLow')}</option>
                </select>
              </label>
              <label className='space-y-1 text-sm'>
                <span>{t('production.assignee')}</span>
                <Input
                  value={assigneeName}
                  onChange={(event) => setAssigneeName(event.target.value)}
                />
              </label>
              <label className='space-y-1 text-sm sm:col-span-2'>
                <span>{t('production.faultDescription')}</span>
                <Input
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
            </div>
            <Button
              size='sm'
              disabled={
                !access.canManage ||
                !effectiveEquipmentId ||
                !description.trim() ||
                createOrder.isPending
              }
              onClick={() => createOrder.mutate()}
            >
              <Plus className='mr-1 size-4' />
              {t('production.reportOrder')}
            </Button>
            <div className='space-y-3'>
              {orderRows.map((order) => (
                <div key={order.id} className='rounded-md border p-3 text-sm'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <div>
                      <span className='font-mono text-xs'>{order.orderNo}</span>
                      <span className='ml-2 font-medium'>
                        {order.equipmentName}
                      </span>
                    </div>
                    <span>
                      {t(`production.maintenanceStatus_${order.status}`)}
                    </span>
                  </div>
                  <p className='mt-1 text-muted-foreground'>
                    {order.description}
                  </p>
                  <div className='mt-2 flex flex-wrap items-center gap-2'>
                    {order.status === 'reported' ? (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={!access.canManage}
                        onClick={() => move(order, 'in_progress')}
                      >
                        {t('production.startRepair')}
                      </Button>
                    ) : null}
                    {order.status === 'in_progress' ? (
                      <>
                        <Input
                          className='h-8 w-56'
                          placeholder={t('production.solution')}
                          value={solutions[order.id] ?? ''}
                          onChange={(event) =>
                            setSolutions((current) => ({
                              ...current,
                              [order.id]: event.target.value,
                            }))
                          }
                        />
                        <Button
                          size='sm'
                          disabled={!access.canManage}
                          onClick={() => move(order, 'completed')}
                        >
                          {t('production.completeRepair')}
                        </Button>
                      </>
                    ) : null}
                    {order.status === 'reported' ||
                    order.status === 'in_progress' ? (
                      <Button
                        size='sm'
                        variant='ghost'
                        disabled={!access.canManage}
                        onClick={() => move(order, 'cancelled')}
                      >
                        {t('production.cancelOrder')}
                      </Button>
                    ) : null}
                  </div>
                  {order.solution ? (
                    <p className='mt-2 text-muted-foreground'>
                      {t('production.solution')}: {order.solution}
                    </p>
                  ) : null}
                </div>
              ))}
              {orderRows.length === 0 ? (
                <Empty className='min-h-32 border border-dashed'>
                  <EmptyHeader>
                    <EmptyMedia variant='icon'>
                      <Wrench />
                    </EmptyMedia>
                    <EmptyDescription>
                      {t('production.maintenanceEmpty')}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : null}
            </div>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
