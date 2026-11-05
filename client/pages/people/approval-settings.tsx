import { useMemo, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ApiClientError,
  createUuid,
  useApiClient,
  useToaster,
} from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  MoreHorizontal,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Alert, AlertDescription } from '#components/ui/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#components/ui/tooltip';
import { cn } from 'cn';
import { PeopleLoading, PeopleErrorNotice, PeopleSelect } from './controls.js';
import { ChecklistSettings } from './checklist-settings.js';
import { usePeopleError } from './hooks.js';

const changeTypes = [
  'entry',
  'transfer',
  'partTime',
  'endPartTime',
  'exit',
  'regularize',
] as const;
type ChangeType = (typeof changeTypes)[number];
const selectionTypes = ['role', 'user', 'position'] as const;
type SelectionType = (typeof selectionTypes)[number];
type Selection = { type: SelectionType; referenceId: string };
type Stage = {
  key: string;
  title: string;
  mode: 'any' | 'all';
  selections: Selection[];
  subjectIds: string[];
};
type Chains = Record<string, { stages: Stage[] }>;
type ChecklistItem = {
  key: string;
  title: string;
  owner: string;
  assets?: boolean;
};
type Checklists = Record<string, ChecklistItem[]>;
type Settings = {
  revision: number;
  values: { approvalChains: Chains; checklists: Checklists };
  defaults: { approvalChains: Chains; checklists: Checklists };
  options: {
    roles: { key: string; title: string }[];
    accounts: { id: string; name: string; code: string }[];
    companies: { id: string; name: string }[];
    positions: { id: string; name: string; subjectName: string }[];
  };
};
const emptyStage = (title: string): Stage => ({
  key: createUuid(),
  title,
  mode: 'any',
  selections: [],
  subjectIds: [],
});

export default function ApprovalSettingsPage() {
  const { t } = useTranslation(),
    api = useApiClient();
  const data = useQuery({
    retry: false,
    queryKey: ['people-approval-settings'],
    queryFn: ({ signal }) =>
      api.request<{ data: Settings }>({
        path: 'people/approval-settings',
        signal,
      }),
  });
  const header = (
    <PageHeader
      title={t('people.approvalSettings')}
      description={t('people.approvalSettingsDescription')}
    />
  );
  return (
    <PageContainer>
      {data.isError ? (
        <>
          {header}
          <PeopleErrorNotice
            error={data.error}
            retry={() => void data.refetch()}
          />
        </>
      ) : !data.data ? (
        <>
          {header}
          <PeopleLoading />
        </>
      ) : (
        <ApprovalEditor
          key={data.data.data.revision}
          settings={data.data.data}
        />
      )}
    </PageContainer>
  );
}

