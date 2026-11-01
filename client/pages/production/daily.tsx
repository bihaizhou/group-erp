import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { RefreshCw, Save } from 'lucide-react';
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
import { Input } from '#components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import type {
  AttendanceRoster,
  AttendanceRow,
  AttendanceStatus,
  DowntimeCategory,
  DowntimeImpact,
  OvertimeCompensation,
  OvertimeType,
  ProductionDowntime,
  ProductionDowntimePage,
  ProductionOvertime,
  ProductionSetup,
  ShiftReport,
  ShiftReportPage,
} from './model.js';

type DailyContext = {
  readonly unitId: string;
  readonly workDate: string;
  readonly shift: 'day' | 'night';
};
type SetupResult = { data: ProductionSetup };
type ShiftListResult = { data: ShiftReportPage };
type RosterResult = { data: AttendanceRoster };
type DowntimeResult = { data: ProductionDowntimePage };
type OvertimeResult = { data: { records: ProductionOvertime[] } };
type CandidatesResult = {
  data: {
    people: {
      personId: string;
      personName: string;
      positionId: string;
      positionName: string;
    }[];
  };
};

const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm';
const today = () => new Date().toISOString().slice(0, 10);
const nowInput = () => new Date().toISOString().slice(0, 16);
const quantity = (value: string) => value.trim() || '0';

function shiftForNow(): 'day' | 'night' {
  const hour = new Date().getHours();
  return hour >= 8 && hour < 20 ? 'day' : 'night';
}

export default function ProductionDailyPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const subjectId = params.get('subjectId') ?? '';
  const setup = useQuery({
    retry: false,
    queryKey: ['production-daily-setup'],
    queryFn: ({ signal }) =>
      api.request<SetupResult>({ path: 'production/setup', signal }),
  });
  const units = (setup.data?.data.units ?? []).filter(
    (unit) => !subjectId || unit.subjectId === subjectId,
  );
  const requestedUnit = params.get('unitId') ?? '';
  const unitId = units.some((unit) => unit.id === requestedUnit)
    ? requestedUnit
    : (units[0]?.id ?? '');
  const workDate = params.get('date') ?? today();
  const shift =
    params.get('shift') === 'night' || params.get('shift') === 'day'
      ? (params.get('shift') as 'day' | 'night')
      : shiftForNow();

  const update = (patch: Record<string, string>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['production-daily'] });
    void queryClient.invalidateQueries({ queryKey: ['production-attendance'] });
    void queryClient.invalidateQueries({
      queryKey: ['production-shift-reports'],
    });
    void queryClient.invalidateQueries({ queryKey: ['production-downtime'] });
    void queryClient.invalidateQueries({ queryKey: ['production-overtime'] });
  };

  const context: DailyContext = { unitId, workDate, shift };

  return (
    <PageContainer>
      <PageHeader
        title={t('production.daily')}
        description={t('production.dailyDescription')}
        actions={
          <Button variant='outline' onClick={refresh}>
            <RefreshCw className='size-4' />
            {t('production.refresh')}
          </Button>
        }
      />
      <Card className='mb-4'>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>
            {t('production.dailyContext')}
          </CardTitle>
          <CardDescription>{t('production.dailyDescription')}</CardDescription>
        </CardHeader>
        <CardContent className='grid gap-3 md:grid-cols-3'>
          <label className='space-y-1 text-sm'>
            <span>{t('production.unit')}</span>
            <select
              className={selectClass}
              value={unitId}
              disabled={!units.length}
              onChange={(event) => update({ unitId: event.target.value })}
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
            <Input
              type='date'
              value={workDate}
              onChange={(event) => update({ date: event.target.value })}
            />
          </label>
          <label className='space-y-1 text-sm'>
            <span>{t('production.shift')}</span>
            <select
              className={selectClass}
              value={shift}
              onChange={(event) => update({ shift: event.target.value })}
            >
              <option value='day'>{t('production.shiftDay')}</option>
              <option value='night'>{t('production.shiftNight')}</option>
            </select>
          </label>
        </CardContent>
      </Card>
      {!units.length ? (
        <p className='rounded-lg border border-dashed px-4 py-8 text-sm text-muted-foreground'>
          {t('production.dailyNoUnits')}
        </p>
      ) : (
        <div className='space-y-4'>
          <ShiftReportSection context={context} />
          <AttendanceSection context={context} />
          <div className='grid gap-4 xl:grid-cols-2'>
            <DowntimeSection context={context} />
            <OvertimeSection context={context} />
          </div>
        </div>
      )}
    </PageContainer>
  );
}

