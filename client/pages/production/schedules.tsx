import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, RefreshCw, Save, Send } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Input } from '#components/ui/input';
import { nativeSelectClass } from '#components/native-controls';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { useProductionAccess } from './access.js';
import { ReadOnlyNotice } from '#components/read-only-notice';
import type {
  ProductionOptions,
  ProductionSchedulePayload,
  ProductionSchedulePerson,
} from './model.js';

const today = () => new Date().toISOString().slice(0, 10);
type ScheduleResult = { data: ProductionSchedulePayload };
type OptionsResult = { data: ProductionOptions };

export default function ProductionSchedulesPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const access = useProductionAccess();
  const [unitId, setUnitId] = useState('');
  const [scheduleDate, setScheduleDate] = useState(today);
  const [shift, setShift] = useState<'day' | 'night'>('day');
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState('');
  const options = useQuery({
    retry: false,
    queryKey: ['production-options'],
    queryFn: ({ signal }) =>
      api.request<OptionsResult>({ path: 'production/options', signal }),
  });
  const units = options.data?.data.units ?? [];
  const selectedUnit = unitId || units[0]?.id || '';
  const schedule = useQuery({
    retry: false,
    enabled: Boolean(selectedUnit),
    queryKey: ['production-schedule', selectedUnit, scheduleDate, shift],
    queryFn: ({ signal }) =>
      api.request<ScheduleResult>({
        path: 'production/schedules',
        query: { unitId: selectedUnit, scheduleDate, shift },
        signal,
      }),
  });
  const data = schedule.data?.data;
  const isAssigned = (person: ProductionSchedulePerson) =>
    draft[person.personId] ?? person.assigned;
  const selectedCount = (data?.people ?? []).filter(isAssigned).length;
  const setPerson = (personId: string, assigned: boolean) =>
    setDraft((current) => ({ ...current, [personId]: assigned }));
  const selectAll = () =>
    setDraft(
      Object.fromEntries(
        (data?.people ?? []).map((person) => [person.personId, true]),
      ),
    );
  const selectNone = () =>
    setDraft(
      Object.fromEntries(
        (data?.people ?? []).map((person) => [person.personId, false]),
      ),
    );
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<ScheduleResult>({
        path: 'production/schedules',
        method: 'PUT',
        json: {
          unitId: selectedUnit,
          scheduleDate,
          shift,
          personIds: (data?.people ?? [])
            .filter(isAssigned)
            .map((person) => person.personId),
          notes: notes.trim() || data?.schedule?.notes || null,
        },
      }),
    onSuccess: () => {
      setDraft({});
      setNotice(t('production.scheduleSaved'));
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule'],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error ? error.message : t('production.saveFailed'),
      ),
  });
  const publish = useMutation({
    retry: false,
    mutationFn: () =>
      api.request<{ data: { id: string; status: string } }>({
        path: `production/schedules/${data?.schedule?.id}/publish`,
        method: 'POST',
      }),
    onSuccess: () => {
      setNotice(t('production.schedulePublishSuccess'));
      void queryClient.invalidateQueries({
        queryKey: ['production-schedule'],
      });
    },
    onError: (error) =>
      setNotice(
        error instanceof Error
          ? error.message
          : t('production.schedulePublishFailed'),
      ),
  });
  const resetFilters = () => {
    setDraft({});
    setNotes('');
    setNotice('');
  };
  const summary = data?.summary ?? { planned: 0, assigned: 0 };
  const status = data?.schedule?.status ?? 'draft';
  return (
    <PageContainer>
      <PageHeader
        title={t('production.schedules')}
        description={t('production.schedulesDescription')}
      />
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-end justify-between gap-3'>
          <div>
            <CardTitle className='flex items-center gap-2'>
              <CalendarDays className='size-4' />
              {t('production.scheduleTitle')}
            </CardTitle>
            <CardDescription>
              {t('production.scheduleDescription')}
            </CardDescription>
          </div>
          <div className='flex flex-wrap items-end gap-2'>
            <label className='grid gap-1 text-sm'>
              <span>{t('production.unit')}</span>
              <select
                className={nativeSelectClass}
                value={selectedUnit}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  resetFilters();
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
              <span>{t('production.date')}</span>
              <Input
                type='date'
                value={scheduleDate}
                onChange={(event) => {
                  setScheduleDate(event.target.value);
                  resetFilters();
                }}
              />
            </label>
            <label className='grid gap-1 text-sm'>
              <span>{t('production.shift')}</span>
              <select
                className={nativeSelectClass}
                value={shift}
                onChange={(event) => {
                  setShift(event.target.value as 'day' | 'night');
                  resetFilters();
                }}
              >
                <option value='day'>{t('production.shiftDay')}</option>
                <option value='night'>{t('production.shiftNight')}</option>
              </select>
            </label>
            <Button
              type='button'
              variant='outline'
              size='icon'
              onClick={() => void schedule.refetch()}
              aria-label={t('production.refresh')}
            >
              <RefreshCw className='size-4' />
            </Button>
          </div>
        </CardHeader>
      </Card>
      {notice ? (
        <p className='rounded-md border bg-muted/40 px-3 py-2 text-sm'>
          {notice}
        </p>
      ) : null}
      <ReadOnlyNotice
        canManage={access.canManage}
        canApprove={access.canApprove}
      />
      {!selectedUnit ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('production.noUnits')}</CardTitle>
            <CardDescription>
              {t('production.noUnitsDescription')}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
            <div>
              <CardTitle>{t('production.scheduleRoster')}</CardTitle>
              <CardDescription>
                {t('production.scheduleSummary')
                  .replace('{planned}', String(summary.planned))
                  .replace('{assigned}', String(selectedCount))}
              </CardDescription>
            </div>
            <div className='flex flex-wrap items-center gap-2'>
              <span className='rounded-full border px-2 py-1 text-xs'>
                {status === 'published'
                  ? t('production.schedulePublished')
                  : t('production.scheduleDraft')}
              </span>
              <Button
                type='button'
                variant='outline'
                disabled={!access.canManage}
                onClick={selectAll}
              >
                {t('production.selectAll')}
              </Button>
              <Button
                type='button'
                variant='outline'
                disabled={!access.canManage}
                onClick={selectNone}
              >
                {t('production.selectNone')}
              </Button>
            </div>
          </CardHeader>
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-16'>
                    {t('production.assigned')}
                  </TableHead>
                  <TableHead>{t('production.person')}</TableHead>
                  <TableHead>{t('production.position')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.people ?? []).map((person) => (
                  <TableRow key={person.personId}>
                    <TableCell>
                      <Checkbox
                        disabled={!access.canManage}
                        checked={isAssigned(person)}
                        onCheckedChange={(checked) =>
                          setPerson(person.personId, Boolean(checked))
                        }
                      />
                    </TableCell>
                    <TableCell>{person.personName}</TableCell>
                    <TableCell>{person.positionName}</TableCell>
                  </TableRow>
                ))}
                {!data?.people.length ? (
                  <TableRow>
                    <TableCell colSpan={3} className='text-muted-foreground'>
                      {t('production.noProductionPeople')}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <div className='flex flex-wrap items-end gap-2 border-t p-4'>
            <label className='grid flex-1 gap-1 text-sm sm:max-w-md'>
              <span>{t('production.notes')}</span>
              <Input
                value={notes}
                disabled={!access.canManage}
                placeholder={data?.schedule?.notes ?? ''}
                onChange={(event) => setNotes(event.target.value)}
              />
            </label>
            <Button
              type='button'
              disabled={save.isPending || !selectedUnit || !access.canManage}
              onClick={() => save.mutate()}
            >
              <Save className='size-4' />
              {t('production.saveSchedule')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={
                publish.isPending ||
                !access.canApprove ||
                !data?.schedule ||
                data.schedule.status === 'published' ||
                selectedCount === 0
              }
              onClick={() => publish.mutate()}
            >
              <Send className='size-4' />
              {t('production.publishSchedule')}
            </Button>
          </div>
        </Card>
      )}
    </PageContainer>
  );
}
