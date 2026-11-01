import { ApiClientError } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { Skeleton } from '#components/ui/skeleton';
import { sourceUi, useSourceError } from './hooks.js';
export function SourceError({
  error,
  retry,
  message,
}: {
  error: unknown;
  retry?: () => void;
  message?: string;
}) {
  const { t } = useTranslation(),
    formatError = useSourceError(),
    { refresh } = useAuthentication();
  const status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant='destructive'>
      <AlertDescription className='flex flex-col items-start gap-2'>
        <span>{message ?? formatError(error)}</span>
        {status === 401 ? (
          <Button variant='outline' onClick={() => void refresh()}>
            {t(sourceUi('signIn'))}
          </Button>
        ) : retry && ![403, 404, 409].includes(status) ? (
          <Button variant='outline' onClick={retry}>
            {t(sourceUi('retry'))}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function SourceLoading() {
  const { t } = useTranslation();
  return (
    <div
      role='status'
      aria-label={t(sourceUi('loading'))}
      aria-busy='true'
      className='grid gap-3'
    >
      <Skeleton className='h-5 w-2/3' />
      <Skeleton className='h-5 w-full' />
    </div>
  );
}
