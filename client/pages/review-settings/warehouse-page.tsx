import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { QuantitySettingsSection } from '../execution/settings.js';

export default function WarehouseReviewSettingsPage() {
  const { t } = useTranslation();
  return (
    <PageContainer className='max-w-5xl'>
      <PageHeader
        title={t('reviewSettings.warehouse')}
        description={t('reviewSettings.warehouseHint')}
      />
      <QuantitySettingsSection
        kinds={['stockDocuments', 'stockTransfers', 'stockCounts']}
      />
    </PageContainer>
  );
}
