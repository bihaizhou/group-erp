import { useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { BackButton } from '#components/back-button';
import { RouteChildPage } from '#components/route-child-page';
import { EmptyState } from './controls.js';
import { useExecutionError, ui } from './hooks.js';
import type { ReviewKind } from './settings-model.js';
import {
  ReviewSettingsPanel,
  type ReviewSettingsDomain,
} from '../review-settings/runtime.js';

const kinds: ReviewKind[] = [
  'purchaseOrders',
  'salesOrders',
  'stockDocuments',
  'stockTransfers',
  'stockCounts',
];

function domain(kind: ReviewKind): ReviewSettingsDomain {
  return {
    key: `execution-${kind}`,
    apiPath: 'warehouse/settings',
    companiesPath: 'warehouse/settings/companies',
    optionsPath: 'warehouse/settings/options',
    canResource: 'warehouse.settings',
    editorId: 'reviewer-rows',
    ui,
    kind,
    subjectParam: 'subjectId',
    invalidationKey: ['execution'],
  };
}

export default function ReviewSettingsEdit() {
  const { parameter = '' } = useParams(),
    { t } = useTranslation(),
    message = useExecutionError(),
    kind = parameter as ReviewKind;
  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton />
        <PageHeader
          title={t(ui(`reviewKinds.${kind}`))}
          description={t(ui('frozenRulesHint'))}
        />
        {kinds.includes(kind) ? (
          <ReviewSettingsPanel domain={domain(kind)} message={message} />
        ) : (
          <EmptyState type='restricted' />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
