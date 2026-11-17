import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { usePageFieldVisibility } from '#components/page-field-visibility';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import {
  HseErrorNotice,
  HseLoading,
  HseRefresh,
  HseSelect,
  HseStatus,
} from './controls.js';
import { nativeSelectClass } from '#components/native-controls';
import {
  workPermitStatusKeys,
  workPermitTypeKeys,
  type HseOptions,
  type HsePage,
  type HseWorkPermit,
} from './model.js';

const localInput = (value: string) =>
  new Date(value).toISOString().slice(0, 16);

const emptyForm = () => ({
  subjectId: '',
  unitId: '',
  permitNo: '',
  type: 'hot_work',
  workDescription: '',
  location: '',
  validFrom: localInput(new Date().toISOString()),
  validTo: localInput(new Date(Date.now() + 8 * 3600 * 1000).toISOString()),
  riskMeasures: '',
});

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export default function HseWorkPermitsPage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HseWorkPermit | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [transition, setTransition] = useState<{
    row: HseWorkPermit;
    action: 'submit' | 'approve' | 'reject' | 'close';
  } | null>(null);
  const [note, setNote] = useState('');
  const [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '';
  const pageFields = usePageFieldVisibility('hse-work-permits');
  const showField = (field: string) =>
    pageFields.visible('hse.workPermit', field);
  const options = useQuery({
    retry: false,
    queryKey: ['hse-options'],
    queryFn: ({ signal }) =>
      api.request<{ data: HseOptions }>({ path: 'hse/options', signal }),
  });
  const list = useQuery({
    retry: false,
    queryKey: ['hse-work-permits', subjectId, page, statusFilter, typeFilter],
    queryFn: ({ signal }) =>
      api.request<HsePage<HseWorkPermit>>({
        path: 'hse/work-permits',
        query: {
          ...(subjectId ? { subjectId } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(typeFilter ? { type: typeFilter } : {}),
          page,
          pageSize: 20,
        },
        signal,
      }),
  });
  const canManage = options.data?.data.permissions.manage ?? false;
  const canApprove = options.data?.data.permissions.approve ?? false;
  const units = useMemo(
    () =>
      (options.data?.data.units ?? []).filter(
        (unit) => !form.subjectId || unit.subjectId === form.subjectId,
      ),
    [options.data?.data.units, form.subjectId],
  );
  const save = useMutation({
    retry: false,
    mutationFn: () => {
      const json = {
        unitId: form.unitId || null,
        workDescription: form.workDescription,
        location: form.location,
        validFrom: new Date(form.validFrom).toISOString(),
        validTo: new Date(form.validTo).toISOString(),
        riskMeasures: lines(form.riskMeasures),
      };
      return editing
        ? api.request({
            path: `hse/work-permits/${editing.id}`,
            method: 'PATCH',
            json: { ...json, version: editing.version },
          })
        : api.request({
            path: 'hse/work-permits',
            method: 'POST',
            json: {
              ...json,
              subjectId: form.subjectId,
              permitNo: form.permitNo,
              type: form.type,
            },
          });
    },
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['hse-work-permits'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const advance = useMutation({
    retry: false,
    mutationFn: () => {
      if (!transition) throw new Error('No transition selected');
      return api.request({
        path: `hse/work-permits/${transition.row.id}/transitions`,
        method: 'POST',
        json: {
          version: transition.row.version,
          action: transition.action,
          note: note.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      setTransition(null);
      void queryClient.invalidateQueries({ queryKey: ['hse-work-permits'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm(), subjectId });
    setOpen(true);
  };
  const openEdit = (row: HseWorkPermit) => {
    setEditing(row);
    setForm({
      subjectId: row.subjectId,
      unitId: row.unitId ?? '',
      permitNo: row.permitNo,
      type: row.type,
      workDescription: row.workDescription,
      location: row.location,
      validFrom: localInput(row.validFrom),
      validTo: localInput(row.validTo),
      riskMeasures: row.riskMeasures.join('\n'),
    });
    setOpen(true);
  };
  const openTransition = (
    row: HseWorkPermit,
    action: 'submit' | 'approve' | 'reject' | 'close',
  ) => {
    setNote('');
    setTransition({ row, action });
  };
  const knownErrorCodes = [
    'PERMISSION_DENIED',
    'SUBJECT_REQUIRED',
    'UNIT_NOT_IN_COMPANY',
    'PERMIT_STATE',
    'PERMIT_SELF_APPROVAL',
    'PERMIT_PERIOD_INVALID',
    'PERMIT_NO_DUPLICATE',
    'REJECT_REASON_REQUIRED',
    'HSE_CONFLICT',
    'HSE_FORBIDDEN',
    'HSE_NOT_FOUND',
  ];
  const errorText = (error: unknown) => {
    if (error instanceof Error && error.message) {
      return knownErrorCodes.includes(error.message)
        ? t(`hse.error.${error.message}`)
        : error.message;
    }
    return t('hse.saveFailed');
  };
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  const set = (key: keyof ReturnType<typeof emptyForm>, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const stamp = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(i18n.language, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '—';
  return (
    <PageContainer>
      <PageHeader
        title={t('hse.workPermits')}
        description={t('hse.workPermitsDescription')}
        actions={
          <>
            <HseRefresh
              busy={list.isFetching}
              onClick={() => void list.refetch()}
            />
            {canManage ? (
              <Button onClick={openCreate}>
                <Plus />
                {t('hse.createWorkPermit')}
              </Button>
            ) : null}
          </>
        }
      />
      <ReadOnlyNotice canManage={canManage} canApprove={canApprove} />
      <div className='flex flex-wrap items-end gap-3'>
        <label className='grid w-full gap-1 text-sm sm:w-36'>
          <span>{t('hse.fields.status')}</span>
          <select
            className={nativeSelectClass}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value=''>{t('hse.allStatus')}</option>
            {workPermitStatusKeys.map((key) => (
              <option key={key} value={key}>
                {t(`hse.status.${key}`)}
              </option>
            ))}
          </select>
        </label>
        <label className='grid w-full gap-1 text-sm sm:w-40'>
          <span>{t('hse.fields.type')}</span>
          <select
            className={nativeSelectClass}
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value=''>{t('hse.allType')}</option>
            {workPermitTypeKeys.map((key) => (
              <option key={key} value={key}>
                {t(`hse.workPermitType.${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isError ? (
        <HseErrorNotice error={list.error} retry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <HseLoading />
      ) : rows.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {showField('permitNo') ? (
                  <TableHead>{t('hse.fields.permitNo')}</TableHead>
                ) : null}
                {showField('type') ? (
                  <TableHead>{t('hse.fields.type')}</TableHead>
                ) : null}
                <TableHead>{t('hse.fields.subject')}</TableHead>
                {showField('location') ? (
                  <TableHead>{t('hse.fields.location')}</TableHead>
                ) : null}
                {showField('validFrom') ? (
                  <TableHead>{t('hse.fields.validFrom')}</TableHead>
                ) : null}
                {showField('validTo') ? (
                  <TableHead>{t('hse.fields.validTo')}</TableHead>
                ) : null}
                {showField('approverId') ? (
                  <TableHead>{t('hse.fields.approver')}</TableHead>
                ) : null}
                {showField('status') ? (
                  <TableHead>{t('hse.fields.status')}</TableHead>
                ) : null}
                <TableHead className='text-right'>
                  {t('hse.fields.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {showField('permitNo') ? (
                    <TableCell>{row.permitNo}</TableCell>
                  ) : null}
                  {showField('type') ? (
                    <TableCell>{t(`hse.workPermitType.${row.type}`)}</TableCell>
                  ) : null}
                  <TableCell>{row.subjectName || '—'}</TableCell>
                  {showField('location') ? (
                    <TableCell className='max-w-48 truncate'>
                      {row.location}
                    </TableCell>
                  ) : null}
                  {showField('validFrom') ? (
                    <TableCell>{stamp(row.validFrom)}</TableCell>
                  ) : null}
                  {showField('validTo') ? (
                    <TableCell>{stamp(row.validTo)}</TableCell>
                  ) : null}
                  {showField('approverId') ? (
                    <TableCell>
                      {row.approverId
                        ? (options.data?.data.employees.find(
                            (employee) => employee.id === row.approverId,
                          )?.name ?? row.approverId)
                        : '—'}
                    </TableCell>
                  ) : null}
                  {showField('status') ? (
                    <TableCell>
                      <HseStatus status={row.status} />
                    </TableCell>
                  ) : null}
                  <TableCell className='text-right'>
                    {row.status === 'draft' || row.status === 'rejected' ? (
                      canManage ? (
                        <div className='flex justify-end gap-2'>
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => openEdit(row)}
                          >
                            {t('hse.edit')}
                          </Button>
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => openTransition(row, 'submit')}
                          >
                            {t('hse.action.submitApproval')}
                          </Button>
                        </div>
                      ) : (
                        '—'
                      )
                    ) : row.status === 'submitted' && canApprove ? (
                      <div className='flex justify-end gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => openTransition(row, 'reject')}
                        >
                          {t('hse.action.reject')}
                        </Button>
                        <Button
                          size='sm'
                          onClick={() => openTransition(row, 'approve')}
                        >
                          {t('hse.action.approve')}
                        </Button>
                      </div>
                    ) : row.status === 'approved' &&
                      (canManage || canApprove) ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => openTransition(row, 'close')}
                      >
                        {t('hse.action.closePermit')}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className='flex items-center justify-end gap-2 text-sm'>
            <span className='text-muted-foreground'>
              {t('hse.pageOf', { page, pages, total })}
            </span>
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              {t('hse.previous')}
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={page >= pages}
              onClick={() => setPage((value) => Math.min(pages, value + 1))}
            >
              {t('hse.next')}
            </Button>
          </div>
        </>
      ) : (
        <div className='flex flex-col items-center gap-3 rounded-xl border border-dashed py-12'>
          <FileCheck2 className='size-5 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>
            {t('hse.emptyWorkPermits')}
          </p>
          {statusFilter || typeFilter ? (
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                setStatusFilter('');
                setTypeFilter('');
                setPage(1);
              }}
            >
              {t('hse.clearFilters')}
            </Button>
          ) : null}
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {editing ? t('hse.edit') : t('hse.createWorkPermit')}
            </DialogTitle>
            <DialogDescription>
              {t('hse.createWorkPermitDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4'>
            <div className='grid gap-2 sm:grid-cols-2'>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.permitNo')}</span>
                <Input
                  value={form.permitNo}
                  disabled={editing !== null}
                  onChange={(event) => set('permitNo', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.type')}</span>
                <HseSelect
                  value={form.type}
                  onChange={(value) => set('type', value)}
                  options={workPermitTypeKeys.map((key) => ({
                    id: key,
                    name: t(`hse.workPermitType.${key}`),
                  }))}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.location')}</span>
                <Input
                  value={form.location}
                  onChange={(event) => set('location', event.target.value)}
                />
              </label>
              {showField('unitId') ? (
                <label className='grid gap-1.5 text-sm'>
                  <span>{t('hse.fields.unit')}</span>
                  <HseSelect
                    value={form.unitId}
                    onChange={(value) => set('unitId', value)}
                    options={units}
                    placeholder={t('hse.optional')}
                  />
                </label>
              ) : null}
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.validFrom')}</span>
                <Input
                  type='datetime-local'
                  value={form.validFrom}
                  onChange={(event) => set('validFrom', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.validTo')}</span>
                <Input
                  type='datetime-local'
                  value={form.validTo}
                  onChange={(event) => set('validTo', event.target.value)}
                />
              </label>
            </div>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.workDescription')}</span>
              <Textarea
                rows={3}
                value={form.workDescription}
                onChange={(event) => set('workDescription', event.target.value)}
              />
            </label>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.riskMeasures')}</span>
              <Textarea
                rows={4}
                value={form.riskMeasures}
                onChange={(event) => set('riskMeasures', event.target.value)}
              />
            </label>
            {save.isError ? (
              <p className='text-sm text-destructive'>
                {errorText(save.error)}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setOpen(false)}
              disabled={save.isPending}
            >
              {t('hse.cancel')}
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={
                save.isPending ||
                (!editing && (!form.subjectId || !form.permitNo.trim())) ||
                !form.workDescription.trim() ||
                !form.location.trim() ||
                !form.validFrom ||
                !form.validTo ||
                lines(form.riskMeasures).length === 0
              }
            >
              {save.isPending ? t('hse.saving') : t('hse.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={transition !== null}
        onOpenChange={(value) => {
          if (!value) setTransition(null);
        }}
      >
        <DialogContent className='sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>
              {transition
                ? t(`hse.action.${transition.action}`)
                : t('hse.fields.actions')}
            </DialogTitle>
            <DialogDescription>
              {t('hse.permitTransitionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.note')}</span>
              <Textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {advance.isError ? (
              <p className='text-sm text-destructive'>
                {errorText(advance.error)}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setTransition(null)}
              disabled={advance.isPending}
            >
              {t('hse.cancel')}
            </Button>
            <Button
              onClick={() => advance.mutate()}
              disabled={
                advance.isPending ||
                (transition?.action === 'reject' && !note.trim())
              }
            >
              {advance.isPending ? t('hse.saving') : t('hse.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
