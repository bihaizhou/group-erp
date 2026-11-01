import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import {
  Boxes,
  Building2,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ClipboardList,
  FileBadge,
  Gauge,
  Gem,
  Info,
  Mountain,
  RefreshCw,
  ShieldAlert,
  ShoppingCart,
  Siren,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { cn } from 'cn';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  DashboardMetric,
  DashboardMetricGrid,
  DashboardViewAll,
} from '#components/module-dashboard/index';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '#components/ui/alert';
import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { DatePicker } from '#components/date-picker';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Skeleton } from '#components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import type {
  OperationsCompanyOverview,
  OperationsOptions,
  OperationsOverview,
} from './model.js';

const displayNumber = (
  value: string | number | null | undefined,
  language: string,
): string => {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString(language)
    : String(value);
};

const displayRate = (
  value: string | null | undefined,
  language: string,
): string => {
  if (value === null || value === undefined || value === '') return '—';
  return `${displayNumber(value, language)}%`;
};

function ErrorNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <Alert variant='destructive'>
      <CircleAlert aria-hidden />
      <AlertTitle>{t('operations.loadFailed')}</AlertTitle>
      <AlertDescription className='break-words'>
        {t('operations.loadFailedDescription')}
      </AlertDescription>
      <AlertAction>
        <Button type='button' variant='outline' size='sm' onClick={onRetry}>
          {t('operations.retry')}
        </Button>
      </AlertAction>
    </Alert>
  );
}

