import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '#components/ui/card';
import { Button } from '#components/ui/button';
import { StatusBadge } from '#components/status-badge';
import { accessKey, useModuleAccess } from '../../hooks/use-module-access.js';
import { homeChecks, homeModules } from '../../modules/catalog.js';

export default function HomePage() {
  const { t } = useTranslation(),
    { allowed } = useModuleAccess(homeChecks),
    modules = homeModules.map((item) => ({
      ...item,
      can:
        item.path !== null &&
        item.checks.length > 0 &&
        (item.any
          ? item.checks.some((check) => allowed.has(accessKey(check)))
          : item.checks.every((check) => allowed.has(accessKey(check)))),
    }));

  return (
    <PageContainer className='max-w-6xl'>
      <PageHeader title={t('erp.title')} description={t('erp.description')} />
      <div className='grid gap-4 md:grid-cols-2'>
        {modules.map((module) => {
          const Icon = module.icon;
          return (
            <Card key={module.id}>
              <CardHeader>
                <div className='mb-2 flex items-center justify-between gap-2'>
                  <Icon className='size-5 text-primary' />
                  <StatusBadge tone={module.path ? 'success' : 'neutral'}>
                    {t(module.path ? 'erp.available' : 'erp.planned')}
                  </StatusBadge>
                </div>
                <CardTitle>{t(module.titleKey)}</CardTitle>
                <CardDescription>{t(module.descriptionKey)}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className='text-sm text-muted-foreground'>
                  {module.path ? t('erp.boundary') : t('erp.planned')}
                </p>
              </CardContent>
              {module.path && module.can ? (
                <CardFooter>
                  <Button
                    nativeButton={false}
                    render={<Link to={module.path} />}
                  >
                    {t(
                      module.id === 'organization'
                        ? 'erp.open'
                        : module.id === 'hr'
                          ? 'people.openHr'
                          : 'materials.open',
                    )}
                    <ArrowRight />
                  </Button>
                </CardFooter>
              ) : null}
            </Card>
          );
        })}
      </div>
    </PageContainer>
  );
}
