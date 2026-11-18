import { useListData } from '#hooks/use-list-data';
import { createUuid, useApiClient, useToaster } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type ReactElement } from 'react';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Card, CardContent } from '#components/ui/card';
import { Input } from '#components/ui/input';
import { Spinner } from '#components/ui/spinner';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { SettingsError } from './shared.js';

interface Preview {
  active: boolean;
  employeeId: string | null;
  employeeName: string | null;
  expiresAt: string | null;
}

interface PreviewEmployee {
  id: string;
  code: string;
  name: string;
  positions: string[];
  units: string[];
}

const idempotencyKey = (): string => `${Date.now()}.${createUuid()}`;

/**
 * Root-only staff identity preview: business pages still need a real employee
 * behind the account, so instead of a fake employee card the administrator
 * temporarily borrows an existing employee's identity for a bounded window.
 */
export default function IdentityPreviewPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const current = useListData<{ data: Preview }>('identity-preview/current');
  const employees = useListData<{ data: { employees: PreviewEmployee[] } }>(
    'identity-preview/employees',
    true,
  );
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [query, setQuery] = useState('');

  const active = current.data?.data;
  const rows = useMemo(() => {
    const list = employees.data?.data.employees ?? [];
    const keyword = query.trim().toLowerCase();
    if (!keyword) return list;
    return list.filter((row) =>
      `${row.name} ${row.code} ${row.positions.join(' ')} ${row.units.join(' ')}`
        .toLowerCase()
        .includes(keyword),
    );
  }, [employees.data, query]);

  const start = async (employee: PreviewEmployee): Promise<void> => {
    setBusy(employee.id);
    setError(undefined);
    try {
      await api.request({
        path: 'identity-preview',
        method: 'POST',
        json: { employeeId: employee.id },
        headers: { 'Idempotency-Key': idempotencyKey() },
      });
      toaster.show({
        type: 'success',
        title: t('identityPreview.started', { name: employee.name }),
      });
      current.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(undefined);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy('stop');
    setError(undefined);
    try {
      await api.request({
        path: 'identity-preview',
        method: 'DELETE',
        headers: { 'Idempotency-Key': idempotencyKey() },
      });
      toaster.show({ type: 'success', title: t('identityPreview.stopped') });
      current.reload();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(undefined);
    }
  };

  const denied =
    employees.error instanceof Error &&
    Reflect.get(employees.error, 'status') === 403;

  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('identityPreview.title')}
        description={t('identityPreview.description')}
      />
      <SettingsError error={error} />
      {denied ? (
        <Alert>
          <AlertDescription>{t('identityPreview.rootOnly')}</AlertDescription>
        </Alert>
      ) : null}
      {active?.active ? (
        <Card>
          <CardContent className='space-y-3 py-5'>
            <p className='text-sm'>
              {t('identityPreview.current', {
                name: active.employeeName ?? '',
                expires: active.expiresAt
                  ? new Date(active.expiresAt).toLocaleString()
                  : '',
              })}
            </p>
            <p className='text-sm text-muted-foreground'>
              {t('identityPreview.currentHint')}
            </p>
            <Button
              variant='destructive'
              disabled={busy === 'stop'}
              onClick={() => void stop()}
            >
              {busy === 'stop' ? <Spinner /> : null}
              {t('identityPreview.stop')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className='space-y-3'>
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('identityPreview.search')}
            aria-label={t('identityPreview.search')}
          />
          {employees.loading ? (
            <p className='flex items-center gap-2 py-6 text-sm text-muted-foreground'>
              <Spinner /> {t('identityPreview.loading')}
            </p>
          ) : rows.length === 0 ? (
            <p className='py-6 text-sm text-muted-foreground'>
              {t('identityPreview.empty')}
            </p>
          ) : (
            <ul className='divide-y rounded-md border'>
              {rows.map((employee) => (
                <li
                  key={employee.id}
                  className='flex flex-wrap items-center justify-between gap-3 px-4 py-3'
                >
                  <div className='min-w-0'>
                    <p className='truncate text-sm font-medium'>
                      {employee.name}{' '}
                      <span className='text-muted-foreground'>
                        {employee.code}
                      </span>
                    </p>
                    <p className='truncate text-xs text-muted-foreground'>
                      {[
                        employee.units.join('、'),
                        employee.positions.join('、'),
                      ]
                        .filter(Boolean)
                        .join(' · ') || t('identityPreview.noPosition')}
                    </p>
                  </div>
                  <Button
                    variant='outline'
                    disabled={busy === employee.id}
                    onClick={() => void start(employee)}
                  >
                    {busy === employee.id ? <Spinner /> : null}
                    {t('identityPreview.start')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PageContainer>
  );
}
