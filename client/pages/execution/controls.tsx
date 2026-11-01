import type { ReactNode } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Inbox, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
  EmptyContent,
} from '#components/ui/empty';
import {
  PagedReferencePicker,
  type PagedReferencePickerProps,
  type PagedReferenceChoice,
} from '#components/paged-reference-picker';
import { StatusBadge } from '#components/status-badge';
import {
  Loading,
  Pagination,
  RefreshButton,
} from '../requisitions/requests/controls.js';
import { ui, useExecutionError } from './hooks.js';
export { Loading, Pagination, RefreshButton };
export { PeopleSelect as StaticSelect } from '../people/controls.js';
export { OverflowText } from '../materials/controls.js';
export function ReferencePicker<T extends PagedReferenceChoice>(
  props: Omit<
    PagedReferencePickerProps<T>,
    'uiNamespace' | 'renderError' | 'renderLoading' | 'renderPagination'
  >,
) {
  return (
    <PagedReferencePicker<T>
      {...props}
      compact
      uiNamespace='execution'
      renderError={(error, retry) => (
        <ErrorNotice error={error} retry={retry} />
      )}
      renderLoading={() => <Loading />}
      renderPagination={(pagination) => <Pagination {...pagination} />}
    />
  );
}
export function ErrorNotice({
  error,
  retry,
  committed = false,
}: {
  error: unknown;
  retry?: () => void;
  committed?: boolean;
}) {
  const { t } = useTranslation(),
    message = useExecutionError(),
    { refresh } = useAuthentication(),
    status = error instanceof ApiClientError ? error.status : 0;
  return (
    <Alert variant={committed ? 'default' : 'destructive'}>
      <AlertDescription className='flex flex-col items-start gap-3'>
        <span>{committed ? t(ui('committedReadFailed')) : message(error)}</span>
        {status === 401 ? (
          <Button variant='outline' onClick={() => void refresh()}>
            {t(ui('signIn'))}
          </Button>
        ) : ![403, 404].includes(status) && retry ? (
          <Button variant='outline' onClick={retry}>
            {t(ui(committed ? 'readAgain' : 'retry'))}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
export function EmptyState({
  type = 'empty',
  children,
}: {
  type?:
    | 'empty'
    | 'chooseCompany'
    | 'noCompany'
    | 'noMatches'
    | 'noLines'
    | 'noSelection'
    | 'noCount'
    | 'noHistory'
    | 'noVersions'
    | 'restricted';
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Empty className='min-h-48 border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          {type === 'restricted' ? <ShieldCheck /> : <Inbox />}
        </EmptyMedia>
        <EmptyTitle>{t(ui(type))}</EmptyTitle>
        <EmptyDescription>{t(ui(`${type}Hint`))}</EmptyDescription>
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
export function RecordStatus({ status }: { status: string }) {
  const { t } = useTranslation();
  return (
    <StatusBadge
      tone={
        ['approved', 'posted'].includes(status)
          ? 'success'
          : status === 'pending'
            ? 'info'
            : status === 'counting'
              ? 'warning'
              : 'neutral'
      }
    >
      {t(ui(`states.${status}`))}
    </StatusBadge>
  );
}