function EmptyPanel({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <Empty className={cn('min-h-48 border border-dashed', className)}>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function MetricSkeleton({
  label,
  icon: Icon,
}: {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <Card className='h-full'>
      <CardHeader>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0 flex-1 space-y-1.5'>
            <CardDescription>{label}</CardDescription>
            <Skeleton className='h-9 w-24' />
            <Skeleton className='h-3 w-28' />
          </div>
          <span className='grid size-10 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary'>
            <Icon aria-hidden className='size-5' />
          </span>
        </div>
      </CardHeader>
    </Card>
  );
}

function TableSkeleton({
  className,
  columns,
  rows,
}: {
  className?: string;
  columns: number;
  rows: number;
}) {
  return (
    <Card className={cn('flex h-full min-w-0 flex-col', className)}>
      <CardHeader>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-3 w-56' />
      </CardHeader>
      <CardContent className='flex flex-1 flex-col gap-2'>
        <div className='flex gap-3 border-b pb-2'>
          {Array.from({ length: columns }, (_, index) => (
            <Skeleton key={index} className='h-3 flex-1' />
          ))}
        </div>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className='flex gap-3 py-1.5'>
            {Array.from({ length: columns }, (_, column) => (
              <Skeleton key={column} className='h-4 flex-1' />
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ListSkeleton({ className }: { className?: string }) {
  return (
    <Card className={cn('flex h-full min-w-0 flex-col', className)}>
      <CardHeader>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-3 w-56' />
      </CardHeader>
      <CardContent className='flex flex-1 flex-col gap-4'>
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className='flex items-center gap-3'>
            <Skeleton className='size-8 shrink-0 rounded-lg' />
            <div className='flex-1 space-y-1.5'>
              <Skeleton className='h-3 w-24' />
              <Skeleton className='h-3 w-16' />
            </div>
            <Skeleton className='h-4 w-4 shrink-0' />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function GroupSkeleton() {
  return (
    <Card className='flex h-full min-h-60 min-w-0 flex-col'>
      <CardHeader>
        <Skeleton className='h-5 w-28' />
        <Skeleton className='h-3 w-48' />
      </CardHeader>
      <CardContent className='grid flex-1 grid-cols-2 gap-4'>
        {[0, 1, 2, 3].map((cell) => (
          <div key={cell} className='space-y-2'>
            <Skeleton className='h-3 w-20' />
            <Skeleton className='h-6 w-12' />
          </div>
        ))}
      </CardContent>
      <div className='px-4 pt-3'>
        <Skeleton className='h-3 w-20' />
      </div>
    </Card>
  );
}

const metricSkeletons = [
  { key: 'processed', icon: Boxes },
  { key: 'metal', icon: Gem },
  { key: 'sand', icon: Mountain },
  { key: 'metalRate', icon: Gauge },
] as const;

function SummarySkeleton() {
  const { t } = useTranslation();
  return (
    <div aria-busy='true' className='space-y-4'>
      <DashboardMetricGrid>
        {metricSkeletons.map(({ key, icon }) => (
          <MetricSkeleton
            key={key}
            label={t(`operations.${key}`)}
            icon={icon}
          />
        ))}
      </DashboardMetricGrid>
      <div className='grid gap-4 lg:grid-cols-3'>
        <TableSkeleton
          className='min-h-80 lg:col-span-2'
          columns={5}
          rows={5}
        />
        <ListSkeleton className='min-h-80' />
      </div>
      <div className='grid gap-4 lg:grid-cols-3'>
        <GroupSkeleton />
        <GroupSkeleton />
        <GroupSkeleton />
      </div>
    </div>
  );
}

type RiskItem = {
  key: string;
  label: string;
  hint?: string;
  count: number;
  to: string;
  icon: LucideIcon;
};

function RiskCard({ data }: { data: OperationsOverview }) {
  const { t, i18n } = useTranslation();
  const risks: RiskItem[] = [
    ...(data.issues.open > 0
      ? [
          {
            key: 'issues',
            label: t('operations.issueOpen'),
            hint:
              data.issues.overdue > 0
                ? t('operations.issueOverdue', {
                    count: data.issues.overdue.toLocaleString(i18n.language),
                  })
                : undefined,
            count: data.issues.open,
            to: '/functions/operations/issues',
            icon: CircleAlert,
          },
        ]
      : []),
    ...(data.hse.hazardsOpen > 0
      ? [
          {
            key: 'hazards',
            label: t('operations.hazardsOpen'),
            hint:
              data.hse.hazardsOverdue > 0
                ? t('operations.hazardsOverdueHint', {
                    count: data.hse.hazardsOverdue.toLocaleString(
                      i18n.language,
                    ),
                  })
                : undefined,
            count: data.hse.hazardsOpen,
            to: '/functions/hse/hazards',
            icon: ShieldAlert,
          },
        ]
      : []),
    ...(data.hse.incidentsOpen > 0
      ? [
          {
            key: 'incidents',
            label: t('operations.incidentsOpen'),
            count: data.hse.incidentsOpen,
            to: '/functions/hse/incidents',
            icon: Siren,
          },
        ]
      : []),
    ...(data.hse.certificatesExpiring90 > 0
      ? [
          {
            key: 'certificates',
            label: t('operations.certificatesExpiring90'),
            count: data.hse.certificatesExpiring90,
            to: '/functions/hse/certificates',
            icon: FileBadge,
          },
        ]
      : []),
  ];
  return (
    <Card className='flex h-full min-w-0 flex-col'>
      <CardHeader>
        <CardTitle>{t('operations.riskTitle')}</CardTitle>
        <CardDescription>{t('operations.riskDescription')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-1 flex-col'>
        {risks.length ? (
          <div className='-mx-2 flex flex-col'>
            {risks.map((risk) => (
              <Link
                key={risk.key}
                to={risk.to}
                className='flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted'
              >
                <span className='grid size-8 shrink-0 place-items-center rounded-md bg-destructive/8 text-destructive'>
                  <risk.icon aria-hidden className='size-4' />
                </span>
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>
                    {risk.label}
                  </span>
                  {risk.hint ? (
                    <span className='block truncate text-xs text-destructive'>
                      {risk.hint}
                    </span>
                  ) : null}
                </span>
                <span className='text-lg font-semibold tabular-nums'>
                  {risk.count.toLocaleString(i18n.language)}
                </span>
                <ChevronRight
                  aria-hidden
                  className='size-4 shrink-0 text-muted-foreground'
                />
              </Link>
            ))}
          </div>
        ) : (
          <Empty className='min-h-40 flex-1 border border-dashed'>
            <EmptyHeader>
              <EmptyMedia variant='icon'>
                <CircleCheck aria-hidden />
              </EmptyMedia>
              <EmptyTitle>{t('operations.riskClear')}</EmptyTitle>
              <EmptyDescription>
                {t('operations.riskClearDescription')}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </CardContent>
    </Card>
  );
}

function UnitOutputCard({ data }: { data: OperationsOverview }) {
  const { t, i18n } = useTranslation();
  const units = data.units
    .filter((unit) => unit.reports > 0)
    .sort((a, b) => Number(b.processed) - Number(a.processed))
    .slice(0, 10);
  const maxProcessed = Math.max(
    0,
    ...units.map((unit) => Number(unit.processed)),
  );
  return (
    <Card className='flex h-full min-w-0 flex-col lg:col-span-2'>
      <CardHeader>
        <CardTitle>{t('operations.unitRanking')}</CardTitle>
        <CardDescription>
          {t('operations.unitRankingDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className='flex flex-1 flex-col'>
        {units.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope='col' className='sticky left-0 z-10 bg-muted'>
                  {t('operations.unit')}
                </TableHead>
                <TableHead scope='col' className='text-right'>
                  {t('operations.processed')}
                </TableHead>
                <TableHead scope='col' className='text-right'>
                  {t('operations.metal')}
                </TableHead>
                <TableHead scope='col' className='text-right'>
                  {t('operations.sand')}
                </TableHead>
                <TableHead scope='col' className='text-right'>
                  {t('operations.metalRate')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map((unit) => {
                const width =
                  maxProcessed > 0
                    ? Math.round((Number(unit.processed) / maxProcessed) * 100)
                    : 0;
                return (
                  <TableRow key={unit.unitId}>
                    <TableCell className='sticky left-0 z-10 max-w-56 truncate bg-card font-medium'>
                      {unit.unitName}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      <span className='inline-flex items-center justify-end gap-2 whitespace-nowrap'>
                        <span
                          aria-hidden
                          className='h-1.5 w-16 overflow-hidden rounded-full bg-muted'
                        >
                          <span
                            className='block h-full rounded-full bg-primary'
                            style={{ width: `${width}%` }}
                          />
                        </span>
                        {displayNumber(unit.processed, i18n.language)}
                      </span>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {displayNumber(unit.metal, i18n.language)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {displayNumber(unit.sand, i18n.language)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {displayRate(unit.metalRate, i18n.language)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <EmptyPanel
            icon={ClipboardList}
            title={t('operations.emptyUnits')}
            description={t('operations.emptyUnitsDescription')}
            className='flex-1'
          />
        )}
        <div className='mt-auto pt-3'>
          <DashboardViewAll to='/functions/production/shift-reports'>
            {t('operations.viewShiftReports')}
          </DashboardViewAll>
        </div>
      </CardContent>
    </Card>
  );
}

type StatItem = { label: string; value: string; hint?: string };
type FooterLink = { label: string; to: string };

function GroupCard({
  title,
  description,
  icon: Icon,
  stats,
  links,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  stats: readonly StatItem[];
  links: readonly FooterLink[];
}) {
  return (
    <Card className='flex h-full min-w-0 flex-col'>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <span className='grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground'>
            <Icon aria-hidden className='size-4' />
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className='flex flex-1 flex-col gap-4'>
        <dl className='grid grid-cols-2 gap-x-4 gap-y-4'>
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className='text-xs leading-5 text-muted-foreground'>
                {stat.label}
              </dt>
              <dd className='font-heading text-xl font-semibold tabular-nums'>
                {stat.value}
              </dd>
              {stat.hint ? (
                <dd className='text-xs text-muted-foreground'>{stat.hint}</dd>
              ) : null}
            </div>
          ))}
        </dl>
        <div className='mt-auto flex flex-wrap gap-x-4 gap-y-1 border-t pt-3'>
          {links.map((link) => (
            <DashboardViewAll key={link.to} to={link.to}>
              {link.label}
            </DashboardViewAll>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryView({ data }: { data: OperationsOverview }) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const rate = data.production.metalRate;
  return (
    <div className='space-y-4'>
      <DashboardMetricGrid>
        <DashboardMetric
          label={t('operations.processed')}
          value={displayNumber(data.production.processed, language)}
          hint={t('operations.reportsCount', {
            count: data.production.reports.toLocaleString(language),
          })}
          icon={Boxes}
        />
        <DashboardMetric
          label={t('operations.metal')}
          value={displayNumber(data.production.metal, language)}
          icon={Gem}
        />
        <DashboardMetric
          label={t('operations.sand')}
          value={displayNumber(data.production.sand, language)}
          icon={Mountain}
        />
        <DashboardMetric
          label={t('operations.metalRate')}
          value={displayRate(rate, language)}
          hint={
            rate === null ? t('operations.rateEmpty') : t('operations.rateHint')
          }
          icon={Gauge}
        />
      </DashboardMetricGrid>

      <div className='grid gap-4 lg:grid-cols-3'>
        <UnitOutputCard data={data} />
        <RiskCard data={data} />
      </div>

      <div className='grid gap-4 lg:grid-cols-3'>
        <GroupCard
          title={t('operations.stockTitle')}
          description={
            data.warehouse.stockConfigured
              ? t('operations.stockHint')
              : t('operations.stockNotConfigured')
          }
          icon={Warehouse}
          stats={[
            {
              label: t('operations.stockMetal'),
              value: data.warehouse.stockConfigured
                ? displayNumber(data.warehouse.stockMetal, language)
                : '—',
            },
            {
              label: t('operations.stockSand'),
              value: data.warehouse.stockConfigured
                ? displayNumber(data.warehouse.stockSand, language)
                : '—',
            },
            {
              label: t('operations.receiptDraft'),
              value: displayNumber(data.warehouse.receiptDraft, language),
            },
            {
              label: t('operations.receiptPostedLabel'),
              value: displayNumber(data.warehouse.receiptPosted, language),
            },
          ]}
          links={[
            {
              label: t('operations.openWarehouse'),
              to: '/functions/warehouse/overview',
            },
          ]}
        />
        <GroupCard
          title={t('operations.tradeTitle')}
          description={t('operations.tradeDescription')}
          icon={ShoppingCart}
          stats={[
            {
              label: t('operations.salesOpen'),
              value: displayNumber(data.sales.openOrders, language),
            },
            {
              label: t('operations.salesShippedToday'),
              value: displayNumber(data.sales.shippedToday, language),
            },
            {
              label: t('operations.procurementOpen'),
              value: displayNumber(data.procurement.openOrders, language),
            },
            {
              label: t('operations.procurementReceivedToday'),
              value: displayNumber(data.procurement.receivedToday, language),
            },
          ]}
          links={[
            {
              label: t('operations.openSales'),
              to: '/functions/sales/overview',
            },
            {
              label: t('operations.openProcurement'),
              to: '/functions/procurement/overview',
            },
          ]}
        />
        <GroupCard
          title={t('operations.peopleEquipmentTitle')}
          description={t('operations.peopleEquipmentDescription')}
          icon={Users}
          stats={[
            {
              label: t('operations.peopleActive'),
              value: displayNumber(data.people.active, language),
            },
            {
              label: t('operations.peopleProductionLabel'),
              value: displayNumber(data.people.production, language),
            },
            {
              label: t('operations.maintenanceOpen'),
              value: displayNumber(data.maintenance.openOrders, language),
            },
            {
              label: t('operations.downtimeOpen'),
              value: displayNumber(data.downtime.open, language),
              hint: t('operations.downtimeMinutes', {
                minutes: data.downtime.minutesToday.toLocaleString(language),
              }),
            },
          ]}
          links={[
            { label: t('operations.openPeople'), to: '/functions/personnel' },
            {
              label: t('operations.openEquipment'),
              to: '/functions/production/equipment',
            },
          ]}
        />
      </div>
    </div>
  );
}

function CompanyComparison({
  data,
  loading,
  onSelect,
}: {
  data: OperationsCompanyOverview | undefined;
  loading: boolean;
  onSelect: (subjectId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const columns = [
    t('operations.company'),
    t('operations.processed'),
    t('operations.metalRate'),
    t('operations.stockMetal'),
    t('operations.stockSand'),
    t('operations.salesOpen'),
    t('operations.procurementOpen'),
    t('operations.peopleActive'),
    t('operations.issueOpen'),
  ];
  const head = (
    <TableHeader>
      <TableRow>
        {columns.map((column, index) => (
          <TableHead
            key={column}
            scope='col'
            className={cn(
              index === 0 && 'sticky left-0 z-10 bg-muted',
              index > 0 && 'text-right',
            )}
          >
            {column}
          </TableHead>
        ))}
      </TableRow>
    </TableHeader>
  );
  return (
    <Card className='min-w-0'>
      <CardHeader>
        <CardTitle>{t('operations.companiesTitle')}</CardTitle>
        <CardDescription>
          {t('operations.companiesDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Table>
            {head}
            <TableBody>
              {['one', 'two', 'three', 'four', 'five'].map((row) => (
                <TableRow key={row}>
                  {columns.map((column, index) => (
                    <TableCell
                      key={column}
                      className={cn(
                        index === 0 && 'sticky left-0 z-10 bg-card',
                      )}
                    >
                      <Skeleton className='h-4 w-full max-w-24' />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : data && data.items.length ? (
          <Table>
            {head}
            <TableBody>
              {data.items.map((item) => (
                <TableRow
                  key={item.subjectId ?? item.subjectName}
                  className='group/row'
                >
                  <TableCell className='sticky left-0 z-10 bg-card group-hover/row:bg-muted/50'>
                    <button
                      type='button'
                      onClick={() => onSelect(item.subjectId ?? '')}
                      aria-label={t('operations.companyDetail', {
                        name: item.subjectName,
                      })}
                      className='inline-flex items-center gap-1 whitespace-nowrap text-left font-medium transition-colors hover:text-primary focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                    >
                      {item.subjectName}
                      <ChevronRight
                        aria-hidden
                        className='size-3.5 text-muted-foreground'
                      />
                    </button>
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {displayNumber(item.production.processed, language)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {displayRate(item.production.metalRate, language)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {item.warehouse.stockConfigured
                      ? displayNumber(item.warehouse.stockMetal, language)
                      : '—'}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {item.warehouse.stockConfigured
                      ? displayNumber(item.warehouse.stockSand, language)
                      : '—'}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {displayNumber(item.sales.openOrders, language)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {displayNumber(item.procurement.openOrders, language)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {displayNumber(item.people.active, language)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {displayNumber(item.issues.open, language)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyPanel
            icon={Building2}
            title={t('operations.noCompanies')}
            description={t('operations.noCompaniesDescription')}
          />
        )}
      </CardContent>
    </Card>
  );
}

function DataNote() {
  const { t } = useTranslation();
  return (
    <p className='flex items-start gap-2 text-xs leading-5 text-muted-foreground'>
      <Info aria-hidden className='mt-0.5 size-3.5 shrink-0' />
      <span>{t('operations.notes')}</span>
    </p>
  );
}

export default function OperationsOverviewPage() {
  const { t } = useTranslation();
  const api = useApiClient();
  const [subjectId, setSubjectId] = useState('');
  const [view, setView] = useState<'summary' | 'companies'>('summary');
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString('en-CA'),
  );
  const options = useQuery({
    retry: false,
    queryKey: ['operations-options'],
    queryFn: ({ signal }) =>
      api.request<{ data: OperationsOptions }>({
        path: 'operations/options',
        signal,
      }),
  });
  const subjects = options.data?.data.subjects ?? [];
  const overview = useQuery({
    retry: false,
    placeholderData: keepPreviousData,
    queryKey: ['operations-overview', subjectId, date],
    queryFn: ({ signal }) =>
      api.request<{ data: OperationsOverview }>({
        path: 'operations/overview',
        query: {
          ...(subjectId ? { subjectId } : {}),
          date,
        },
        signal,
      }),
  });
  const companies = useQuery({
    retry: false,
    enabled: view === 'companies',
    placeholderData: keepPreviousData,
    queryKey: ['operations-company-overview', date],
    queryFn: ({ signal }) =>
      api.request<{ data: OperationsCompanyOverview }>({
        path: 'operations/company-overview',
        query: { date },
        signal,
      }),
  });
  const busy =
    options.isFetching || overview.isFetching || companies.isFetching;
  const refresh = () => {
    void options.refetch();
    void overview.refetch();
    if (view === 'companies') void companies.refetch();
  };
  const companyItems = [
    { value: '', label: t('operations.allCompanies') },
    ...subjects.map((subject) => ({
      value: subject.id,
      label: subject.name,
    })),
  ];
  return (
    <PageContainer>
      <PageHeader
        title={t('operations.overview')}
        description={t('operations.overviewDescription')}
        actions={
          <Button
            type='button'
            variant='outline'
            disabled={busy}
            onClick={refresh}
          >
            <RefreshCw
              aria-hidden
              className={cn('size-4', busy && 'animate-spin')}
            />
            {t('operations.refresh')}
          </Button>
        }
      />
      <Tabs
        className='gap-4'
        value={view}
        onValueChange={(value) =>
          setView(value === 'companies' ? 'companies' : 'summary')
        }
      >
        <div className='flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between'>
          <div className='grid gap-2 sm:flex sm:flex-wrap sm:items-center'>
            <Select
              items={companyItems}
              value={subjectId}
              disabled={options.isPending || options.isError}
              onValueChange={(value) => {
                setSubjectId(value ?? '');
                setView('summary');
              }}
            >
              <SelectTrigger
                className='w-full sm:w-56'
                aria-label={t('operations.company')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                <SelectGroup>
                  {companyItems.map((item) => (
                    <SelectItem key={item.value || 'all'} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className='w-full sm:w-40'>
              <DatePicker
                value={date}
                label={t('operations.date')}
                onChange={(next) => {
                  if (next) setDate(next);
                }}
              />
            </div>
          </div>
          <TabsList
            className='w-full sm:w-fit'
            aria-label={t('operations.viewLabel')}
          >
            <TabsTrigger value='summary'>
              {t('operations.viewSummary')}
            </TabsTrigger>
            <TabsTrigger value='companies'>
              {t('operations.viewCompanies')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value='summary' className='space-y-4'>
          {overview.isError ? (
            <ErrorNotice onRetry={() => void overview.refetch()} />
          ) : null}
          {overview.isPending ? (
            <SummarySkeleton />
          ) : overview.data ? (
            <SummaryView data={overview.data.data} />
          ) : null}
        </TabsContent>

        <TabsContent value='companies' className='space-y-4'>
          {companies.isError ? (
            <ErrorNotice onRetry={() => void companies.refetch()} />
          ) : (
            <CompanyComparison
              data={companies.data?.data}
              loading={companies.isPending}
              onSelect={(id) => {
                setSubjectId(id);
                setView('summary');
              }}
            />
          )}
        </TabsContent>
      </Tabs>
      <DataNote />
    </PageContainer>
  );
}
