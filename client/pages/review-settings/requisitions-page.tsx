import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { IssueReviewSettingsPanel } from './issue-panel.js';

export default function RequisitionsReviewSettingsPage() {
  const { t } = useTranslation();
  return (
    <PageContainer className='max-w-5xl'>
      <PageHeader
        title={t('reviewSettings.requisitions')}
        description={t('reviewSettings.requisitionsHint')}
      />
      <IssueReviewSettingsPanel />
    </PageContainer>
  );
}
