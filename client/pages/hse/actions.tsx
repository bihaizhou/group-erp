import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus } from 'lucide-react';
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
  actionSourceTypeKeys,
  actionStatusKeys,
  type HseAction,
  type HseOptions,
  type HsePage,
} from './model.js';

const emptyForm = () => ({
  subjectId: '',
  unitId: '',
  sourceType: 'inspection',
  sourceId: '',
  description: '',
  ownerId: '',
  ownerName: '',
  dueAt: '',
});

export default function HseActionsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HseAction | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [transition, setTransition] = useState<{
    row: HseAction;
    action: 'complete' | 'verify';
  } | null>(null);
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
    queryKey: ['hse-actions', subjectId, page, statusFilter, sourceFilter],
    queryFn: ({ signal }) =>
      api.request<HsePage<HseAction>>({
        path: 'hse/actions',
        query: {
          ...(subjectId ? { subjectId } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(sourceFilter ? { sourceType: sourceFilter } : {}),
          page,
          pageSize: 20,
        },
        signal,
      }),
  });
  const canManage = options.data?.data.permissions.manage ?? false;
  const canApprove = options.data?.data.permissions.approve ?? false;
  const canReport = options.data?.data.permissions.report ?? false;
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
        unitId: form.unitId || null,
        description: form.description,
        ownerId: form.ownerId || null,
        ownerName: form.ownerName,
        dueAt: form.dueAt || null,
      };
      return editing
        ? api.request({
            path: `hse/actions/${editing.id}`,
            method: 'PATCH',
            json: { ...json, version: editing.version },
          })
        : api.request({
            path: 'hse/actions',
            method: 'POST',
            json: {
              ...json,
              subjectId: form.subjectId,
              sourceType: form.sourceType,
              sourceId: form.sourceId,
            },
          });
    },
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['hse-actions'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const advance = useMutation({
    retry: false,
    mutationFn: () => {
      if (!transition) throw new Error('No transition selected');
      return api.request({
        path: `hse/actions/${transition.row.id}/transitions`,
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
      void queryClient.invalidateQueries({ queryKey: ['hse-actions'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm(), subjectId });
    setOpen(true);
  };
  const openEdit = (row: HseAction) => {
    setEditing(row);
    setForm({
      subjectId: row.subjectId,
      unitId: row.unitId ?? '',
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      description: row.description,
      ownerId: row.ownerId ?? '',
      ownerName: row.ownerName,
      dueAt: row.dueAt ?? '',
    });
    setOpen(true);
  };
  const pickOwner = (id: string) => {
    const employee = employees.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      ownerId: id,
      ownerName: employee?.name ?? current.ownerName,
    }));
  };
  const openTransition = (row: HseAction, action: 'complete' | 'verify') => {
    setNote('');
    setTransition({ row, action });
  };
  const knownErrorCodes = [
    'PERMISSION_DENIED',
    'SUBJECT_REQUIRED',
    'UNIT_NOT_IN_COMPANY',
    'OWNER_NOT_FOUND',
    'OWNER_NOT_IN_COMPANY',
    'ACTION_STATE',
    'ACTION_LOCKED',
    'SELF_VERIFICATION',
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
        title={t('hse.actions')}
        description={t('hse.actionsDescription')}
        actions={
          <>
            <HseRefresh
              busy={list.isFetching}
              onClick={() => void list.refetch()}
            />
            {canManage || canReport ? (
              <Button onClick={openCreate}>
                <Plus />
                {t('hse.createAction')}
              </Button>
            ) : null}
          </>
        }
      />
      <ReadOnlyNotice
        canManage={canManage || canReport}
        canApprove={canApprove}
      />
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
            {actionStatusKeys.map((key) => (
              <option key={key} value={key}>
                {t(`hse.status.${key}`)}
              </option>
            ))}
          </select>
        </label>
        <label className='grid w-full gap-1 text-sm sm:w-40'>
          <span>{t('hse.fields.sourceType')}</span>
          <select
            className={nativeSelectClass}
            value={sourceFilter}
            onChange={(event) => {
              setSourceFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value=''>{t('hse.allType')}</option>
            {actionSourceTypeKeys.map((key) => (
              <option key={key} value={key}>
                {t(`hse.actionSource.${key}`)}
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
                <TableHead>{t('hse.fields.sourceType')}</TableHead>
                <TableHead>{t('hse.fields.description')}</TableHead>
                <TableHead>{t('hse.fields.subject')}</TableHead>
                <TableHead>{t('hse.fields.ownerName')}</TableHead>
                <TableHead>{t('hse.fields.dueAt')}</TableHead>
                <TableHead>{t('hse.fields.status')}</TableHead>
                <TableHead>{t('hse.fields.verifiedBy')}</TableHead>
                <TableHead className='text-right'>
                  {t('hse.fields.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {t(`hse.actionSource.${row.sourceType}`)}
                  </TableCell>
                  <TableCell className='max-w-64 truncate'>
                    {row.description}
                  </TableCell>
                  <TableCell>{row.subjectName || '—'}</TableCell>
                  <TableCell>{row.ownerName || '—'}</TableCell>
                  <TableCell
                    className={
                      row.status === 'open' &&
                      row.dueAt &&
                      row.dueAt < businessDate()
                        ? 'text-destructive'
                        : undefined
                    }
                  >
                    {row.dueAt || '—'}
                  </TableCell>
                  <TableCell>
                    <HseStatus status={row.status} />
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>
                    {row.verifiedBy || '—'}
                  </TableCell>
                  <TableCell className='text-right'>
                    {row.status === 'open' && canManage ? (
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
                          onClick={() => openTransition(row, 'complete')}
                        >
                          {t('hse.action.complete')}
                        </Button>
                      </div>
                    ) : row.status === 'completed' && canApprove ? (
                      <Button
                        size='sm'
                        onClick={() => openTransition(row, 'verify')}
                      >
                        {t('hse.action.verify')}
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
          <ListChecks className='size-5 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>
            {t('hse.emptyActions')}
          </p>
          {statusFilter || sourceFilter ? (
            <Button
              variant='outline'
              size='sm'
              onClick={() => {
                setStatusFilter('');
                setSourceFilter('');
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
              {editing ? t('hse.edit') : t('hse.createAction')}
            </DialogTitle>
            <DialogDescription>
              {t('hse.createActionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4'>
            <div className='grid gap-2 sm:grid-cols-2'>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.sourceType')}</span>
                <HseSelect
                  value={form.sourceType}
                  onChange={(value) => set('sourceType', value)}
                  options={actionSourceTypeKeys.map((key) => ({
                    id: key,
                    name: t(`hse.actionSource.${key}`),
                  }))}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.sourceId')}</span>
                <Input
                  value={form.sourceId}
                  disabled={editing !== null}
                  onChange={(event) => set('sourceId', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.owner')}</span>
                <HseSelect
                  value={form.ownerId}
                  onChange={pickOwner}
                  options={employees}
                  placeholder={t('hse.selectOwner')}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.dueAt')}</span>
                <Input
                  type='date'
                  value={form.dueAt}
                  onChange={(event) => set('dueAt', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.unit')}</span>
                <HseSelect
                  value={form.unitId}
                  onChange={(value) => set('unitId', value)}
                  options={units}
                  placeholder={t('hse.optional')}
                />
              </label>
            </div>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.description')}</span>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
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
                !form.sourceId.trim() ||
                !form.description.trim() ||
                !form.ownerName.trim() ||
                !form.ownerId
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
              {t('hse.actionTransitionDescription')}
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
              disabled={advance.isPending}
            >
              {advance.isPending ? t('hse.saving') : t('hse.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
