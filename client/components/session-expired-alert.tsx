// client/components/session-expired-alert.tsx
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { Alert, AlertAction, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';

/**
 * Shown where a request failed with 401: the session ended, so a retry cannot succeed. refresh() re-reads the session;
 * while it runs, AuthenticationGuard renders nothing, so the signed-in pages (and any input in them) unmount, and
 * RequiredAuthentication then sends the user to sign in. That is why the user starts it, never an effect or a catch.
 */
export function SessionExpiredAlert(): ReactElement {
  const { t } = useTranslation();
  const { refresh } = useAuthentication();
  return (
    <Alert variant='destructive'>
      <AlertCircleIcon />
      <AlertDescription>{t('status.sessionExpired')}</AlertDescription>
      <AlertAction>
        <Button variant='outline' size='sm' onClick={() => void refresh()}>
          {t('actions.signInAgain')}
        </Button>
      </AlertAction>
    </Alert>
  );
}
