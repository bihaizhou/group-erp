import { useMemo, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
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
  hazardLevelKeys,
  hazardSourceKeys,
  type HseHazard,
  type HseOptions,
  type HsePage,
} from './model.js';

const today = () => new Date().toISOString().slice(0, 10);
const emptyForm = () => ({
  subjectId: '',
  unitId: '',
  source: 'inspection',
  level: 'general',
  description: '',
  location: '',
  discoveredAt: today(),
  ownerName: '',
  dueAt: '',
  rectification: '',
});

export default function HseHazardsPage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [transition, setTransition] = useState<{
    row: HseHazard;
    action: 'startRectification' | 'submitVerification' | 'verify' | 'return';
  } | null>(null);
  const [rectification, setRectification] = useState('');
  const [note, setNote] = useState('');
  const options = useQuery({
    retry: false,
    queryKey: ['hse-options'],
    queryFn: ({ signal }) =>
      api.request<{ data: HseOptions }>({ path: 'hse/options', signal }),
  });
  const list = useQuery({
    retry: false,
    queryKey: ['hse-hazards', page],
    queryFn: ({ signal }) =>
      api.request<HsePage<HseHazard>>({
        path: 'hse/hazards',
        query: { page, pageSize: 20 },
        signal,
      }),
  });
  const subjects = options.data?.data.subjects ?? [];
  const canManage = options.data?.data.permissions.manage ?? false;
  const canApprove = options.data?.data.permissions.approve ?? false;
  const units = useMemo(
    () =>
      (options.data?.data.units ?? []).filter(
        (unit) => !form.subjectId || unit.subjectId === form.subjectId,
      ),
    [options.data?.data.units, form.subjectId],
  );
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['hse-hazards'] });
    void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
  };
  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request({
        path: 'hse/hazards',
        method: 'POST',
        json: {
          subjectId: form.subjectId,
          unitId: form.unitId || null,
          source: form.source,
          level: form.level,
          description: form.description,
          location: form.location,
          discoveredAt: form.discoveredAt,
          ownerName: form.ownerName,
          dueAt: form.dueAt || null,
          rectification: form.rectification,
        },
      }),
    onSuccess: () => {
      setOpen(false);
      setForm(emptyForm());
      invalidate();
    },
  });
  const advance = useMutation({
    retry: false,
    mutationFn: () => {
      if (!transition) throw new Error('No transition selected');
      return api.request({
        path: `hse/hazards/${transition.row.id}/transitions`,
        method: 'POST',
        json: {
          version: transition.row.version,
          action: transition.action,
          rectification: rectification.trim() || undefined,
          note: note.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      setTransition(null);
      invalidate();
    },
  });
  const openTransition = (
    row: HseHazard,
    action: 'startRectification' | 'submitVerification' | 'verify' | 'return',
  ) => {
    setRectification(row.rectification ?? '');
    setNote('');
    setTransition({ row, action });
  };
  const lastAction = (row: HseHazard) => {
    const entry = row.history?.at(-1);
    if (!entry) return '—';
    return `${t(`hse.action.${entry.action}`)} · ${new Date(entry.at).toLocaleDateString(i18n.language)}`;
  };
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  const set = (key: keyof ReturnType<typeof emptyForm>, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  return (
    <PageContainer>
      <PageHeader
        title={t('hse.hazards')}
        description={t('hse.hazardsDescription')}
        actions={
          <>
            <HseRefresh
              busy={list.isFetching}
              onClick={() => void list.refetch()}
            />
            <Button
              onClick={() => {
                setForm({
                  ...emptyForm(),
                  subjectId: subjects[0]?.id ?? '',
                });
                setOpen(true);
              }}
            >
              <Plus />
              {t('hse.createHazard')}
            </Button>
          </>
        }
      />
      {list.isError ? (
        <HseErrorNotice error={list.error} retry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <HseLoading />
      ) : rows.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('hse.fields.level')}</TableHead>
                <TableHead>{t('hse.fields.description')}</TableHead>
                <TableHead>{t('hse.fields.location')}</TableHead>
                <TableHead>{t('hse.fields.ownerName')}</TableHead>
                <TableHead>{t('hse.fields.dueAt')}</TableHead>
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
                  <TableCell>{t(`hse.hazardLevel.${row.level}`)}</TableCell>
                  <TableCell className='max-w-72 truncate'>
                    {row.description}
                  </TableCell>
                  <TableCell>{row.location}</TableCell>
                  <TableCell>{row.ownerName}</TableCell>
                  <TableCell>
                    {row.dueAt
                      ? new Date(`${row.dueAt}T00:00:00`).toLocaleDateString(
                          i18n.language,
                        )
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <HseStatus status={row.status} />
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>
                    {lastAction(row)}
                  </TableCell>
                  <TableCell className='text-right'>
                    {row.status === 'open' && canManage ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          openTransition(row, 'startRectification')
                        }
                      >
                        {t('hse.startRectification')}
                      </Button>
                    ) : row.status === 'rectifying' && canManage ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          openTransition(row, 'submitVerification')
                        }
                      >
                        {t('hse.submitRectification')}
                      </Button>
                    ) : row.status === 'verifying' && canApprove ? (
                      <span className='inline-flex gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => openTransition(row, 'verify')}
                        >
                          {t('hse.closeHazard')}
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => openTransition(row, 'return')}
                        >
                          {t('hse.returnHazard')}
                        </Button>
                      </span>
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
          {t('hse.emptyHazards')}
        </p>
      )}
      {advance.isError ? (
        <p className='text-sm text-destructive'>
          {advance.error instanceof Error
            ? advance.error.message
            : t('hse.saveFailed')}
        </p>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('hse.createHazard')}</DialogTitle>
            <DialogDescription>
              {t('hse.createHazardDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4'>
            <div className='grid gap-2 sm:grid-cols-2'>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.subject')}</span>
                <HseSelect
                  value={form.subjectId}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      subjectId: value,
                      unitId: '',
                    }))
                  }
                  options={subjects}
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
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.source')}</span>
                <HseSelect
                  value={form.source}
                  onChange={(value) => set('source', value)}
                  options={hazardSourceKeys.map((key) => ({
                    id: key,
                    name: t(`hse.hazardSource.${key}`),
                  }))}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.level')}</span>
                <HseSelect
                  value={form.level}
                  onChange={(value) => set('level', value)}
                  options={hazardLevelKeys.map((key) => ({
                    id: key,
                    name: t(`hse.hazardLevel.${key}`),
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
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.discoveredAt')}</span>
                <Input
                  type='date'
                  value={form.discoveredAt}
                  onChange={(event) => set('discoveredAt', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.ownerName')}</span>
                <Input
                  value={form.ownerName}
                  onChange={(event) => set('ownerName', event.target.value)}
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
            </div>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.description')}</span>
              <Textarea
                rows={3}
                value={form.description}
                onChange={(event) => set('description', event.target.value)}
              />
            </label>
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.rectification')}</span>
              <Textarea
                rows={3}
                value={form.rectification}
                onChange={(event) => set('rectification', event.target.value)}
              />
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
                !form.description.trim() ||
                !form.ownerName.trim()
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
              {t('hse.hazardTransitionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            {transition?.action === 'submitVerification' ? (
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.rectification')}</span>
                <Textarea
                  rows={4}
                  value={rectification}
                  onChange={(event) => setRectification(event.target.value)}
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
                (transition?.action === 'submitVerification' &&
                  !rectification.trim()) ||
                (transition?.action === 'return' && !note.trim())
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
