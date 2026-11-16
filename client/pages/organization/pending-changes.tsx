import { useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Input } from '#components/ui/input';
import { displayValue } from './formatting.js';
import { useOrgError, usePendingChanges } from './hooks.js';
import type { OrgOptions } from './model.js';
import { ErrorNotice } from './shared.js';

export function OrganizationPendingChanges({
  kind,
  recordId,
  options,
  canWrite,
}: {
  readonly kind: string;
  readonly recordId: string;
  readonly options?: OrgOptions;
  readonly canWrite: boolean;
}) {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const cache = useQueryClient();
  const toaster = useToaster();
  const errorText = useOrgError();
  const pending = usePendingChanges(kind, recordId);
  const [cancelling, setCancelling] = useState<string>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const rows = (pending.data?.rows ?? []).filter(
    (row) => row.status === 'pending',
  );
  const cancel = async (id: string) => {
    if (busy || !reason.trim()) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `organization/pending/${id}/cancel`,
        method: 'POST',
        json: { reason: reason.trim() },
      });
      await cache.invalidateQueries({
        queryKey: ['org-pending', kind, recordId],
      });
      await cache.invalidateQueries({
        queryKey: ['org-record-history', recordId],
      });
      toaster.show({ type: 'success', title: t('org.pending.cancelled') });
      setCancelling(undefined);
      setReason('');
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('org.pending.title')}</CardTitle>
        <CardDescription>{t('org.pending.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert variant='destructive' className='mb-4'>
            <AlertDescription>{errorText(error)}</AlertDescription>
          </Alert>
        ) : null}
        {pending.isError ? (
          <ErrorNotice
            error={pending.error}
            retry={() => void pending.refetch()}
          />
        ) : pending.isPending ? (
          <p className='text-sm text-muted-foreground'>{t('org.loading')}</p>
        ) : !rows.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('org.pending.empty')}
          </p>
        ) : (
          <ul className='flex flex-col gap-4'>
            {rows.map((row) => {
              const payload = row.payload ?? {};
              const keys = Object.keys(payload);
              return (
                <li
                  key={row.id}
                  className='flex flex-col gap-3 rounded-lg border p-3'
                >
                  <div className='flex flex-wrap items-start justify-between gap-2'>
                    <div className='flex flex-col gap-0.5'>
                      <p className='text-sm font-medium'>
                        {t(`org.operations.${row.operation}`, {
                          defaultValue: row.operation,
                        })}
                      </p>
                      <p className='text-xs text-muted-foreground'>
                        {t('org.pending.effectiveFrom')} ·{' '}
                        {row.effectiveFrom}
                      </p>
                    </div>
                    {canWrite && cancelling !== row.id ? (
                      <Button
                        type='button'
                        variant='outline'
                        size='sm'
                        onClick={() => {
                          setCancelling(row.id);
                          setReason('');
                        }}
                      >
                        {t('org.pending.cancel')}
                      </Button>
                    ) : null}
                  </div>
                  <dl className='grid gap-1.5'>
                    {keys.length ? (
                      keys.map((key) => (
                        <div
                          key={key}
                          className='grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2'
                        >
                          <dt className='text-xs text-muted-foreground'>
                            {t(`org.fields.${key}`, { defaultValue: key })}
                          </dt>
                          <dd className='text-sm break-words'>
                            {displayValue(
                              key,
                              payload[key],
                              options,
                              t,
                              i18n.language,
                            )}
                          </dd>
                        </div>
                      ))
                    ) : (
                      <div className='text-sm text-muted-foreground'>
                        {t('org.noFieldChanges')}
                      </div>
                    )}
                    <div className='grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2'>
                      <dt className='text-xs text-muted-foreground'>
                        {t('org.pending.actor')}
                      </dt>
                      <dd className='text-sm'>{row.actorName || '—'}</dd>
                    </div>
                    {row.reason ? (
                      <div className='grid grid-cols-[6rem_minmax(0,1fr)] items-baseline gap-2'>
                        <dt className='text-xs text-muted-foreground'>
                          {t('org.fields.reason')}
                        </dt>
                        <dd className='text-sm break-words'>{row.reason}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {cancelling === row.id ? (
                    <div className='flex flex-col gap-2 border-t pt-3'>
                      <Input
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                        placeholder={t('org.pending.cancelReason')}
                        aria-label={t('org.pending.cancelReason')}
                        maxLength={1000}
                        autoFocus
                        disabled={busy}
                      />
                      <div className='flex justify-end gap-2'>
                        <Button
                          type='button'
                          variant='outline'
                          size='sm'
                          disabled={busy}
                          onClick={() => {
                            setCancelling(undefined);
                            setReason('');
                          }}
                        >
                          {t('org.cancel')}
                        </Button>
                        <Button
                          type='button'
                          size='sm'
                          disabled={busy || !reason.trim()}
                          onClick={() => void cancel(row.id)}
                        >
                          {busy
                            ? t('org.saving')
                            : t('org.pending.cancelConfirm')}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
