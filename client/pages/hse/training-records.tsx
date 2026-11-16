import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GraduationCap, Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
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
  trainingCourseTypeKeys,
  trainingStatusKeys,
  type HseOptions,
  type HsePage,
  type HseTrainingRecord,
} from './model.js';

const emptyForm = () => ({
  subjectId: '',
  personId: '',
  courseType: 'safety',
  courseName: '',
  completedAt: businessDate(),
  score: '',
  certificateId: '',
});

export default function HseTrainingRecordsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HseTrainingRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
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
    queryKey: [
      'hse-training-records',
      subjectId,
      page,
      statusFilter,
      typeFilter,
    ],
    queryFn: ({ signal }) =>
      api.request<HsePage<HseTrainingRecord>>({
        path: 'hse/training-records',
        query: {
          ...(subjectId ? { subjectId } : {}),
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(typeFilter ? { courseType: typeFilter } : {}),
          page,
          pageSize: 20,
        },
        signal,
      }),
  });
  const canManage = options.data?.data.permissions.manage ?? false;
  const canApprove = options.data?.data.permissions.approve ?? false;
  const employees = useMemo(
    () =>
      (options.data?.data.employees ?? [])
        .filter(
          (employee) =>
            !form.subjectId || employee.subjectId === form.subjectId,
        )
        .map((employee) => ({
          id: employee.id,
          name: `${employee.code} · ${employee.name}`,
        })),
    [options.data?.data.employees, form.subjectId],
  );
  const save = useMutation({
    retry: false,
    mutationFn: () => {
      const json = {
        courseType: form.courseType,
        courseName: form.courseName,
        completedAt: form.completedAt,
        score: form.score === '' ? null : Number(form.score),
        certificateId: form.certificateId.trim() || null,
      };
      return editing
        ? api.request({
            path: `hse/training-records/${editing.id}`,
            method: 'PATCH',
            json: { ...json, version: editing.version },
          })
        : api.request({
            path: 'hse/training-records',
            method: 'POST',
            json: {
              ...json,
              subjectId: form.subjectId,
              personId: form.personId,
            },
          });
    },
    onSuccess: () => {
      setOpen(false);
      setEditing(null);
      setForm(emptyForm());
      void queryClient.invalidateQueries({
        queryKey: ['hse-training-records'],
      });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm(), subjectId });
    setOpen(true);
  };
  const openEdit = (row: HseTrainingRecord) => {
    setEditing(row);
    setForm({
      subjectId: row.subjectId,
      personId: row.personId,
      courseType: row.courseType,
      courseName: row.courseName,
      completedAt: row.completedAt,
      score: row.score === null ? '' : String(row.score),
      certificateId: row.certificateId ?? '',
    });
    setOpen(true);
  };
  const knownErrorCodes = [
    'PERMISSION_DENIED',
    'SUBJECT_REQUIRED',
    'PERSON_REQUIRED',
    'PERSON_NOT_FOUND',
    'PERSON_NOT_IN_COMPANY',
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
        title={t('hse.trainingRecords')}
        description={t('hse.trainingRecordsDescription')}
        actions={
          <>
            <HseRefresh
              busy={list.isFetching}
              onClick={() => void list.refetch()}
            />
            {canManage ? (
              <Button onClick={openCreate}>
                <Plus />
                {t('hse.createTrainingRecord')}
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
            {trainingStatusKeys.map((key) => (
              <option key={key} value={key}>
                {t(`hse.status.${key}`)}
              </option>
            ))}
          </select>
        </label>
        <label className='grid w-full gap-1 text-sm sm:w-40'>
          <span>{t('hse.fields.courseType')}</span>
          <select
            className={nativeSelectClass}
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value=''>{t('hse.allType')}</option>
            {trainingCourseTypeKeys.map((key) => (
              <option key={key} value={key}>
                {t(`hse.trainingCourseType.${key}`)}
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
                <TableHead>{t('hse.fields.person')}</TableHead>
                <TableHead>{t('hse.fields.courseName')}</TableHead>
                <TableHead>{t('hse.fields.courseType')}</TableHead>
                <TableHead>{t('hse.fields.completedAt')}</TableHead>
                <TableHead>{t('hse.fields.score')}</TableHead>
                <TableHead>{t('hse.fields.certificateId')}</TableHead>
                <TableHead>{t('hse.fields.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('hse.fields.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.personName || '—'}</TableCell>
                  <TableCell className='max-w-56 truncate'>
                    {row.courseName}
                  </TableCell>
                  <TableCell>
                    {t(`hse.trainingCourseType.${row.courseType}`)}
                  </TableCell>
                  <TableCell>{row.completedAt}</TableCell>
                  <TableCell>{row.score ?? '—'}</TableCell>
                  <TableCell className='max-w-40 truncate text-xs text-muted-foreground'>
                    {row.certificateId || '—'}
                  </TableCell>
                  <TableCell>
                    <HseStatus status={row.status} />
                  </TableCell>
                  <TableCell className='text-right'>
                    {canManage ? (
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() => openEdit(row)}
                      >
                        {t('hse.edit')}
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
          <GraduationCap className='size-5 text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>
            {t('hse.emptyTrainingRecords')}
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
              {editing ? t('hse.edit') : t('hse.createTrainingRecord')}
            </DialogTitle>
            <DialogDescription>
              {t('hse.createTrainingRecordDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4'>
            <div className='grid gap-2 sm:grid-cols-2'>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.person')}</span>
                <HseSelect
                  value={form.personId}
                  onChange={(value) => set('personId', value)}
                  options={employees}
                  placeholder={t('hse.selectPerson')}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.courseType')}</span>
                <HseSelect
                  value={form.courseType}
                  onChange={(value) => set('courseType', value)}
                  options={trainingCourseTypeKeys.map((key) => ({
                    id: key,
                    name: t(`hse.trainingCourseType.${key}`),
                  }))}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.completedAt')}</span>
                <Input
                  type='date'
                  value={form.completedAt}
                  onChange={(event) => set('completedAt', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.score')}</span>
                <Input
                  type='number'
                  min={0}
                  max={1000}
                  value={form.score}
                  onChange={(event) => set('score', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.certificateId')}</span>
                <Input
                  value={form.certificateId}
                  onChange={(event) => set('certificateId', event.target.value)}
                />
              </label>
            </div>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.courseName')}</span>
              <Input
                value={form.courseName}
                onChange={(event) => set('courseName', event.target.value)}
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
                (!editing &&
                  (!form.subjectId || !form.personId || !form.completedAt)) ||
                !form.courseName.trim()
              }
            >
              {save.isPending ? t('hse.saving') : t('hse.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
