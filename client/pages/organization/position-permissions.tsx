import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { cn } from 'cn';
import {
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Checkbox } from '#components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import { Input } from '#components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import {
  effectivePermissionKeys,
  groupPermissionSets,
  isBroadPermissionSet,
  moduleLabelKey,
  permissionKeyDiff,
  type PositionSummary,
  type PermissionSetOption,
  type TemplateSummary,
} from './position-permissions-model.js';

type Data = {
  positions: PositionSummary[];
  permissionSets: PermissionSetOption[];
  templates: TemplateSummary[];
};

type SaveResult = {
  members: number;
  granted: number;
  revoked: number;
};

type PositionFilter = 'all' | 'staffed' | 'unconfigured';

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const sameKeys = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((key) => right.has(key));

function PermissionSetPicker({
  sets,
  selected,
  inherited,
  onToggle,
}: {
  sets: readonly PermissionSetOption[];
  selected: ReadonlySet<string>;
  inherited: ReadonlySet<string>;
  onToggle: (key: string, next: boolean) => void;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupPermissionSets(sets), [sets]);
  const [search, setSearch] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        groups
          .filter((group) =>
            group.sets.some(
              (set) => selected.has(set.key) || inherited.has(set.key),
            ),
          )
          .map((group) => group.id),
      ),
  );

  // A newly chosen template can bring in keys from modules the user has not
  // opened. Those groups are forced open in the render below, so inheriting a
  // key never hides it behind a collapsed module.
  const normalized = search.trim().toLowerCase();
  const prepared = groups
    .map((group) => {
      const shown = group.sets.filter((set) => {
        if (onlySelected && !selected.has(set.key) && !inherited.has(set.key))
          return false;
        if (!normalized) return true;
        return (
          set.title.toLowerCase().includes(normalized) ||
          set.key.toLowerCase().includes(normalized)
        );
      });
      return {
        ...group,
        shown,
        chosen: group.sets.filter((set) => selected.has(set.key)).length,
        inheritedCount: group.sets.filter((set) => inherited.has(set.key))
          .length,
      };
    })
    .filter((group) => group.shown.length > 0);

  const toggleGroup = (id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className='space-y-3'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <div className='relative w-full sm:max-w-xs'>
          <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('org.positionSetSearch')}
            className='pl-8'
            aria-label={t('org.positionSetSearch')}
          />
        </div>
        <label className='flex items-center gap-2 text-sm text-muted-foreground'>
          <Checkbox
            checked={onlySelected}
            onCheckedChange={(next) => setOnlySelected(next === true)}
          />
          {t('org.positionSetShowSelected')}
        </label>
      </div>

      {prepared.length === 0 ? (
        <p className='rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground'>
          {onlySelected
            ? t('org.positionSetNoSelected')
            : t('org.positionSetNoMatch')}
        </p>
      ) : (
        <div className='max-h-[26rem] divide-y overflow-y-auto rounded-lg border'>
          {prepared.map((group) => {
            const open =
              normalized.length > 0 ||
              onlySelected ||
              expanded.has(group.id) ||
              group.sets.some((set) => inherited.has(set.key));
            const chosen = group.sets.filter(
              (set) => selected.has(set.key) || inherited.has(set.key),
            ).length;
            return (
              <section key={group.id}>
                <button
                  type='button'
                  className='flex w-full items-center gap-2 bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/70'
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={open}
                >
                  {open ? (
                    <ChevronDown className='size-4 shrink-0 text-muted-foreground' />
                  ) : (
                    <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
                  )}
                  <span>{t(moduleLabelKey(group.id))}</span>
                  <span className='ml-auto text-xs font-normal text-muted-foreground tabular-nums'>
                    {chosen > 0
                      ? t('org.positionSetGroupChosen', {
                          chosen,
                          total: group.sets.length,
                        })
                      : t('org.positionSetGroupTotal', {
                          total: group.sets.length,
                        })}
                  </span>
                </button>
                {open ? (
                  <div className='divide-y'>
                    {group.shown.map((set) => {
                      const isInherited = inherited.has(set.key);
                      const isSelected = selected.has(set.key);
                      return (
                        <label
                          key={set.key}
                          title={`${set.title} · ${set.key}`}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/40',
                            isInherited &&
                              'cursor-default bg-muted/30 hover:bg-muted/30',
                          )}
                        >
                          <Checkbox
                            checked={isSelected || isInherited}
                            disabled={isInherited}
                            onCheckedChange={(next) =>
                              onToggle(set.key, next === true)
                            }
                            className='mt-0.5'
                          />
                          <span className='min-w-0 flex-1'>
                            <span className='flex flex-wrap items-center gap-x-2 gap-y-1'>
                              <span className='text-sm font-medium'>
                                {set.title}
                              </span>
                              {isInherited ? (
                                <Badge
                                  variant='secondary'
                                  className='h-5 px-1.5 text-[10px]'
                                >
                                  {t('org.positionSetInherited')}
                                </Badge>
                              ) : null}
                              {isBroadPermissionSet(set) ? (
                                <Badge
                                  variant='outline'
                                  className='h-5 border-destructive/40 px-1.5 text-[10px] text-destructive'
                                >
                                  {t('org.positionSetBroad')}
                                </Badge>
                              ) : null}
                            </span>
                            <span className='mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground'>
                              <span>
                                {t('org.positionSetPages', {
                                  count: set.pageCount,
                                })}
                              </span>
                              {set.actionCount > 0 ? (
                                <>
                                  <span aria-hidden>·</span>
                                  <span>
                                    {t('org.positionSetActions', {
                                      count: set.actionCount,
                                    })}
                                  </span>
                                </>
                              ) : null}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PositionEditor({
  position,
  sets,
  templates,
  onSaved,
  onDirtyChange,
}: {
  position: PositionSummary;
  sets: readonly PermissionSetOption[];
  templates: readonly TemplateSummary[];
  onSaved: () => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toast = useToaster();
  const [ownKeys, setOwnKeys] = useState<Set<string>>(
    () => new Set(position.permissionSetKeys),
  );
  const [templateId, setTemplateId] = useState(position.templateId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedTemplate = templates.find(
    (template) => template.id === templateId,
  );
  const templateItems = useMemo(
    () => [
      { value: 'none', label: t('org.positionTemplateNone') },
      ...templates.map((template) => ({
        value: template.id,
        label: template.name,
      })),
    ],
    [t, templates],
  );
  const inheritedKeys = useMemo(() => {
    if (selectedTemplate)
      return new Set<string>(selectedTemplate.permissionSetKeys);
    // Keep an already-linked template visible before the templates list has
    // refreshed, otherwise the inherited rows would briefly disappear.
    if (position.templateId && position.templateId === templateId)
      return new Set<string>(position.templateKeys);
    return new Set<string>();
  }, [
    position.templateId,
    position.templateKeys,
    selectedTemplate,
    templateId,
  ]);

  const initialOwn = useMemo(
    () => new Set(position.permissionSetKeys),
    [position.permissionSetKeys],
  );
  const initialTemplate = position.templateId ?? '';
  const ownChanged = !sameKeys(ownKeys, initialOwn);
  const templateChanged = templateId !== initialTemplate;
  const dirty = ownChanged || templateChanged;

  const initialEffective = useMemo(
    () =>
      effectivePermissionKeys(
        position.permissionSetKeys,
        position.templateKeys,
      ),
    [position.permissionSetKeys, position.templateKeys],
  );
  const nextEffective = useMemo(
    () => effectivePermissionKeys(ownKeys, inheritedKeys),
    [inheritedKeys, ownKeys],
  );
  const diff = useMemo(
    () => permissionKeyDiff(initialEffective, nextEffective),
    [initialEffective, nextEffective],
  );

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const titles = useMemo(
    () => new Map(sets.map((set) => [set.key, set.title])),
    [sets],
  );
  const broadKeys = sets
    .filter((set) => ownKeys.has(set.key) && isBroadPermissionSet(set))
    .map((set) => set.title);

  const toggle = (key: string, next: boolean) => {
    setOwnKeys((previous) => {
      const value = new Set(previous);
      if (next) value.add(key);
      else value.delete(key);
      return value;
    });
  };

  const reset = () => {
    setOwnKeys(new Set(position.permissionSetKeys));
    setTemplateId(initialTemplate);
    setError('');
  };

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.request<{ data: SaveResult }>({
        path: `position-permissions/${position.id}`,
        method: 'PUT',
        json: {
          permissionSetKeys: [...ownKeys],
          templateId: templateId || null,
        },
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
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const changeText =
    diff.added.length || diff.removed.length
      ? t('org.positionPermissionChanges', {
          added: diff.added.length,
          removed: diff.removed.length,
        })
      : t('org.positionTemplateChanged');

  return (
    <>
      <CardHeader className='border-b'>
        <div className='flex flex-wrap items-start justify-between gap-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <ShieldCheck className='size-5 shrink-0 text-muted-foreground' />
              <CardTitle className='truncate text-lg'>
                {position.name}
              </CardTitle>
            </div>
            <CardDescription className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1'>
              <span>{position.code}</span>
              <span aria-hidden>·</span>
              <span>{position.unitName || t('org.positionUnitUngrouped')}</span>
              <span aria-hidden>·</span>
              <span>
                {t('org.positionMembers', { count: position.memberCount })}
              </span>
            </CardDescription>
          </div>
          {dirty ? (
            <Badge variant='secondary'>{t('org.positionUnsaved')}</Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className='space-y-5'>
        {error ? (
          <p
            role='alert'
            className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive'
          >
            {error}
          </p>
        ) : null}

        <section className='rounded-lg border bg-muted/20 p-4'>
          <div className='flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between'>
            <div className='min-w-0'>
              <h2 className='flex items-center gap-2 text-sm font-medium'>
                <Layers className='size-4 text-muted-foreground' />
                {t('org.positionTemplate')}
              </h2>
              <p className='mt-1 max-w-xl text-xs leading-5 text-muted-foreground'>
                {t('org.positionTemplateHint')}
              </p>
            </div>
            <Select
              items={templateItems}
              value={templateId || 'none'}
              onValueChange={(value) =>
                setTemplateId(!value || value === 'none' ? '' : value)
              }
            >
              <SelectTrigger
                className='w-full sm:w-80'
                size='sm'
                aria-label={t('org.positionTemplate')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='none'>
                  {t('org.positionTemplateNone')}
                </SelectItem>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name} · {template.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {templates.length === 0 ? (
            <p className='mt-3 text-xs text-muted-foreground'>
              {t('org.positionTemplateNoneAvailable')}
            </p>
          ) : null}

          {selectedTemplate ? (
            <div className='mt-3 rounded-md border bg-background p-3'>
              <div className='flex flex-wrap items-center justify-between gap-2'>
                <div className='flex min-w-0 flex-wrap items-center gap-2 text-sm'>
                  <span className='truncate font-medium'>
                    {selectedTemplate.name}
                  </span>
                  <Badge variant='outline' className='font-mono text-[11px]'>
                    {selectedTemplate.code}
                  </Badge>
                  <Badge variant='secondary'>
                    {t('org.positionSetKeyCount', {
                      count: selectedTemplate.permissionSetKeys.length,
                    })}
                  </Badge>
                </div>
                <span className='text-xs text-muted-foreground'>
                  {t('org.positionTemplatePositionCount', {
                    count: selectedTemplate.positionCount,
                  })}
                </span>
              </div>
              <div className='mt-2 flex flex-wrap gap-1.5'>
                {selectedTemplate.permissionSetKeys.length ? (
                  selectedTemplate.permissionSetKeys.map((key) => (
                    <Badge key={key} variant='outline' className='font-normal'>
                      {titles.get(key) ?? key}
                    </Badge>
                  ))
                ) : (
                  <span className='text-xs text-muted-foreground'>
                    {t('org.positionTemplateNoKeys')}
                  </span>
                )}
              </div>
              <p className='mt-2 text-xs text-muted-foreground'>
                {t('org.positionTemplateChangeHint')}
              </p>
            </div>
          ) : null}
        </section>

        <section className='space-y-3'>
          <div className='flex flex-wrap items-center gap-x-3 gap-y-1'>
            <h2 className='text-sm font-medium'>
              {t('org.positionDirectGrants')}
            </h2>
            <Badge variant='outline'>
              {t('org.positionSetKeyCount', { count: ownKeys.size })}
            </Badge>
            {inheritedKeys.size > 0 ? (
              <span className='text-xs text-muted-foreground'>
                {t('org.positionInheritedCount', {
                  count: inheritedKeys.size,
                })}
              </span>
            ) : null}
            {ownKeys.size > 0 ? (
              <Button
                type='button'
                variant='ghost'
                size='xs'
                className='ml-auto'
                onClick={() => setOwnKeys(new Set())}
              >
                {t('org.positionClearDirect')}
              </Button>
            ) : null}
          </div>
          <p className='text-xs leading-5 text-muted-foreground'>
            {t('org.positionDirectGrantsHint')}
          </p>
          <PermissionSetPicker
            sets={sets}
            selected={ownKeys}
            inherited={inheritedKeys}
            onToggle={toggle}
          />
          {broadKeys.length > 0 ? (
            <p className='rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive'>
              {t('org.positionBroadWarning', {
                names: broadKeys.join('、'),
              })}
            </p>
          ) : null}
        </section>
      </CardContent>

      <CardFooter className='sticky bottom-0 z-10 flex-col items-stretch gap-3 rounded-b-xl border-t bg-card/95 backdrop-blur sm:flex-row sm:items-center sm:justify-between'>
        <div className='min-w-0 text-xs text-muted-foreground'>
          <p>
            {position.memberCount > 0
              ? t('org.positionPermissionSyncHint', {
                  count: position.memberCount,
                })
              : t('org.positionNoMembersSync')}
          </p>
          <p
            className={cn(
              'mt-1',
              dirty ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {dirty ? changeText : t('org.positionNoChanges')}
          </p>
        </div>
        <div className='flex w-full gap-2 sm:w-auto'>
          {dirty ? (
            <Button
              type='button'
              variant='outline'
              className='flex-1 sm:flex-none'
              onClick={reset}
              disabled={busy}
            >
              {t('org.positionDiscard')}
            </Button>
          ) : null}
          <Button
            type='button'
            className='flex-1 sm:flex-none'
            onClick={() => void save()}
            disabled={!dirty || busy}
          >
            {busy ? t('org.saving') : t('org.save')}
          </Button>
        </div>
      </CardFooter>
    </>
  );
}

function TemplateForm({
  template,
  sets,
  onDone,
  onCancel,
}: {
  template?: TemplateSummary;
  sets: readonly PermissionSetOption[];
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toast = useToaster();
  const [name, setName] = useState(template?.name ?? '');
  const [code, setCode] = useState(template?.code ?? '');
  const [keys, setKeys] = useState<Set<string>>(
    () => new Set(template?.permissionSetKeys ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const noInherited = useMemo(() => new Set<string>(), []);
  const canSave =
    name.trim().length > 0 &&
    keys.size > 0 &&
    (Boolean(template) || code.trim().length >= 2);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || busy) return;
    setBusy(true);
    setError('');
    try {
      if (template) {
        const result = await api.request<{
          data: { positions: number; members: number };
        }>({
          path: `position-permissions/templates/${template.id}`,
          method: 'PUT',
          json: { name: name.trim(), permissionSetKeys: [...keys] },
        });
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
            code: code.trim().toUpperCase(),
            name: name.trim(),
            permissionSetKeys: [...keys],
          },
        });
        toast.show({
          type: 'success',
          title: t('org.positionTemplateCreated'),
        });
      }
      await onDone();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className='space-y-4' onSubmit={(event) => void submit(event)}>
      <div className='grid gap-3 sm:grid-cols-2'>
        <label className='grid gap-1.5 text-sm'>
          <span className='font-medium'>{t('org.positionTemplateName')}</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('org.positionTemplateNamePlaceholder')}
            autoFocus
          />
        </label>
        <label className='grid gap-1.5 text-sm'>
          <span className='font-medium'>{t('org.positionTemplateCode')}</span>
          <Input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={t('org.positionTemplateCodePlaceholder')}
            className='font-mono'
            disabled={Boolean(template)}
          />
        </label>
      </div>
      <div className='space-y-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm font-medium'>
            {t('org.positionTemplateKeys')}
          </span>
          <Badge variant='outline'>
            {t('org.positionSetKeyCount', { count: keys.size })}
          </Badge>
        </div>
        <PermissionSetPicker
          sets={sets}
          selected={keys}
          inherited={noInherited}
          onToggle={(key, next) =>
            setKeys((previous) => {
              const value = new Set(previous);
              if (next) value.add(key);
              else value.delete(key);
              return value;
            })
          }
        />
        <p className='text-xs text-muted-foreground'>
          {t('org.positionTemplateSyncHint')}
        </p>
      </div>
      {error ? (
        <p role='alert' className='text-sm text-destructive'>
          {error}
        </p>
      ) : null}
      <div className='flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end'>
        <Button
          type='button'
          variant='outline'
          onClick={onCancel}
          disabled={busy}
        >
          {t('org.cancel')}
        </Button>
        <Button type='submit' disabled={!canSave || busy}>
          {busy ? t('org.saving') : t('org.positionTemplateSave')}
        </Button>
      </div>
    </form>
  );
}

function TemplateManager({
  open,
  onOpenChange,
  templates,
  sets,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: readonly TemplateSummary[];
  sets: readonly PermissionSetOption[];
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toast = useToaster();
  const [mode, setMode] = useState<
    'list' | 'create' | { edit: TemplateSummary }
  >('list');
  const [deleting, setDeleting] = useState<TemplateSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setMode('list');
      setDeleting(null);
      setDeleteError('');
    }
    onOpenChange(next);
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setBusy(true);
    setDeleteError('');
    try {
      await api.request({
        path: `position-permissions/templates/${deleting.id}`,
        method: 'DELETE',
      });
      toast.show({ type: 'success', title: t('org.positionTemplateDeleted') });
      setDeleting(null);
      await onChanged();
    } catch (cause) {
      setDeleteError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('org.positionTemplates')}</DialogTitle>
          <DialogDescription>
            {t('org.positionTemplatesDescription')}
          </DialogDescription>
        </DialogHeader>

        {mode === 'list' ? (
          <div className='space-y-3'>
            <div className='flex items-center justify-between gap-2'>
              <p className='text-sm text-muted-foreground'>
                {t('org.positionTemplateTotal', { count: templates.length })}
              </p>
              <Button type='button' size='sm' onClick={() => setMode('create')}>
                <Plus className='size-4' />
                {t('org.positionTemplateCreate')}
              </Button>
            </div>
            {templates.length === 0 ? (
              <p className='rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground'>
                {t('org.positionTemplateEmpty')}
              </p>
            ) : (
              <div className='max-h-[55vh] space-y-2 overflow-y-auto pr-1'>
                {templates.map((template) => (
                  <div
                    key={template.id}
                    className='rounded-lg border p-3 transition-colors hover:bg-muted/30'
                  >
                    <div className='flex flex-wrap items-start justify-between gap-2'>
                      <div className='min-w-0'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='font-medium'>{template.name}</span>
                          <Badge
                            variant='outline'
                            className='font-mono text-[11px]'
                          >
                            {template.code}
                          </Badge>
                        </div>
                        <p className='mt-1 text-xs text-muted-foreground'>
                          {t('org.positionTemplatePositionCount', {
                            count: template.positionCount,
                          })}
                          {' · '}
                          {t('org.positionSetKeyCount', {
                            count: template.permissionSetKeys.length,
                          })}
                        </p>
                      </div>
                      <div className='flex shrink-0 items-center gap-1'>
                        <Button
                          type='button'
                          variant='ghost'
                          size='xs'
                          onClick={() => setMode({ edit: template })}
                        >
                          {t('org.edit')}
                        </Button>
                        <Button
                          type='button'
                          variant='ghost'
                          size='xs'
                          className='text-destructive hover:text-destructive'
                          onClick={() => {
                            setDeleteError('');
                            setDeleting(template);
                          }}
                          aria-label={t('org.positionTemplateDeleteNamed', {
                            name: template.name,
                          })}
                        >
                          <Trash2 className='size-3.5' />
                        </Button>
                      </div>
                    </div>
                    <div className='mt-2 flex flex-wrap gap-1'>
                      {template.permissionSetKeys.slice(0, 6).map((key) => (
                        <Badge
                          key={key}
                          variant='secondary'
                          className='font-normal'
                        >
                          {sets.find((set) => set.key === key)?.title ?? key}
                        </Badge>
                      ))}
                      {template.permissionSetKeys.length > 6 ? (
                        <Badge variant='outline'>
                          +{template.permissionSetKeys.length - 6}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <TemplateForm
            key={mode === 'create' ? 'create' : mode.edit.id}
            template={mode === 'create' ? undefined : mode.edit}
            sets={sets}
            onDone={async () => {
              await onChanged();
              setMode('list');
            }}
            onCancel={() => setMode('list')}
          />
        )}

        <AlertDialog
          open={Boolean(deleting)}
          onOpenChange={(next) => {
            if (!next) {
              setDeleting(null);
              setDeleteError('');
            }
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('org.positionTemplateDeleteTitle', {
                  name: deleting?.name ?? '',
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('org.positionTemplateDeleteDescription', {
                  count: deleting?.positionCount ?? 0,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {deleteError ? (
              <p role='alert' className='text-sm text-destructive'>
                {deleteError}
              </p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>
                {t('org.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                disabled={busy}
                onClick={() => void confirmDelete()}
              >
                {busy ? t('org.saving') : t('org.positionTemplateDelete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

export default function PositionPermissionsPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<PositionFilter>('all');
  const filterItems = useMemo(
    () => [
      { value: 'all', label: t('org.positionFilterAll') },
      { value: 'staffed', label: t('org.positionFilterStaffed') },
      {
        value: 'unconfigured',
        label: t('org.positionFilterUnconfigured'),
      },
    ],
    [t],
  );
  const [selectedId, setSelectedId] = useState('');
  const [dirty, setDirty] = useState(false);
  const [pendingId, setPendingId] = useState('');
  const [templatesOpen, setTemplatesOpen] = useState(false);

  const query = useQuery({
    retry: false,
    queryKey: ['position-permissions'],
    queryFn: ({ signal }) =>
      api.request<{ data: Data }>({
        path: 'position-permissions',
        signal,
      }),
  });
  const positions = query.data?.data.positions ?? [];
  const sets = query.data?.data.permissionSets ?? [];
  const templates = query.data?.data.templates ?? [];
  const selected =
    positions.find((position) => position.id === selectedId) ?? positions[0];

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const requestSelect = (id: string) => {
    if (id === selected?.id) return;
    if (dirty) {
      setPendingId(id);
      return;
    }
    setSelectedId(id);
    setDirty(false);
  };

  const confirmDiscard = () => {
    if (pendingId) setSelectedId(pendingId);
    setPendingId('');
    setDirty(false);
  };

  const normalized = search.trim().toLowerCase();
  const filtered = positions.filter((position) => {
    if (filter === 'staffed' && position.memberCount === 0) return false;
    if (
      filter === 'unconfigured' &&
      (position.permissionSetKeys.length > 0 || Boolean(position.templateId))
    )
      return false;
    if (!normalized) return true;
    return [position.name, position.code, position.unitName]
      .join(' ')
      .toLowerCase()
      .includes(normalized);
  });
  const grouped = new Map<string, PositionSummary[]>();
  for (const position of filtered) {
    const unit = position.unitName || t('org.positionUnitUngrouped');
    grouped.set(unit, [...(grouped.get(unit) ?? []), position]);
  }
  const unitGroups = [...grouped.entries()].sort(([left], [right]) => {
    const ungrouped = t('org.positionUnitUngrouped');
    if (left === ungrouped) return 1;
    if (right === ungrouped) return -1;
    return left.localeCompare(right, 'zh-CN');
  });

  return (
    <PageContainer>
      <PageHeader
        title={t('org.positionPermissions')}
        description={t('org.positionPermissionsDescription')}
        actions={
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => setTemplatesOpen(true)}
          >
            <Layers className='size-4' />
            {t('org.positionTemplateManage')}
          </Button>
        }
      />

      <div className='grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]'>
        <Card className='min-w-0 self-start'>
          <CardHeader className='gap-3'>
            <div className='flex items-center justify-between gap-2'>
              <CardTitle className='text-base'>{t('org.positions')}</CardTitle>
              <span className='text-xs text-muted-foreground tabular-nums'>
                {t('org.positionTotal', { count: positions.length })}
              </span>
            </div>
            <div className='relative'>
              <Search className='pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input
                className='pl-8'
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('org.positionSearch')}
                aria-label={t('org.positionSearch')}
              />
            </div>
            <Select
              items={filterItems}
              value={filter}
              onValueChange={(value) => setFilter(value as PositionFilter)}
            >
              <SelectTrigger
                size='sm'
                className='w-full'
                aria-label={t('org.positionFilterLabel')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>
                  {t('org.positionFilterAll')}
                </SelectItem>
                <SelectItem value='staffed'>
                  {t('org.positionFilterStaffed')}
                </SelectItem>
                <SelectItem value='unconfigured'>
                  {t('org.positionFilterUnconfigured')}
                </SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent className='grid gap-3 xl:max-h-[calc(100vh-20rem)] xl:overflow-y-auto'>
            {query.isError ? (
              <p className='text-sm text-destructive'>
                {errorMessage(query.error)}
              </p>
            ) : query.isPending ? (
              <p className='text-sm text-muted-foreground'>
                {t('org.loading')}
              </p>
            ) : unitGroups.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {t('org.noPositions')}
              </p>
            ) : (
              unitGroups.map(([unit, unitPositions]) => (
                <div key={unit} className='space-y-1'>
                  <p className='sticky top-0 z-10 bg-card px-1 py-1 text-xs font-medium text-muted-foreground'>
                    {unit}
                    <span className='ml-1.5 font-normal tabular-nums'>
                      {unitPositions.length}
                    </span>
                  </p>
                  {unitPositions.map((position) => {
                    const isSelected = position.id === selected?.id;
                    const effectiveCount = new Set([
                      ...position.permissionSetKeys,
                      ...position.templateKeys,
                    ]).size;
                    return (
                      <button
                        key={position.id}
                        type='button'
                        aria-current={isSelected ? 'true' : undefined}
                        className={cn(
                          'w-full rounded-md border px-3 py-2.5 text-left transition-colors',
                          isSelected
                            ? 'border-primary/40 bg-secondary text-secondary-foreground'
                            : 'border-transparent hover:bg-muted',
                        )}
                        onClick={() => requestSelect(position.id)}
                      >
                        <span className='flex items-center justify-between gap-2'>
                          <span className='truncate text-sm font-medium'>
                            {position.name}
                          </span>
                          {isSelected && dirty ? (
                            <span
                              className='size-1.5 shrink-0 rounded-full bg-primary'
                              aria-label={t('org.positionUnsaved')}
                            />
                          ) : null}
                        </span>
                        <span className='mt-0.5 block truncate text-xs text-muted-foreground'>
                          {position.code}
                        </span>
                        <span className='mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground'>
                          <span>
                            {t('org.positionMembers', {
                              count: position.memberCount,
                            })}
                          </span>
                          <span aria-hidden>·</span>
                          <span>
                            {t('org.positionEffectiveCount', {
                              count: effectiveCount,
                            })}
                          </span>
                        </span>
                        {position.templateId ? (
                          <span className='mt-1 flex items-center gap-1 text-xs text-muted-foreground'>
                            <Layers className='size-3 shrink-0' />
                            <span className='truncate'>
                              {position.templateName}
                            </span>
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className='min-w-0'>
          {!selected ? (
            <CardContent className='py-12 text-center text-sm text-muted-foreground'>
              {t('org.selectPosition')}
            </CardContent>
          ) : (
            <PositionEditor
              key={selected.id}
              position={selected}
              sets={sets}
              templates={templates}
              onSaved={async () => {
                await query.refetch();
              }}
              onDirtyChange={setDirty}
            />
          )}
        </Card>
      </div>

      <TemplateManager
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        templates={templates}
        sets={sets}
        onChanged={async () => {
          await query.refetch();
        }}
      />

      <AlertDialog
        open={Boolean(pendingId)}
        onOpenChange={(next) => {
          if (!next) setPendingId('');
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('org.positionDiscardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('org.positionDiscardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('org.positionKeepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDiscard}>
              {t('org.positionDiscard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