function SectionHeader({
  title,
  description,
  href,
}: {
  readonly title: string;
  readonly description: string;
  readonly href: string;
}) {
  const { t } = useTranslation();
  return (
    <CardHeader className='flex flex-row items-start justify-between gap-4'>
      <div className='space-y-1'>
        <CardTitle className='text-base'>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      <Button
        variant='ghost'
        size='sm'
        nativeButton={false}
        render={<Link to={href} />}
      >
        {t('production.dailyOpenFull')}
      </Button>
    </CardHeader>
  );
}

type ReportForm = {
  processedQuantity: string;
  metalQuantity: string;
  sandQuantity: string;
  tailingsQuantity: string;
  runtimeMinutes: string;
  downtimeMinutes: string;
  notes: string;
};
const emptyReport = (): ReportForm => ({
  processedQuantity: '',
  metalQuantity: '',
  sandQuantity: '',
  tailingsQuantity: '0',
  runtimeMinutes: '0',
  downtimeMinutes: '0',
  notes: '',
});
const reportForm = (row: ShiftReport): ReportForm => ({
  processedQuantity: row.processedQuantity,
  metalQuantity: row.metalQuantity,
  sandQuantity: row.sandQuantity,
  tailingsQuantity: row.tailingsQuantity,
  runtimeMinutes: String(row.runtimeMinutes),
  downtimeMinutes: String(row.downtimeMinutes),
  notes: row.notes ?? '',
});

