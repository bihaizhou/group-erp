import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { createUuid, useApiClient, useToaster } from '@nocobase/app-client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { StatusBadge } from '#components/status-badge';
import { usePageFieldVisibility } from '#components/page-field-visibility';
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
  useExecutionQuery,
  useExecutionRefresh,
} from './hooks.js';

type Choice = { id: string; code: string; name: string };
type Receivable = {
  id: string;
  customerId: string;
  orderId: string;
  documentId: string;
  amount: string;
  currency: string;
  paidAmount: string;
  outstanding: string;
  status: string;
  dueDate: string | null;
  priced: boolean;
  customer: Choice | null;
  order: Choice | null;
  document: Choice | null;
};
type Payment = {
  id: string;
  amount: string;
  paidAt: string;
  method: string;
  reference: string | null;
  note: string | null;
};
type Page = { data: Receivable[]; meta: { total: number } };
type Detail = { data: Receivable & { payments: Payment[] } };

const tone = (status: string) =>
  status === 'paid'
    ? ('success' as const)
    : status === 'partially_paid'
      ? ('info' as const)
      : status === 'void'
        ? ('warning' as const)
        : ('neutral' as const);

export default function ReceivablesPage() {
  const { t } = useTranslation(),
    [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '',
    [status, setStatus] = useState(''),
    [customerId, setCustomerId] = useState(''),
    [customer, setCustomer] = useState<Choice | null>(null),
    [page, setPage] = useState(1),
    [detailId, setDetailId] = useState(''),
    [paymentOpen, setPaymentOpen] = useState(false),
    [amount, setAmount] = useState(''),
    [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10)),
    [method, setMethod] = useState('bank_transfer'),
    [reference, setReference] = useState(''),
    [note, setNote] = useState(''),
    [pending, setPending] = useState(false),
    [formError, setFormError] = useState<unknown>(),
    api = useApiClient(),
    toast = useToaster(),
    refresh = useExecutionRefresh(),
    canWrite = useExecutionCan('sales.orders', 'update');
  const list = useExecutionQuery<Page>(
    'sales/receivables',
    {
      subjectId,
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      page,
      pageSize: 20,
    },
    Boolean(subjectId),
  );
  const detail = useExecutionQuery<Detail>(
    `sales/receivables/${detailId}`,
    {},
    Boolean(subjectId && detailId),
  );
  const openPayment = () => {
    setAmount('');
    setPaidAt(new Date().toISOString().slice(0, 10));
    setMethod('bank_transfer');
    setReference('');
    setNote('');
    setFormError(undefined);
    setPaymentOpen(true);
  };
  const submitPayment = async () => {
    if (!amount.trim()) return;
    setPending(true);
    setFormError(undefined);
    try {
      await api.request({
        path: `sales/receivables/${detailId}/payments`,
        method: 'POST',
        json: {
          amount: amount.trim(),
          paidAt,
          method,
          reference: reference.trim() || null,
          note: note.trim() || null,
          requestKey: createUuid(),
        },
      });
      setPaymentOpen(false);
      void refresh();
      toast.show({ type: 'success', title: t(ui('receivables.saved')) });
    } catch (error) {
      setFormError(error);
    } finally {
      setPending(false);
    }
  };
  const pageFields = usePageFieldVisibility('sales-receivables');
  const showField = (field: string) =>
    pageFields.visible('sales.receivable', field);
  return (
    <PageContainer>
      <PageHeader
        title={t(ui('receivables.title'))}
        description={t(ui('receivables.description'))}
      />
      <div className='flex flex-wrap items-end gap-3'>
        <div className='flex w-52 flex-col gap-1.5'>
          <Label>{t(ui('receivables.status'))}</Label>
          <StaticSelect
            label={t(ui('receivables.status'))}
            value={status}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
            items={[
              { value: '', label: t(ui('receivables.allStatuses')) },
              { value: 'open', label: t(ui('receivableStatus.open')) },
              {
                value: 'partially_paid',
                label: t(ui('receivableStatus.partially_paid')),
              },
              { value: 'paid', label: t(ui('receivableStatus.paid')) },
              { value: 'void', label: t(ui('receivableStatus.void')) },
            ]}
          />
        </div>
        <div className='flex w-72 flex-col gap-1.5'>
          <Label>{t(ui('receivables.customer'))}</Label>
          <ReferencePicker
            label={t(ui('receivables.customer'))}
            value={customerId}
            selected={customer}
            queryPath='sales/orders/partnerOptions'
            query={{ subjectId }}
            onChange={(id, item) => {
              setCustomerId(id);
              setCustomer(item ?? null);
              setPage(1);
            }}
          />
        </div>
      </div>
      {list.error ? (
        <ErrorNotice error={list.error} retry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <Loading />
      ) : !list.data?.data.length ? (
        <EmptyState type={status || customerId ? 'noMatches' : 'empty'} />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {showField('documentId') && (
                  <TableHead>{t(ui('receivables.document'))}</TableHead>
                )}
                {showField('customerId') && (
                  <TableHead>{t(ui('receivables.customer'))}</TableHead>
                )}
                {showField('amount') && (
                  <TableHead className='text-right'>
                    {t(ui('receivables.amount'))}
                  </TableHead>
                )}
                {showField('paid') && (
                  <TableHead className='text-right'>
                    {t(ui('receivables.paid'))}
                  </TableHead>
                )}
                {showField('outstanding') && (
                  <TableHead className='text-right'>
                    {t(ui('receivables.outstanding'))}
                  </TableHead>
                )}
                {showField('status') && (
                  <TableHead>{t(ui('receivables.status'))}</TableHead>
                )}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.data.map((row) => (
                <TableRow key={row.id}>
                  {showField('documentId') && (
                    <TableCell>
                      {row.document?.code ?? row.order?.code ?? row.id}
                    </TableCell>
                  )}
                  {showField('customerId') && (
                    <TableCell>
                      {row.customer
                        ? `${row.customer.code} · ${row.customer.name}`
                        : row.customerId}
                    </TableCell>
                  )}
                  {showField('amount') && (
                    <TableCell className='text-right'>
                      {row.amount} {row.currency}
                    </TableCell>
                  )}
                  {showField('paid') && (
                    <TableCell className='text-right'>
                      {row.paidAmount}
                    </TableCell>
                  )}
                  {showField('outstanding') && (
                    <TableCell className='text-right'>
                      {row.outstanding}
                    </TableCell>
                  )}
                  {showField('status') && (
                    <TableCell>
                      <StatusBadge tone={tone(row.status)}>
                        {t(ui(`receivableStatus.${row.status}`))}
                      </StatusBadge>
                    </TableCell>
                  )}
                  <TableCell className='text-right'>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setDetailId(row.id)}
                    >
                      {t(ui('receivables.detail'))}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            total={list.data.meta.total}
            pageSize={20}
            busy={list.isFetching}
            onPage={setPage}
          />
        </>
      )}
      <Dialog
        open={Boolean(detailId)}
        onOpenChange={(open) => {
          if (!open) setDetailId('');
        }}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t(ui('receivables.detailTitle'))}</DialogTitle>
            <DialogDescription>
              {t(ui('receivables.detailDescription'))}
            </DialogDescription>
          </DialogHeader>
          {detail.error ? (
            <ErrorNotice
              error={detail.error}
              retry={() => void detail.refetch()}
            />
          ) : detail.isLoading || !detail.data ? (
            <Loading />
          ) : (
            <div className='flex flex-col gap-5'>
              <div className='grid grid-cols-2 gap-3 text-sm sm:grid-cols-3'>
                <div>
                  <div className='text-muted-foreground'>
                    {t(ui('receivables.document'))}
                  </div>
                  <div>{detail.data.data.document?.code ?? '—'}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t(ui('receivables.order'))}
                  </div>
                  <div>{detail.data.data.order?.code ?? '—'}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t(ui('receivables.status'))}
                  </div>
                  <StatusBadge tone={tone(detail.data.data.status)}>
                    {t(ui(`receivableStatus.${detail.data.data.status}`))}
                  </StatusBadge>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t(ui('receivables.amount'))}
                  </div>
                  <div>
                    {detail.data.data.amount} {detail.data.data.currency}
                  </div>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t(ui('receivables.paid'))}
                  </div>
                  <div>{detail.data.data.paidAmount}</div>
                </div>
                <div>
                  <div className='text-muted-foreground'>
                    {t(ui('receivables.outstanding'))}
                  </div>
                  <div>{detail.data.data.outstanding}</div>
                </div>
              </div>
              {!detail.data.data.priced ? (
                <p className='rounded-md border border-(--status-warning)/20 bg-(--status-warning-background) p-3 text-sm text-(--status-warning)'>
                  {t(ui('receivables.pricedMissing'))}
                </p>
              ) : null}
              <div className='flex flex-col gap-2'>
                <div className='flex items-center justify-between'>
                  <h3 className='text-sm font-medium'>
                    {t(ui('receivables.payments'))}
                  </h3>
                  {canWrite &&
                  detail.data.data.status !== 'void' &&
                  detail.data.data.outstanding !== '0' ? (
                    <Button size='sm' onClick={openPayment}>
                      {t(ui('receivables.registerPayment'))}
                    </Button>
                  ) : null}
                </div>
                {!detail.data.data.payments.length ? (
                  <p className='text-sm text-muted-foreground'>
                    {t(ui('receivables.noPayments'))}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t(ui('receivables.paidAt'))}</TableHead>
                        <TableHead>{t(ui('receivables.method'))}</TableHead>
                        <TableHead className='text-right'>
                          {t(ui('receivables.paymentAmount'))}
                        </TableHead>
                        <TableHead>{t(ui('receivables.reference'))}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.data.data.payments.map((payment) => (
                        <TableRow key={payment.id}>
                          <TableCell>{payment.paidAt}</TableCell>
                          <TableCell>
                            {['bank_transfer', 'cash', 'other'].includes(
                              payment.method,
                            )
                              ? t(ui(`receivables.methods.${payment.method}`))
                              : payment.method}
                          </TableCell>
                          <TableCell className='text-right'>
                            {payment.amount}
                          </TableCell>
                          <TableCell>{payment.reference ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{t(ui('receivables.registerPayment'))}</DialogTitle>
            <DialogDescription>
              {t(ui('receivables.paymentDescription'))}
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-col gap-4'>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='payment-amount'>
                {t(ui('receivables.paymentAmount'))}
              </Label>
              <Input
                id='payment-amount'
                inputMode='decimal'
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='payment-date'>
                {t(ui('receivables.paidAt'))}
              </Label>
              <Input
                id='payment-date'
                type='date'
                value={paidAt}
                onChange={(event) => setPaidAt(event.target.value)}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='payment-method'>
                {t(ui('receivables.method'))}
              </Label>
              <StaticSelect
                id='payment-method'
                label={t(ui('receivables.method'))}
                value={method}
                onChange={setMethod}
                items={['bank_transfer', 'cash', 'other'].map((value) => ({
                  value,
                  label: t(ui(`receivables.methods.${value}`)),
                }))}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='payment-reference'>
                {t(ui('receivables.reference'))}
              </Label>
              <Input
                id='payment-reference'
                maxLength={200}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <Label htmlFor='payment-note'>{t(ui('receivables.note'))}</Label>
              <Textarea
                id='payment-note'
                rows={2}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>
            {formError ? <ErrorNotice error={formError} committed /> : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setPaymentOpen(false)}>
              {t(ui('cancel'))}
            </Button>
            <Button
              disabled={pending || !amount.trim()}
              onClick={() => void submitPayment()}
            >
              {t(ui('save'))}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
