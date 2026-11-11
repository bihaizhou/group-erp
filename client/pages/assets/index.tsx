import { useState } from 'react';
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

type Asset = {
  id: string;
  subjectId: string;
  code: string;
  name: string;
  category: string | null;
  status: 'in_stock' | 'assigned' | 'maintenance' | 'scrapped';
  scrapPending: boolean;
  scrapReason: string | null;
  scrapDecision: 'approved' | 'rejected' | null;
  custodianEmployeeId: string | null;
  custodian: { id: string; code: string; name: string } | null;
  location: string | null;
  acquiredOn: string | null;
  originalCost: string | null;
  currency: string | null;
  sourceDocumentId: string | null;
  notes: string | null;
  version: number;
};
type Options = {
  subjects: { id: string; name: string }[];
  employees: { id: string; code: string; name: string }[];
  categories: string[];
  permissions: { manage: boolean; readAll: boolean; approve: boolean };
};
type Page = {
  data: Asset[];
  meta: { page: number; pageSize: number; total: number };
};
type Form = {
  subjectId: string;
  code: string;
  name: string;
  category: string;
  custodianEmployeeId: string;
  location: string;
  acquiredOn: string;
  originalCost: string;
  notes: string;
};

const emptyForm = (subjectId = ''): Form => ({
  subjectId,
  code: '',
  name: '',
  category: '',
  custodianEmployeeId: '',
  location: '',
  acquiredOn: '',
  originalCost: '',
  notes: '',
});

