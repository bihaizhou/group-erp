import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Search, ShieldCheck } from 'lucide-react';
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
};
type PermissionSet = {
  key: string;
  title: string;
  grantCount: number;
};
type Data = {
  positions: Position[];
  permissionSets: PermissionSet[];
};

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function PositionEditor({
  position,
  sets,
  onSaved,
}: {
  position: Position;
  sets: PermissionSet[];
  onSaved: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const toast = useToaster();
  const [draft, setDraft] = useState(
    () => new Set<string>(position.permissionSetKeys),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const changed =
    draft.size !== position.permissionSetKeys.length ||
    position.permissionSetKeys.some((key) => !draft.has(key));

  const toggle = (key: string) => {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
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
              onSaved={async () => {
                await data.refetch();
              }}
            />
          )}
        </Card>
      </div>
    </PageContainer>
  );
}
