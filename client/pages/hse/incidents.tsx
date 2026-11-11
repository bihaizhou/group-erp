import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
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
import {
  incidentSeverityKeys,
  incidentTypeKeys,
  type HseIncident,
  type HseOptions,
  type HsePage,
} from './model.js';

const emptyForm = () => ({
  subjectId: '',
  unitId: '',
  occurredAt: new Date().toISOString().slice(0, 16),
  type: 'injury',
  severity: 'minor',
  location: '',
  description: '',
  injuryCount: '0',
  lostDays: '0',
  environmentalRelease: false,
});

export default function HseIncidentsPage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [transition, setTransition] = useState<{
    row: HseIncident;
    action: 'investigate' | 'rectify' | 'close';
  } | null>(null);
  const [rootCause, setRootCause] = useState('');
  const [corrective, setCorrective] = useState('');
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
    queryKey: ['hse-incidents', subjectId, page],
    queryFn: ({ signal }) =>
      api.request<HsePage<HseIncident>>({
        path: 'hse/incidents',
        query: {
          ...(subjectId ? { subjectId } : {}),
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
  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request({
        path: 'hse/incidents',
        method: 'POST',
        json: {
          subjectId: form.subjectId,
          unitId: form.unitId || null,
          occurredAt: new Date(form.occurredAt).toISOString(),
          type: form.type,
          severity: form.severity,
          location: form.location,
          description: form.description,
          injuryCount: Number(form.injuryCount) || 0,
          lostDays: Number(form.lostDays) || 0,
          environmentalRelease: form.environmentalRelease,
        },
      }),
    onSuccess: () => {
      setOpen(false);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['hse-incidents'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const advance = useMutation({
    retry: false,
    mutationFn: () => {
      if (!transition) throw new Error('No transition selected');
      return api.request({
        path: `hse/incidents/${transition.row.id}/transitions`,
        method: 'POST',
        json: {
          version: transition.row.version,
          action: transition.action,
          rootCause: rootCause.trim() || undefined,
          actions: corrective.trim() || undefined,
          note: note.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      setTransition(null);
      void queryClient.invalidateQueries({ queryKey: ['hse-incidents'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const openTransition = (
    row: HseIncident,
    action: 'investigate' | 'rectify' | 'close',
  ) => {
    setRootCause(row.rootCause ?? '');
    setCorrective(row.actions ?? '');
    setNote('');
    setTransition({ row, action });
  };
  const lastAction = (row: HseIncident) => {
    const entry = row.history?.at(-1);
    if (!entry) return '—';
    return `${t(`hse.action.${entry.action}`)} · ${new Date(entry.at).toLocaleDateString(i18n.language)}`;
  };
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  const set = (
    key: keyof ReturnType<typeof emptyForm>,
    value: string | boolean,
  ) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <PageContainer>
      <PageHeader
        title={t('hse.incidents')}
        description={t('hse.incidentsDescription')}
        actions={
          <>
            <HseRefresh
              busy={list.isFetching}
              onClick={() => void list.refetch()}
            />
            {canManage ? (
              <Button
                onClick={() => {
                  setForm({ ...emptyForm(), subjectId });
                  setOpen(true);
                }}
              >
                <Plus />
                {t('hse.createIncident')}
              </Button>
            ) : null}
          </>
        }
      />
      <ReadOnlyNotice canManage={canManage} />
      {list.isError ? (
        <HseErrorNotice error={list.error} retry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <HseLoading />
      ) : rows.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hse.fields.incidentNo')}</TableHead>
                <TableHead>{t('hse.fields.occurredAt')}</TableHead>
                <TableHead>{t('hse.fields.subject')}</TableHead>
                <TableHead>{t('hse.fields.type')}</TableHead>
                <TableHead>{t('hse.fields.severity')}</TableHead>
                <TableHead>{t('hse.fields.location')}</TableHead>
                <TableHead>{t('hse.fields.status')}</TableHead>
                <TableHead>{t('hse.fields.lastAction')}</TableHead>
                <TableHead className='text-right'>
                  {t('hse.fields.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.incidentNo}</TableCell>
                  <TableCell>
                    {new Date(row.occurredAt).toLocaleString(i18n.language, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </TableCell>
                  <TableCell>{row.subjectName || '—'}</TableCell>
                  <TableCell>{t(`hse.incidentType.${row.type}`)}</TableCell>
                  <TableCell>{t(`hse.severity.${row.severity}`)}</TableCell>
                  <TableCell className='max-w-48 truncate'>
                    {row.location}
                  </TableCell>
                  <TableCell>
                    <HseStatus status={row.status} />
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>
                    {lastAction(row)}
                  </TableCell>
                  <TableCell className='text-right'>
                    {row.status === 'reported' && canManage ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => openTransition(row, 'investigate')}
                      >
                        {t('hse.investigate')}
                      </Button>
                    ) : row.status === 'investigating' && canManage ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => openTransition(row, 'rectify')}
                      >
                        {t('hse.rectify')}
                      </Button>
                    ) : row.status === 'rectifying' && canApprove ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => openTransition(row, 'close')}
                      >
                        {t('hse.closeIncident')}
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
        <p className='py-10 text-sm text-muted-foreground'>
          {t('hse.emptyIncidents')}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('hse.createIncident')}</DialogTitle>
            <DialogDescription>
              {t('hse.createIncidentDescription')}
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
                <span>{t('hse.fields.occurredAt')}</span>
                <Input
                  type='datetime-local'
                  value={form.occurredAt}
                  onChange={(event) => set('occurredAt', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.location')}</span>
                <Input
                  value={form.location}
                  onChange={(event) => set('location', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.type')}</span>
                <HseSelect
                  value={form.type}
                  onChange={(value) => set('type', value)}
                  options={incidentTypeKeys.map((key) => ({
                    id: key,
                    name: t(`hse.incidentType.${key}`),
                  }))}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.severity')}</span>
                <HseSelect
                  value={form.severity}
                  onChange={(value) => set('severity', value)}
                  options={incidentSeverityKeys.map((key) => ({
                    id: key,
                    name: t(`hse.severity.${key}`),
                  }))}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.injuryCount')}</span>
                <Input
                  type='number'
                  min={0}
                  value={form.injuryCount}
                  onChange={(event) => set('injuryCount', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.lostDays')}</span>
                <Input
                  type='number'
                  min={0}
                  value={form.lostDays}
                  onChange={(event) => set('lostDays', event.target.value)}
                />
              </label>
            </div>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.description')}</span>
              <Textarea
                rows={4}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <input
                type='checkbox'
                checked={form.environmentalRelease}
                onChange={(event) =>
                  set('environmentalRelease', event.target.checked)
                }
              />
              {t('hse.fields.environmentalRelease')}
            </label>
            {create.isError ? (
              <p className='text-sm text-destructive'>
                {create.error instanceof Error
                  ? create.error.message
                  : t('hse.saveFailed')}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              {t('hse.cancel')}
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={
                create.isPending ||
                !form.subjectId ||
                !form.location.trim() ||
                !form.description.trim()
              }
            >
              {create.isPending ? t('hse.saving') : t('hse.save')}
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
              {t('hse.incidentTransitionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            {transition?.action !== 'investigate' ? (
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.rootCause')}</span>
                <Textarea
                  rows={3}
                  value={rootCause}
                  onChange={(event) => setRootCause(event.target.value)}
                />
              </label>
            ) : null}
            {transition?.action === 'rectify' ||
            transition?.action === 'close' ? (
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.correctiveActions')}</span>
                <Textarea
                  rows={3}
                  value={corrective}
                  onChange={(event) => setCorrective(event.target.value)}
                />
              </label>
            ) : null}
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
                {advance.error instanceof Error
                  ? advance.error.message
                  : t('hse.saveFailed')}
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
                (transition?.action !== 'investigate' && !rootCause.trim()) ||
                (transition?.action === 'close' && !corrective.trim())
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
