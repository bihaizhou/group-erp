import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useSearchParams } from 'react-router';
import { ClipboardCheck, ClipboardList, Tags } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  DashboardMetric,
  DashboardMetricGrid,
  DashboardRefresh,
  DashboardStatus,
  DashboardTableCard,
  DashboardTodoCard,
  DashboardViewAll,
  formatDashboardDate,
  useDashboardCount,
  useDashboardList,
  useDashboardRefresh,
} from '#components/module-dashboard/index';
import { TableCell, TableRow } from '#components/ui/table';

type RequestRow = {
  id: string;
  code: string;
  status: string;
  fulfillmentStatus: string;
  neededOn: string;
  display?: { requester?: { name?: string } | null };
};

export default function RequisitionsOverviewPage() {
  const { t, i18n } = useTranslation();
  const [params] = useSearchParams();
  const subjectId = params.get('subjectId') ?? '';
  const { refresh, busy } = useDashboardRefresh();
  const requests = useCan({
    resource: { type: 'composite', id: 'requisitions.requests' },
    action: 'read',
  });
  const purposes = useCan({
    resource: { type: 'composite', id: 'requisitions.purposes' },
    action: 'read',
  });
  const enabled = Boolean(subjectId);

  const requestCount = useDashboardCount(
    'requisitions',
    'requests',
    'requisitions/requests',
    { subjectId },
    enabled && requests.can,
  );
  const pendingCount = useDashboardCount(
    'requisitions',
    'pending',
    'requisitions/requests',
    { subjectId, status: 'pending' },
    enabled && requests.can,
  );
  const openCount = useDashboardCount(
    'requisitions',
    'open',
    'requisitions/requests',
    { subjectId, fulfillmentStatus: 'open' },
    enabled && requests.can,
  );
  const issuedCount = useDashboardCount(
    'requisitions',
    'issued',
    'requisitions/requests',
    { subjectId, fulfillmentStatus: 'issued' },
    enabled && requests.can,
  );
  const recentRequests = useDashboardList<RequestRow>(
    'requisitions',
    'recentRequests',
    'requisitions/requests',
    { subjectId },
    enabled && requests.can,
  );

  const withCompany = (path: string) =>
    `${path}${path.includes('?') ? '&' : '?'}subjectId=${subjectId}`;

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.requisitions.title')}
        description={t('dashboard.requisitions.description')}
        actions={<DashboardRefresh busy={busy} onClick={refresh} />}
      />
      <DashboardMetricGrid>
        {requests.can ? (
          <DashboardMetric
            label={t('dashboard.requisitions.metrics.requests')}
            value={requestCount.data}
            isLoading={requestCount.isPending}
            icon={ClipboardCheck}
            to={withCompany('/functions/requisitions/requests')}
          />
        ) : null}
        {requests.can ? (
          <DashboardMetric
            label={t('dashboard.requisitions.metrics.pending')}
            value={pendingCount.data}
            isLoading={pendingCount.isPending}
            icon={ClipboardList}
            to={withCompany('/functions/requisitions/requests?status=pending')}
          />
        ) : null}
        {requests.can ? (
          <DashboardMetric
            label={t('dashboard.requisitions.metrics.open')}
            value={openCount.data}
            isLoading={openCount.isPending}
            icon={ClipboardList}
            to={withCompany(
              '/functions/requisitions/requests?fulfillmentStatus=open',
            )}
          />
        ) : null}
        {requests.can ? (
          <DashboardMetric
            label={t('dashboard.requisitions.metrics.issued')}
            value={issuedCount.data}
            isLoading={issuedCount.isPending}
            icon={ClipboardCheck}
            to={withCompany(
              '/functions/requisitions/requests?fulfillmentStatus=issued',
            )}
          />
        ) : null}
      </DashboardMetricGrid>
      {requests.can ? (
        <DashboardTableCard
          title={t('dashboard.requisitions.recentRequests')}
          description={t('dashboard.requisitions.recentRequestsDescription')}
          columns={[
            t('dashboard.common.code'),
            t('dashboard.common.requester'),
            t('dashboard.common.status'),
            t('dashboard.common.fulfillment'),
            t('dashboard.common.neededOn'),
          ]}
          isLoading={recentRequests.isPending}
          isError={recentRequests.isError}
          onRetry={() => void recentRequests.refetch()}
          isEmpty={recentRequests.data?.length === 0}
          footer={
            <DashboardViewAll
              to={withCompany('/functions/requisitions/requests')}
            >
              {t('dashboard.viewAll')}
            </DashboardViewAll>
          }
        >
          {recentRequests.data?.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='font-medium'>{row.code}</TableCell>
              <TableCell>{row.display?.requester?.name ?? '—'}</TableCell>
              <TableCell>
                <DashboardStatus status={row.status} />
              </TableCell>
              <TableCell>
                <DashboardStatus status={row.fulfillmentStatus} />
              </TableCell>
              <TableCell className='text-muted-foreground'>
                {formatDashboardDate(row.neededOn, i18n.language)}
              </TableCell>
            </TableRow>
          ))}
        </DashboardTableCard>
      ) : null}
      <DashboardTodoCard
        title={t('dashboard.requisitions.todos')}
        description={t('dashboard.requisitions.todosDescription')}
        items={[
          ...(requests.can
            ? [
                {
                  label: t('dashboard.requisitions.todo.request'),
                  to: withCompany('/functions/requisitions/requests/new'),
                  icon: ClipboardCheck,
                  count: pendingCount.data,
                },
              ]
            : []),
          ...(purposes.can
            ? [
                {
                  label: t('dashboard.requisitions.todo.purposes'),
                  to: withCompany('/functions/requisitions/purposes'),
                  icon: Tags,
                },
              ]
            : []),
        ]}
      />
    </PageContainer>
  );
}
