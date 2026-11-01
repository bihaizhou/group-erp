import { useMemo, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster, ApiClientError } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '#components/ui/tabs';
import { Field, FieldLabel } from '#components/ui/field';
import { PeopleLoading, PeopleErrorNotice, PeopleSelect } from './controls.js';
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
type Settings = {
  revision: number;
  values: { approvalChains: Chains };
  defaults: { approvalChains: Chains };
  options: {
    roles: { key: string; title: string }[];
    accounts: { id: string; name: string; code: string }[];
    companies: { id: string; name: string }[];
    positions: { id: string; name: string; subjectName: string }[];
  };
};
const emptyStage = (title: string): Stage => ({
  key: crypto.randomUUID(),
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
  return (
    <PageContainer>
      <PageHeader
        title={t('people.approvalSettings')}
        description={t('people.approvalSettingsDescription')}
      />
      {data.isError ? (
        <PeopleErrorNotice
          error={data.error}
          retry={() => void data.refetch()}
        />
      ) : !data.data ? (
        <PeopleLoading />
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
    [active, setActive] = useState<ChangeType>('entry'),
    [revision, setRevision] = useState(settings.revision),
    [pending, setPending] = useState(false),
    [error, setError] = useState<unknown>();
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
    sourceLabel = (type: SelectionType) => t(`people.approvalSources.${type}`);
  const items = (type: SelectionType) => sourceItems[type];
  const chain = chains[active] ?? { stages: [] };
  const update = (stages: Stage[]) =>
    setChains((current) => ({ ...current, [active]: { stages } }));
  const updateStage = (index: number, patch: Partial<Stage>) =>
    update(
      chain.stages.map((stage, i) =>
        i === index ? { ...stage, ...patch } : stage,
      ),
    );
  const move = (index: number, delta: number) => {
    const next = [...chain.stages],
      target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };
  const addStage = () =>
    update([
      ...chain.stages,
      emptyStage(
        t('people.approvalStageDefault', { index: chain.stages.length + 1 }),
      ),
    ]);
  const addSelection = (index: number) => {
    const stage = chain.stages[index],
      type: SelectionType = 'role';
    const referenceId = items(type)[0]?.value;
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
    const stage = chain.stages[index],
      selections = stage.selections.map((selection, i) => {
        if (i !== position) return selection;
        const next = { ...selection, ...patch };
        if (
          patch.type &&
          !items(patch.type).some((item) => item.value === next.referenceId)
        )
          next.referenceId = items(patch.type)[0]?.value ?? '';
        return next;
      });
    updateStage(index, { selections });
  };
  const removeSelection = (index: number, position: number) =>
    updateStage(index, {
      selections: chain.stages[index].selections.filter(
        (_, i) => i !== position,
      ),
    });
  const save = async () => {
    for (const type of changeTypes)
      for (const [index, stage] of (chains[type]?.stages ?? []).entries()) {
        if (!stage.title.trim()) {
          setError(
            new Error(t('people.approvalTitleRequired', { index: index + 1 })),
          );
          return;
        }
        if (
          !stage.selections.length ||
          stage.selections.some((selection) => !selection.referenceId)
        ) {
          setError(
            new Error(
              t('people.approvalReviewerRequired', { index: index + 1 }),
            ),
          );
          return;
        }
      }
    setPending(true);
    setError(undefined);
    try {
      const response = await api.request<{
        data: { revision: number; values: { approvalChains: Chains } };
      }>({
        path: 'people/approval-settings',
        method: 'PUT',
        json: {
          values: { approvalChains: chains },
          version: revision,
          requestId: crypto.randomUUID(),
        },
      });
      setRevision(response.data.revision);
      setChains(structuredClone(response.data.values.approvalChains));
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
    <div className='flex flex-col gap-4'>
      <Alert>
        <AlertDescription>{t('people.approvalHint')}</AlertDescription>
      </Alert>
      {message ? (
        <Alert variant='destructive'>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
      <Tabs
        value={active}
        onValueChange={(value) => setActive(value as ChangeType)}
        orientation='vertical'
        className='items-start gap-4'
      >
        <TabsList className='h-auto w-full flex-wrap sm:w-44 sm:flex-col'>
          {changeTypes.map((type) => (
            <TabsTrigger key={type} value={type} className='w-full'>
              {t(`people.career.change.${type}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={active} className='flex w-full flex-col gap-4'>
          {chain.stages.map((stage, index) => (
            <Card key={stage.key}>
              <CardHeader className='flex flex-row items-center justify-between gap-2'>
                <CardTitle>
                  {t('people.approvalStageOf', { index: index + 1 })}
                </CardTitle>
                <div className='flex gap-1'>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('people.approvalMoveUp')}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('people.approvalMoveDown')}
                    disabled={index === chain.stages.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label={t('people.approvalRemoveStage')}
                    disabled={chain.stages.length === 1}
                    onClick={() =>
                      update(chain.stages.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className='flex flex-col gap-4'>
                <div className='grid gap-4 sm:grid-cols-3'>
                  <Field>
                    <FieldLabel htmlFor={`stage-title-${stage.key}`}>
                      {t('people.approvalStageTitle')}
                    </FieldLabel>
                    <Input
                      id={`stage-title-${stage.key}`}
                      value={stage.title}
                      maxLength={100}
                      onChange={(event) =>
                        updateStage(index, { title: event.target.value })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t('people.approvalMode')}</FieldLabel>
                    <PeopleSelect
                      label={t('people.approvalMode')}
                      value={stage.mode}
                      onChange={(value) =>
                        updateStage(index, { mode: value as 'any' | 'all' })
                      }
                      items={[
                        { value: 'any', label: t('people.approvalModes.any') },
                        { value: 'all', label: t('people.approvalModes.all') },
                      ]}
                    />
                  </Field>
                  <Field>
                    <FieldLabel>{t('people.approvalCompany')}</FieldLabel>
                    <PeopleSelect
                      label={t('people.approvalCompany')}
                      value={stage.subjectIds[0] ?? 'all'}
                      onChange={(value) =>
                        updateStage(index, {
                          subjectIds: value === 'all' ? [] : [value],
                        })
                      }
                      items={companyItems}
                    />
                  </Field>
                </div>
                <div className='flex flex-col gap-2'>
                  <Label>{t('people.approvalReviewers')}</Label>
                  {stage.selections.map((selection, position) => (
                    <div
                      // Rows are positional and a selection may still be empty.
                      // eslint-disable-next-line @eslint-react/no-array-index-key
                      key={`${stage.key}-${position}`}
                      className='grid gap-2 sm:grid-cols-[10rem_1fr_auto]'
                    >
                      <PeopleSelect
                        label={t('people.approvalSource')}
                        value={selection.type}
                        onChange={(value) =>
                          changeSelection(index, position, {
                            type: value as SelectionType,
                          })
                        }
                        items={selectionTypes.map((type) => ({
                          value: type,
                          label: sourceLabel(type),
                        }))}
                      />
                      <PeopleSelect
                        label={t(sourceLabel(selection.type))}
                        value={selection.referenceId}
                        onChange={(value) =>
                          changeSelection(index, position, {
                            referenceId: value,
                          })
                        }
                        items={items(selection.type)}
                      />
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={t('people.approvalRemoveReviewer')}
                        onClick={() => removeSelection(index, position)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  ))}
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
              </CardContent>
            </Card>
          ))}
          <div className='flex flex-wrap items-center gap-2'>
            <Button
              variant='outline'
              disabled={chain.stages.length >= 5}
              onClick={addStage}
            >
              <Plus />
              {t('people.approvalAddStage')}
            </Button>
            <span className='text-sm text-muted-foreground'>
              {t('people.approvalStageLimit')}
            </span>
            <div className='ms-auto flex gap-2'>
              <Button disabled={pending} onClick={() => void save()}>
                {pending ? t('people.saving') : t('people.save')}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
