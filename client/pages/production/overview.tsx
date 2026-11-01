import { useMemo, useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  Settings2,
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
  useDashboardList,
  useDashboardRefresh,
} from '#components/module-dashboard/index';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { TableCell, TableRow } from '#components/ui/table';

type Unit = {
  id: string;
  code: string;
  name: string;
};

type ShiftReport = {
  id: string;
  reportDate: string;
  shift: string;
  status: string;
  processedQuantity: string;
  metalQuantity: string;
  sandQuantity: string;
  runtimeMinutes: number | string;
};

const sum = (
  rows: readonly ShiftReport[] | undefined,
  field: keyof ShiftReport,
) => (rows ?? []).reduce((total, row) => total + Number(row[field] || 0), 0);

const round = (value: number) => Math.round(value * 100) / 100;

export default function ProductionOverviewPage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const [params] = useSearchParams();
  const subjectId = params.get('subjectId') ?? '';
  const { refresh, busy } = useDashboardRefresh();
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const setup = useQuery({
    queryKey: ['moduleDashboard', 'production', 'setup', subjectId],
    queryFn: ({ signal }) =>
      api.request<{ data: { units: Unit[] } }>({
        path: 'production/setup',
        query: { subjectId },
        signal,
      }),
    enabled: Boolean(subjectId),
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const units = setup.data?.data.units ?? [];
  const unitId =
    selectedUnitId && units.some((unit) => unit.id === selectedUnitId)
      ? selectedUnitId
      : (units[0]?.id ?? '');
  const [today] = useState(() => new Date().toLocaleDateString('en-CA'));

  const todayReports = useDashboardList<ShiftReport>(
    'production',
    `today-${unitId}`,
    'production/shift-reports',
    { unitId, reportDate: today },
    Boolean(unitId),
    'nested',
  );
  const recentReports = useDashboardList<ShiftReport>(
    'production',
    `recent-${unitId}`,
    'production/shift-reports',
    { unitId },
    Boolean(unitId),
    'nested',
  );

  const totals = useMemo(
    () => ({
      processed: round(sum(todayReports.data, 'processedQuantity')),
      metal: round(sum(todayReports.data, 'metalQuantity')),
      sand: round(sum(todayReports.data, 'sandQuantity')),
      runtime: round(sum(todayReports.data, 'runtimeMinutes')),
    }),
    [todayReports.data],
  );
  const unitName = units.find((unit) => unit.id === unitId)?.name;

  return (
    <PageContainer>
      <PageHeader
        title={t('dashboard.production.title')}
        description={t('dashboard.production.description')}
        actions={
          <div className='flex flex-wrap items-center gap-2'>
            {units.length > 1 ? (
              <Select
                items={units.map((unit) => ({
                  value: unit.id,
                  label: unit.name,
                }))}
                value={unitId}
                onValueChange={(value) => setSelectedUnitId(value ?? '')}
              >
                <SelectTrigger aria-label={t('dashboard.production.unit')}>
                  <SelectValue>{unitName}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {units.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : null}
            <DashboardRefresh busy={busy} onClick={refresh} />
          </div>
        }
      />
      {setup.isError ? (
        <p className='text-sm text-muted-foreground'>
          {t('dashboard.loadFailed')}
        </p>
      ) : !setup.isPending && !units.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('dashboard.production.noUnits')}
        </p>
      ) : (
        <>
          <DashboardMetricGrid>
            <DashboardMetric
              label={t('dashboard.production.metrics.processed')}
              value={totals.processed}
              isLoading={todayReports.isPending}
              icon={ClipboardCheck}
            />
            <DashboardMetric
              label={t('dashboard.production.metrics.metal')}
              value={totals.metal}
              isLoading={todayReports.isPending}
              icon={FileText}
            />
            <DashboardMetric
              label={t('dashboard.production.metrics.sand')}
              value={totals.sand}
              isLoading={todayReports.isPending}
              icon={FileText}
            />
            <DashboardMetric
              label={t('dashboard.production.metrics.runtime')}
              value={totals.runtime}
              isLoading={todayReports.isPending}
              icon={CalendarDays}
            />
          </DashboardMetricGrid>
          <DashboardTableCard
            title={t('dashboard.production.recentReports')}
            description={
              unitName
                ? `${unitName} · ${t('dashboard.production.recentReportsDescription')}`
                : t('dashboard.production.recentReportsDescription')
            }
            columns={[
              t('dashboard.common.date'),
              t('dashboard.common.shift'),
              t('dashboard.common.processed'),
              t('dashboard.common.status'),
            ]}
            isLoading={recentReports.isPending}
            isError={recentReports.isError}
            onRetry={() => void recentReports.refetch()}
            isEmpty={recentReports.data?.length === 0}
            footer={
              <DashboardViewAll to='/functions/production/shift-reports'>
                {t('dashboard.viewAll')}
              </DashboardViewAll>
            }
          >
            {recentReports.data?.map((row) => (
              <TableRow key={row.id}>
                <TableCell className='font-medium'>
                  {formatDashboardDate(row.reportDate, i18n.language)}
                </TableCell>
                <TableCell>{t(`production.shifts.${row.shift}`)}</TableCell>
                <TableCell className='tabular-nums'>
                  {Number(row.processedQuantity || 0).toLocaleString(
                    i18n.language,
                  )}
                </TableCell>
                <TableCell>
                  <DashboardStatus status={row.status} />
                </TableCell>
              </TableRow>
            ))}
          </DashboardTableCard>
          <DashboardTodoCard
            title={t('dashboard.production.todos')}
            description={t('dashboard.production.todosDescription')}
            items={[
              {
                label: t('dashboard.production.todo.report'),
                to: '/functions/production/shift-reports',
                icon: FileText,
              },
              {
                label: t('dashboard.production.todo.daily'),
                to: '/functions/production/daily',
                icon: ClipboardCheck,
              },
              {
                label: t('dashboard.production.todo.schedules'),
                to: '/functions/production/schedules',
                icon: CalendarDays,
              },
              {
                label: t('dashboard.production.todo.setup'),
                to: '/functions/production/setup',
                icon: Settings2,
              },
            ]}
          />
        </>
      )}
    </PageContainer>
  );
}
