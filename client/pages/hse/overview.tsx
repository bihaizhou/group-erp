import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import {
  HseErrorNotice,
  HseLoading,
  HseRefresh,
  HseStatus,
} from './controls.js';
import type { HseOverview } from './model.js';

export default function HseOverviewPage() {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const query = useQuery({
    retry: false,
    queryKey: ['hse-overview'],
    queryFn: ({ signal }) =>
      api.request<{ data: HseOverview }>({
        path: 'hse/overview',
        signal,
      }),
  });
  const result = query.data?.data;
  const format = (value: string) =>
    value
      ? new Date(value).toLocaleString(i18n.language, {
          dateStyle: 'short',
          timeStyle: 'short',
        })
      : '—';
  const stats = result
    ? [
        ['incidentsOpen', result.counts.incidentsOpen],
        ['incidentsLti', result.counts.incidentsLti],
        ['hazardsOpen', result.counts.hazardsOpen],
        ['hazardsOverdue', result.counts.hazardsOverdue],
        ['certificatesExpiring90', result.counts.certificatesExpiring90],
      ]
    : [];
  return (
    <PageContainer>
      <PageHeader
        title={t('hse.overview')}
        description={t('hse.overviewDescription')}
        actions={
          <HseRefresh
            busy={query.isFetching}
            onClick={() => void query.refetch()}
          />
        }
      />
      {query.isError ? (
        <HseErrorNotice
          error={query.error}
          retry={() => void query.refetch()}
        />
      ) : !result ? (
        <HseLoading />
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {stats.map(([key, value]) => (
              <Card key={String(key)}>
                <CardHeader>
                  <CardDescription>
                    {t(`hse.metrics.${String(key)}`)}
                  </CardDescription>
                  <CardTitle className='text-3xl tabular-nums'>
                    {Number(value).toLocaleString(i18n.language)}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <div className='grid gap-4 xl:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>{t('hse.recentIncidents')}</CardTitle>
                <CardDescription>
                  {t('hse.recentIncidentsDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.recentIncidents.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('hse.fields.incidentNo')}</TableHead>
                        <TableHead>{t('hse.fields.occurredAt')}</TableHead>
                        <TableHead>{t('hse.fields.status')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.recentIncidents.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.incidentNo}</TableCell>
                          <TableCell>{format(row.occurredAt)}</TableCell>
                          <TableCell>
                            <HseStatus status={row.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('hse.emptyIncidents')}
                  </p>
                )}
                <Link
                  className='mt-3 inline-block text-sm text-primary hover:underline'
                  to='/functions/hse/incidents'
                >
                  {t('hse.viewAll')}
                </Link>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('hse.recentHazards')}</CardTitle>
                <CardDescription>
                  {t('hse.recentHazardsDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result.recentHazards.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('hse.fields.description')}</TableHead>
                        <TableHead>{t('hse.fields.dueAt')}</TableHead>
                        <TableHead>{t('hse.fields.status')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.recentHazards.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className='max-w-64 truncate'>
                            {row.description}
                          </TableCell>
                          <TableCell>{row.dueAt ?? '—'}</TableCell>
                          <TableCell>
                            <HseStatus status={row.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('hse.emptyHazards')}
                  </p>
                )}
                <Link
                  className='mt-3 inline-block text-sm text-primary hover:underline'
                  to='/functions/hse/hazards'
                >
                  {t('hse.viewAll')}
                </Link>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('hse.expiringCertificates')}</CardTitle>
              <CardDescription>
                {t('hse.expiringCertificatesDescription')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.expiringCertificates.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('hse.fields.holderName')}</TableHead>
                      <TableHead>{t('hse.fields.certType')}</TableHead>
                      <TableHead>{t('hse.fields.expiresAt')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.expiringCertificates.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.holderName}</TableCell>
                        <TableCell>{row.certType}</TableCell>
                        <TableCell>{row.expiresAt}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('hse.emptyCertificates')}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageContainer>
  );
}
