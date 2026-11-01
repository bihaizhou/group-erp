import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { PurchaseReviewSettingsPanel } from './purchase-panel.js';

export default function ProcurementReviewSettingsPage() {
  const { t } = useTranslation();
  return (
    <PageContainer className='max-w-5xl'>
      <PageHeader
        title={t('reviewSettings.procurement')}
        description={t('reviewSettings.procurementHint')}
      />
      <PurchaseReviewSettingsPanel />
    </PageContainer>
  );
}
