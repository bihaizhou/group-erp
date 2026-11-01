import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import {
  BookOpen,
  ClipboardList,
  PackageOpen,
  Ruler,
  SlidersHorizontal,
} from 'lucide-react';
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

type MaterialRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  updatedAt: string;
};

type RequestRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  createdAt: string;
};

export default function MaterialsOverviewPage() {
  const { t, i18n } = useTranslation();
  const { refresh, busy } = useDashboardRefresh();
  const catalog = useCan({
    resource: { type: 'composite', id: 'materials.catalog' },
    action: 'read',
  });
  const requests = useCan({
    resource: { type: 'composite', id: 'materials.requests' },
    action: 'read',
  });

  const skuCount = useDashboardCount(
    'materials',
    'activeSkus',
    'materials/skus',
    { status: 'active' },
    catalog.can,
  );
  const nameCount = useDashboardCount(
    'materials',
    'names',
    'materials/names',
    { status: 'active' },
    catalog.can,
  );
  const templateCount = useDashboardCount(
    'materials',
    'templates',
    'materials/templates',
    { status: 'active' },
    catalog.can,
  );
  const pendingRequests = useDashboardCount(
    'materials',
    'pendingRequests',
    'materials/requests',
    { status: 'pending' },
    requests.can,
  );
  const recentSkus = useDashboardList<MaterialRow>(
    'materials',
    'recentSkus',
    'materials/skus',
    {},
    catalog.can,
  );
  const recentRequests = useDashboardList<RequestRow>(
    'materials',
    'recentRequests',
    'materials/requests',
    {},
    requests.can,
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.materials.title')}
        description={t('dashboard.materials.description')}
        actions={<DashboardRefresh busy={busy} onClick={refresh} />}
      />
      <DashboardMetricGrid>
        {catalog.can ? (
          <DashboardMetric
            label={t('dashboard.materials.metrics.activeSkus')}
            value={skuCount.data}
            isLoading={skuCount.isPending}
            icon={PackageOpen}
            to='/functions/warehouse/materials?status=active'
          />
        ) : null}
        {catalog.can ? (
          <DashboardMetric
            label={t('dashboard.materials.metrics.names')}
            value={nameCount.data}
            isLoading={nameCount.isPending}
            icon={BookOpen}
            to='/functions/warehouse/materials/names'
          />
        ) : null}
        {catalog.can ? (
          <DashboardMetric
            label={t('dashboard.materials.metrics.templates')}
            value={templateCount.data}
            isLoading={templateCount.isPending}
            icon={SlidersHorizontal}
            to='/functions/warehouse/materials/templates'
          />
        ) : null}
        {requests.can ? (
          <DashboardMetric
            label={t('dashboard.materials.metrics.pendingRequests')}
            value={pendingRequests.data}
            isLoading={pendingRequests.isPending}
            icon={ClipboardList}
            to='/functions/warehouse/materials/requests?status=pending'
          />
        ) : null}
      </DashboardMetricGrid>
      <div className='grid gap-4 2xl:grid-cols-2'>
        {catalog.can ? (
          <DashboardTableCard
            title={t('dashboard.materials.recentSkus')}
            description={t('dashboard.materials.recentSkusDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.name'),
              t('dashboard.common.status'),
              t('dashboard.common.date'),
            ]}
            isLoading={recentSkus.isPending}
            isError={recentSkus.isError}
            onRetry={() => void recentSkus.refetch()}
            isEmpty={recentSkus.data?.length === 0}
            footer={
              <DashboardViewAll to='/functions/warehouse/materials'>
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentSkus.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  <DashboardStatus status={row.status} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {formatDashboardDate(row.updatedAt, i18n.language)}
                </TableCell>
              </TableRow>
            ))}
          </DashboardTableCard>
        ) : null}
        {requests.can ? (
          <DashboardTableCard
            title={t('dashboard.materials.requests')}
            description={t('dashboard.materials.requestsDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.name'),
              t('dashboard.common.status'),
              t('dashboard.common.date'),
            ]}
            isLoading={recentRequests.isPending}
            isError={recentRequests.isError}
            onRetry={() => void recentRequests.refetch()}
            isEmpty={recentRequests.data?.length === 0}
            footer={
              <DashboardViewAll to='/functions/warehouse/materials/requests'>
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentRequests.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  <DashboardStatus status={row.status} />
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {formatDashboardDate(row.createdAt, i18n.language)}
                </TableCell>
              </TableRow>
            ))}
          </DashboardTableCard>
        ) : null}
      </div>
      <DashboardTodoCard
        title={t('dashboard.materials.todos')}
        description={t('dashboard.materials.todosDescription')}
        items={[
          ...(catalog.can
            ? [
                {
                  label: t('dashboard.materials.todo.newSku'),
                  to: '/functions/warehouse/materials/new',
                  icon: PackageOpen,
                },
                {
                  label: t('dashboard.materials.todo.names'),
                  to: '/functions/warehouse/materials/names',
                  icon: BookOpen,
                },
                {
                  label: t('dashboard.materials.todo.units'),
                  to: '/functions/warehouse/materials/units',
                  icon: Ruler,
                },
              ]
            : []),
          ...(requests.can
            ? [
                {
                  label: t('dashboard.materials.todo.requests'),
                  to: '/functions/warehouse/materials/requests',
                  icon: ClipboardList,
                  count: pendingRequests.data,
                },
              ]
            : []),
        ]}
      />
    </PageContainer>
  );
}
