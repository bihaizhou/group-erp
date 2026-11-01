import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router';
import { Inbox } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { StatusBadge } from '#components/status-badge';
import { Button } from '#components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '#components/ui/empty';
import { PeopleLoading, PeopleErrorNotice, PeopleRefresh } from './controls.js';
import { textValue } from './model.js';
import type { Row } from './model.js';

/** A change waiting on the viewer, as `/people/approvals/todo` returns it. */
export type ApprovalTask = {
  round: number;
  stageIndex: number;
  title: string;
  mode: 'any' | 'all';
  candidates: { id: string; name: string }[];
  createdAt: string;
};

export type ApprovalTodo = Row & { approval: ApprovalTask };

export default function ApprovalsPage() {
  const { t } = useTranslation(),
    api = useApiClient(),
    location = useLocation();
  const data = useQuery({
    retry: false,
    queryKey: ['people-approvals'],
    queryFn: ({ signal }) =>
      api.request<{ data: ApprovalTodo[]; meta: { total: number } }>({
        path: 'people/approvals/todo',
        signal,
      }),
  });
  const rows = data.data?.data ?? [],
    total = data.data?.meta.total ?? 0;
  const link = (row: ApprovalTodo) => ({
    pathname: `/functions/personnel/changes/${row.id}`,
    search: location.search,
  });
  return (
    <PageContainer>
      <PageHeader
        title={t('people.approvals')}
        description={t('people.approvalsDescription')}
        actions={
          <PeopleRefresh
            busy={data.isFetching}
            onClick={() => void data.refetch()}
          />
        }
      />
      {data.isError ? (
        <PeopleErrorNotice
          error={data.error}
          retry={() => void data.refetch()}
        />
      ) : !data.data ? (
        <PeopleLoading />
      ) : rows.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>{t('people.approvalsEmpty')}</EmptyTitle>
            <EmptyDescription>
              {t('people.approvalsEmptyDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('people.fields.name')}</TableHead>
                <TableHead>{t('people.fields.type')}</TableHead>
                <TableHead>{t('people.fields.effectiveDate')}</TableHead>
                <TableHead>{t('people.approvalStage')}</TableHead>
                <TableHead>{t('people.approvalMode')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link className='font-medium underline' to={link(row)}>
                      {row.name}
                    </Link>
                    <span className='block text-xs text-muted-foreground'>
                      {row.code}
                    </span>
                  </TableCell>
                  <TableCell>
                    {t(`people.career.change.${textValue(row.data.type)}`)}
                  </TableCell>
                  <TableCell>
                    {textValue(row.data.effectiveDate) || '—'}
                  </TableCell>
                  <TableCell>
                    {row.approval.title}
                    <span className='block text-xs text-muted-foreground'>
                      {t('people.approvalStageOf', {
                        index: row.approval.stageIndex + 1,
                      })}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge>
                      {t(`people.approvalModes.${row.approval.mode}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell className='text-right'>
                    <Button
                      variant='outline'
                      size='sm'
                      nativeButton={false}
                      render={<Link to={link(row)} />}
                    >
                      {t('people.reviewAction')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className='text-sm text-muted-foreground'>
            {t('people.approvalsCount', { total })}
          </p>
        </>
      )}
    </PageContainer>
  );
}
