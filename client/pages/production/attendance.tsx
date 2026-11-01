import { useMemo, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Save } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Card,
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
  ProductionOptions,
} from './model.js';

const today = () => new Date().toISOString().slice(0, 10);
const statuses: AttendanceStatus[] = ['present', 'absent', 'leave', 'rest'];
type Draft = {
  status: AttendanceStatus;
  absenceReason: string;
  overtimeHours: string;
  overtimeContent: string;
};
const defaultDraft = (row: AttendanceRow): Draft => ({
  status: row.status,
  absenceReason: row.absenceReason ?? '',
  overtimeHours: row.overtimeMinutes ? String(row.overtimeMinutes / 60) : '',
  overtimeContent: row.overtimeContent ?? '',
});
type RosterResult = { data: AttendanceRoster };
type OptionsResult = { data: ProductionOptions };

export default function ProductionAttendancePage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [unitId, setUnitId] = useState('');
  const [workDate, setWorkDate] = useState(today);
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [notice, setNotice] = useState('');
  const options = useQuery({
    retry: false,
    queryKey: ['production-options'],
    queryFn: ({ signal }) =>
      api.request<OptionsResult>({ path: 'production/options', signal }),
  });
  const units = options.data?.data.units ?? [];
  const selectedUnit = unitId || units[0]?.id || '';
  const roster = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-attendance', selectedUnit, workDate, shift],
    queryFn: ({ signal }) =>
      api.request<RosterResult>({
        path: 'production/attendance',
        query: { unitId: selectedUnit, workDate, shift },
        signal,
      }),
  });
  const data = roster.data?.data;
  const valueFor = (row: AttendanceRow): Draft =>
    drafts[row.personId] ?? defaultDraft(row);
  const update = (row: AttendanceRow, patch: Partial<Draft>) => {
    setDrafts((current) => ({
      ...current,
      [row.personId]: { ...valueFor(row), ...patch },
    }));
  };
  const summary = useMemo(() => {
    const rows = data?.rows ?? [];
    const values = rows.map((row) => ({
      row,
      draft: drafts[row.personId] ?? defaultDraft(row),
    }));
    const count = (status: AttendanceStatus) =>
      values.filter((value) => value.draft.status === status).length;
    const overtimeMinutes = values.reduce(
      (sum, value) =>
        sum + Math.max(0, Math.round(Number(value.draft.overtimeHours) * 60)),
      0,
    );
    return {
      expected: rows.length,
      present: count('present'),
      absent: count('absent'),
      leave: count('leave'),
      rest: count('rest'),
      unrecorded: count('unrecorded'),
      overtimePeople: values.filter(
        (value) => Number(value.draft.overtimeHours) > 0,
      ).length,
      overtimeMinutes,
    };
  }, [data?.rows, drafts]);
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<RosterResult>({
        path: 'production/attendance',
        method: 'PUT',
        json: {
          unitId: selectedUnit,
          workDate,
          shift,
          records: (data?.rows ?? [])
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
      setNotice(t('production.saved'));
      void queryClient.invalidateQueries({
        queryKey: ['production-attendance'],
      });
    },
    onError: (error) => {
      setNotice(
        error instanceof Error ? error.message : t('production.saveFailed'),
      );
    },
  });
  const markPresent = () => {
    const next: Record<string, Draft> = { ...drafts };
    for (const row of data?.rows ?? [])
      if (valueFor(row).status === 'unrecorded')
        next[row.personId] = {
          ...valueFor(row),
          status: 'present',
        };
    setDrafts(next);
  };
  const stats: [string, number][] = [
    ['expected', summary.expected],
    ['present', summary.present],
    ['absent', summary.absent],
    ['leave', summary.leave],
    ['unrecorded', summary.unrecorded],
    ['overtimePeople', summary.overtimePeople],
    ['overtimeMinutes', summary.overtimeMinutes],
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('production.attendance')}
        description={t('production.attendanceDescription')}
        actions={
          <>
            <Button
              variant='outline'
              onClick={() => void roster.refetch()}
              disabled={roster.isFetching}
            >
              <RefreshCw className={roster.isFetching ? 'animate-spin' : ''} />
              {t('production.refresh')}
            </Button>
            <Button
              onClick={() => {
                setNotice('');
                save.mutate();
              }}
              disabled={!data || save.isPending}
            >
              <Save />
              {save.isPending ? t('production.saving') : t('production.save')}
            </Button>
          </>
        }
      />
      <div className='flex flex-wrap items-end gap-3'>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.unit')}</span>
          <select
            className='h-8 min-w-56 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
            value={selectedUnit}
            onChange={(event) => {
              setUnitId(event.target.value);
              setDrafts({});
              setNotice('');
            }}
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.name}
              </option>
            ))}
          </select>
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.workDate')}</span>
          <Input
            type='date'
            value={workDate}
            onChange={(event) => {
              setWorkDate(event.target.value);
              setDrafts({});
              setNotice('');
            }}
          />
        </label>
        <label className='grid gap-1 text-sm'>
          <span>{t('production.shift')}</span>
          <select
            className='h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
            value={shift}
            onChange={(event) => {
              setShift(event.target.value as 'day' | 'night');
              setDrafts({});
              setNotice('');
            }}
          >
            <option value='day'>{t('production.shifts.day')}</option>
            <option value='night'>{t('production.shifts.night')}</option>
          </select>
        </label>
        <Button variant='outline' onClick={markPresent} disabled={!data}>
          {t('production.markPresent')}
        </Button>
      </div>
      {notice ? (
        <p className='text-sm text-muted-foreground' role='status'>
          {notice}
        </p>
      ) : null}
      {options.isError || roster.isError ? (
        <p className='text-sm text-destructive' role='alert'>
          {t('production.loadFailed')}
        </p>
      ) : !units.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('production.noUnits')}
        </p>
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-3 xl:grid-cols-7'>
            {stats.map(([key, value]) => (
              <Card key={key}>
                <CardHeader>
                  <CardDescription>
                    {t(`production.metrics.${key}`)}
                  </CardDescription>
                  <CardTitle className='text-2xl tabular-nums'>
                    {key === 'overtimeMinutes'
                      ? (value / 60).toFixed(1)
                      : Number(value).toLocaleString(i18n.language)}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <div className='overflow-x-auto rounded-xl border'>
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
                {(data?.rows ?? []).map((row) => {
                  const draft = valueFor(row);
                  return (
                    <TableRow key={row.personId}>
                      <TableCell>{row.personName}</TableCell>
                      <TableCell>{row.positionName}</TableCell>
                      <TableCell>
                        <select
                          className='h-8 rounded-lg border border-input bg-transparent px-2 text-sm'
                          value={draft.status}
                          onChange={(event) => {
                            const status = event.target
                              .value as AttendanceStatus;
                            update(row, {
                              status,
                              overtimeHours:
                                status === 'absent' || status === 'leave'
                                  ? ''
                                  : draft.overtimeHours,
                            });
                          }}
                        >
                          {draft.status === 'unrecorded' ? (
                            <option value='unrecorded' disabled>
                              {t('production.status.unrecorded')}
                            </option>
                          ) : null}
                          {statuses.map((status) => (
                            <option key={status} value={status}>
                              {t(`production.status.${status}`)}
                            </option>
                          ))}
                        </select>
                      </TableCell>
                      <TableCell>
                        {draft.status === 'absent' ||
                        draft.status === 'leave' ? (
                          <Input
                            value={draft.absenceReason}
                            placeholder={t(
                              'production.absenceReasonPlaceholder',
                            )}
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
                          max='24'
                          step='0.5'
                          className='w-24'
                          value={draft.overtimeHours}
                          disabled={
                            draft.status === 'absent' ||
                            draft.status === 'leave'
                          }
                          onChange={(event) =>
                            update(row, { overtimeHours: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={draft.overtimeContent}
                          placeholder={t(
                            'production.overtimeContentPlaceholder',
                          )}
                          disabled={Number(draft.overtimeHours) <= 0}
                          onChange={(event) =>
                            update(row, { overtimeContent: event.target.value })
                          }
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {data && !data.rows.length ? (
                  <TableRow>
                    <TableCell colSpan={6} className='text-muted-foreground'>
                      {t('production.empty')}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </PageContainer>
  );
}
