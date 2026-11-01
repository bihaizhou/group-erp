import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Ban,
  CheckCircle2,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import type {
  ProductionSetup,
  ShiftReport,
  ShiftReportInputOptions,
  ShiftReportPage,
} from './model.js';

const today = () => new Date().toISOString().slice(0, 10);
type SetupResult = { data: ProductionSetup };
type ListResult = { data: ShiftReportPage };
type Form = {
  reportDate: string;
  shift: 'day' | 'night';
  processedQuantity: string;
  metalQuantity: string;
  sandQuantity: string;
  tailingsQuantity: string;
  runtimeMinutes: string;
  downtimeMinutes: string;
  notes: string;
};
const emptyForm = (): Form => ({
  reportDate: today(),
  shift: 'day',
  processedQuantity: '',
  metalQuantity: '',
  sandQuantity: '',
  tailingsQuantity: '0',
  runtimeMinutes: '0',
  downtimeMinutes: '0',
  notes: '',
});
const quantity = (value: string) => value.trim() || '0';

export default function ProductionShiftReportsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const [reportDate, setReportDate] = useState(today);
  const [form, setForm] = useState<Form>(emptyForm);
  const [notice, setNotice] = useState('');
  const [voidingRow, setVoidingRow] = useState<ShiftReport | null>(null);
  const [inputsRow, setInputsRow] = useState<ShiftReport | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const setup = useQuery({
    retry: false,
    queryKey: ['production-shift-report-setup'],
    queryFn: ({ signal }) =>
      api.request<SetupResult>({ path: 'production/setup', signal }),
  });
  const units = setup.data?.data.units ?? [];
  const selectedUnit = unitId || units[0]?.id || '';
  const mappings = (setup.data?.data.outputs ?? []).filter(
    (output) => output.unitId === selectedUnit,
  );
  const list = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-shift-reports', selectedUnit, reportDate],
    queryFn: ({ signal }) =>
      api.request<ListResult>({
        path: 'production/shift-reports',
        query: {
          unitId: selectedUnit,
          ...(reportDate ? { reportDate } : {}),
          page: 1,
          pageSize: 50,
        },
        signal,
      }),
  });
  const rows = list.data?.data.data ?? [];
  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ShiftReport }>({
        path: 'production/shift-reports',
        method: 'POST',
        json: {
          unitId: selectedUnit,
          reportDate: form.reportDate,
          shift: form.shift,
          processedQuantity: quantity(form.processedQuantity),
          metalQuantity: quantity(form.metalQuantity),
          sandQuantity: quantity(form.sandQuantity),
          tailingsQuantity: quantity(form.tailingsQuantity),
          runtimeMinutes: Number(form.runtimeMinutes) || 0,
          downtimeMinutes: Number(form.downtimeMinutes) || 0,
          notes: form.notes || null,
        },
      }),
    onSuccess: () => {
      setNotice(t('production.shiftReportSaved'));
      setForm((current) => ({
        ...emptyForm(),
        reportDate: current.reportDate,
        shift: current.shift,
      }));
      void queryClient.invalidateQueries({
        queryKey: ['production-shift-reports', selectedUnit],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.shiftReportSaveFailed'),
      ),
  });
  const confirm = useMutation({
    retry: false,
    mutationFn: (row: ShiftReport) =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row.id}/confirm`,
        method: 'POST',
        json: { version: row.version },
      }),
    onSuccess: () => {
      setNotice(t('production.shiftReportConfirmed'));
      void queryClient.invalidateQueries({
        queryKey: ['production-shift-reports', selectedUnit],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.shiftReportConfirmFailed'),
      ),
  });
  const inbound = useMutation({
    retry: false,
    mutationFn: (row: ShiftReport) =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row.id}/inbound`,
        method: 'POST',
      }),
    onSuccess: () => {
      setNotice(t('production.shiftReportInboundCreated'));
      void queryClient.invalidateQueries({
        queryKey: ['production-shift-reports', selectedUnit],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.shiftReportInboundFailed'),
      ),
  });
  const voidReport = useMutation({
    retry: false,
    mutationFn: (input: { row: ShiftReport; reason: string }) =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${input.row.id}/void`,
        method: 'POST',
        json: { version: input.row.version, reason: input.reason },
      }),
    onSuccess: () => {
      setNotice(t('production.shiftReportVoided'));
      setVoidingRow(null);
      setVoidReason('');
      void queryClient.invalidateQueries({
        queryKey: ['production-shift-reports', selectedUnit],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.shiftReportVoidFailed'),
      ),
  });
  const reopen = useMutation({
    retry: false,
    mutationFn: (row: ShiftReport) =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row.id}/reopen`,
        method: 'POST',
        json: { version: row.version },
      }),
    onSuccess: () => {
      setNotice(t('production.shiftReportReopened'));
      void queryClient.invalidateQueries({
        queryKey: ['production-shift-reports', selectedUnit],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.shiftReportReopenFailed'),
      ),
  });
  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) =>
      setForm((current) => ({ ...current, [key]: event.target.value })),
  });
  return (
    <PageContainer>
      <PageHeader
        title={t('production.shiftReportsTitle')}
        description={t('production.shiftReportsDescription')}
        actions={
          <Button
            variant='outline'
            onClick={() => void queryClient.invalidateQueries()}
          >
            <RefreshCw className='size-4' />
            {t('production.refresh')}
          </Button>
        }
      />
      {notice ? (
        <p className='text-sm text-muted-foreground' role='status'>
          {notice}
        </p>
      ) : null}
      <Card>
        <CardHeader>
          <CardTitle>{t('production.shiftReportNew')}</CardTitle>
          <CardDescription>
            {t('production.shiftReportNewDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-3 md:grid-cols-3'>
            <label className='space-y-1 text-sm'>
              <span>{t('production.unit')}</span>
              <select
                className='h-9 w-full rounded-md border bg-transparent px-3'
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
            <label className='space-y-1 text-sm'>
              <span>{t('production.reportDate')}</span>
              <Input type='date' {...field('reportDate')} />
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.shift')}</span>
              <select
                className='h-9 w-full rounded-md border bg-transparent px-3'
                value={form.shift}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    shift: event.target.value as 'day' | 'night',
                  }))
                }
              >
                <option value='day'>{t('production.shiftDay')}</option>
                <option value='night'>{t('production.shiftNight')}</option>
              </select>
            </label>
          </div>
          <div className='grid gap-3 md:grid-cols-4'>
            {(
              [
                ['processedQuantity', 'processedQuantity'],
                ['metalQuantity', 'metalQuantity'],
                ['sandQuantity', 'sandQuantity'],
                ['tailingsQuantity', 'tailingsQuantity'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className='space-y-1 text-sm'>
                <span>{t(`production.${label}`)}</span>
                <Input type='number' min='0' step='0.001' {...field(key)} />
              </label>
            ))}
          </div>
          <div className='grid gap-3 md:grid-cols-3'>
            <label className='space-y-1 text-sm'>
              <span>{t('production.runtimeMinutes')}</span>
              <Input
                type='number'
                min='0'
                max='1440'
                {...field('runtimeMinutes')}
              />
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.downtimeMinutes')}</span>
              <Input
                type='number'
                min='0'
                max='1440'
                {...field('downtimeMinutes')}
              />
            </label>
            <label className='space-y-1 text-sm'>
              <span>{t('production.notes')}</span>
              <Input {...field('notes')} />
            </label>
          </div>
          {mappings.length ? (
            <p className='text-xs text-muted-foreground'>
              {t('production.outputMappingSummary', {
                metal:
                  mappings.find((item) => item.outputType === 'metal')
                    ?.skuName ?? '-',
                sand:
                  mappings.find((item) => item.outputType === 'sand')
                    ?.skuName ?? '-',
              })}
            </p>
          ) : (
            <p className='text-xs text-destructive'>
              {t('production.outputMappingMissing')}
            </p>
          )}
          <Button
            disabled={!selectedUnit || create.isPending}
            onClick={() => create.mutate()}
          >
            <Save className='size-4' />
            {t('production.saveShiftReport')}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('production.shiftReportList')}</CardTitle>
          <CardDescription>
            {t('production.shiftReportListDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-3'>
          <p className='text-xs text-muted-foreground'>
            {t('production.shiftReportInboundHint')}
          </p>
          <Input
            type='date'
            className='max-w-48'
            value={reportDate}
            onChange={(event) => setReportDate(event.target.value)}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('production.reportDate')}</TableHead>
                <TableHead>{t('production.shift')}</TableHead>
                <TableHead>{t('production.processedQuantity')}</TableHead>
                <TableHead>{t('production.metalQuantity')}</TableHead>
                <TableHead>{t('production.sandQuantity')}</TableHead>
                <TableHead>{t('production.statusLabel')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const linked = row.outputs?.find(
                  (output) => output.stockDocumentId,
                );
                const hasActiveInbound =
                  row.outputs?.some(
                    (output) =>
                      output.stockDocumentId &&
                      output.stockDocumentStatus !== 'cancelled',
                  ) ?? false;
                return (
                  <TableRow key={row.id}>
                    <TableCell>{row.reportDate}</TableCell>
                    <TableCell>
                      {row.shift === 'day'
                        ? t('production.shiftDay')
                        : t('production.shiftNight')}
                    </TableCell>
                    <TableCell>{row.processedQuantity}</TableCell>
                    <TableCell>{row.metalQuantity}</TableCell>
                    <TableCell>{row.sandQuantity}</TableCell>
                    <TableCell>
                      <div>
                        {t(`production.shiftReportStatus.${row.status}`)}
                      </div>
                      {row.status === 'void' && row.voidReason ? (
                        <p className='text-xs text-muted-foreground'>
                          {t('production.voidReasonDisplay', {
                            reason: row.voidReason,
                          })}
                        </p>
                      ) : null}
                      {row.status === 'draft' && row.reopenedAt ? (
                        <p className='text-xs text-muted-foreground'>
                          {t('production.shiftReportReopenedHint')}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap items-center gap-2'>
                        {row.status === 'draft' ? (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={confirm.isPending}
                            onClick={() => confirm.mutate(row)}
                          >
                            <CheckCircle2 className='size-4' />
                            {t('production.confirmShiftReport')}
                          </Button>
                        ) : null}
                        {row.status === 'confirmed' && linked ? (
                          <Link
                            className='text-sm text-primary hover:underline'
                            to={`/functions/warehouse/inbounds/${linked.stockDocumentId}`}
                          >
                            {t(
                              linked.stockDocumentStatus === 'posted'
                                ? 'production.viewPostedInbound'
                                : 'production.viewInboundDraft',
                            )}
                          </Link>
                        ) : null}
                        {row.status === 'confirmed' && !linked ? (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={inbound.isPending}
                            onClick={() => inbound.mutate(row)}
                          >
                            <PackagePlus className='size-4' />
                            {t('production.createInboundDraft')}
                          </Button>
                        ) : null}
                        {row.status === 'confirmed' && !hasActiveInbound ? (
                          <Button
                            size='sm'
                            variant='destructive'
                            onClick={() => {
                              setVoidingRow(row);
                              setVoidReason('');
                            }}
                          >
                            <Ban className='size-4' />
                            {t('production.voidShiftReport')}
                          </Button>
                        ) : null}
                        {row.status === 'void' ? (
                          <Button
                            size='sm'
                            variant='outline'
                            disabled={reopen.isPending}
                            onClick={() => reopen.mutate(row)}
                          >
                            <RotateCcw className='size-4' />
                            {t('production.reopenShiftReport')}
                          </Button>
                        ) : null}
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => setInputsRow(row)}
                        >
                          {t('production.shiftReportInputs')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-muted-foreground'>
                    {t('production.shiftReportEmpty')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {inputsRow ? (
        <ShiftReportInputsDialog
          row={inputsRow}
          onClose={() => setInputsRow(null)}
          onChanged={() =>
            void queryClient.invalidateQueries({
              queryKey: ['production-shift-reports', selectedUnit],
            })
          }
        />
      ) : null}
      <Dialog
        open={Boolean(voidingRow)}
        onOpenChange={(open) => {
          if (!open) {
            setVoidingRow(null);
            setVoidReason('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('production.voidShiftReport')}</DialogTitle>
            <DialogDescription>
              {t('production.voidShiftReportDescription')}
            </DialogDescription>
          </DialogHeader>
          <label className='space-y-1 text-sm'>
            <span>{t('production.voidReason')}</span>
            <Textarea
              rows={3}
              maxLength={500}
              value={voidReason}
              onChange={(event) => setVoidReason(event.target.value)}
              placeholder={t('production.voidReasonPlaceholder')}
            />
          </label>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setVoidingRow(null);
                setVoidReason('');
              }}
            >
              {t('production.cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={!voidReason.trim() || voidReport.isPending}
              onClick={() => {
                if (voidingRow)
                  voidReport.mutate({
                    row: voidingRow,
                    reason: voidReason.trim(),
                  });
              }}
            >
              <Ban className='size-4' />
              {t('production.confirmVoid')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function ShiftReportInputsDialog({
  row,
  onClose,
  onChanged,
}: {
  row: ShiftReport;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const [report, setReport] = useState(row);
  const [mode, setMode] = useState<'manual' | 'issue'>('manual');
  const [materialId, setMaterialId] = useState('');
  const [documentId, setDocumentId] = useState('');
  const [lineId, setLineId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState('');
  const detail = useQuery({
    retry: false,
    queryKey: ['production-shift-report', row.id],
    queryFn: ({ signal }) =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row.id}`,
        signal,
      }),
  });
  const options = useQuery({
    retry: false,
    queryKey: ['production-shift-report-input-options', row.id],
    queryFn: ({ signal }) =>
      api.request<{ data: ShiftReportInputOptions }>({
        path: `production/shift-reports/${row.id}/input-options`,
        signal,
      }),
  });
  const current = detail.data?.data ?? report;
  const inputs = current.inputs ?? [];
  const materials = options.data?.data.materials ?? [];
  const documents = options.data?.data.issueDocuments ?? [];
  const activeMaterialId = materialId || materials[0]?.id || '';
  const activeDocumentId = documentId || documents[0]?.id || '';
  const document = documents.find((item) => item.id === activeDocumentId);
  const activeLineId = lineId || document?.lines[0]?.id || '';
  const line = document?.lines.find((item) => item.id === activeLineId);
  const apply = (next: ShiftReport) => {
    setReport(next);
    void detail.refetch();
    onChanged();
  };
  const add = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row.id}/inputs`,
        method: 'POST',
        json:
          mode === 'manual'
            ? {
                version: current.version,
                sourceType: 'manual',
                skuId: activeMaterialId,
                quantity,
                note,
              }
            : {
                version: current.version,
                sourceType: 'issue',
                skuId: line?.skuId,
                quantity,
                note: note || null,
                issueRequestId: line?.issueRequestId,
                issueRequestLineId: line?.issueRequestLineId,
                stockDocumentId: activeDocumentId,
                stockDocumentLineId: activeLineId,
              },
      }),
    onSuccess: ({ data }) => {
      setNotice(t('production.shiftReportInputSaved'));
      setQuantity('');
      setNote('');
      apply(data);
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.shiftReportInputFailed'),
      ),
  });
  const remove = useMutation({
    retry: false,
    mutationFn: (inputId: string) =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row.id}/inputs/${inputId}`,
        method: 'DELETE',
        json: { version: current.version },
      }),
    onSuccess: ({ data }) => {
      setNotice(t('production.shiftReportInputRemoved'));
      apply(data);
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.shiftReportInputFailed'),
      ),
  });
  const canEdit = current.status === 'draft';
  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className='max-w-4xl'>
        <DialogHeader>
          <DialogTitle>{t('production.shiftReportInputs')}</DialogTitle>
          <DialogDescription>
            {t('production.shiftReportInputsDescription')}
          </DialogDescription>
        </DialogHeader>
        {notice ? (
          <p className='text-sm text-muted-foreground' role='status'>
            {notice}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('production.material')}</TableHead>
              <TableHead>{t('production.quantity')}</TableHead>
              <TableHead>{t('production.inputSource')}</TableHead>
              <TableHead>{t('production.notes')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {inputs.map((input) => (
              <TableRow key={input.id}>
                <TableCell>
                  {input.skuName || input.skuCode || input.skuId}
                </TableCell>
                <TableCell>
                  {input.quantity} {input.unit ?? ''}
                </TableCell>
                <TableCell>
                  {t(`production.shiftReportInputSource.${input.sourceType}`)}
                  {input.stockDocumentCode ? (
                    <span className='ml-2 text-xs text-muted-foreground'>
                      {input.stockDocumentCode}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>{input.note || '-'}</TableCell>
                <TableCell>
                  {canEdit && input.sourceType === 'manual' ? (
                    <Button
                      size='sm'
                      variant='ghost'
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(input.id)}
                    >
                      <Trash2 className='size-4' />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
            {!inputs.length ? (
              <TableRow>
                <TableCell colSpan={5} className='text-muted-foreground'>
                  {t('production.shiftReportInputEmpty')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
        {canEdit ? (
          <div className='space-y-3 rounded-md border p-3'>
            <div className='flex gap-2'>
              <Button
                size='sm'
                variant={mode === 'manual' ? 'default' : 'outline'}
                onClick={() => setMode('manual')}
              >
                {t('production.manualInput')}
              </Button>
              <Button
                size='sm'
                variant={mode === 'issue' ? 'default' : 'outline'}
                onClick={() => setMode('issue')}
              >
                {t('production.issueInput')}
              </Button>
            </div>
            {mode === 'manual' ? (
              <label className='block space-y-1 text-sm'>
                <span>{t('production.material')}</span>
                <select
                  className='h-9 w-full rounded-md border bg-transparent px-3'
                  value={activeMaterialId}
                  onChange={(event) => setMaterialId(event.target.value)}
                >
                  {materials.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.code} {item.name}
                      {item.unit ? ` (${item.unit})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className='grid gap-2 md:grid-cols-2'>
                <label className='block space-y-1 text-sm'>
                  <span>{t('production.issueDocument')}</span>
                  <select
                    className='h-9 w-full rounded-md border bg-transparent px-3'
                    value={activeDocumentId}
                    onChange={(event) => {
                      setDocumentId(event.target.value);
                      setLineId('');
                    }}
                  >
                    {documents.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.code} {item.occurredOn}
                      </option>
                    ))}
                  </select>
                </label>
                <label className='block space-y-1 text-sm'>
                  <span>{t('production.issueLine')}</span>
                  <select
                    className='h-9 w-full rounded-md border bg-transparent px-3'
                    value={activeLineId}
                    onChange={(event) => setLineId(event.target.value)}
                  >
                    {document?.lines.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.skuCode} {item.skuName} · {item.quantity}{' '}
                        {item.unit ?? ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            <div className='grid gap-2 md:grid-cols-3'>
              <label className='block space-y-1 text-sm'>
                <span>{t('production.quantity')}</span>
                <Input
                  type='number'
                  min='0'
                  step='0.000001'
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </label>
              <label className='block space-y-1 text-sm md:col-span-2'>
                <span>{t('production.notes')}</span>
                <Input
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
            </div>
            <Button
              size='sm'
              disabled={
                add.isPending ||
                !quantity ||
                !activeMaterialId ||
                (mode === 'issue' && (!activeLineId || !line))
              }
              onClick={() => add.mutate()}
            >
              <PackagePlus className='size-4' />
              {t('production.addInput')}
            </Button>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('production.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