function ShiftReportSection({ context }: { readonly context: DailyContext }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { unitId, workDate, shift } = context;
  const [draft, setDraft] = useState<{ key: string; form: ReportForm }>(() => ({
    key: '',
    form: emptyReport(),
  }));
  const [notice, setNotice] = useState('');
  const list = useQuery({
    retry: false,
    enabled: Boolean(unitId),
    queryKey: ['production-daily-shift', unitId, workDate],
    queryFn: ({ signal }) =>
      api.request<ShiftListResult>({
        path: 'production/shift-reports',
        query: { unitId, reportDate: workDate, page: 1, pageSize: 50 },
        signal,
      }),
  });
  const row =
    (list.data?.data.data ?? []).find((item) => item.shift === shift) ?? null;

  const formKey = `${row?.id ?? 'new'}:${row?.version ?? 0}:${unitId}:${workDate}:${shift}`;
  const form =
    draft.key === formKey ? draft.form : row ? reportForm(row) : emptyReport();
  const setForm = (next: ReportForm) => setDraft({ key: formKey, form: next });

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ['production-daily-shift', unitId, workDate],
    });
  const save = useMutation({
    retry: false,
    mutationFn: () => {
      const json = {
        processedQuantity: quantity(form.processedQuantity),
        metalQuantity: quantity(form.metalQuantity),
        sandQuantity: quantity(form.sandQuantity),
        tailingsQuantity: quantity(form.tailingsQuantity),
        runtimeMinutes: Number(form.runtimeMinutes) || 0,
        downtimeMinutes: Number(form.downtimeMinutes) || 0,
        notes: form.notes.trim() || null,
      };
      return row
        ? api.request<{ data: ShiftReport }>({
            path: `production/shift-reports/${row.id}`,
            method: 'PUT',
            json: { ...json, version: row.version },
          })
        : api.request<{ data: ShiftReport }>({
            path: 'production/shift-reports',
            method: 'POST',
            json: { ...json, unitId, reportDate: workDate, shift },
          });
    },
    onSuccess: () => {
      setNotice(t('production.dailySaved'));
      refresh();
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.dailySaveFailed'),
      ),
  });
  const confirm = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row!.id}/confirm`,
        method: 'POST',
        json: { version: row!.version },
      }),
    onSuccess: () => {
      setNotice(t('production.shiftReportConfirmed'));
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });
  const inbound = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ShiftReport }>({
        path: `production/shift-reports/${row!.id}/inbound`,
        method: 'POST',
      }),
    onSuccess: () => {
      setNotice(t('production.shiftReportInboundCreated'));
      refresh();
    },
    onError: (error) => setNotice(error.message),
  });
  const field = (key: keyof ReportForm) => ({
    value: form[key],
    disabled: row?.status !== undefined && row.status !== 'draft',
    onChange: (event: { target: { value: string } }) =>
      setForm({ ...form, [key]: event.target.value }),
  });
  const locked = row?.status !== undefined && row.status !== 'draft';

  return (
    <Card id='shift-report'>
      <SectionHeader
        title={t('production.dailyShiftReport')}
        description={
          row
            ? t(`production.shiftReportStatus.${row.status}`)
            : t('production.dailyReportMissing')
        }
        href='/functions/production/shift-reports'
      />
      <CardContent className='space-y-4'>
        {notice ? (
          <p className='text-sm text-muted-foreground' role='status'>
            {notice}
          </p>
        ) : null}
        {row?.status === 'confirmed' ? (
          <p className='text-sm text-muted-foreground'>
            {t('production.dailyReportConfirmed')}
          </p>
        ) : null}
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
        <div className='flex flex-wrap gap-2'>
          <Button
            disabled={locked || save.isPending}
            onClick={() => save.mutate()}
          >
            <Save className='size-4' />
            {t('production.saveShiftReport')}
          </Button>
          {row?.status === 'draft' ? (
            <Button
              variant='outline'
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {t('production.confirmShiftReport')}
            </Button>
          ) : null}
          {row?.status === 'confirmed' ? (
            <Button
              variant='outline'
              disabled={inbound.isPending}
              onClick={() => inbound.mutate()}
            >
              {t('production.createInboundDraft')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

type AttendanceDraft = {
  status: AttendanceStatus;
  absenceReason: string;
  overtimeHours: string;
  overtimeContent: string;
};
const attendanceDraft = (row: AttendanceRow): AttendanceDraft => ({
  status: row.status,
  absenceReason: row.absenceReason ?? '',
  overtimeHours: row.overtimeMinutes ? String(row.overtimeMinutes / 60) : '',
  overtimeContent: row.overtimeContent ?? '',
});

function AttendanceSection({ context }: { readonly context: DailyContext }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { unitId, workDate, shift } = context;
  const [draftState, setDraftState] = useState<{
    key: string;
    drafts: Record<string, AttendanceDraft>;
  }>({ key: '', drafts: {} });
  const [notice, setNotice] = useState('');
  const roster = useQuery({
    retry: false,
    enabled: Boolean(unitId),
    queryKey: ['production-daily-attendance', unitId, workDate, shift],
    queryFn: ({ signal }) =>
      api.request<RosterResult>({
        path: 'production/attendance',
        query: { unitId, workDate, shift },
        signal,
      }),
  });
  const rows = roster.data?.data.rows ?? [];
  const attendanceKey = `${unitId}:${workDate}:${shift}`;
  const drafts = draftState.key === attendanceKey ? draftState.drafts : {};
  const setDrafts = (next: Record<string, AttendanceDraft>) =>
    setDraftState({ key: attendanceKey, drafts: next });

  const valueFor = (row: AttendanceRow): AttendanceDraft =>
    drafts[row.personId] ?? attendanceDraft(row);
  const update = (row: AttendanceRow, patch: Partial<AttendanceDraft>) =>
    setDrafts({
      ...drafts,
      [row.personId]: { ...valueFor(row), ...patch },
    });
  const values = rows.map((row) => valueFor(row));
  const count = (status: AttendanceStatus) =>
    values.filter((value) => value.status === status).length;
  const summary = {
    expected: rows.length,
    present: count('present'),
    absent: count('absent'),
    leave: count('leave'),
    unrecorded: count('unrecorded'),
    overtime: values.filter((value) => Number(value.overtimeHours) > 0).length,
  };
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<RosterResult>({
        path: 'production/attendance',
        method: 'PUT',
        json: {
          unitId,
          workDate,
          shift,
          records: rows
            .map((row) => ({ row, draft: valueFor(row) }))
            .filter(({ draft }) => draft.status !== 'unrecorded')
            .map(({ row, draft }) => ({
              personId: row.personId,
              positionId: row.positionId,
              status: draft.status,
              absenceReason: draft.absenceReason || null,
              overtimeMinutes: Math.max(
                0,
                Math.round(Number(draft.overtimeHours) * 60) || 0,
              ),
              overtimeContent: draft.overtimeContent || null,
            })),
        },
      }),
    onSuccess: () => {
      setDrafts({});
      setNotice(t('production.dailySaved'));
      void queryClient.invalidateQueries({
        queryKey: ['production-daily-attendance', unitId, workDate, shift],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.dailySaveFailed'),
      ),
  });
  const markPresent = () => {
    const next: Record<string, AttendanceDraft> = { ...drafts };
    for (const row of rows)
      if (valueFor(row).status === 'unrecorded')
        next[row.personId] = { ...valueFor(row), status: 'present' };
    setDrafts(next);
  };
  const stat = (label: string, value: number) => (
    <span
      key={label}
      className='rounded-full border px-2.5 py-1 text-xs text-muted-foreground'
    >
      {label} <strong className='text-foreground'>{value}</strong>
    </span>
  );

  return (
    <Card id='attendance'>
      <SectionHeader
        title={t('production.dailyAttendance')}
        description={t('production.dailyAttendanceHint')}
        href='/functions/production/attendance'
      />
      <CardContent className='space-y-3'>
        <div className='flex flex-wrap gap-2'>
          {stat(t('production.metrics.expected'), summary.expected)}
          {stat(t('production.metrics.present'), summary.present)}
          {stat(t('production.metrics.absent'), summary.absent)}
          {stat(t('production.metrics.leave'), summary.leave)}
          {stat(t('production.metrics.unrecorded'), summary.unrecorded)}
          {stat(t('production.metrics.overtimePeople'), summary.overtime)}
        </div>
        {notice ? (
          <p className='text-sm text-muted-foreground' role='status'>
            {notice}
          </p>
        ) : null}
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('production.person')}</TableHead>
                <TableHead>{t('production.position')}</TableHead>
                <TableHead>{t('production.statusLabel')}</TableHead>
                <TableHead>{t('production.absenceReason')}</TableHead>
                <TableHead>{t('production.overtimeHours')}</TableHead>
                <TableHead>{t('production.overtimeContent')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const draft = valueFor(row);
                return (
                  <TableRow key={row.personId}>
                    <TableCell>{row.personName}</TableCell>
                    <TableCell>{row.positionName}</TableCell>
                    <TableCell>
                      <select
                        className='h-8 rounded-md border bg-transparent px-2 text-sm'
                        value={draft.status}
                        onChange={(event) =>
                          update(row, {
                            status: event.target.value as AttendanceStatus,
                          })
                        }
                      >
                        {draft.status === 'unrecorded' ? (
                          <option value='unrecorded' disabled>
                            {t('production.status.unrecorded')}
                          </option>
                        ) : null}
                        {(['present', 'absent', 'leave', 'rest'] as const).map(
                          (status) => (
                            <option key={status} value={status}>
                              {t(`production.status.${status}`)}
                            </option>
                          ),
                        )}
                      </select>
                    </TableCell>
                    <TableCell>
                      {draft.status === 'absent' || draft.status === 'leave' ? (
                        <Input
                          value={draft.absenceReason}
                          placeholder={t('production.absenceReason')}
                          onChange={(event) =>
                            update(row, { absenceReason: event.target.value })
                          }
                        />
                      ) : (
                        <span className='text-muted-foreground'>—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Input
                        type='number'
                        min='0'
                        step='0.5'
                        className='w-24'
                        value={draft.overtimeHours}
                        onChange={(event) =>
                          update(row, { overtimeHours: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={draft.overtimeContent}
                        onChange={(event) =>
                          update(row, { overtimeContent: event.target.value })
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
              {!rows.length ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className='text-sm text-muted-foreground'
                  >
                    {roster.isPending
                      ? t('production.loading')
                      : t('production.noUnits')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            onClick={markPresent}
            disabled={!rows.length}
          >
            {t('production.markPresent')}
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            <Save className='size-4' />
            {t('production.saveAttendance')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function DowntimeSection({ context }: { readonly context: DailyContext }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { unitId, workDate } = context;
  const [notice, setNotice] = useState('');
  const [startedAt, setStartedAt] = useState(nowInput);
  const [category, setCategory] = useState<DowntimeCategory>('equipment');
  const [impact, setImpact] = useState<DowntimeImpact>('stop');
  const [description, setDescription] = useState('');
  const query = useQuery({
    retry: false,
    enabled: Boolean(unitId),
    queryKey: ['production-daily-downtime', unitId, workDate],
    queryFn: ({ signal }) =>
      api.request<DowntimeResult>({
        path: 'production/downtime-events',
        query: { unitId, date: workDate },
        signal,
      }),
  });
  const rows = query.data?.data.events ?? [];
  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ProductionDowntime }>({
        path: 'production/downtime-events',
        method: 'POST',
        json: {
          unitId,
          equipmentId: null,
          startedAt: new Date(startedAt).toISOString(),
          category,
          impact,
          description: description.trim(),
        },
      }),
    onSuccess: () => {
      setDescription('');
      setStartedAt(nowInput());
      setNotice(t('production.downtimeCreated'));
      void queryClient.invalidateQueries({
        queryKey: ['production-daily-downtime', unitId, workDate],
      });
    },
    onError: (error) => setNotice(error.message),
  });

  return (
    <Card id='downtime'>
      <SectionHeader
        title={t('production.dailyDowntime')}
        description={t('production.dailyDowntimeHint')}
        href='/functions/production/downtime'
      />
      <CardContent className='space-y-3'>
        {notice ? (
          <p className='text-sm text-muted-foreground' role='status'>
            {notice}
          </p>
        ) : null}
        <div className='grid gap-2 sm:grid-cols-2'>
          <label className='space-y-1 text-sm'>
            <span>{t('production.downtimeStartedAt')}</span>
            <Input
              type='datetime-local'
              value={startedAt}
              onChange={(event) => setStartedAt(event.target.value)}
            />
          </label>
          <label className='space-y-1 text-sm'>
            <span>{t('production.downtimeCategory')}</span>
            <select
              className={selectClass}
              value={category}
              onChange={(event) =>
                setCategory(event.target.value as DowntimeCategory)
              }
            >
              {(
                [
                  'equipment',
                  'production',
                  'utility',
                  'material',
                  'quality',
                  'other',
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {t(`production.downtimeCategory_${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className='space-y-1 text-sm'>
            <span>{t('production.downtimeImpact')}</span>
            <select
              className={selectClass}
              value={impact}
              onChange={(event) =>
                setImpact(event.target.value as DowntimeImpact)
              }
            >
              {(['stop', 'speed_loss', 'other'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`production.downtimeImpact_${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className='space-y-1 text-sm sm:col-span-2'>
            <span>{t('production.downtimeDescription')}</span>
            <textarea
              className='min-h-16 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <Button
          size='sm'
          disabled={!description.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('production.downtimeCreate')}
        </Button>
        {rows.length ? (
          <div className='space-y-1 text-sm'>
            {rows.slice(0, 5).map((row) => (
              <div
                key={row.id}
                className='flex items-center justify-between gap-2 border-t py-1.5'
              >
                <span className='truncate'>{row.description}</span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {row.durationMinutes} min ·{' '}
                  {t(`production.downtimeStatus_${row.status}`)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('production.downtimeEmpty')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OvertimeSection({ context }: { readonly context: DailyContext }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { unitId, workDate } = context;
  const [notice, setNotice] = useState('');
  const [personId, setPersonId] = useState('');
  const [hours, setHours] = useState('1');
  const [type, setType] = useState<OvertimeType>('temporary');
  const [reason, setReason] = useState('');
  const candidates = useQuery({
    retry: false,
    enabled: Boolean(unitId),
    queryKey: ['production-daily-overtime-people', unitId, workDate],
    queryFn: ({ signal }) =>
      api.request<CandidatesResult>({
        path: 'production/overtime/candidates',
        query: { unitId, businessDate: workDate },
        signal,
      }),
  });
  const people = candidates.data?.data.people ?? [];
  const selectedPerson = people.some((row) => row.personId === personId)
    ? personId
    : (people[0]?.personId ?? '');
  const list = useQuery({
    retry: false,
    enabled: Boolean(unitId),
    queryKey: ['production-daily-overtime', unitId, workDate],
    queryFn: ({ signal }) =>
      api.request<OvertimeResult>({
        path: 'production/overtime',
        query: { unitId, businessDate: workDate },
        signal,
      }),
  });
  const rows = list.data?.data.records ?? [];
  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: ProductionOvertime }>({
        path: 'production/overtime',
        method: 'POST',
        json: {
          unitId,
          personId: selectedPerson,
          businessDate: workDate,
          hours: Number(hours),
          type,
          reason: reason.trim(),
          compensation: 'none' as OvertimeCompensation,
        },
      }),
    onSuccess: () => {
      setReason('');
      setNotice(t('production.overtimeCreated'));
      void queryClient.invalidateQueries({
        queryKey: ['production-daily-overtime', unitId, workDate],
      });
    },
    onError: (error) => setNotice(error.message),
  });

  return (
    <Card id='overtime'>
      <SectionHeader
        title={t('production.dailyOvertime')}
        description={t('production.dailyOvertimeHint')}
        href='/functions/production/overtime'
      />
      <CardContent className='space-y-3'>
        {notice ? (
          <p className='text-sm text-muted-foreground' role='status'>
            {notice}
          </p>
        ) : null}
        <div className='grid gap-2 sm:grid-cols-3'>
          <label className='space-y-1 text-sm'>
            <span>{t('production.person')}</span>
            <select
              className={selectClass}
              value={selectedPerson}
              onChange={(event) => setPersonId(event.target.value)}
            >
              {people.map((person) => (
                <option key={person.personId} value={person.personId}>
                  {person.personName}
                </option>
              ))}
            </select>
          </label>
          <label className='space-y-1 text-sm'>
            <span>{t('production.overtimeHours')}</span>
            <Input
              type='number'
              min='0.5'
              max='24'
              step='0.5'
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </label>
          <label className='space-y-1 text-sm'>
            <span>{t('production.overtimeType')}</span>
            <select
              className={selectClass}
              value={type}
              onChange={(event) => setType(event.target.value as OvertimeType)}
            >
              {(['planned', 'temporary', 'holiday'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`production.overtimeType_${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className='space-y-1 text-sm sm:col-span-3'>
            <span>{t('production.overtimeReason')}</span>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
        </div>
        <Button
          size='sm'
          disabled={!selectedPerson || !reason.trim() || create.isPending}
          onClick={() => create.mutate()}
        >
          {t('production.overtimeSubmit')}
        </Button>
        {rows.length ? (
          <div className='space-y-1 text-sm'>
            {rows.slice(0, 5).map((row) => (
              <div
                key={row.id}
                className='flex items-center justify-between gap-2 border-t py-1.5'
              >
                <span className='truncate'>
                  {row.personName} · {row.hours}h
                </span>
                <span className='shrink-0 text-xs text-muted-foreground'>
                  {t(`production.overtimeStatus_${row.status}`)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('production.overtimeEmpty')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
