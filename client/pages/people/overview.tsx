import { textValue } from './model.js';
import { useTranslation } from '@nocobase/i18n/client';
import { useApiClient } from '@nocobase/app-client';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '#components/ui/card';
import { PeopleLoading, PeopleErrorNotice, PeopleRefresh } from './controls.js';
import { usePeopleOptions } from './hooks.js';

export default function PeopleOverviewPage() {
  const { t, i18n } = useTranslation(),
    api = useApiClient(),
    options = usePeopleOptions('profiles');
  const data = useQuery({
    retry: false,
    queryKey: ['people-overview'],
    queryFn: ({ signal }) =>
      api.request<{
        data: {
          counts: Record<string, number>;
          companies: { subjectId: string; primary: number; partTime: number }[];
          asOf: string;
        };
      }>({ path: 'people/overview', signal }),
  });
  const result = data.data?.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('people.overview')}
        description={t('people.overviewDescription')}
        actions={
          <PeopleRefresh
            busy={data.isFetching || options.isFetching}
            onClick={() => {
              void data.refetch();
              void options.refetch();
            }}
          />
        }
      />
      {data.isError || options.isError ? (
        <PeopleErrorNotice
          error={data.error ?? options.error}
          retry={() => {
            void data.refetch();
            void options.refetch();
          }}
        />
      ) : !result ? (
        <PeopleLoading />
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-5'>
            {[
              'activePeople',
              'profiles',
              'evaluations',
              'developmentPlans',
              'workforcePlans',
            ].map((key) => (
              <Card key={key}>
                <CardHeader>
                  <CardDescription>
                    {t(`people.metrics.${textValue(key)}`)}
                  </CardDescription>
                  <CardTitle className='text-3xl tabular-nums'>
                    {(result.counts[key] ?? 0).toLocaleString(i18n.language)}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('people.companyDistribution')}</CardTitle>
              <CardDescription>
                {t('people.companyDistributionDescription', {
                  date: result.asOf,
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className='flex flex-col gap-4'>
              {result.companies.length ? (
                <>
                  <div className='flex items-center justify-between gap-3 border-b pb-2 text-xs text-muted-foreground'>
                    <span>{t('people.companyColumn')}</span>
                    <div className='flex gap-x-6 pr-1'>
                      <span className='w-16 text-right'>
                        {t('people.primaryColumn')}
                      </span>
                      <span className='w-16 text-right'>
                        {t('people.partTimeColumn')}
                      </span>
                    </div>
                  </div>
                  {result.companies.map((company) => (
                    <div
                      key={company.subjectId}
                      className='flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0'
                    >
                      <span className='text-sm font-medium'>
                        {options.data?.data.orgSubjects?.rows.find(
                          (r) => r.id === company.subjectId,
                        )?.name ?? company.subjectId}
                      </span>
                      <div className='flex gap-x-6 pr-1 text-sm tabular-nums text-muted-foreground'>
                        <span className='w-16 text-right'>
                          {company.primary}
                        </span>
                        <span className='w-16 text-right'>
                          {company.partTime}
                        </span>
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('people.noAssignmentData')}
                </p>
              )}
              <Link
                className='text-sm text-primary hover:underline'
                to='/human-resources/profiles'
              >
                {t('people.viewAll')}
              </Link>
            </CardContent>
          </Card>
          <div className='grid gap-4 md:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>{t('people.talentFoundation')}</CardTitle>
                <CardDescription>
                  {t('people.talentFoundationDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent className='flex flex-wrap gap-4'>
                {['dimensions', 'models', 'profiles'].map((kind) => (
                  <Link
                    key={kind}
                    className='rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted'
                    to={`/human-resources/${kind}`}
                  >
                    {t(`people.${kind}`)}
                  </Link>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('people.strategicPlanning')}</CardTitle>
                <CardDescription>
                  {t('people.strategicPlanningDescription')}
                </CardDescription>
              </CardHeader>
              <CardContent className='flex flex-wrap gap-4'>
                {['developmentPlans', 'workforcePlans'].map((kind) => (
                  <Link
                    key={kind}
                    className='rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted'
                    to={`/human-resources/${kind}`}
                  >
                    {t(`people.${kind}`)}
                  </Link>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  );
}
