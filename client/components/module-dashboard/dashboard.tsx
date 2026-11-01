import type { ReactNode } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { ChevronRight, RefreshCw, type LucideIcon } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '#components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Skeleton } from '#components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { StatusBadge } from '#components/status-badge';

const statusTones = {
  draft: 'neutral',
  pending: 'warning',
  counting: 'warning',
  open: 'warning',
  partial: 'warning',
  overdue: 'warning',
  approved: 'success',
  posted: 'success',
  effective: 'success',
  active: 'success',
  confirmed: 'success',
  issued: 'success',
  received: 'success',
  resolved: 'success',
  completed: 'success',
  cancelled: 'neutral',
  withdrawn: 'neutral',
  inactive: 'neutral',
  void: 'neutral',
  closed: 'neutral',
} as const;

/** Status label with one shared tone mapping, so every dashboard reads the same. */
export function DashboardStatus({
  status,
  className,
}: {
  readonly status?: string | null;
  readonly className?: string;
}): ReactNode {
  const { t } = useTranslation();
  if (!status) {
    return <span className='text-muted-foreground'>—</span>;
  }
  const tone = statusTones[status as keyof typeof statusTones];
  if (!tone) {
    return <span className='text-sm'>{status}</span>;
  }
  return (
    <StatusBadge tone={tone} size='sm' className={className}>
      {t(`dashboard.status.${status}`)}
    </StatusBadge>
  );
}

/** One KPI card. Wrapping `to` turns the whole card into a link to the filtered list. */
export function DashboardMetric({
  label,
  value,
  hint,
  icon: Icon,
  to,
  isLoading,
}: {
  readonly label: string;
  readonly value?: number | string | null;
  readonly hint?: string;
  readonly icon?: LucideIcon;
  readonly to?: string;
  readonly isLoading?: boolean;
}): ReactNode {
  const { i18n } = useTranslation();
  const display =
    typeof value === 'number'
      ? value.toLocaleString(i18n.language)
      : (value ?? '—');
  const card = (
    <Card className='h-full transition-all group-hover:ring-foreground/20'>
      <CardHeader>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0 space-y-1.5'>
            <CardDescription>{label}</CardDescription>
            {isLoading ? (
              <Skeleton className='h-9 w-20' />
            ) : (
              <CardTitle className='font-heading text-3xl font-semibold tabular-nums'>
                {display}
              </CardTitle>
            )}
            {hint ? (
              <p className='text-xs leading-5 text-muted-foreground'>{hint}</p>
            ) : null}
          </div>
          {Icon ? (
            <span className='grid size-10 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary'>
              <Icon aria-hidden className='size-5' />
            </span>
          ) : null}
        </div>
      </CardHeader>
    </Card>
  );
  return to ? (
    <Link
      to={to}
      className='group block rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
    >
      {card}
    </Link>
  ) : (
    card
  );
}

export function DashboardMetricGrid({
  children,
}: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>{children}</div>
  );
}

function DashboardCardError({
  onRetry,
}: {
  readonly onRetry?: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col items-start gap-2 py-6'>
      <p className='text-sm text-muted-foreground'>
        {t('dashboard.loadFailed')}
      </p>
      {onRetry ? (
        <Button variant='outline' size='sm' onClick={onRetry}>
          {t('dashboard.retry')}
        </Button>
      ) : null}
    </div>
  );
}

/** Card with a title, an optional "view all" action and a table body. */
export function DashboardTableCard({
  title,
  description,
  action,
  columns,
  children,
  isEmpty,
  isLoading,
  isError,
  onRetry,
  footer,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
  readonly columns: readonly string[];
  readonly children?: ReactNode;
  readonly isEmpty?: boolean;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly onRetry?: () => void;
  readonly footer?: ReactNode;
  readonly className?: string;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        {isError ? (
          <DashboardCardError onRetry={onRetry} />
        ) : isLoading ? (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {['one', 'two', 'three', 'four'].map((key) => (
                <TableRow key={key}>
                  {columns.map((column) => (
                    <TableCell key={column}>
                      <Skeleton className='h-4 w-full max-w-32' />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : isEmpty ? (
          <p className='py-6 text-sm text-muted-foreground'>
            {t('dashboard.empty')}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>{children}</TableBody>
          </Table>
        )}
        {footer ? <div className='mt-3'>{footer}</div> : null}
      </CardContent>
    </Card>
  );
}

export type DashboardTodoItem = {
  readonly label: string;
  readonly description?: string;
  readonly count?: number;
  readonly to: string;
  readonly icon?: LucideIcon;
};

/** A compact list of "what needs attention now" links. */
export function DashboardTodoCard({
  title,
  description,
  items,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly items: readonly DashboardTodoItem[];
  readonly action?: ReactNode;
}): ReactNode {
  return (
    <Card className='min-w-0'>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {action ? <CardAction>{action}</CardAction> : null}
      </CardHeader>
      <CardContent>
        {items.length ? (
          <div className='-mx-2 flex flex-col'>
            {items.map((item) => (
              <Link
                key={`${item.to}-${item.label}`}
                to={item.to}
                className='flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-muted'
              >
                {item.icon ? (
                  <span className='grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground'>
                    <item.icon aria-hidden className='size-4' />
                  </span>
                ) : null}
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>
                    {item.label}
                  </span>
                  {item.description ? (
                    <span className='block truncate text-xs text-muted-foreground'>
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {typeof item.count === 'number' ? (
                  <span className='text-sm tabular-nums text-muted-foreground'>
                    {item.count}
                  </span>
                ) : null}
                <ChevronRight
                  aria-hidden
                  className='size-4 shrink-0 text-muted-foreground'
                />
              </Link>
            ))}
          </div>
        ) : (
          <DashboardEmptyText />
        )}
      </CardContent>
    </Card>
  );
}

function DashboardEmptyText(): ReactNode {
  const { t } = useTranslation();
  return (
    <p className='py-6 text-sm text-muted-foreground'>{t('dashboard.empty')}</p>
  );
}

/** Outlined refresh button shared by the module dashboards. */
export function DashboardRefresh({
  busy,
  onClick,
}: {
  readonly busy?: boolean;
  readonly onClick: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <Button variant='outline' size='sm' onClick={onClick} disabled={busy}>
      <RefreshCw aria-hidden className={cn('size-4', busy && 'animate-spin')} />
      {t('dashboard.refresh')}
    </Button>
  );
}

/** Inline link used as a card footer. */
export function DashboardViewAll({
  to,
  children,
}: {
  readonly to: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <Link className='text-sm text-primary hover:underline' to={to}>
      {children}
    </Link>
  );
}
