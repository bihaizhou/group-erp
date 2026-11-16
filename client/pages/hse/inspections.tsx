import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
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
import { businessDate } from '#lib/business-date';
import {
  inspectionStatusKeys,
  inspectionTypeKeys,
  type HseInspection,
  type HseOptions,
  type HsePage,
} from './model.js';

const emptyForm = () => ({
  subjectId: '',
  unitId: '',
  type: 'routine',
  plannedAt: businessDate(),
  inspectorId: '',
  checklist: '',
});

const lines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

export default function HseInspectionsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HseInspection | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [transition, setTransition] = useState<{
    row: HseInspection;
    action: 'complete';
  } | null>(null);
  const [findingsCount, setFindingsCount] = useState('0');
  const [note, setNote] = useState('');
  const [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '';
  const options = useQuery({
    retry: false,
    queryKey: ['hse-options'],
    queryFn: ({ signal }) =>
      api.request<{ data: HseOptions }>({ path: 'hse/options', signal }),
  });
  const list = useQuery({
    retry: false,
    queryKey: ['hse-inspections', subjectId, page, statusFilter, typeFilter],
    queryFn: ({ signal }) =>
      api.request<HsePage<HseInspection>>({
        path: 'hse/inspections',
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
  const employees = useMemo(
    () =>
      (options.data?.data.employees ?? []).filter(
        (employee) => !form.subjectId || employee.subjectId === form.subjectId,
      ),
    [options.data?.data.employees, form.subjectId],
  );
  const save = useMutation({
    retry: false,
    mutationFn: () => {
      const json = {
        type: form.type,
        plannedAt: form.plannedAt,
        inspectorId: form.inspectorId || null,
        checklist: lines(form.checklist),
      };
      return editing
        ? api.request({
            path: `hse/inspections/${editing.id}`,
            method: 'PATCH',
            json: { ...json, version: editing.version },
          })
        : api.request({
            path: 'hse/inspections',
            method: 'POST',
            json: {
              ...json,
              subjectId: form.subjectId,
              unitId: form.unitId || null,
            },
          });
    },
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['hse-inspections'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const complete = useMutation({
    retry: false,
    mutationFn: () => {
      if (!transition) throw new Error('No transition selected');
      return api.request({
        path: `hse/inspections/${transition.row.id}/transitions`,
        method: 'POST',
        json: {
          version: transition.row.version,
          action: 'complete',
          findingsCount: Number(findingsCount) || 0,
          note: note.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      setTransition(null);
      void queryClient.invalidateQueries({ queryKey: ['hse-inspections'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm(), subjectId });
    setOpen(true);
  };
  const openEdit = (row: HseInspection) => {
    setEditing(row);
    setForm({
      subjectId: row.subjectId,
      unitId: row.unitId ?? '',
      type: row.type,
      plannedAt: row.plannedAt,
      inspectorId: row.inspectorId ?? '',
      checklist: row.checklist.join('\n'),
    });
    setOpen(true);
  };
  const openComplete = (row: HseInspection) => {
    setFindingsCount(String(row.findingsCount ?? 0));
    setNote('');
    setTransition({ row, action: 'complete' });
  };
  const knownErrorCodes = [
    'PERMISSION_DENIED',
    'SUBJECT_REQUIRED',
    'UNIT_NOT_IN_COMPANY',
    'INSPECTION_STATE',
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
  return (
    <PageContainer>
      <PageHeader
        title={t('hse.inspections')}
        description={t('hse.inspectionsDescription')}
        actions={
          <>
            <HseRefresh
              busy={list.isFetching}
              onClick={() => void list.refetch()}
            />
            {canManage ? (
              <Button onClick={openCreate}>
                <Plus />
                {t('hse.createInspection')}
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
            {inspectionStatusKeys.map((key) => (
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
            {inspectionTypeKeys.map((key) => (
              <option key={key} value={key}>
                {t(`hse.inspectionType.${key}`)}
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
                <TableHead>{t('hse.fields.type')}</TableHead>
                <TableHead>{t('hse.fields.plannedAt')}</TableHead>
                <TableHead>{t('hse.fields.subject')}</TableHead>
                <TableHead>{t('hse.fields.unit')}</TableHead>
                <TableHead>{t('hse.fields.inspector')}</TableHead>
                <TableHead>{t('hse.fields.findingsCount')}</TableHead>
                <TableHead>{t('hse.fields.completedAt')}</TableHead>
                <TableHead>{t('hse.fields.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('hse.fields.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{t(`hse.inspectionType.${row.type}`)}</TableCell>
                  <TableCell
                    className={
                      row.status === 'planned' && row.plannedAt < businessDate()
                        ? 'text-destructive'
                        : undefined
                    }
                  >
                    {row.plannedAt}
                  </TableCell>
                  <TableCell>{row.subjectName || '—'}</TableCell>
                  <TableCell>
                    {row.unitId
                      ? (options.data?.data.units.find(
                          (unit) => unit.id === row.unitId,
                        )?.name ?? '—')
                      : '—'}
                  </TableCell>
                  <TableCell>{row.inspectorName || '—'}</TableCell>
                  <TableCell>{row.findingsCount}</TableCell>
                  <TableCell>
                    {row.completedAt ? row.completedAt.slice(0, 10) : '—'}
                  </TableCell>
                  <TableCell>
                    <HseStatus status={row.status} />
                  </TableCell>
                  <TableCell className='text-right'>
                    {row.status === 'planned' && canManage ? (
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
                          onClick={() => openComplete(row)}
                        >
                          {t('hse.action.complete')}
                        </Button>
                      </div>
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
          <ClipboardCheck className='size-5 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>
            {t('hse.emptyInspections')}
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
              {editing ? t('hse.edit') : t('hse.createInspection')}
            </DialogTitle>
            <DialogDescription>
              {t('hse.createInspectionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4'>
            <div className='grid gap-2 sm:grid-cols-2'>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.unit')}</span>
                <HseSelect
                  value={form.unitId}
                  onChange={(value) => set('unitId', value)}
                  options={units}
                  placeholder={t('hse.optional')}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.type')}</span>
                <HseSelect
                  value={form.type}
                  onChange={(value) => set('type', value)}
                  options={inspectionTypeKeys.map((key) => ({
                    id: key,
                    name: t(`hse.inspectionType.${key}`),
                  }))}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.plannedAt')}</span>
                <Input
                  type='date'
                  value={form.plannedAt}
                  onChange={(event) => set('plannedAt', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.inspector')}</span>
                <HseSelect
                  value={form.inspectorId}
                  onChange={(value) => set('inspectorId', value)}
                  options={employees}
                  placeholder={t('hse.selectInspector')}
                />
              </label>
            </div>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.checklist')}</span>
              <Textarea
                rows={5}
                value={form.checklist}
                onChange={(event) => set('checklist', event.target.value)}
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
                (!editing && !form.subjectId) ||
                !form.plannedAt ||
                lines(form.checklist).length === 0
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
            <DialogTitle>{t('hse.action.complete')}</DialogTitle>
            <DialogDescription>
              {t('hse.inspectionTransitionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.findingsCount')}</span>
              <Input
                type='number'
                min={0}
                value={findingsCount}
                onChange={(event) => setFindingsCount(event.target.value)}
              />
            </label>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.note')}</span>
              <Textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {complete.isError ? (
              <p className='text-sm text-destructive'>
                {errorText(complete.error)}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setTransition(null)}
              disabled={complete.isPending}
            >
              {t('hse.cancel')}
            </Button>
            <Button
              onClick={() => complete.mutate()}
              disabled={complete.isPending}
            >
              {complete.isPending ? t('hse.saving') : t('hse.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
