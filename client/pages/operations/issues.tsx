import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { ReadOnlyNotice } from '#components/read-only-notice';
import { useSettingsAccess } from '#hooks/use-settings-access';
import { businessDate } from '#hooks/business-date';
import { operationsErrorKey } from './errors.js';
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
import type {
  OperationsIssue,
  OperationsIssuePage,
  OperationsOptions,
} from './model.js';
import { nativeSelectClass } from '#components/native-controls';

const today = () => businessDate();
const emptyForm = () => ({
  sourceType: 'other',
  title: '',
  description: '',
  severity: 'medium',
  ownerId: '',
  ownerName: '',
  dueAt: today(),
  businessDate: today(),
});

export default function OperationsIssuesPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [params] = useSearchParams(),
    subjectId = params.get('subjectId') ?? '';
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [closing, setClosing] = useState<OperationsIssue | null>(null);
  const [editing, setEditing] = useState<OperationsIssue | null>(null);
  const [editForm, setEditForm] = useState(() => ({
    severity: 'medium',
    ownerId: '',
    ownerName: '',
    dueAt: today(),
  }));
  const [resolution, setResolution] = useState('');
  const list = useQuery({
    retry: false,
    queryKey: ['operations-issues', subjectId, status, page],
    queryFn: ({ signal }) =>
      api.request<{ data: OperationsIssuePage }>({
        path: 'operations/issues',
        query: {
          ...(subjectId ? { subjectId: subjectId } : {}),
          ...(status ? { status } : {}),
          page,
          pageSize: 20,
        },
        signal,
      }),
  });
  const options = useQuery({
    retry: false,
    queryKey: ['operations-options'],
    queryFn: ({ signal }) =>
      api.request<{ data: OperationsOptions }>({
        path: 'operations/options',
        signal,
      }),
  });
  const positions = (options.data?.data.positions ?? []).filter(
    (position) => position.subjectId === subjectId,
  );
  const create = useMutation({
    mutationFn: () => {
      const { ownerId, ...fields } = form;
      return api.request({
        path: 'operations/issues',
        method: 'POST',
        json: {
          ...fields,
          subjectId,
          dueAt: form.dueAt,
          ...(ownerId ? { ownerId } : {}),
        },
      });
    },
    onSuccess: () => {
      setOpen(false);
      setForm(emptyForm());
      void queryClient.invalidateQueries({ queryKey: ['operations-issues'] });
      void queryClient.invalidateQueries({ queryKey: ['operations-overview'] });
    },
  });
  const update = useMutation({
    mutationFn: (input: {
      id: string;
      version: number;
      status?: string;
      resolution?: string;
      severity?: string;
      ownerId?: string;
      ownerName?: string;
      dueAt?: string;
    }) =>
      api.request({
        path: `operations/issues/${input.id}`,
        method: 'PATCH',
        json: {
          version: input.version,
          ...(input.status ? { status: input.status } : {}),
          ...(input.resolution !== undefined
            ? { resolution: input.resolution }
            : {}),
          ...(input.severity ? { severity: input.severity } : {}),
          ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
          ...(input.ownerName ? { ownerName: input.ownerName } : {}),
          ...(input.dueAt ? { dueAt: input.dueAt } : {}),
        },
      }),
    onSuccess: () => {
      setClosing(null);
      setEditing(null);
      setResolution('');
      void queryClient.invalidateQueries({ queryKey: ['operations-issues'] });
      void queryClient.invalidateQueries({ queryKey: ['operations-overview'] });
    },
  });
  const result = list.data?.data;
  const access = useSettingsAccess('operations');
  const error = create.error ?? update.error ?? list.error;
  const openEdit = (issue: OperationsIssue) => {
    setEditing(issue);
    setEditForm({
      severity: issue.severity,
      ownerId: issue.ownerId ?? '',
      ownerName: issue.ownerName,
      dueAt: issue.dueAt,
    });
  };
  const editPosition = positions.find(
    (position) => position.id === editForm.ownerId,
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('operations.issues')}
        description={t('operations.issuesDescription')}
        actions={
          access.canManage ? (
            <Button size='sm' onClick={() => setOpen(true)}>
              <Plus className='mr-2 size-4' />
              {t('operations.issueCreate')}
            </Button>
          ) : null
        }
      />
      <ReadOnlyNotice
        canManage={access.canManage}
        canApprove={access.canApprove}
      />
      <div className='flex flex-wrap items-end gap-3'>
        <label className='grid gap-1 text-sm'>
          <span className='text-muted-foreground'>
            {t('operations.issueStatusLabel')}
          </span>
          <select
            className={nativeSelectClass}
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value=''>{t('operations.issueAllStatuses')}</option>
            {(['open', 'in_progress', 'closed'] as const).map((value) => (
              <option key={value} value={value}>
                {t(`operations.issueStatus.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!status ? (
        <p className='text-sm text-muted-foreground'>
          {t('operations.issuesClosedHint')}
        </p>
      ) : null}
      {error ? (
        <p className='text-sm text-destructive'>
          {t(`operations.error.${operationsErrorKey(error)}`)}
        </p>
      ) : null}
      <div className='rounded-md border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('operations.issueCode')}</TableHead>
              <TableHead>{t('operations.issueTitle')}</TableHead>
              <TableHead>{t('operations.issueBusinessDate')}</TableHead>
              <TableHead>{t('operations.issueSourceLabel')}</TableHead>
              <TableHead>{t('operations.issueSeverityLabel')}</TableHead>
              <TableHead>{t('operations.issueOwner')}</TableHead>
              <TableHead>{t('operations.issueDue')}</TableHead>
              <TableHead>{t('operations.issueStatusLabel')}</TableHead>
              <TableHead>{t('operations.issueAction')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(result?.items ?? []).map((issue) => (
              <TableRow key={issue.id}>
                <TableCell className='font-mono text-xs'>
                  {issue.code}
                </TableCell>
                <TableCell>{issue.title}</TableCell>
                <TableCell>{issue.businessDate ?? '—'}</TableCell>
                <TableCell>
                  {t(`operations.issueSource.${issue.sourceType}`)}
                </TableCell>
                <TableCell>
                  {t(`operations.issueSeverity.${issue.severity}`)}
                </TableCell>
                <TableCell>{issue.ownerName}</TableCell>
                <TableCell>{issue.dueAt}</TableCell>
                <TableCell>
                  {t(`operations.issueStatus.${issue.status}`)}
                </TableCell>
                <TableCell>
                  {issue.status === 'closed' ? null : (
                    <div className='flex flex-wrap gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={update.isPending}
                        onClick={() => openEdit(issue)}
                      >
                        <Pencil className='mr-1 size-3.5' />
                        {t('operations.issueEdit')}
                      </Button>
                      {issue.status === 'open' ? (
                        <Button
                          variant='outline'
                          size='sm'
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({
                              id: issue.id,
                              version: issue.version,
                              status: 'in_progress',
                            })
                          }
                        >
                          {t('operations.issueStart')}
                        </Button>
                      ) : null}
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => setClosing(issue)}
                      >
                        {t('operations.issueClose')}
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {result && result.items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className='py-8 text-center text-muted-foreground'
                >
                  {t('operations.issuesEmpty')}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
      {result && result.total > 0 ? (
        <div className='flex items-center justify-end gap-2 text-sm'>
          <span className='text-muted-foreground'>
            {t('operations.issuesPagination', {
              page,
              pages: Math.ceil(result.total / result.pageSize),
              total: result.total,
            })}
          </span>
          {result.total > result.pageSize ? (
            <Button
              variant='outline'
              size='sm'
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {t('operations.previous')}
            </Button>
          ) : null}
          {result.total > result.pageSize ? (
            <Button
              variant='outline'
              size='sm'
              disabled={page >= Math.ceil(result.total / result.pageSize)}
              onClick={() => setPage((value) => value + 1)}
            >
              {t('operations.next')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('operations.issueCreate')}</DialogTitle>
            <DialogDescription>
              {t('operations.issueCreateDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <label className='grid gap-1 text-sm'>
              <span>{t('operations.issueTitle')}</span>
              <Input
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
              />
            </label>
            <label className='grid gap-1 text-sm'>
              <span>{t('operations.issueDescription')}</span>
              <Textarea
                value={form.description}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
              />
            </label>
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='grid gap-1 text-sm'>
                <span>{t('operations.issueSourceLabel')}</span>
                <select
                  className={nativeSelectClass}
                  value={form.sourceType}
                  onChange={(event) =>
                    setForm({ ...form, sourceType: event.target.value })
                  }
                >
                  {(
                    [
                      'production',
                      'warehouse',
                      'sales',
                      'procurement',
                      'people',
                      'hse',
                      'other',
                    ] as const
                  ).map((value) => (
                    <option key={value} value={value}>
                      {t(`operations.issueSource.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className='grid gap-1 text-sm'>
                <span>{t('operations.issueSeverityLabel')}</span>
                <select
                  className={nativeSelectClass}
                  value={form.severity}
                  onChange={(event) =>
                    setForm({ ...form, severity: event.target.value })
                  }
                >
                  {(['low', 'medium', 'high'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`operations.issueSeverity.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className='grid gap-1 text-sm'>
                <span>{t('operations.issueOwner')}</span>
                <select
                  className={nativeSelectClass}
                  value={form.ownerId}
                  onChange={(event) => {
                    const position = positions.find(
                      (item) => item.id === event.target.value,
                    );
                    setForm({
                      ...form,
                      ownerId: event.target.value,
                      ownerName: position?.name ?? '',
                    });
                  }}
                >
                  <option value=''>
                    {positions.length
                      ? t('operations.issueOwnerPlaceholder')
                      : t('operations.issueOwnerEmpty')}
                  </option>
                  {positions.map((position) => (
                    <option key={position.id} value={position.id}>
                      {position.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className='grid gap-1 text-sm'>
                <span>{t('operations.issueBusinessDate')}</span>
                <Input
                  type='date'
                  value={form.businessDate}
                  onChange={(event) =>
                    setForm({ ...form, businessDate: event.target.value })
                  }
                />
              </label>
              <label className='grid gap-1 text-sm'>
                <span>{t('operations.issueDue')}</span>
                <Input
                  type='date'
                  value={form.dueAt}
                  onChange={(event) =>
                    setForm({ ...form, dueAt: event.target.value })
                  }
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              {t('operations.cancel')}
            </Button>
            <Button
              disabled={
                create.isPending ||
                !subjectId ||
                !form.title.trim() ||
                !form.description.trim() ||
                !form.ownerId ||
                !form.ownerName.trim()
              }
              onClick={() => create.mutate()}
            >
              {t('operations.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(editing)}
        onOpenChange={(value) => !value && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('operations.issueEditTitle')}</DialogTitle>
            <DialogDescription>{editing?.title}</DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <label className='grid gap-1 text-sm'>
              <span>{t('operations.issueOwner')}</span>
              <select
                className={nativeSelectClass}
                value={editForm.ownerId}
                onChange={(event) => {
                  const position = positions.find(
                    (item) => item.id === event.target.value,
                  );
                  setEditForm({
                    ...editForm,
                    ownerId: event.target.value,
                    ownerName: position?.name ?? editForm.ownerName,
                  });
                }}
              >
                <option value=''>
                  {positions.length
                    ? t('operations.issueOwnerPlaceholder')
                    : t('operations.issueOwnerEmpty')}
                </option>
                {positions.map((position) => (
                  <option key={position.id} value={position.id}>
                    {position.name}
                  </option>
                ))}
              </select>
            </label>
            <div className='grid gap-3 sm:grid-cols-2'>
              <label className='grid gap-1 text-sm'>
                <span>{t('operations.issueSeverityLabel')}</span>
                <select
                  className={nativeSelectClass}
                  value={editForm.severity}
                  onChange={(event) =>
                    setEditForm({ ...editForm, severity: event.target.value })
                  }
                >
                  {(['low', 'medium', 'high'] as const).map((value) => (
                    <option key={value} value={value}>
                      {t(`operations.issueSeverity.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className='grid gap-1 text-sm'>
                <span>{t('operations.issueDue')}</span>
                <Input
                  type='date'
                  value={editForm.dueAt}
                  onChange={(event) =>
                    setEditForm({ ...editForm, dueAt: event.target.value })
                  }
                />
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setEditing(null)}>
              {t('operations.cancel')}
            </Button>
            <Button
              disabled={update.isPending || !editing}
              onClick={() => {
                if (!editing) return;
                update.mutate({
                  id: editing.id,
                  version: editing.version,
                  severity: editForm.severity,
                  dueAt: editForm.dueAt,
                  ...(editForm.ownerId
                    ? {
                        ownerId: editForm.ownerId,
                        ownerName:
                          editPosition?.name ?? editForm.ownerName,
                      }
                    : {}),
                });
              }}
            >
              {t('operations.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(closing)}
        onOpenChange={(value) => !value && setClosing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('operations.issueClose')}</DialogTitle>
            <DialogDescription>{closing?.title}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={resolution}
            placeholder={t('operations.issueResolution')}
            onChange={(event) => setResolution(event.target.value)}
          />
          <DialogFooter>
            <Button variant='outline' onClick={() => setClosing(null)}>
              {t('operations.cancel')}
            </Button>
            <Button
              disabled={update.isPending || !resolution.trim() || !closing}
              onClick={() => {
                if (!closing) return;
                update.mutate({
                  id: closing.id,
                  version: closing.version,
                  status: 'closed',
                  resolution,
                });
              }}
            >
              {t('operations.issueClose')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
