import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
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
  certificateTypeKeys,
  type HseCertificate,
  type HseOptions,
  type HsePage,
} from './model.js';

const emptyForm = () => ({
  subjectId: '',
  holderType: 'company',
  holderName: '',
  certType: 'pollution',
  certNo: '',
  issuedAt: '',
  expiresAt: '',
  authority: '',
});

export default function HseCertificatesPage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [transition, setTransition] = useState<{
    row: HseCertificate;
    action: 'renew' | 'revoke' | 'reinstate';
  } | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
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
    queryKey: ['hse-certificates', subjectId, page],
    queryFn: ({ signal }) =>
      api.request<HsePage<HseCertificate>>({
        path: 'hse/certificates',
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
  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request({
        path: 'hse/certificates',
        method: 'POST',
        json: {
          subjectId: form.subjectId,
          holderType: form.holderType,
          holderName: form.holderName,
          certType: form.certType,
          certNo: form.certNo,
          issuedAt: form.issuedAt || null,
          expiresAt: form.expiresAt,
          authority: form.authority,
        },
      }),
    onSuccess: () => {
      setOpen(false);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['hse-certificates'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const advance = useMutation({
    retry: false,
    mutationFn: () => {
      if (!transition) throw new Error('No transition selected');
      return api.request({
        path: `hse/certificates/${transition.row.id}/transitions`,
        method: 'POST',
        json: {
          version: transition.row.version,
          action: transition.action,
          expiresAt: transition.action === 'renew' ? expiresAt : undefined,
          note: note.trim(),
        },
      });
    },
    onSuccess: () => {
      setTransition(null);
      void queryClient.invalidateQueries({ queryKey: ['hse-certificates'] });
      void queryClient.invalidateQueries({ queryKey: ['hse-overview'] });
    },
  });
  const openTransition = (
    row: HseCertificate,
    action: 'renew' | 'revoke' | 'reinstate',
  ) => {
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    setExpiresAt(
      action === 'renew' ? nextYear.toISOString().slice(0, 10) : row.expiresAt,
    );
    setNote('');
    setTransition({ row, action });
  };
  const lastAction = (row: HseCertificate) => {
    const entry = row.history?.at(-1);
    if (!entry) return '—';
    return `${t(`hse.action.${entry.action}`)} · ${new Date(entry.at).toLocaleDateString(i18n.language)}`;
  };
  const rows = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 20));
  const set = (key: keyof ReturnType<typeof emptyForm>, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const certTypes = useMemo(
    () =>
      certificateTypeKeys.map((key) => ({
        id: key,
        name: t(`hse.certificateType.${key}`),
      })),
    [t],
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('hse.certificates')}
        description={t('hse.certificatesDescription')}
        actions={
          <>
            <HseRefresh
              busy={list.isFetching}
              onClick={() => void list.refetch()}
            />
            <Button
              onClick={() => {
                setForm({ ...emptyForm(), subjectId });
                setOpen(true);
              }}
            >
              <Plus />
              {t('hse.createCertificate')}
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
                <TableHead>{t('hse.fields.holderName')}</TableHead>
                <TableHead>{t('hse.fields.certType')}</TableHead>
                <TableHead>{t('hse.fields.certNo')}</TableHead>
                <TableHead>{t('hse.fields.expiresAt')}</TableHead>
                <TableHead>{t('hse.fields.authority')}</TableHead>
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
                  <TableCell>{row.holderName}</TableCell>
                  <TableCell>
                    {t(`hse.certificateType.${row.certType}`)}
                  </TableCell>
                  <TableCell>{row.certNo}</TableCell>
                  <TableCell>
                    {new Date(`${row.expiresAt}T00:00:00`).toLocaleDateString(
                      i18n.language,
                    )}
                  </TableCell>
                  <TableCell>{row.authority || '—'}</TableCell>
                  <TableCell>
                    <HseStatus status={row.status} />
                  </TableCell>
                  <TableCell className='text-xs text-muted-foreground'>
                    {lastAction(row)}
                  </TableCell>
                  <TableCell className='text-right'>
                    {row.status === 'revoked' ? (
                      canApprove ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => openTransition(row, 'reinstate')}
                        >
                          {t('hse.reinstate')}
                        </Button>
                      ) : (
                        '—'
                      )
                    ) : (
                      <span className='inline-flex gap-2'>
                        {canManage ? (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => openTransition(row, 'renew')}
                          >
                            {t('hse.renew')}
                          </Button>
                        ) : null}
                        {canApprove ? (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => openTransition(row, 'revoke')}
                          >
                            {t('hse.revoke')}
                          </Button>
                        ) : null}
                        {!canManage && !canApprove ? '—' : null}
                      </span>
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
          {t('hse.emptyCertificates')}
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className='sm:max-w-xl'>
          <DialogHeader>
            <DialogTitle>{t('hse.createCertificate')}</DialogTitle>
            <DialogDescription>
              {t('hse.createCertificateDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4'>
            <div className='grid gap-2 sm:grid-cols-2'>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.holderType')}</span>
                <HseSelect
                  value={form.holderType}
                  onChange={(value) => set('holderType', value)}
                  options={[
                    { id: 'company', name: t('hse.holderType.company') },
                    { id: 'person', name: t('hse.holderType.person') },
                  ]}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.holderName')}</span>
                <Input
                  value={form.holderName}
                  onChange={(event) => set('holderName', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.certType')}</span>
                <HseSelect
                  value={form.certType}
                  onChange={(value) => set('certType', value)}
                  options={certTypes}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.certNo')}</span>
                <Input
                  value={form.certNo}
                  onChange={(event) => set('certNo', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.authority')}</span>
                <Input
                  value={form.authority}
                  onChange={(event) => set('authority', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.issuedAt')}</span>
                <Input
                  type='date'
                  value={form.issuedAt}
                  onChange={(event) => set('issuedAt', event.target.value)}
                />
              </label>
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.expiresAt')}</span>
                <Input
                  type='date'
                  value={form.expiresAt}
                  onChange={(event) => set('expiresAt', event.target.value)}
                />
              </label>
            </div>
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
                !form.holderName.trim() ||
                !form.certNo.trim() ||
                !form.expiresAt
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
              {t('hse.certificateTransitionDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            {transition?.action === 'renew' ? (
              <label className='grid gap-1.5 text-sm'>
                <span>{t('hse.fields.newExpiresAt')}</span>
                <Input
                  type='date'
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
              </label>
            ) : null}
            <label className='grid gap-1.5 text-sm'>
              <span>{t('hse.fields.note')}</span>
              <Textarea
                rows={3}
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
                !note.trim() ||
                (transition?.action === 'renew' && !expiresAt)
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
