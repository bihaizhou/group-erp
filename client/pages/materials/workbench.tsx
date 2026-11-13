import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { ArrowRight, Shapes } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from '#components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyMedia,
} from '#components/ui/empty';
import { accessKey, useModuleAccess } from '../../hooks/use-module-access.js';
import { workbenchChecks, workbenchModules } from '../../modules/catalog.js';

export default function Workbench() {
  const { t } = useTranslation(),
    { allowed, isPending } = useModuleAccess(workbenchChecks),
    modules = workbenchModules.flatMap((item) => {
      const landing = item.landing.find((entry) =>
        allowed.has(
          accessKey({ type: 'page', id: entry.pageId, action: 'access' }),
        ),
      );
      return landing ? [{ ...item, path: landing.path }] : [];
    }),
    pending = isPending;

  return (
    <PageContainer>
      <PageHeader
        title={t('erp.functions')}
        description={t('materials.workbenchDescription')}
      />
      {modules.length ? (
        <div className='grid gap-4 md:grid-cols-2'>
          {modules.map(({ icon: Icon, ...module }) => (
            <Card key={module.id}>
              <CardHeader>
                <Icon className='mb-2 size-5 text-primary' />
                <CardTitle>{t(module.titleKey)}</CardTitle>
                <CardDescription>{t(module.descriptionKey)}</CardDescription>
              </CardHeader>
              <CardFooter>
                <Button
                  variant='outline'
                  nativeButton={false}
                  render={<Link to={module.path} />}
                >
                  {t('materials.open')}
                  <ArrowRight />
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : !pending ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Shapes />
            </EmptyMedia>
            <EmptyTitle>{t('materials.noModules')}</EmptyTitle>
            <EmptyDescription>
              {t('materials.noModulesDescription')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}
    </PageContainer>
  );
}
