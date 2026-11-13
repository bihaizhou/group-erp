import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { ArrowRight, KeyRound, ListFilter, Users } from 'lucide-react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';

const entries = [
  {
    id: 'users',
    path: '/settings/users',
    icon: Users,
    titleKey: 'settingsHub.users',
    hintKey: 'settingsHub.usersHint',
  },
  {
    id: 'roles',
    path: '/settings/roles',
    icon: KeyRound,
    titleKey: 'settingsHub.roles',
    hintKey: 'settingsHub.rolesHint',
  },
  {
    id: 'default-access',
    path: '/settings/default-access',
    icon: ListFilter,
    titleKey: 'settingsHub.defaultAccess',
    hintKey: 'settingsHub.defaultAccessHint',
  },
] as const;

/** Landing page for the settings section: /settings itself has no other content once no page is selected. */
export default function SettingsOverviewPage() {
  const { t } = useTranslation();
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('settingsHub.title')}
        description={t('settingsHub.description')}
      />
      <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
        {entries.map((entry) => {
          const Icon = entry.icon;
          return (
            <Link
              key={entry.id}
              to={entry.path}
              className='group rounded-xl transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
            >
              <Card className='h-full'>
                <CardHeader>
                  <Icon className='mb-2 size-5 text-primary' />
                  <CardTitle className='flex items-center justify-between gap-2'>
                    {t(entry.titleKey)}
                    <ArrowRight className='size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5' />
                  </CardTitle>
                  <CardDescription>{t(entry.hintKey)}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </PageContainer>
  );
}
