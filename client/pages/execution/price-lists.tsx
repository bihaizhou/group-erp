import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { createUuid, useApiClient, useToaster } from '@nocobase/app-client';
import { Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { Textarea } from '#components/ui/textarea';
import { StatusBadge } from '#components/status-badge';
import { usePageFieldVisibility } from '#components/page-field-visibility';
import {
  EmptyState,
  ErrorNotice,
  Loading,
  Pagination,
  ReferencePicker,
  StaticSelect,
} from './controls.js';
import {
  ui,
  useExecutionCan,
  useExecutionError,
  useExecutionQuery,
  useExecutionRefresh,
} from './hooks.js';

type Choice = { id: string; code: string; name: string };
type PriceRow = {
  id: string;
  customerId: string;
  skuId: string;
  unitPrice: string | null;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  note: string | null;
  version: number;
  customer: Choice | null;
  sku: Choice | null;
};
type PricePage = { data: PriceRow[]; meta: { total: number } };
type Draft = {
  customerId: string;
  customer: Choice | null;
  skuId: string;
  sku: Choice | null;
  unitPrice: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string;
  note: string;
};

const emptyDraft: Draft = {
  customerId: '',
  customer: null,
  skuId: '',
  sku: null,
  unitPrice: '',
  currency: 'CNY',
  effectiveFrom: '',
  effectiveTo: '',
  note: '',
};

export default function PriceListsPage() {
  const { t } = useTranslation(),
    [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '',
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [editing, setEditing] = useState<PriceRow | null>(null),
    [open, setOpen] = useState(false),
    [draft, setDraft] = useState<Draft>(emptyDraft),
    [pending, setPending] = useState(false),
    [formError, setFormError] = useState<unknown>(),
    api = useApiClient(),
    toast = useToaster(),
    errorText = useExecutionError(),
    refresh = useExecutionRefresh(),
    canWrite = useExecutionCan('sales.orders', 'update'),
    pageFields = usePageFieldVisibility('sales-price-lists'),
    showField = (field: string) => pageFields.visible('sales.priceList', field);
  const query = useExecutionQuery<PricePage>(
    'sales/price-lists',
    {
      subjectId,
      ...(status ? { status } : {}),
      page,
      pageSize: 20,
    },
    Boolean(subjectId),
  );
  const startCreate = () => {
    setEditing(null);
    setDraft(emptyDraft);
    setFormError(undefined);
    setOpen(true);
  };
  const startEdit = (row: PriceRow) => {
    setEditing(row);
    setDraft({
      customerId: row.customerId,
      customer: row.customer,
      skuId: row.skuId,
      sku: row.sku,
      unitPrice: row.unitPrice ?? '',
      currency: row.currency,
      effectiveFrom: row.effectiveFrom,
      effectiveTo: row.effectiveTo ?? '',
      note: row.note ?? '',
    });
    setFormError(undefined);
    setOpen(true);
  };
  const save = async () => {
    if (
      !draft.customerId ||
      !draft.skuId ||
      !draft.unitPrice.trim() ||
      !draft.effectiveFrom
    ) {
      setFormError(new Error(t(ui('priceLists.required'))));
      return;
    }
    if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) {
      setFormError(new Error(t(ui('priceLists.invalidRange'))));
      return;
    }
    setPending(true);
    setFormError(undefined);
    try {
      const body = {
        ...(editing ? { version: editing.version } : { subjectId }),
        customerId: draft.customerId,
        skuId: draft.skuId,
        unitPrice: draft.unitPrice.trim(),
        currency: draft.currency.trim().toUpperCase() || 'CNY',
        effectiveFrom: draft.effectiveFrom,
        effectiveTo: draft.effectiveTo || null,
        note: draft.note.trim() || null,
        requestKey: createUuid(),
      };
      await api.request({
        path: editing ? `sales/price-lists/${editing.id}` : 'sales/price-lists',
        method: editing ? 'PATCH' : 'POST',
        json: body,
      });
      setOpen(false);
      void refresh();
      toast.show({ type: 'success', title: t(ui('priceLists.saved')) });
    } catch (error) {
      setFormError(error);
    } finally {
      setPending(false);
    }
  };
  const disable = async (row: PriceRow) => {
    if (!window.confirm(t(ui('priceLists.disableConfirm')))) return;
    try {
      await api.request({
        path: `sales/price-lists/${row.id}/disable`,
        method: 'POST',
        json: { version: row.version, requestKey: createUuid() },
      });
      void refresh();
      toast.show({ type: 'success', title: t(ui('priceLists.disabled')) });
    } catch (error) {
      toast.show({ type: 'error', title: errorText(error) });
    }
  };
  return (
    <PageContainer>
      <PageHeader
        title={t(ui('priceLists.title'))}
        description={t(ui('priceLists.description'))}
        actions={
          canWrite ? (
            <Button onClick={startCreate}>
              <Plus /> {t(ui('priceLists.new'))}
            </Button>
          ) : null
        }
      />
      <div className='flex flex-wrap items-end gap-3'>
        <div className='flex w-48 flex-col gap-1.5'>
          <Label>{t(ui('priceLists.status'))}</Label>
          <StaticSelect
            label={t(ui('priceLists.status'))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            items={[
              { value: '', label: t(ui('priceLists.allStatuses')) },
              { value: 'active', label: t(ui('priceListStatus.active')) },
              { value: 'inactive', label: t(ui('priceListStatus.inactive')) },
            ]}
          />
        </div>
      </div>
      {query.error ? (
        <ErrorNotice error={query.error} retry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <Loading />
      ) : !query.data?.data.length ? (
        <EmptyState type={status ? 'noMatches' : 'empty'} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {showField('customerId') && (
                  <TableHead>{t(ui('priceLists.customer'))}</TableHead>
                )}
                {showField('skuId') && (
                  <TableHead>{t(ui('priceLists.material'))}</TableHead>
                )}
                {showField('unitPrice') && (
                  <TableHead>{t(ui('priceLists.unitPrice'))}</TableHead>
                )}
                {showField('effectiveFrom') && (
                  <TableHead>{t(ui('priceLists.effectiveFrom'))}</TableHead>
                )}
                {showField('status') && (
                  <TableHead>{t(ui('priceLists.status'))}</TableHead>
                )}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.data.map((row) => (
                <TableRow key={row.id}>
                  {showField('customerId') && (
                    <TableCell>
                      {row.customer
                        ? `${row.customer.code} · ${row.customer.name}`
                        : row.customerId}
                    </TableCell>
                  )}
                  {showField('skuId') && (
                    <TableCell>
                      {row.sku
                        ? `${row.sku.code} · ${row.sku.name}`
                        : row.skuId}
                    </TableCell>
                  )}
                  {showField('unitPrice') && (
                    <TableCell>
                      {row.unitPrice ?? '—'} {row.currency}
                    </TableCell>
                  )}
                  {showField('effectiveFrom') && (
                    <TableCell>
                      {row.effectiveFrom}
                      {row.effectiveTo ? ` – ${row.effectiveTo}` : ''}
                    </TableCell>
                  )}
                  {showField('status') && (
                    <TableCell>
                      <StatusBadge
                        tone={row.status === 'active' ? 'success' : 'neutral'}
                      >
                        {t(ui(`priceListStatus.${row.status}`))}
                      </StatusBadge>
                    </TableCell>
                  )}
                  <TableCell className='text-right'>
                    {canWrite ? (
                      <div className='flex justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => startEdit(row)}
                        >
                          {t(ui('priceLists.edit'))}
                        </Button>
                        {row.status === 'active' ? (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => void disable(row)}
                          >
                            {t(ui('priceLists.disable'))}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            total={query.data.meta.total}
            pageSize={20}
            busy={query.isFetching}
            onPage={setPage}
          />
        </>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>
              {editing ? t(ui('priceLists.edit')) : t(ui('priceLists.new'))}
            </DialogTitle>
            <DialogDescription>
              {t(ui('priceLists.dialogDescription'))}
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label>{t(ui('priceLists.customer'))}</Label>
              <ReferencePicker
                label={t(ui('priceLists.customer'))}
                value={draft.customerId}
                selected={draft.customer}
                queryPath='sales/orders/partnerOptions'
                query={{ subjectId }}
                onChange={(id, item) =>
                  setDraft((current) => ({
                    ...current,
                    customerId: id,
                    customer: item ?? null,
                  }))
                }
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label>{t(ui('priceLists.material'))}</Label>
              <ReferencePicker
                label={t(ui('priceLists.material'))}
                value={draft.skuId}
                selected={draft.sku}
                queryPath='sales/orders/materialOptions'
                query={{ subjectId }}
                onChange={(id, item) =>
                  setDraft((current) => ({
                    ...current,
                    skuId: id,
                    sku: item ?? null,
                  }))
                }
              />
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='flex flex-col gap-2'>
                <Label htmlFor='price-unit'>
                  {t(ui('priceLists.unitPrice'))}
                </Label>
                <Input
                  id='price-unit'
                  inputMode='decimal'
                  value={draft.unitPrice}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      unitPrice: event.target.value,
                    }))
                  }
                />
              </div>
              {showField('currency') && (
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='price-currency'>
                    {t(ui('priceLists.currency'))}
                  </Label>
                  <Input
                    id='price-currency'
                    maxLength={3}
                    value={draft.currency}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        currency: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                </div>
              )}
              <div className='flex flex-col gap-2'>
                <Label htmlFor='price-from'>
                  {t(ui('priceLists.effectiveFrom'))}
                </Label>
                <Input
                  id='price-from'
                  type='date'
                  value={draft.effectiveFrom}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      effectiveFrom: event.target.value,
                    }))
                  }
                />
              </div>
              {showField('effectiveTo') && (
                <div className='flex flex-col gap-2'>
                  <Label htmlFor='price-to'>
                    {t(ui('priceLists.effectiveTo'))}
                  </Label>
                  <Input
                    id='price-to'
                    type='date'
                    min={draft.effectiveFrom || undefined}
                    value={draft.effectiveTo}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        effectiveTo: event.target.value,
                      }))
                    }
                  />
                </div>
              )}
            </div>
            {showField('note') && (
              <div className='flex flex-col gap-2'>
                <Label htmlFor='price-note'>{t(ui('priceLists.note'))}</Label>
                <Textarea
                  id='price-note'
                  rows={2}
                  maxLength={2000}
                  value={draft.note}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                />
              </div>
            )}
            {formError ? <ErrorNotice error={formError} committed /> : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t(ui('cancel'))}
            </Button>
            <Button disabled={pending} onClick={() => void save()}>
              {t(ui('save'))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
