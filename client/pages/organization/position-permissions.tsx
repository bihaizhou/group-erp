import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Layers, Search, ShieldCheck } from 'lucide-react';
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

type Position = {
  id: string;
  code: string;
  name: string;
  unitName: string;
  permissionSetKeys: string[];
  memberCount: number;
  templateId: string | null;
  templateName: string;
  templateKeys: string[];
};
type PermissionSet = {
  key: string;
  title: string;
  grantCount: number;
};
type Template = {
  id: string;
  code: string;
  name: string;
  permissionSetKeys: string[];
  positionCount: number;
};
type Data = {
  positions: Position[];
  permissionSets: PermissionSet[];
  templates: Template[];
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function PositionEditor({
  position,
  sets,
  templates,
  onSaved,
}: {
  position: Position;
  sets: PermissionSet[];
  templates: Template[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toast = useToaster();
  const [draft, setDraft] = useState(
    () => new Set<string>(position.permissionSetKeys),
  );
  const [busy, setBusy] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [error, setError] = useState('');
  const changed =
    draft.size !== position.permissionSetKeys.length ||
    position.permissionSetKeys.some((key) => !draft.has(key));
  const titleOf = (key: string) =>
    sets.find((set) => set.key === key)?.title ?? key;

  const toggle = (key: string) => {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const linkTemplate = async (templateId: string) => {
    setTemplateBusy(true);
    setError('');
    try {
      const result = await api.request<{
        data: { members: number; granted: number; revoked: number };
      }>({
        path: `position-permissions/${position.id}/template`,
        method: 'PUT',
        json: { templateId: templateId || null },
      });
      await onSaved();
      toast.show({
        type: 'success',
        title: t('org.positionTemplateLinked', {
          members: result.data.members,
        }),
      });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setTemplateBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.request<{
        data: { granted: number; revoked: number };
      }>({
        path: `position-permissions/${position.id}`,
        method: 'PUT',
        json: { permissionSetKeys: [...draft] },
      });
      await onSaved();
      toast.show({
        type: 'success',
        title: t('org.positionPermissionSaved', {
          granted: result.data.granted,
          revoked: result.data.revoked,
        }),
      });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-lg'>
          <ShieldCheck className='size-4' />
          {position.name}
        </CardTitle>
        <CardDescription>{t('org.positionPermissionHint')}</CardDescription>
      </CardHeader>
      <CardContent className='grid gap-4'>
        <div className='grid gap-2 rounded-md border p-3'>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <label
              className='text-sm font-medium'
              htmlFor={`position-template-${position.id}`}
            >
              {t('org.positionTemplate')}
            </label>
            <select
              id={`position-template-${position.id}`}
              className='h-8 rounded-md border bg-background px-2 text-sm'
              value={position.templateId ?? ''}
              disabled={busy || templateBusy}
              onChange={(event) => void linkTemplate(event.target.value)}
            >
              <option value=''>{t('org.positionTemplateNone')}</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <p className='text-xs text-muted-foreground'>
            {position.templateId
              ? t('org.positionTemplateInherited', {
                  name: position.templateName,
                  keys:
                    position.templateKeys.map(titleOf).join('、') ||
                    t('org.positionTemplateNoKeys'),
                })
              : t('org.positionTemplateHint')}
          </p>
        </div>
        <div className='grid gap-2 sm:grid-cols-2'>
          {sets.map((set) => (
            <label
              key={set.key}
              className='flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm hover:bg-muted/50'
            >
              <input
                type='checkbox'
                className='mt-1 size-4 accent-primary'
                checked={draft.has(set.key)}
                onChange={() => toggle(set.key)}
              />
              <span>
                <span className='block font-medium'>{set.title}</span>
                <span className='block text-xs text-muted-foreground'>
                  {set.key} ·{' '}
                  {t('org.permissionGrantCount', {
                    count: set.grantCount,
                  })}
                </span>
              </span>
            </label>
          ))}
        </div>
        {error ? <p className='text-sm text-destructive'>{error}</p> : null}
        <div className='flex items-center justify-between gap-3'>
          <p className='text-xs text-muted-foreground'>
            {t('org.positionPermissionSyncHint', {
              count: position.memberCount,
            })}
          </p>
          <Button
            type='button'
            disabled={!changed || busy}
            onClick={() => void save()}
          >
            {busy ? t('org.saving') : t('org.save')}
          </Button>
        </div>
      </CardContent>
    </>
  );
}

const emptyForm = { id: '', code: '', name: '', keys: new Set<string>() };

function TemplateManager({
  templates,
  sets,
  onSaved,
}: {
  templates: Template[];
  sets: PermissionSet[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toast = useToaster();
  const [form, setForm] = useState<{
    id: string;
    code: string;
    name: string;
    keys: Set<string>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState('');
  const [error, setError] = useState('');

  const startNew = () => {
    setError('');
    setForm({ ...emptyForm, keys: new Set() });
  };
  const startEdit = (row: Template) => {
    setError('');
    setForm({
      id: row.id,
      code: row.code,
      name: row.name,
      keys: new Set(row.permissionSetKeys),
    });
  };
  const toggle = (key: string) =>
    setForm((current) => {
      if (!current) return current;
      const keys = new Set(current.keys);
      if (keys.has(key)) keys.delete(key);
      else keys.add(key);
      return { ...current, keys };
    });

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError('');
    try {
      if (form.id) {
        const result = await api.request<{
          data: { positions: number; members: number };
        }>({
          path: `position-permissions/templates/${form.id}`,
          method: 'PUT',
          json: { name: form.name.trim(), permissionSetKeys: [...form.keys] },
        });
        await onSaved();
        toast.show({
          type: 'success',
          title: t('org.positionTemplateUpdated', {
            positions: result.data.positions,
            members: result.data.members,
          }),
        });
      } else {
        await api.request({
          path: 'position-permissions/templates',
          method: 'POST',
          json: {
            code: form.code.trim(),
            name: form.name.trim(),
            permissionSetKeys: [...form.keys],
          },
        });
        await onSaved();
        toast.show({
          type: 'success',
          title: t('org.positionTemplateCreated'),
        });
      }
      setForm(null);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const canSave =
    form !== null &&
    form.name.trim().length > 0 &&
    form.keys.size > 0 &&
    (form.id.length > 0 || form.code.trim().length >= 2);

  const remove = async (row: Template) => {
    if (deleting !== row.id) {
      setDeleting(row.id);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.request({
        path: `position-permissions/templates/${row.id}`,
        method: 'DELETE',
      });
      await onSaved();
      toast.show({
        type: 'success',
        title: t('org.positionTemplateDeleted'),
      });
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
      setDeleting('');
    }
  };

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div className='grid gap-1'>
          <CardTitle className='flex items-center gap-2 text-base'>
            <Layers className='size-4' />
            {t('org.positionTemplates')}
          </CardTitle>
          <CardDescription>
            {t('org.positionTemplatesDescription')}
          </CardDescription>
        </div>
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={startNew}
        >
          {t('org.positionTemplateCreate')}
        </Button>
      </CardHeader>
      <CardContent className='grid gap-3'>
        {templates.length === 0 ? (
          <p className='text-sm text-muted-foreground'>
            {t('org.positionTemplateEmpty')}
          </p>
        ) : (
          templates.map((row) => (
            <div key={row.id} className='rounded-md border p-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='grid gap-1'>
                  <span className='text-sm font-medium'>{row.name}</span>
                  <span className='text-xs text-muted-foreground'>
                    {row.code} ·{' '}
                    {t('org.positionTemplateCount', {
                      count: row.positionCount,
                    })}{' '}
                    ·{' '}
                    {t('org.positionTemplateKeyCount', {
                      count: row.permissionSetKeys.length,
                    })}
                  </span>
                </div>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={busy}
                  onClick={() => startEdit(row)}
                >
                  {t('org.edit')}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  disabled={busy}
                  onClick={() => void remove(row)}
                >
                  {deleting === row.id
                    ? t('org.positionTemplateDeleteConfirm')
                    : t('org.positionTemplateDelete')}
                </Button>
              </div>
            </div>
          ))
        )}
        {form ? (
          <div className='grid gap-3 rounded-md border border-dashed p-3'>
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <span className='text-sm font-medium'>
                {form.id
                  ? t('org.positionTemplateEdit')
                  : t('org.positionTemplateCreate')}
              </span>
              <span className='text-xs text-muted-foreground'>
                {form.id ? form.code : null}
              </span>
            </div>
            {form.id ? null : (
              <Input
                value={form.code}
                placeholder={t('org.positionTemplateCode')}
                onChange={(event) =>
                  setForm((current) =>
                    current
                      ? { ...current, code: event.target.value }
                      : current,
                  )
                }
              />
            )}
            <Input
              value={form.name}
              placeholder={t('org.positionTemplateName')}
              onChange={(event) =>
                setForm((current) =>
                  current ? { ...current, name: event.target.value } : current,
                )
              }
            />
            <div className='grid gap-2 sm:grid-cols-2'>
              {sets.map((set) => (
                <label
                  key={set.key}
                  className='flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm hover:bg-muted/50'
                >
                  <input
                    type='checkbox'
                    className='mt-1 size-4 accent-primary'
                    checked={form.keys.has(set.key)}
                    onChange={() => toggle(set.key)}
                  />
                  <span className='text-xs'>
                    <span className='block font-medium'>{set.title}</span>
                    <span className='block text-muted-foreground'>
                      {set.key}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {error ? <p className='text-sm text-destructive'>{error}</p> : null}
            <div className='flex items-center justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => setForm(null)}
              >
                {t('org.cancel')}
              </Button>
              <Button
                type='button'
                disabled={!canSave || busy}
                onClick={() => void save()}
              >
                {busy ? t('org.saving') : t('org.save')}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function PositionPermissionsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const data = useQuery({
    retry: false,
    queryKey: ['position-permissions'],
    queryFn: ({ signal }) =>
      api.request<{ data: Data }>({
        path: 'position-permissions',
        signal,
      }),
  });
  const positions = data.data?.data.positions ?? [];
  const sets = data.data?.data.permissionSets ?? [];
  const templates = data.data?.data.templates ?? [];
  const selected =
    positions.find((position) => position.id === selectedId) ?? positions[0];
  const filtered = query.trim()
    ? positions.filter((position) =>
        [position.name, position.code, position.unitName]
          .join(' ')
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
    : positions;

  return (
    <PageContainer>
      <PageHeader
        title={t('org.positionPermissions')}
        description={t('org.positionPermissionsDescription')}
      />
      <div className='grid gap-4 xl:grid-cols-[320px_1fr]'>
        <Card className='self-start'>
          <CardHeader>
            <CardTitle className='flex items-center gap-2 text-base'>
              <KeyRound className='size-4' />
              {t('org.positions')}
            </CardTitle>
            <div className='relative'>
              <Search className='pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground' />
              <Input
                className='pl-8'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('org.positionSearch')}
              />
            </div>
          </CardHeader>
          <CardContent className='grid gap-1'>
            {data.isError ? (
              <p className='text-sm text-destructive'>{message(data.error)}</p>
            ) : data.isPending ? (
              <p className='text-sm text-muted-foreground'>
                {t('org.loading')}
              </p>
            ) : filtered.length ? (
              filtered.map((position) => (
                <button
                  key={position.id}
                  type='button'
                  className={`rounded-md px-3 py-2 text-left text-sm ${
                    position.id === selected?.id
                      ? 'bg-secondary text-secondary-foreground'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => setSelectedId(position.id)}
                >
                  <div className='font-medium'>{position.name}</div>
                  <div className='text-xs text-muted-foreground'>
                    {[position.code, position.unitName]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  <div className='mt-1 text-xs text-muted-foreground'>
                    {t('org.positionMembers', {
                      count: position.memberCount,
                    })}
                    {' · '}
                    {t('org.positionSetCount', {
                      count: position.permissionSetKeys.length,
                    })}
                  </div>
                </button>
              ))
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('org.noPositions')}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          {!selected ? (
            <CardContent className='py-10 text-sm text-muted-foreground'>
              {t('org.selectPosition')}
            </CardContent>
          ) : (
            <PositionEditor
              key={selected.id}
              position={selected}
              sets={sets}
              templates={templates}
              onSaved={async () => {
                await data.refetch();
              }}
            />
          )}
        </Card>
      </div>
      <div className='mt-4'>
        <TemplateManager
          templates={templates}
          sets={sets}
          onSaved={async () => {
            await data.refetch();
          }}
        />
      </div>
    </PageContainer>
  );
}
