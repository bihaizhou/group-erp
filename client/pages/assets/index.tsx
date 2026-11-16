import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { nativeSelectClass } from '#components/native-controls';
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
  employees: { id: string; code: string; name: string; subjectId: string | null }[];
  categories: string[];
  permissions: { manage: boolean; readAll: boolean; approve: boolean };
};
type Page = {
  data: Asset[];
  meta: { page: number; pageSize: number; total: number };
};
type AssetEvent = {
  id: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  actorId: string;
  note: string | null;
  createdAt: string;
};
type AssetDetail = Asset & { events: AssetEvent[] };
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
  const [editing, setEditing] = useState<Asset | null>(null);
  const [q, setQ] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [action, setAction] = useState<{
    row: Asset;
    kind: 'assign' | 'return' | 'scrap' | 'approve' | 'reject';
  } | null>(null);
  const [employeeId, setEmployeeId] = useState('');
  const [note, setNote] = useState('');
  const [location, setLocation] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [bulk, setBulk] = useState<'assign' | 'return' | null>(null);
  const [bulkEmployeeId, setBulkEmployeeId] = useState('');
  const [bulkLocation, setBulkLocation] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkMessage, setBulkMessage] = useState('');
  const [employeeQuery, setEmployeeQuery] = useState('');
  const [bulkEmployeeQuery, setBulkEmployeeQuery] = useState('');
  const options = useQuery({
    retry: false,
    queryKey: ['asset-options'],
    queryFn: ({ signal }) =>
      api.request<{ data: Options }>({ path: 'assets/options', signal }),
  });
  const list = useQuery({
    retry: false,
    queryKey: ['assets', subjectId, page, status, custodian, q],
    queryFn: ({ signal }) =>
      api.request<Page>({
        path: 'assets',
        query: {
          page,
          pageSize: 20,
          ...(subjectId ? { subjectId } : {}),
          ...(status ? { status } : {}),
          ...(custodian ? { custodianEmployeeId: custodian } : {}),
          ...(q ? { q } : {}),
        },
        signal,
      }),
  });
  const detail = useQuery({
    retry: false,
    enabled: !!detailId,
    queryKey: ['assets', 'detail', detailId],
    queryFn: ({ signal }) =>
      api.request<{ data: AssetDetail }>({
        path: `assets/${detailId}`,
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
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(subjectId));
    setOpen(true);
  };
  const openEdit = (row: Asset) => {
    setEditing(row);
    setForm({
      subjectId: row.subjectId,
      code: row.code,
      name: row.name,
      category: row.category ?? '',
      custodianEmployeeId: row.custodianEmployeeId ?? '',
      location: row.location ?? '',
      acquiredOn: row.acquiredOn ?? '',
      originalCost: row.originalCost ?? '',
      notes: row.notes ?? '',
    });
    setOpen(true);
  };
  const categoryLabel = (category: string) => {
    const key = `assets.category.${category}`;
    const label = t(key);
    return label === key ? category : label;
  };
  // Legacy rows still store the old Chinese category text. Keep that value in
  // the select so editing an unrelated field neither shows an empty choice nor
  // silently drops the category; it is only replaced when the user picks a code.
  const legacyCategory =
    form.category && !categories.includes(form.category) ? form.category : '';
  const formEmployees = employees.filter(
    (employee) => !form.subjectId || employee.subjectId === form.subjectId,
  );
  const save = useMutation({
    retry: false,
    mutationFn: () =>
      editing
        ? api.request({
            path: `assets/${editing.id}`,
            method: 'PATCH',
            json: {
              version: editing.version,
              name: form.name.trim(),
              category: form.category || null,
              location: form.location.trim() || null,
              acquiredOn: form.acquiredOn || null,
              originalCost: form.originalCost.trim() || null,
              notes: form.notes.trim() || null,
            },
          })
        : api.request({
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
      setEditing(null);
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
  const bulkAct = useMutation({
    retry: false,
    mutationFn: () => {
      if (!bulk || !selected.length) throw new Error('ASSET_SELECTION_EMPTY');
      const json =
        bulk === 'assign'
          ? {
              ids: selected,
              employeeId: bulkEmployeeId,
              location: bulkLocation.trim() || null,
              note: bulkNote.trim() || null,
            }
          : {
              ids: selected,
              location: bulkLocation.trim() || null,
              note: bulkNote.trim() || null,
            };
      return api.request<{ data: { updated: string[]; failed: unknown[] } }>({
        path: bulk === 'assign' ? 'assets/batch-assign' : 'assets/batch-return',
        method: 'POST',
        json,
      });
    },
    onSuccess: async (result) => {
      const updated = result.data?.updated?.length ?? 0;
      const failed = result.data?.failed?.length ?? 0;
      setSelected([]);
      setBulk(null);
      setBulkEmployeeId('');
      setBulkLocation('');
      setBulkNote('');
      setBulkMessage(
        t('assets.bulkResult', { updated: String(updated), failed: String(failed) }),
      );
      await refresh();
    },
  });
  const openAction = (
    row: Asset,
    kind: 'assign' | 'return' | 'scrap' | 'approve' | 'reject',
  ) => {
    setAction({ row, kind });
    setEmployeeQuery('');
    setEmployeeId(row.custodianEmployeeId ?? '');
    setLocation(row.location ?? '');
    setNote('');
  };
  useEffect(() => {
    setSelected([]);
    setBulkMessage('');
  }, [subjectId, page, status, custodian, q]);
  const error = list.error ?? options.error ?? save.error ?? act.error ?? bulkAct.error;
  return (
    <PageContainer>
      <PageHeader
        title={t('assets.title')}
        description={t('assets.description')}
        actions={
          <div className='flex items-center gap-2'>
            <Button
              variant='outline'
              size='icon'
              aria-label={t('assets.refresh')}
              title={t('assets.refresh')}
              onClick={() => void list.refetch()}
            >
              <RefreshCw className='size-4' />
            </Button>
            {canManage ? (
              <Button onClick={openCreate}>
                <Plus />
                {t('assets.create')}
              </Button>
            ) : null}
          </div>
        }
      />
      <ReadOnlyNotice canManage={canManage} canApprove={canApprove} />
      <div className='mb-4 flex flex-wrap items-end gap-3'>
        <label className='grid w-full gap-1 text-sm sm:w-44'>
          <span className='text-muted-foreground'>
            {t('assets.fields.status')}
          </span>
          <select
            className={nativeSelectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value=''>{t('assets.allStatuses')}</option>
            <option value='in_stock'>{t('assets.status.in_stock')}</option>
            <option value='assigned'>{t('assets.status.assigned')}</option>
            <option value='maintenance'>
              {t('assets.status.maintenance')}
            </option>
            <option value='scrapped'>{t('assets.status.scrapped')}</option>
          </select>
        </label>
        <label className='grid w-full gap-1 text-sm sm:w-56'>
          <span className='text-muted-foreground'>
            {t('assets.searchPlaceholder')}
          </span>
          <Input
            value={q}
            placeholder={t('assets.searchPlaceholder')}
            onChange={(event) => {
              setQ(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label className='grid w-full gap-1 text-sm sm:w-44'>
          <span className='text-muted-foreground'>
            {t('assets.fields.custodian')}
          </span>
          <select
            className={nativeSelectClass}
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
        </label>
      </div>
      {selected.length ? (
        <div className='mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2'>
          <span className='text-sm text-muted-foreground'>
            {t('assets.selectedCount', { count: String(selected.length) })}
          </span>
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              setBulk('assign');
              setBulkLocation('');
              setBulkNote('');
            }}
          >
            {t('assets.bulkAssign')}
          </Button>
          <Button
            size='sm'
            variant='outline'
            onClick={() => {
              setBulk('return');
              setBulkLocation('');
              setBulkNote('');
            }}
          >
            {t('assets.bulkReturn')}
          </Button>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => setSelected([])}
          >
            {t('assets.clearSelection')}
          </Button>
        </div>
      ) : null}
      {bulkMessage ? (
        <p className='mb-4 text-sm text-muted-foreground'>{bulkMessage}</p>
      ) : null}
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
                {canManage ? (
                  <TableHead className='w-10'>
                    <input
                      type='checkbox'
                      aria-label={t('assets.selectAll')}
                      checked={rows.length > 0 && selected.length === rows.length}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked ? rows.map((row) => row.id) : [],
                        )
                      }
                    />
                  </TableHead>
                ) : null}
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
                  {canManage ? (
                    <TableCell>
                      <input
                        type='checkbox'
                        aria-label={row.code}
                        checked={selected.includes(row.id)}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, row.id]
                              : current.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </TableCell>
                  ) : null}
                  <TableCell className='font-mono text-xs'>
                    {row.code}
                  </TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell>
                    {row.category ? categoryLabel(row.category) : '—'}
                  </TableCell>
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
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setDetailId(row.id)}
                    >
                      {t('assets.detail')}
                    </Button>
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
                          variant='ghost'
                          onClick={() => openEdit(row)}
                        >
                          {t('assets.edit')}
                        </Button>
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
            <DialogTitle>
              {editing ? t('assets.edit') : t('assets.create')}
            </DialogTitle>
            <DialogDescription>
              {editing ? t('assets.editHint') : t('assets.createHint')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3 sm:grid-cols-2'>
            <label className='grid gap-1 text-sm'>
              <span>{t('assets.fields.code')}</span>
              <Input
                value={form.code}
                disabled={!!editing}
                onChange={(event) =>
                  setForm({ ...form, code: event.target.value })
                }
              />
            </label>
            <label className='grid gap-1 text-sm'>
              <span>{t('assets.fields.name')}</span>
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
            <label className='grid gap-1 text-sm'>
              <span>{t('assets.fields.category')}</span>
              <select
                className={nativeSelectClass}
                value={form.category}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
              >
                <option value=''>{t('assets.fields.category')}</option>
                {legacyCategory ? (
                  <option value={legacyCategory}>{legacyCategory}</option>
                ) : null}
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {categoryLabel(category)}
                  </option>
                ))}
              </select>
            </label>
            {editing ? null : (
              <label className='grid gap-1 text-sm'>
                <span>{t('assets.fields.custodian')}</span>
                <select
                  className={nativeSelectClass}
                  value={form.custodianEmployeeId}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      custodianEmployeeId: event.target.value,
                    })
                  }
                >
                  <option value=''>{t('assets.noCustodian')}</option>
                  {formEmployees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className='grid gap-1 text-sm'>
              <span>{t('assets.fields.location')}</span>
              <Input
                value={form.location}
                onChange={(event) =>
                  setForm({ ...form, location: event.target.value })
                }
              />
            </label>
            <label className='grid gap-1 text-sm'>
              <span>{t('assets.fields.acquiredOn')}</span>
              <Input
                type='date'
                value={form.acquiredOn}
                onChange={(event) =>
                  setForm({ ...form, acquiredOn: event.target.value })
                }
              />
            </label>
            <label className='grid gap-1 text-sm'>
              <span>{t('assets.fields.originalCost')}</span>
              <Input
                value={form.originalCost}
                onChange={(event) =>
                  setForm({ ...form, originalCost: event.target.value })
                }
              />
            </label>
            <label className='grid gap-1 text-sm sm:col-span-2'>
              <span>{t('assets.fields.notes')}</span>
              <Textarea
                value={form.notes}
                onChange={(event) =>
                  setForm({ ...form, notes: event.target.value })
                }
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('assets.cancel')}
            </Button>
            <Button
              disabled={!form.name.trim() || save.isPending}
              onClick={() => save.mutate()}
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
              <>
                <Input
                  placeholder={t('assets.employeeSearch')}
                  value={employeeQuery}
                  onChange={(event) => setEmployeeQuery(event.target.value)}
                />
                <select
                  className={nativeSelectClass}
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                >
                  <option value=''>{t('assets.chooseEmployee')}</option>
                  {employees
                    .filter(
                      (employee) =>
                        employee.subjectId === action.row.subjectId &&
                        (!employeeQuery.trim() ||
                          employee.name
                            .toLowerCase()
                            .includes(employeeQuery.trim().toLowerCase()) ||
                          employee.code
                            .toLowerCase()
                            .includes(employeeQuery.trim().toLowerCase())),
                    )
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} · {employee.code}
                      </option>
                    ))}
                </select>
              </>
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
      <Dialog
        open={!!bulk}
        onOpenChange={(value) => {
          if (!value) {
            setBulk(null);
            setBulkEmployeeQuery('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulk === 'assign'
                ? t('assets.bulkAssign')
                : t('assets.bulkReturn')}
            </DialogTitle>
            <DialogDescription>
              {t('assets.bulkHint', { count: String(selected.length) })}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            {bulk === 'assign' ? (
              <>
                <Input
                  placeholder={t('assets.employeeSearch')}
                  value={bulkEmployeeQuery}
                  onChange={(event) =>
                    setBulkEmployeeQuery(event.target.value)
                  }
                />
                <select
                  className={nativeSelectClass}
                  value={bulkEmployeeId}
                  onChange={(event) => setBulkEmployeeId(event.target.value)}
                >
                  <option value=''>{t('assets.chooseEmployee')}</option>
                  {employees
                    .filter(
                      (employee) =>
                        !bulkEmployeeQuery.trim() ||
                        employee.name
                          .toLowerCase()
                          .includes(bulkEmployeeQuery.trim().toLowerCase()) ||
                        employee.code
                          .toLowerCase()
                          .includes(bulkEmployeeQuery.trim().toLowerCase()),
                    )
                    .map((employee) => (
                      <option key={employee.id} value={employee.id}>
                        {employee.name} · {employee.code}
                      </option>
                    ))}
                </select>
              </>
            ) : (
              <Input
                placeholder={t('assets.fields.location')}
                value={bulkLocation}
                onChange={(event) => setBulkLocation(event.target.value)}
              />
            )}
            <Textarea
              placeholder={t('assets.fields.notes')}
              value={bulkNote}
              onChange={(event) => setBulkNote(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setBulk(null)}>
              {t('assets.cancel')}
            </Button>
            <Button
              disabled={
                bulkAct.isPending ||
                (bulk === 'assign' && !bulkEmployeeId)
              }
              onClick={() => bulkAct.mutate()}
            >
              {t('assets.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!detailId}
        onOpenChange={(value) => {
          if (!value) setDetailId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assets.detailTitle')}</DialogTitle>
            <DialogDescription>{detail.data?.data.code ?? ''}</DialogDescription>
          </DialogHeader>
          {detail.data?.data ? (
            <>
              <div className='grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2'>
                <div>
                  <span className='text-muted-foreground'>
                    {t('assets.fields.name')}
                  </span>
                  <p>{detail.data.data.name}</p>
                </div>
                <div>
                  <span className='text-muted-foreground'>
                    {t('assets.fields.category')}
                  </span>
                  <p>
                    {detail.data.data.category
                      ? categoryLabel(detail.data.data.category)
                      : '—'}
                  </p>
                </div>
                <div>
                  <span className='text-muted-foreground'>
                    {t('assets.fields.status')}
                  </span>
                  <p>{t(`assets.status.${detail.data.data.status}`)}</p>
                </div>
                <div>
                  <span className='text-muted-foreground'>
                    {t('assets.fields.custodian')}
                  </span>
                  <p>{detail.data.data.custodian?.name ?? '—'}</p>
                </div>
                <div>
                  <span className='text-muted-foreground'>
                    {t('assets.fields.location')}
                  </span>
                  <p>{detail.data.data.location ?? '—'}</p>
                </div>
                <div>
                  <span className='text-muted-foreground'>
                    {t('assets.fields.originalCost')}
                  </span>
                  <p>
                    {detail.data.data.originalCost
                      ? `${detail.data.data.originalCost} ${detail.data.data.currency ?? ''}`
                      : '—'}
                  </p>
                </div>
                <div className='sm:col-span-2'>
                  <span className='text-muted-foreground'>
                    {t('assets.fields.notes')}
                  </span>
                  <p>{detail.data.data.notes ?? '—'}</p>
                </div>
              </div>
              <div className='mt-4'>
                <h3 className='mb-2 text-sm font-medium'>
                  {t('assets.events')}
                </h3>
                {detail.data.data.events.length ? (
                  <ul className='grid gap-2 text-sm'>
                    {detail.data.data.events.map((event) => (
                      <li
                        key={event.id}
                        className='rounded-md border p-2 text-xs'
                      >
                        <span className='font-medium'>
                          {t(`assets.event.${event.action}`)}
                        </span>
                        {event.fromStatus || event.toStatus ? (
                          <span className='ml-2 text-muted-foreground'>
                            {event.fromStatus ?? '—'} → {event.toStatus ?? '—'}
                          </span>
                        ) : null}
                        <span className='ml-2 text-muted-foreground'>
                          {new Date(event.createdAt).toLocaleString()}
                        </span>
                        {event.note ? (
                          <p className='mt-1 text-muted-foreground'>
                            {event.note}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('assets.noEvents')}
                  </p>
                )}
              </div>
            </>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('assets.loading')}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
