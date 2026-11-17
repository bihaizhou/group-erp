import type { ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import {
  BookOpenCheck,
  ChartNoAxesCombined,
  Landmark,
  ReceiptText,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Badge } from '#components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';

interface FinancePlan {
  readonly key: string;
  readonly icon: LucideIcon;
}

const plans: readonly FinancePlan[] = [
  { key: 'ledger', icon: BookOpenCheck },
  { key: 'receivables', icon: ReceiptText },
  { key: 'treasury', icon: Wallet },
  { key: 'reports', icon: ChartNoAxesCombined },
];

export function FinanceOverviewPage(): ReactElement {
  const { t } = useTranslation();

  return (
    <PageContainer>
      <PageHeader
        title={t('finance.title')}
        description={t('finance.description')}
        actions={<Badge variant='secondary'>{t('finance.previewBadge')}</Badge>}
      />

      <section className='relative overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-950 via-slate-900 to-cyan-950 px-8 py-10 text-white'>
        <div className='absolute -right-16 -top-16 size-64 rounded-full bg-cyan-400/10 blur-3xl' />
        <div className='relative max-w-2xl'>
          <div className='mb-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-cyan-100'>
            <Landmark className='size-3.5' />
            {t('finance.hero.kicker')}
          </div>
          <h2 className='font-heading text-3xl font-semibold tracking-[-0.04em]'>
            {t('finance.hero.title')}
          </h2>
          <p className='mt-3 text-sm leading-6 text-slate-300'>
            {t('finance.hero.description')}
          </p>
        </div>
      </section>

      <div className='grid gap-4 md:grid-cols-2'>
        {plans.map(({ key, icon: Icon }) => (
          <Card key={key}>
            <CardHeader className='flex flex-row items-start justify-between gap-4'>
              <div>
                <CardTitle className='flex items-center gap-2 text-base'>
                  <span className='grid size-8 place-items-center rounded-lg bg-sky-50 text-sky-700'>
                    <Icon className='size-4' />
                  </span>
                  {t(`finance.plans.${key}.title`)}
                </CardTitle>
                <CardDescription className='mt-2 leading-6'>
                  {t(`finance.plans.${key}.description`)}
                </CardDescription>
              </div>
              <Badge variant='outline'>{t('finance.comingSoon')}</Badge>
            </CardHeader>
            <CardContent className='text-xs text-muted-foreground'>
              {t(`finance.plans.${key}.detail`)}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className='text-base'>
            {t('finance.scope.title')}
          </CardTitle>
          <CardDescription>{t('finance.scope.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className='space-y-2 text-sm leading-6 text-muted-foreground'>
            <li>· {t('finance.scope.item1')}</li>
            <li>· {t('finance.scope.item2')}</li>
            <li>· {t('finance.scope.item3')}</li>
          </ul>
        </CardContent>
      </Card>
    </PageContainer>
  );
}

export default FinanceOverviewPage;