export default function AssetsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [search] = useSearchParams();
  const subjectId = search.get('subjectId') ?? '';
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [custodian, setCustodian] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [action, setAction] = useState<{
    row: Asset;
    kind: 'assign' | 'return' | 'scrap' | 'approve' | 'reject';
  } | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState('');
  const options = useQuery({
    retry: false,
    queryKey: ['asset-options'],
    queryFn: ({ signal }) =>
      api.request<{ data: Options }>({ path: 'assets/options', signal }),
  });
  const list = useQuery({
    retry: false,
    queryKey: ['assets', subjectId, page, status, custodian],
    queryFn: ({ signal }) =>
      api.request<Page>({
        path: 'assets',
        query: {
          page,
          pageSize: 20,
          ...(subjectId ? { subjectId } : {}),
          ...(status ? { status } : {}),
          ...(custodian ? { custodianEmployeeId: custodian } : {}),
        },
        signal,
      }),
  });
  const employees = options.data?.data.employees ?? [];
  const categories = options.data?.data.categories ?? [];
  const canManage = options.data?.data.permissions.manage ?? false;
  const canApprove = options.data?.data.permissions.approve ?? false;
  const rows = list.data?.data ?? [];
  const meta = list.data?.meta;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['assets'] });
  const create = useMutation({
    retry: false,
    mutationFn: () =>
      api.request({
        path: 'assets',
        method: 'POST',
        json: {
          subjectId: form.subjectId,
          ...(form.code.trim() ? { code: form.code.trim() } : {}),
          name: form.name.trim(),
          category: form.category || null,
          custodianEmployeeId: form.custodianEmployeeId || null,
          location: form.location.trim() || null,
          acquiredOn: form.acquiredOn || null,
          originalCost: form.originalCost.trim() || null,
          notes: form.notes.trim() || null,
        },
      }),
    onSuccess: async () => {
      setOpen(false);
      await refresh();
    },
  });
  const act = useMutation({
    retry: false,
    mutationFn: () => {
      if (!action) throw new Error('ASSET_ACTION_MISSING');
      const { row, kind } = action;
      const json =
        kind === 'assign'
          ? { version: row.version, employeeId, note: note.trim() || null }
          : kind === 'return'
            ? {
                version: row.version,
                location: location.trim() || null,
                note: note.trim() || null,
              }
            : kind === 'scrap'
              ? { version: row.version, reason: note.trim() }
              : {
                  version: row.version,
                  approve: kind === 'approve',
                  note: note.trim() || null,
                };
      const path =
        kind === 'scrap'
          ? `assets/${row.id}/scrap/request`
          : kind === 'approve' || kind === 'reject'
            ? `assets/${row.id}/scrap/decision`
            : `assets/${row.id}/${kind}`;
      return api.request({ path, method: 'POST', json });
    },
    onSuccess: async () => {
      setAction(null);
      setEmployeeId('');
      setNote('');
      setLocation('');
      await refresh();
    },
  });
  const openAction = (
    row: Asset,
    kind: 'assign' | 'return' | 'scrap' | 'approve' | 'reject',
  ) => {
    setAction({ row, kind });
    setEmployeeId(row.custodianEmployeeId ?? '');
    setLocation(row.location ?? '');
    setNote('');
  };
  const error = list.error ?? options.error ?? create.error ?? act.error;
  return (
    <PageContainer>
      <PageHeader
        title={t('assets.title')}
        description={t('assets.description')}
        actions={
          canManage ? (
            <Button
              onClick={() => {
                setForm(emptyForm(subjectId));
                setOpen(true);
              }}
            >
              <Plus />
              {t('assets.create')}
            </Button>
          ) : undefined
        }
      />
      <ReadOnlyNotice canManage={canManage} canApprove={canApprove} />
      <div className='mb-4 flex flex-wrap items-center gap-3'>
        <select
          className='h-9 rounded-md border bg-background px-3 text-sm'
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
        >
          <option value=''>{t('assets.allStatuses')}</option>
          <option value='in_stock'>{t('assets.status.in_stock')}</option>
          <option value='assigned'>{t('assets.status.assigned')}</option>
          <option value='maintenance'>{t('assets.status.maintenance')}</option>
          <option value='scrapped'>{t('assets.status.scrapped')}</option>
        </select>
        <select
          className='h-9 rounded-md border bg-background px-3 text-sm'
          value={custodian}
          onChange={(event) => {
            setCustodian(event.target.value);
            setPage(1);
          }}
        >
          <option value=''>{t('assets.allCustodians')}</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
        <Button variant='outline' onClick={() => void list.refetch()}>
          {t('assets.refresh')}
        </Button>
      </div>
      {error ? (
        <p className='mb-4 text-sm text-destructive'>{String(error)}</p>
      ) : null}
      {list.isLoading ? (
        <p className='text-sm text-muted-foreground'>{t('assets.loading')}</p>
      ) : rows.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('assets.fields.code')}</TableHead>
                <TableHead>{t('assets.fields.name')}</TableHead>
                <TableHead>{t('assets.fields.category')}</TableHead>
                <TableHead>{t('assets.fields.status')}</TableHead>
                <TableHead>{t('assets.fields.custodian')}</TableHead>
                <TableHead>{t('assets.fields.location')}</TableHead>
                <TableHead>{t('assets.fields.originalCost')}</TableHead>
                <TableHead className='text-right'>
                  {t('assets.fields.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className='font-mono text-xs'>
                    {row.code}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>{row.category ?? '—'}</TableCell>
                  <TableCell>
                    {t(`assets.status.${row.status}`)}
                    {row.scrapPending ? (
                      <span className='ml-2 text-xs text-muted-foreground'>
                        {t('assets.pendingScrap')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.custodian?.name ?? '—'}</TableCell>
                  <TableCell>{row.location ?? '—'}</TableCell>
                  <TableCell>
                    {row.originalCost
                      ? `${row.originalCost} ${row.currency ?? ''}`
                      : '—'}
                  </TableCell>
                  <TableCell className='text-right'>
                    {row.scrapPending && canApprove ? (
                      <span className='inline-flex gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => openAction(row, 'approve')}
                        >
                          {t('assets.approveScrap')}
                        </Button>
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => openAction(row, 'reject')}
                        >
                          {t('assets.rejectScrap')}
                        </Button>
                      </span>
                    ) : canManage &&
                      row.status !== 'scrapped' &&
                      !row.scrapPending ? (
                      <span className='inline-flex gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => openAction(row, 'assign')}
                        >
                          {row.custodian
                            ? t('assets.transfer')
                            : t('assets.assign')}
                        </Button>
                        {row.status === 'assigned' ? (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() => openAction(row, 'return')}
                          >
                            {t('assets.return')}
                          </Button>
                        ) : null}
                        <Button
                          size='sm'
                          variant='ghost'
                          onClick={() => openAction(row, 'scrap')}
                        >
                          {t('assets.scrap')}
                        </Button>
                      </span>
                    ) : row.scrapPending ? (
                      <span className='text-xs text-muted-foreground'>
                        {t('assets.pendingScrap')}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className='mt-4 flex items-center justify-end gap-2 text-sm'>
            <span className='text-muted-foreground'>
              {t('assets.pageOf', {
                page: meta?.page ?? page,
                pages: Math.max(1, Math.ceil((meta?.total ?? 0) / 20)),
                total: meta?.total ?? 0,
              })}
            </span>
            <Button
              size='sm'
              variant='outline'
              disabled={page <= 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              {t('assets.previous')}
            </Button>
            <Button
              size='sm'
              variant='outline'
              disabled={page >= Math.ceil((meta?.total ?? 0) / 20)}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('assets.next')}
            </Button>
          </div>
        </>
      ) : (
        <p className='text-sm text-muted-foreground'>{t('assets.empty')}</p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assets.create')}</DialogTitle>
            <DialogDescription>{t('assets.createHint')}</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <Input
              placeholder={t('assets.fields.code')}
              value={form.code}
              onChange={(event) =>
                setForm({ ...form, code: event.target.value })
              }
            />
            <Input
              placeholder={t('assets.fields.name')}
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              value={form.category}
              onChange={(event) =>
                setForm({ ...form, category: event.target.value })
              }
            >
              <option value=''>{t('assets.fields.category')}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <select
              className='h-9 rounded-md border bg-background px-3 text-sm'
              value={form.custodianEmployeeId}
              onChange={(event) =>
                setForm({ ...form, custodianEmployeeId: event.target.value })
              }
            >
              <option value=''>{t('assets.noCustodian')}</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name}
                </option>
              ))}
            </select>
            <Input
              placeholder={t('assets.fields.location')}
              value={form.location}
              onChange={(event) =>
                setForm({ ...form, location: event.target.value })
              }
            />
            <Input
              type='date'
              value={form.acquiredOn}
              onChange={(event) =>
                setForm({ ...form, acquiredOn: event.target.value })
              }
            />
            <Input
              placeholder={t('assets.fields.originalCost')}
              value={form.originalCost}
              onChange={(event) =>
                setForm({ ...form, originalCost: event.target.value })
              }
            />
            <Textarea
              placeholder={t('assets.fields.notes')}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('assets.cancel')}
            </Button>
            <Button
              disabled={!form.name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {t('assets.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(value) => !value && setAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {action
                ? t(`assets.action.${action.kind}`, { code: action.row.code })
                : t('assets.actionTitle')}
            </DialogTitle>
            <DialogDescription>{t('assets.actionHint')}</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            {action?.kind === 'assign' ? (
              <select
                className='h-9 rounded-md border bg-background px-3 text-sm'
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
              >
                <option value=''>{t('assets.chooseEmployee')}</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
              </select>
            ) : null}
            {action?.kind === 'return' ? (
              <Input
                placeholder={t('assets.fields.location')}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            ) : null}
            <Textarea
              placeholder={
                action?.kind === 'scrap'
                  ? t('assets.scrapNote')
                  : action?.kind === 'approve' || action?.kind === 'reject'
                    ? t('assets.decisionNote')
                    : t('assets.fields.notes')
              }
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setAction(null)}>
              {t('assets.cancel')}
            </Button>
            <Button
              disabled={
                act.isPending ||
                (action?.kind === 'assign' && !employeeId) ||
                (action?.kind === 'scrap' && !note.trim())
              }
              onClick={() => act.mutate()}
            >
              {t('assets.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
