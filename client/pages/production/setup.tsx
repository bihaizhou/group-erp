import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import type {
  ProductionOutputMapping,
  ProductionSetup,
  ProductionSetupUnit,
  ProductionUnitProfile,
} from './model.js';

type SetupResult = { data: ProductionSetup };
type OutputType = 'metal' | 'sand';
const outputTypes: OutputType[] = ['metal', 'sand'];
type OutputDraft = {
  skuId: string;
  warehouseId: string;
  notes: string;
};

const outputDraft = (
  type: OutputType,
  mappings: ProductionOutputMapping[],
): OutputDraft => {
  const mapping = mappings.find((row) => row.outputType === type);
  return {
    skuId: mapping?.skuId ?? '',
    warehouseId: mapping?.defaultWarehouseId ?? '',
    notes: mapping?.notes ?? '',
  };
};

function UnitEditor({
  unit,
  profile,
  mappings,
  setup,
  onSaved,
}: {
  unit: ProductionSetupUnit;
  profile: ProductionUnitProfile | undefined;
  mappings: ProductionOutputMapping[];
  setup: ProductionSetup;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
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
  const [outputs, setOutputs] = useState<Record<OutputType, OutputDraft>>(
    () => ({
      metal: outputDraft('metal', mappings),
      sand: outputDraft('sand', mappings),
    }),
  );
  const [notice, setNotice] = useState('');
  const warehouses = setup.warehouses.filter(
    (warehouse) => warehouse.subjectId === unit.subjectId,
  );
  const describeError = (error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('OUTPUT_UNIT_PRECISION'))
      return t('production.setupUnitPrecisionError');
    if (message.includes('OUTPUT_SKU_DUPLICATE'))
      return t('production.setupDuplicateSkuError');
    if (message.includes('OUTPUT_SKU_CONFLICT'))
      return t('production.setupSkuConflictError');
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
          outputs: outputTypes
            .filter((type) => outputs[type].skuId)
            .map((type) => ({
              outputType: type,
              skuId: outputs[type].skuId,
              defaultWarehouseId: outputs[type].warehouseId || null,
              notes: outputs[type].notes || null,
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
  const updateOutput = (type: OutputType, patch: Partial<OutputDraft>) =>
    setOutputs((current) => ({
      ...current,
      [type]: { ...current[type], ...patch },
    }));
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
      <div className='overflow-x-auto rounded-xl border'>
        <table className='w-full text-sm'>
          <thead className='bg-muted/50 text-left'>
            <tr>
              <th className='px-3 py-2'>
                {t('production.setupFields.output')}
              </th>
              <th className='px-3 py-2'>{t('production.setupFields.sku')}</th>
              <th className='px-3 py-2'>
                {t('production.setupFields.defaultWarehouse')}
              </th>
              <th className='px-3 py-2'>{t('production.setupFields.notes')}</th>
            </tr>
          </thead>
          <tbody>
            {outputTypes.map((type) => (
              <tr key={type} className='border-t'>
                <td className='px-3 py-2'>
                  {t(`production.outputTypes.${type}`)}
                </td>
                <td className='px-3 py-2'>
                  <select
                    className='h-8 min-w-56 rounded-lg border border-input bg-transparent px-2 text-sm'
                    value={outputs[type].skuId}
                    onChange={(event) =>
                      updateOutput(type, { skuId: event.target.value })
                    }
                  >
                    <option value=''>
                      {t('production.setupFields.notMapped')}
                    </option>
                    {setup.skus.map((sku) => (
                      <option key={sku.id} value={sku.id}>
                        {sku.code} {sku.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className='px-3 py-2'>
                  <select
                    className='h-8 min-w-48 rounded-lg border border-input bg-transparent px-2 text-sm'
                    value={outputs[type].warehouseId}
                    onChange={(event) =>
                      updateOutput(type, { warehouseId: event.target.value })
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
                    value={outputs[type].notes}
                    onChange={(event) =>
                      updateOutput(type, { notes: event.target.value })
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='flex items-center gap-3'>
        <Button
          onClick={() => {
            setNotice('');
            save.mutate();
          }}
          disabled={save.isPending}
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
  const unit = data?.units.find((row) => row.id === unitId) ?? data?.units[0];
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
              mappings={data.outputs.filter((row) => row.unitId === unit.id)}
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
