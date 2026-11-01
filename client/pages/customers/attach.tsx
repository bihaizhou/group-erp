import { useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useResolvedPath } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { Button } from '#components/ui/button';
import { Field, FieldLabel, FieldError } from '#components/ui/field';
import { Textarea } from '#components/ui/textarea';
import { Spinner } from '#components/ui/spinner';
import { Card, CardContent } from '#components/ui/card';
import {
  ErrorNotice,
  EmptyState,
  Loading,
  ReferencePicker,
} from '../execution/controls.js';
import {
  useExecutionCan,
  useExecutionQuery,
  useLeaveGuard,
  useRequestKey,
  ui,
} from '../execution/hooks.js';
import { useSupplierRefresh } from '../suppliers/hooks.js';
import type { Relationship } from '../suppliers/model.js';
import type { Choice } from '../execution/model.js';
interface Candidate extends Choice {
  available: boolean;
}
export default function AttachCustomerRole() {
  const location = useLocation(),
    navigate = useNavigate(),
    { t } = useTranslation(),
    api = useApiClient(),
    toast = useToaster(),
    refresh = useSupplierRefresh(),
    key = useRequestKey(),
    permission = useExecutionCan('sales.customers', 'addRole'),
    [subjectId, setSubjectId] = useState(
      () => new URLSearchParams(location.search).get('subjectId') ?? '',
    ),
    [partnerId, setPartnerId] = useState(''),
    [notes, setNotes] = useState(''),
    [attempted, setAttempted] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(),
    lockRef = useRef(false),
    guard = useLeaveGuard(
      !!(partnerId || notes),
      busy,
      useResolvedPath('.').pathname,
    ),
    company = useExecutionQuery<{ data: Choice }>(
      `sales/customerCompanies/${subjectId}`,
      {},
      !!subjectId && permission.can,
    );
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (lockRef.current) return;
    setAttempted(true);
    if (!subjectId || !partnerId) {
      document
        .getElementById(
          !subjectId ? 'customer-role-company' : 'customer-role-identity',
        )
        ?.focus();
      return;
    }
    lockRef.current = true;
    setBusy(true);
    setError(undefined);
    const body = { subjectId, partnerId, notes };
    try {
      const result = await api.request<{ data: Relationship }>({
        path: 'sales/customerRoles',
        method: 'POST',
        json: { ...body, requestKey: key.for(body) },
      });
      void refresh(result.data, true);
      toast.show({
        type: 'success',
        title: t('customers.saved', { name: result.data.identity.name }),
      });
      guard.complete();
      const params = new URLSearchParams(location.search);
      params.set('subjectId', subjectId);
      void navigate(
        {
          pathname: `/functions/sales/customers/${partnerId}`,
          search: params.toString(),
        },
        { replace: true },
      );
    } catch (writeError) {
      setError(writeError);
    } finally {
      lockRef.current = false;
      setBusy(false);
    }
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader
          title={t('customers.attachRole')}
          description={t('customers.attachRoleHint')}
        />
        {permission.isPending ? (
          <Loading kind='form' />
        ) : !permission.can ? (
          <EmptyState type='restricted' />
        ) : (
          <form
            onSubmit={(event) => void save(event)}
            className='grid gap-6'
            noValidate
            aria-busy={busy}
          >
            {!!error &&
              (error instanceof ApiClientError &&
              error.reason?.endsWith('ROLE_EXISTS') ? (
                <p className='text-sm text-destructive'>
                  {t('customers.roleExists')}
                </p>
              ) : (
                <ErrorNotice error={error} />
              ))}
            <Card>
              <CardContent className='grid gap-5 pt-6 md:grid-cols-2'>
                <ReferencePicker<Choice>
                  id='customer-role-company'
                  label={`${t(ui('company'))} *`}
                  queryPath='sales/customerCompanies'
                  value={subjectId}
                  selected={company.data?.data}
                  disabled={busy}
                  error={
                    attempted && !subjectId ? t(ui('required')) : undefined
                  }
                  onChange={setSubjectId}
                />
                <ReferencePicker<Candidate>
                  id='customer-role-identity'
                  label={`${t('customers.chooseIdentity')} *`}
                  queryPath='sales/customerRoles'
                  value={partnerId}
                  disabled={busy}
                  error={
                    attempted && !partnerId ? t(ui('required')) : undefined
                  }
                  isOptionDisabled={(item) => !item.available}
                  renderOption={(item) => (
                    <span>
                      {item.code} · {item.name}
                      {!item.available && (
                        <span className='block text-xs text-muted-foreground'>
                          {t('customers.roleExists')}
                        </span>
                      )}
                    </span>
                  )}
                  onChange={(value) => {
                    setPartnerId(value);
                    setError(undefined);
                  }}
                />
                <Field className='md:col-span-2'>
                  <FieldLabel htmlFor='customer-role-notes'>
                    {t(ui('notes'))}
                  </FieldLabel>
                  <Textarea
                    id='customer-role-notes'
                    maxLength={2000}
                    value={notes}
                    disabled={busy}
                    onChange={(event) => setNotes(event.target.value)}
                  />
                  {notes.length > 2000 && (
                    <FieldError>
                      {t('customers.maxLength', { count: 2000 })}
                    </FieldError>
                  )}
                </Field>
              </CardContent>
            </Card>
            <div className='flex justify-end gap-2'>
              <Button
                type='button'
                variant='outline'
                disabled={busy}
                onClick={() => {
                  void guard.leave().then((ok) => {
                    if (ok)
                      void navigate(
                        { pathname: '..', search: location.search },
                        { relative: 'route' },
                      );
                  });
                }}
              >
                {t(ui('cancel'))}
              </Button>
              <Button type='submit' disabled={busy}>
                {busy && <Spinner />}
                {t('customers.attachRole')}
              </Button>
            </div>
          </form>
        )}
        {guard.dialog}
      </PageContainer>
    </RouteChildPage>
  );
}
