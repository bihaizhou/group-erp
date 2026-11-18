import { useListData } from '#hooks/use-list-data';
import { createUuid, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Button } from '#components/ui/button';

interface Preview {
  active: boolean;
  employeeId: string | null;
  employeeName: string | null;
  expiresAt: string | null;
}

/**
 * A running staff identity preview must be visible everywhere: business pages
 * would otherwise show another employee's post, unit and records with no hint
 * that the data does not belong to the signed-in account.
 */
export function IdentityPreviewBanner(): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const preview = useListData<{ data: Preview }>('identity-preview/current');
  const [busy, setBusy] = useState(false);
  const active = preview.data?.data;
  if (!active?.active) return null;
  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.request({
        path: 'identity-preview',
        method: 'DELETE',
        headers: {
          'Idempotency-Key': `${Date.now()}.${createUuid()}`,
        },
      });
      preview.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      role='status'
      className='flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
    >
      <span>
        {t('identityPreview.banner', {
          name: active.employeeName ?? '',
          expires: active.expiresAt
            ? new Date(active.expiresAt).toLocaleString()
            : '',
        })}
      </span>
      <Button
        size='xs'
        variant='outline'
        disabled={busy}
        onClick={() => void stop()}
      >
        {t('identityPreview.stop')}
      </Button>
    </div>
  );
}
