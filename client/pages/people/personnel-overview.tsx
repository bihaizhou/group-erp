import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import {
  ArrowLeftRight,
  BriefcaseBusiness,
  CalendarClock,
  Contact,
  FileUser,
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
import { Badge } from '#components/ui/badge';

type EmployeeRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  updatedAt: string;
};

type ChangeRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  data?: { type?: string; effectiveDate?: string };
};

type ContractRow = {
  id: string;
  code: string;
  name: string;
  subjectId: string | null;
  contractEnd: string;
  daysLeft: number;
};

export default function PersonnelOverviewPage() {
  const { t, i18n } = useTranslation();
  const { refresh, busy } = useDashboardRefresh();
  const employees = useCan({
    resource: { type: 'composite', id: 'people.employees' },
    action: 'read',
  });
  const employments = useCan({
    resource: { type: 'composite', id: 'people.employments' },
    action: 'read',
  });
  const assignments = useCan({
    resource: { type: 'composite', id: 'people.assignments' },
    action: 'read',
  });
  const changes = useCan({
    resource: { type: 'composite', id: 'people.changes' },
    action: 'read',
  });

  const activeEmployees = useDashboardCount(
    'people',
    'activeEmployees',
    'people/employees',
    { status: 'active' },
    employees.can,
  );
  const pendingChanges = useDashboardCount(
    'people',
    'pendingChanges',
    'people/changes',
    { status: 'pending' },
    changes.can,
  );
  const employmentCount = useDashboardCount(
    'people',
    'employments',
    'people/employments',
    {},
    employments.can,
  );
  const assignmentCount = useDashboardCount(
    'people',
    'assignments',
    'people/assignments',
    {},
    assignments.can,
  );
  const contractExpiries = useDashboardCount(
    'people',
    'contractExpiries',
    'people/contract-expiries',
    { days: 90 },
    employments.can,
  );
  const recentContracts = useDashboardList<ContractRow>(
    'people',
    'recentContracts',
    'people/contract-expiries',
    { days: 90 },
    employments.can,
  );
  const recentEmployees = useDashboardList<EmployeeRow>(
    'people',
    'recentEmployees',
    'people/employees',
    {},
    employees.can,
  );
  const recentChanges = useDashboardList<ChangeRow>(
    'people',
    'recentChanges',
    'people/changes',
    {},
    changes.can,
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.people.title')}
        description={t('dashboard.people.description')}
        actions={<DashboardRefresh busy={busy} onClick={refresh} />}
      />
      <DashboardMetricGrid>
        {employees.can ? (
          <DashboardMetric
            label={t('dashboard.people.metrics.activeEmployees')}
            value={activeEmployees.data}
            isLoading={activeEmployees.isPending}
            icon={Contact}
            to='/functions/personnel/employees?status=active'
          />
        ) : null}
        {changes.can ? (
          <DashboardMetric
            label={t('dashboard.people.metrics.pendingChanges')}
            value={pendingChanges.data}
            isLoading={pendingChanges.isPending}
            icon={ArrowLeftRight}
            to='/functions/personnel/changes?status=pending'
          />
        ) : null}
        {employments.can ? (
          <DashboardMetric
            label={t('dashboard.people.metrics.employments')}
            value={employmentCount.data}
            isLoading={employmentCount.isPending}
            icon={FileUser}
            to='/functions/personnel/employments'
          />
        ) : null}
        {assignments.can ? (
          <DashboardMetric
            label={t('dashboard.people.metrics.assignments')}
            value={assignmentCount.data}
            isLoading={assignmentCount.isPending}
            icon={BriefcaseBusiness}
            to='/functions/personnel/assignments'
          />
        ) : null}
        {employments.can ? (
          <DashboardMetric
            label={t('dashboard.people.metrics.contracts')}
            value={contractExpiries.data}
            isLoading={contractExpiries.isPending}
            icon={CalendarClock}
            to='/functions/personnel/employments'
          />
        ) : null}
      </DashboardMetricGrid>
      {employments.can ? (
        <DashboardTableCard
          title={t('dashboard.people.contractExpiries')}
          description={t('dashboard.people.contractExpiriesDescription')}
          columns={[
            t('dashboard.common.name'),
            t('dashboard.people.contractDate'),
            t('dashboard.people.contractLeft'),
          ]}
          isLoading={recentContracts.isPending}
          isError={recentContracts.isError}
          onRetry={() => void recentContracts.refetch()}
          isEmpty={recentContracts.data?.length === 0}
          footer={
            <DashboardViewAll to='/functions/personnel/employments'>
              {t('dashboard.viewAll')}
            </DashboardViewAll>
          }
        >
          {recentContracts.data?.slice(0, 5).map((row) => (
            <TableRow key={row.id}>
              <TableCell className='font-medium'>{row.name}</TableCell>
              <TableCell className='text-muted-foreground'>
                {formatDashboardDate(row.contractEnd, i18n.language)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={row.daysLeft < 0 ? 'destructive' : 'secondary'}
                  className='tabular-nums'
                >
                  {row.daysLeft < 0
                    ? t('dashboard.people.contractExpired', {
                        count: Math.abs(row.daysLeft),
                      })
                    : t('dashboard.people.contractDays', {
                        count: row.daysLeft,
                      })}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </DashboardTableCard>
      ) : null}
      <div className='grid gap-4 2xl:grid-cols-2'>
        {employees.can ? (
          <DashboardTableCard
            title={t('dashboard.people.recentEmployees')}
            description={t('dashboard.people.recentEmployeesDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.name'),
              t('dashboard.common.status'),
              t('dashboard.common.date'),
            ]}
            isLoading={recentEmployees.isPending}
            isError={recentEmployees.isError}
            onRetry={() => void recentEmployees.refetch()}
            isEmpty={recentEmployees.data?.length === 0}
            footer={
              <DashboardViewAll to='/functions/personnel/employees'>
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentEmployees.data?.map((row) => (
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
        {changes.can ? (
          <DashboardTableCard
            title={t('dashboard.people.recentChanges')}
            description={t('dashboard.people.recentChangesDescription')}
            columns={[
              t('dashboard.common.code'),
              t('dashboard.common.name'),
              t('dashboard.common.type'),
              t('dashboard.common.status'),
            ]}
            isLoading={recentChanges.isPending}
            isError={recentChanges.isError}
            onRetry={() => void recentChanges.refetch()}
            isEmpty={recentChanges.data?.length === 0}
            footer={
              <DashboardViewAll to='/functions/personnel/changes'>
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentChanges.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>{row.code}</TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>
                  {row.data?.type ? t(`people.values.${row.data.type}`) : '—'}
                </TableCell>
                <TableCell>
                  <DashboardStatus status={row.status} />
                </TableCell>
              </TableRow>
            ))}
          </DashboardTableCard>
        ) : null}
      </div>
      <DashboardTodoCard
        title={t('dashboard.people.todos')}
        description={t('dashboard.people.todosDescription')}
        items={[
          ...(employees.can
            ? [
                {
                  label: t('dashboard.people.todo.employees'),
                  to: '/functions/personnel/employees',
                  icon: Contact,
                  count: activeEmployees.data,
                },
              ]
            : []),
          ...(changes.can
            ? [
                {
                  label: t('dashboard.people.todo.pending'),
                  to: '/functions/personnel/changes?status=pending',
                  icon: ArrowLeftRight,
                  count: pendingChanges.data,
                },
              ]
            : []),
          ...(employments.can
            ? [
                {
                  label: t('dashboard.people.todo.employments'),
                  to: '/functions/personnel/employments',
                  icon: FileUser,
                },
              ]
            : []),
          ...(assignments.can
            ? [
                {
                  label: t('dashboard.people.todo.assignments'),
                  to: '/functions/personnel/assignments',
                  icon: BriefcaseBusiness,
                },
              ]
            : []),
        ]}
      />
    </PageContainer>
  );
}