function ApprovalEditor({ settings }: { settings: Settings }) {
  const { t } = useTranslation(),
    api = useApiClient(),
    toaster = useToaster(),
    errorText = usePeopleError();
  const [chains, setChains] = useState<Chains>(() =>
      structuredClone(settings.values.approvalChains),
    ),
    [checklists, setChecklists] = useState<Checklists>(() =>
      structuredClone(
        settings.values.checklists ?? settings.defaults.checklists,
      ),
    ),
    [section, setSection] = useState<'chains' | 'checklists'>('chains'),
    [active, setActive] = useState<ChangeType>('entry'),
    [revision, setRevision] = useState(settings.revision),
    [saved, setSaved] = useState(() =>
      JSON.stringify({
        chains: settings.values.approvalChains,
        checklists: settings.values.checklists ?? settings.defaults.checklists,
      }),
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>(),
    [invalid, setInvalid] = useState<{
      section: 'chains' | 'checklists';
      type: ChangeType;
      key: string;
      message: string;
    } | null>(null);
  const options = settings.options,
    roleItems = useMemo(
      () =>
        options.roles.map((role) => ({
          value: role.key,
          label: role.title || role.key,
        })),
      [options.roles],
    ),
    accountItems = useMemo(
      () =>
        options.accounts.map((account) => ({
          value: account.id,
          label: account.code
            ? `${account.name}（${account.code}）`
            : account.name,
        })),
      [options.accounts],
    ),
    positionItems = useMemo(
      () =>
        options.positions.map((position) => ({
          value: position.id,
          label: position.subjectName
            ? `${position.subjectName} · ${position.name}`
            : position.name,
        })),
      [options.positions],
    ),
    companyItems = useMemo(
      () => [
        { value: 'all', label: t('people.approvalAllCompanies') },
        ...options.companies.map((company) => ({
          value: company.id,
          label: company.name,
        })),
      ],
      [options.companies, t],
    );
  const sourceItems = {
      role: roleItems,
      user: accountItems,
      position: positionItems,
    },
    fieldItems = (type: SelectionType) => sourceItems[type],
    sourceLabel = (type: SelectionType) => t(`people.approvalSources.${type}`),
    typeLabel = (type: ChangeType) => t(`people.career.change.${type}`);
  const chain = chains[active]?.stages ?? [],
    checklist = checklists[active] ?? [],
    dirty = JSON.stringify({ chains, checklists }) !== saved,
    savedState = JSON.parse(saved) as {
      chains: Chains;
      checklists: Checklists;
    },
    dirtyTypes = new Set(
      changeTypes.filter((type) => {
        const current = section === 'chains' ? chains[type] : checklists[type],
          before =
            section === 'chains'
              ? savedState.chains[type]
              : savedState.checklists[type];
        return (
          JSON.stringify(current ?? null) !== JSON.stringify(before ?? null)
        );
      }),
    );
  const update = (stages: Stage[]) =>
    setChains((current) => ({ ...current, [active]: { stages } }));
  const updateStage = (index: number, patch: Partial<Stage>) => {
    if (invalid?.section === 'chains' && invalid.key === chain[index]?.key)
      setInvalid(null);
    update(
      chain.map((stage, i) => (i === index ? { ...stage, ...patch } : stage)),
    );
  };
  const move = (index: number, delta: number) => {
    const next = [...chain],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };
  const focusStage = (key: string) =>
    window.setTimeout(() => {
      document
        .getElementById(`stage-${key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.getElementById(`stage-title-${key}`)?.focus();
    }, 0);
  const addStage = () => {
    const stage = emptyStage(
      t('people.approvalStageDefault', { index: chain.length + 1 }),
    );
    update([...chain, stage]);
    focusStage(stage.key);
  };
  const removeStage = (index: number) => {
    if (chain.length === 1) return;
    update(chain.filter((_, i) => i !== index));
    if (invalid?.key === chain[index]?.key) setInvalid(null);
  };
  const addSelection = (index: number) => {
    const stage = chain[index],
      type: SelectionType = 'role',
      referenceId = fieldItems(type)[0]?.value;
    if (!referenceId) return;
    updateStage(index, {
      selections: [...stage.selections, { type, referenceId }],
    });
  };
  const changeSelection = (
    index: number,
    position: number,
    patch: Partial<Selection>,
  ) => {
    const stage = chain[index],
      selections = stage.selections.map((selection, i) => {
        if (i !== position) return selection;
        const next = { ...selection, ...patch };
        if (
          patch.type &&
          !fieldItems(patch.type).some(
            (item) => item.value === next.referenceId,
          )
        )
          next.referenceId = fieldItems(patch.type)[0]?.value ?? '';
        return next;
      });
    updateStage(index, { selections });
  };
  const removeSelection = (index: number, position: number) =>
    updateStage(index, {
      selections: chain[index].selections.filter((_, i) => i !== position),
    });
  const reset = () => {
    setChains(structuredClone(settings.values.approvalChains));
    setChecklists(
      structuredClone(
        settings.values.checklists ?? settings.defaults.checklists,
      ),
    );
    setInvalid(null);
    setError(undefined);
  };
  const validate = () => {
    for (const type of changeTypes) {
      for (const [index, stage] of (chains[type]?.stages ?? []).entries()) {
        if (!stage.title.trim())
          return {
            section: 'chains' as const,
            type,
            key: stage.key,
            message: t('people.approvalTitleRequired', { index: index + 1 }),
          };
        if (
          !stage.selections.length ||
          stage.selections.some((selection) => !selection.referenceId)
        )
          return {
            section: 'chains' as const,
            type,
            key: stage.key,
            message: t('people.approvalReviewerRequired', { index: index + 1 }),
          };
      }
      for (const item of checklists[type] ?? [])
        if (!item.title.trim())
          return {
            section: 'checklists' as const,
            type,
            key: item.key,
            message: t('people.checklist.itemTitleRequired'),
          };
    }
    return null;
  };
  const save = async () => {
    const problem = validate();
    if (problem) {
      setError(undefined);
      setActive(problem.type);
      setSection(problem.section);
      setInvalid(problem);
      window.setTimeout(() => {
        document
          .getElementById(
            problem.section === 'chains'
              ? `stage-${problem.key}`
              : `checklist-${problem.key}`,
          )
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (problem.section === 'chains') focusStage(problem.key);
      }, 0);
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      const response = await api.request<{
        data: {
          revision: number;
          values: { approvalChains: Chains; checklists: Checklists };
        };
      }>({
        path: 'people/approval-settings',
        method: 'PUT',
        json: {
          values: { approvalChains: chains, checklists },
          version: revision,
          requestId: createUuid(),
        },
      });
      setRevision(response.data.revision);
      setChains(structuredClone(response.data.values.approvalChains));
      setChecklists(structuredClone(response.data.values.checklists));
      setSaved(JSON.stringify(response.data.values));
      setInvalid(null);
      toaster.show({ type: 'success', title: t('people.approvalSaved') });
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const message =
    error instanceof ApiClientError
      ? errorText(error)
      : error instanceof Error
        ? error.message
        : undefined;
  return (
    <>
      <PageHeader
        title={t('people.approvalSettings')}
        description={t('people.approvalSettingsDescription')}
        actions={
          <>
            {dirty ? (
              <span className='me-1 hidden text-sm text-muted-foreground sm:inline'>
                {t('people.approvalUnsaved')}
              </span>
            ) : null}
            <Button
              variant='outline'
              disabled={!dirty || pending}
              onClick={reset}
            >
              {t('people.approvalReset')}
            </Button>
            <Button disabled={!dirty || pending} onClick={() => void save()}>
              {pending ? t('people.saving') : t('people.save')}
            </Button>
          </>
        }
      />
      <div className='flex flex-col gap-4'>
        <p className='rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm leading-6 text-muted-foreground'>
          {t('people.approvalHint')}
        </p>
        <div
          role='group'
          aria-label={t('people.approvalSection')}
          className='inline-flex w-fit rounded-lg border border-border p-0.5'
        >
          {(['chains', 'checklists'] as const).map((item) => (
            <button
              key={item}
              type='button'
              aria-pressed={section === item}
              onClick={() => setSection(item)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors',
                section === item
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`people.approvalSections.${item}`)}
            </button>
          ))}
        </div>
        {message ? (
          <Alert variant='destructive'>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}
        <div className='grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start'>
          <nav
            aria-label={t('people.approvalTypes')}
            className='flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0'
          >
            {changeTypes.map((type) => {
              const count =
                section === 'chains'
                  ? (chains[type]?.stages.length ?? 0)
                  : (checklists[type]?.length ?? 0);
              return (
                <button
                  key={type}
                  type='button'
                  aria-current={active === type ? 'true' : undefined}
                  onClick={() => setActive(type)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors lg:w-full',
                    active === type
                      ? 'border-border bg-muted font-medium text-foreground'
                      : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className='min-w-0 flex-1 truncate'>
                    {typeLabel(type)}
                  </span>
                  {dirtyTypes.has(type) ? (
                    <span
                      className='size-1.5 shrink-0 rounded-full bg-primary'
                      aria-label={t('people.approvalUnsaved')}
                    />
                  ) : null}
                  <Badge variant='secondary' className='tabular-nums'>
                    {count}
                  </Badge>
                </button>
              );
            })}
          </nav>
          <Card>
            <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
              <div className='flex min-w-0 flex-col gap-1.5'>
                <CardTitle>
                  {section === 'chains'
                    ? t('people.approvalChainTitle', {
                        type: typeLabel(active),
                      })
                    : t('people.checklist.settingsTitle', {
                        type: typeLabel(active),
                      })}
                </CardTitle>
                <CardDescription>
                  {section === 'chains'
                    ? t('people.approvalChainSummary', { count: chain.length })
                    : t('people.checklist.settingsDescription')}
                </CardDescription>
              </div>
              {section === 'chains' ? (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={chain.length >= 5}
                  onClick={addStage}
                >
                  <Plus />
                  {t('people.approvalAddStage')}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className='flex flex-col gap-3'>
              {section === 'chains' ? (
                <>
                  {!chain.length ? (
                    <Empty className='border border-dashed border-border py-10'>
                      <EmptyHeader>
                        <EmptyMedia variant='icon'>
                          <Plus />
                        </EmptyMedia>
                        <EmptyTitle>
                          {t('people.approvalEmptyChain')}
                        </EmptyTitle>
                        <EmptyDescription>
                          {t('people.approvalEmptyChainHint')}
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : null}
                  {chain.map((stage, index) => (
                    <div
                      id={`stage-${stage.key}`}
                      key={stage.key}
                      className={cn(
                        'rounded-lg border bg-card',
                        invalid?.key === stage.key
                          ? 'border-destructive'
                          : 'border-border',
                      )}
                    >
                      <div className='flex flex-wrap items-center gap-2 border-b border-border px-3 py-2'>
                        <span className='flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium tabular-nums'>
                          {index + 1}
                        </span>
                        <Input
                          id={`stage-title-${stage.key}`}
                          aria-label={t('people.approvalStageTitle')}
                          value={stage.title}
                          maxLength={100}
                          onChange={(event) =>
                            updateStage(index, { title: event.target.value })
                          }
                          className='h-8 min-w-0 flex-1 border-transparent bg-transparent px-1 font-medium shadow-none focus-visible:border-input sm:max-w-xs'
                        />
                        <div className='ms-auto flex items-center gap-1'>
                          <div
                            role='group'
                            aria-label={t('people.approvalMode')}
                            className='inline-flex rounded-md border border-border p-0.5'
                          >
                            {(['any', 'all'] as const).map((mode) => (
                              <button
                                key={mode}
                                type='button'
                                aria-pressed={stage.mode === mode}
                                onClick={() => updateStage(index, { mode })}
                                className={cn(
                                  'rounded px-2.5 py-1 text-xs transition-colors',
                                  stage.mode === mode
                                    ? 'bg-muted font-medium text-foreground'
                                    : 'text-muted-foreground hover:text-foreground',
                                )}
                              >
                                {t(`people.approvalModes.${mode}`)}
                              </button>
                            ))}
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  variant='ghost'
                                  size='icon-sm'
                                  aria-label={t('people.approvalStageActions')}
                                />
                              }
                            >
                              <MoreHorizontal />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuItem
                                disabled={index === 0}
                                onClick={() => move(index, -1)}
                              >
                                <ArrowUp />
                                {t('people.approvalMoveUp')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={index === chain.length - 1}
                                onClick={() => move(index, 1)}
                              >
                                <ArrowDown />
                                {t('people.approvalMoveDown')}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                variant='destructive'
                                disabled={chain.length === 1}
                                onClick={() => removeStage(index)}
                              >
                                <Trash2 />
                                {t('people.approvalRemoveStage')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                      <div className='flex flex-col gap-4 p-3'>
                        <div className='sm:max-w-xs'>
                          <Label className='mb-2 block'>
                            {t('people.approvalCompany')}
                          </Label>
                          <PeopleSelect
                            label={t('people.approvalCompany')}
                            value={stage.subjectIds[0] ?? 'all'}
                            items={companyItems}
                            onChange={(value) =>
                              updateStage(index, {
                                subjectIds: value === 'all' ? [] : [value],
                              })
                            }
                          />
                        </div>
                        <div className='flex flex-col gap-2'>
                          <div className='flex items-center justify-between gap-2'>
                            <Label>{t('people.approvalReviewers')}</Label>
                            <span className='text-xs tabular-nums text-muted-foreground'>
                              {stage.selections.length}/10
                            </span>
                          </div>
                          {stage.selections.length ? (
                            <div className='flex flex-col gap-2'>
                              {stage.selections.map((selection, position) => (
                                <div
                                  // Rows are positional and a selection may still be empty.
                                  // eslint-disable-next-line @eslint-react/no-array-index-key
                                  key={`${stage.key}-${position}`}
                                  className='flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-2 sm:flex-row sm:items-center'
                                >
                                  <div className='sm:w-36'>
                                    <PeopleSelect
                                      label={t('people.approvalSource')}
                                      value={selection.type}
                                      items={selectionTypes.map((type) => ({
                                        value: type,
                                        label: sourceLabel(type),
                                      }))}
                                      onChange={(value) =>
                                        changeSelection(index, position, {
                                          type: value as SelectionType,
                                        })
                                      }
                                    />
                                  </div>
                                  <div className='min-w-0 flex-1'>
                                    <PeopleSelect
                                      label={sourceLabel(selection.type)}
                                      value={selection.referenceId}
                                      items={fieldItems(selection.type)}
                                      onChange={(value) =>
                                        changeSelection(index, position, {
                                          referenceId: value,
                                        })
                                      }
                                    />
                                  </div>
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <Button
                                          variant='ghost'
                                          size='icon-sm'
                                          aria-label={t(
                                            'people.approvalRemoveReviewer',
                                          )}
                                          className='self-end sm:self-auto'
                                          onClick={() =>
                                            removeSelection(index, position)
                                          }
                                        />
                                      }
                                    >
                                      <X />
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {t('people.approvalRemoveReviewer')}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className='rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground'>
                              {t('people.approvalNoReviewers')}
                            </p>
                          )}
                          <Button
                            variant='outline'
                            size='sm'
                            className='w-fit'
                            disabled={stage.selections.length >= 10}
                            onClick={() => addSelection(index)}
                          >
                            <Plus />
                            {t('people.approvalAddReviewer')}
                          </Button>
                        </div>
                        {invalid?.key === stage.key ? (
                          <p className='text-sm text-destructive' role='alert'>
                            {invalid.message}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                  <p className='text-xs text-muted-foreground'>
                    {t('people.approvalStageLimit')}
                  </p>
                </>
              ) : (
                <ChecklistSettings
                  value={checklist}
                  onChange={(items) =>
                    setChecklists((current) => ({
                      ...current,
                      [active]: items,
                    }))
                  }
                  invalidKey={
                    invalid?.section === 'checklists' ? invalid.key : null
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
