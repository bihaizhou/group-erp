import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { randomUuid } from '#lib/random-id';
import { useProductionAccess } from './access.js';
import { ReadOnlyNotice } from '#components/read-only-notice';
import type {
  ProductionMaterialRole,
  ProductionSetup,
  ProductionSetupUnit,
  ProductionUnitMaterial,
  ProductionUnitProfile,
} from './model.js';

type SetupResult = { data: ProductionSetup };
type MaterialDraft = {
  key: string;
  skuId: string;
  role: ProductionMaterialRole;
  defaultWarehouseId: string;
  notes: string;
};

const materialRoles: ProductionMaterialRole[] = [
  'feedstock',
  'product',
  'byproduct',
  'auxiliary',
];

const emptyMaterial = (): MaterialDraft => ({
  key: randomUuid(),
  skuId: '',
  role: 'product',
  defaultWarehouseId: '',
  notes: '',
});

function UnitEditor({
  unit,
  profile,
  materials,
  setup,
  onSaved,
}: {
  unit: ProductionSetupUnit;
  profile: ProductionUnitProfile | undefined;
  materials: ProductionUnitMaterial[];
  setup: ProductionSetup;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const access = useProductionAccess();
  const [lineCode, setLineCode] = useState(profile?.lineCode ?? '');
  const [processType, setProcessType] = useState(profile?.processType ?? '');
  const [designCapacityTpd, setDesignCapacityTpd] = useState(
    profile?.designCapacityTpd ? String(profile.designCapacityTpd) : '',
  );
  const [commissionDate, setCommissionDate] = useState(
    profile?.commissionDate ?? '',
  );
  const [region, setRegion] = useState(profile?.region ?? '');
  const [gatewayKey, setGatewayKey] = useState(profile?.gatewayKey ?? '');
  const [fuxaPageKey, setFuxaPageKey] = useState(profile?.fuxaPageKey ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(
    profile?.status === 'inactive' ? 'inactive' : 'active',
  );
  const [rows, setRows] = useState<MaterialDraft[]>(() =>
    materials.map((material) => ({
      key: randomUuid(),
      skuId: material.skuId,
      role: material.role,
      defaultWarehouseId: material.defaultWarehouseId ?? '',
      notes: material.notes ?? '',
    })),
  );
  const [notice, setNotice] = useState('');
  const warehouses = setup.warehouses.filter(
    (warehouse) => warehouse.subjectId === unit.subjectId,
  );
  const describeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('DUPLICATE_MATERIAL'))
      return t('production.setupDuplicateSkuError');
    if (message.includes('SKU_NOT_FOUND'))
      return t('production.setupSkuNotFoundError');
    if (message.includes('WAREHOUSE_NOT_FOUND'))
      return t('production.setupWarehouseError');
    return error instanceof Error ? error.message : t('production.saveFailed');
  };
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<SetupResult>({
        path: `production/setup/${unit.id}`,
        method: 'PUT',
        json: {
          lineCode: lineCode || null,
          processType: processType || null,
          designCapacityTpd: designCapacityTpd
            ? Number(designCapacityTpd)
            : null,
          commissionDate: commissionDate || null,
          region: region || null,
          gatewayKey: gatewayKey || null,
          fuxaPageKey: fuxaPageKey || null,
          status,
          materials: rows
            .filter((row) => row.skuId)
            .map((row, index) => ({
              skuId: row.skuId,
              role: row.role,
              defaultWarehouseId: row.defaultWarehouseId || null,
              sortOrder: index * 10,
              notes: row.notes || null,
            })),
        },
      }),
    onSuccess: () => {
      setNotice(t('production.saved'));
      onSaved();
    },
    onError: (error) => {
      setNotice(describeError(error));
    },
  });
  const updateRow = (index: number, patch: Partial<MaterialDraft>) =>
    setRows((current) =>
      current.map((row, position) =>
        position === index ? { ...row, ...patch } : row,
      ),
    );
  const duplicate = (() => {
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row.skuId) continue;
      if (seen.has(row.skuId)) return true;
      seen.add(row.skuId);
    }
    return false;
  })();
  return (
    <>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.lineCode')}</span>
          <Input
            value={lineCode}
            onChange={(event) => setLineCode(event.target.value)}
            placeholder={t('production.setupFields.lineCodePlaceholder')}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.processType')}</span>
          <Input
            value={processType}
            onChange={(event) => setProcessType(event.target.value)}
            placeholder={t('production.setupFields.processTypePlaceholder')}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.designCapacityTpd')}</span>
          <Input
            type='number'
            min='0'
            value={designCapacityTpd}
            onChange={(event) => setDesignCapacityTpd(event.target.value)}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.commissionDate')}</span>
          <Input
            type='date'
            value={commissionDate}
            onChange={(event) => setCommissionDate(event.target.value)}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.region')}</span>
          <Input
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.gatewayKey')}</span>
          <Input
            value={gatewayKey}
            onChange={(event) => setGatewayKey(event.target.value)}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.fuxaPageKey')}</span>
          <Input
            value={fuxaPageKey}
            onChange={(event) => setFuxaPageKey(event.target.value)}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.setupFields.status')}</span>
          <select
            className='h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm'
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as 'active' | 'inactive')
            }
          >
            <option value='active'>{t('production.setupFields.active')}</option>
            <option value='inactive'>
              {t('production.setupFields.inactive')}
            </option>
          </select>
        </label>
      </div>
      <p className='text-xs text-muted-foreground'>
        {t('production.setupPolicy')}
      </p>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <p className='text-sm font-medium'>
            {t('production.materialConfig')}
          </p>
          <p className='text-xs text-muted-foreground'>
            {t('production.materialConfigHint')}
          </p>
        </div>
        <Button
          variant='outline'
          disabled={!access.canManage}
          onClick={() => setRows((current) => [...current, emptyMaterial()])}
        >
          <Plus />
          {t('production.materialAdd')}
        </Button>
      </div>
      <div className='overflow-x-auto rounded-xl border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50 text-left'>
            <tr>
              <th className='px-3 py-2'>{t('production.setupFields.sku')}</th>
              <th className='px-3 py-2'>{t('production.setupFields.role')}</th>
              <th className='px-3 py-2'>
                {t('production.setupFields.defaultWarehouse')}
              </th>
              <th className='px-3 py-2'>{t('production.setupFields.notes')}</th>
              <th className='px-3 py-2' />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className='px-3 py-4 text-sm text-muted-foreground'
                  colSpan={5}
                >
                  {t('production.materialEmpty')}
                </td>
              </tr>
            ) : null}
            {rows.map((row, index) => (
              <tr key={row.key} className='border-t'>
                <td className='px-3 py-2'>
                  <select
                    className='h-8 min-w-64 rounded-lg border border-input bg-transparent px-2 text-sm'
                    value={row.skuId}
                    onChange={(event) =>
                      updateRow(index, { skuId: event.target.value })
                    }
                  >
                    <option value=''>
                      {t('production.setupFields.chooseMaterial')}
                    </option>
                    {setup.skus.map((sku) => (
                      <option key={sku.id} value={sku.id}>
                        {sku.code} {sku.name}
                        {sku.unit ? ` (${sku.unit})` : ''}
                      </option>
                    ))}
                  </select>
                </td>
                <td className='px-3 py-2'>
                  <select
                    className='h-8 rounded-lg border border-input bg-transparent px-2 text-sm'
                    value={row.role}
                    onChange={(event) =>
                      updateRow(index, {
                        role: event.target.value as ProductionMaterialRole,
                      })
                    }
                  >
                    {materialRoles.map((role) => (
                      <option key={role} value={role}>
                        {t(`production.materialRoles.${role}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className='px-3 py-2'>
                  <select
                    className='h-8 min-w-44 rounded-lg border border-input bg-transparent px-2 text-sm'
                    value={row.defaultWarehouseId}
                    onChange={(event) =>
                      updateRow(index, {
                        defaultWarehouseId: event.target.value,
                      })
                    }
                  >
                    <option value=''>
                      {t('production.setupFields.noWarehouse')}
                    </option>
                    {warehouses.map((warehouse) => (
                      <option key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className='px-3 py-2'>
                  <Input
                    value={row.notes}
                    onChange={(event) =>
                      updateRow(index, { notes: event.target.value })
                    }
                  />
                </td>
                <td className='px-3 py-2'>
                  <Button
                    variant='ghost'
                    disabled={!access.canManage}
                    onClick={() =>
                      setRows((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    <Trash2 />
                    {t('production.remove')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {duplicate ? (
        <p className='text-sm text-destructive' role='alert'>
          {t('production.setupDuplicateSkuError')}
        </p>
      ) : null}
      <ReadOnlyNotice
        canManage={access.canManage}
        canApprove={access.canApprove}
      />
      <div className='flex items-center gap-3'>
        <Button
          onClick={() => {
            setNotice('');
            save.mutate();
          }}
          disabled={save.isPending || duplicate || !access.canManage}
        >
          <Save />
          {save.isPending ? t('production.saving') : t('production.save')}
        </Button>
        {notice ? (
          <p className='text-sm text-muted-foreground' role='status'>
            {notice}
          </p>
        ) : null}
      </div>
    </>
  );
}

export default function ProductionSetupPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const setup = useQuery({
    retry: false,
    queryKey: ['production-setup'],
    queryFn: ({ signal }) =>
      api.request<SetupResult>({ path: 'production/setup', signal }),
  });
  const data = setup.data?.data;
  const configuredUnit = data?.units.find(
    (row) =>
      data.materials.some((material) => material.unitId === row.id) ||
      data.profiles.some((profile) => profile.unitId === row.id),
  );
  const unit =
    data?.units.find((row) => row.id === unitId) ??
    configuredUnit ??
    data?.units[0];
  return (
    <PageContainer>
      <PageHeader
        title={t('production.setup')}
        description={t('production.setupDescription')}
        actions={
          <Button
            variant='outline'
            onClick={() => void setup.refetch()}
            disabled={setup.isFetching}
          >
            <RefreshCw className={setup.isFetching ? 'animate-spin' : ''} />
            {t('production.refresh')}
          </Button>
        }
      />
      {setup.isError ? (
        <p className='text-sm text-destructive' role='alert'>
          {t('production.loadFailed')}
        </p>
      ) : !data?.units.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('production.noUnits')}
        </p>
      ) : (
        <>
          <label className='grid max-w-sm gap-1 text-sm'>
            <span>{t('production.unit')}</span>
            <select
              className='h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm'
              value={unit?.id ?? ''}
              onChange={(event) => setUnitId(event.target.value)}
            >
              {data.units.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {unit ? (
            <UnitEditor
              key={unit.id}
              unit={unit}
              profile={data.profiles.find((row) => row.unitId === unit.id)}
              materials={data.materials.filter((row) => row.unitId === unit.id)}
              setup={data}
              onSaved={() =>
                void queryClient.invalidateQueries({
                  queryKey: ['production-setup'],
                })
              }
            />
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
