import { usePurchaseError } from '../procurement/requests/hooks.js';
import { ReviewSettingsPanel, type ReviewSettingsDomain } from './runtime.js';

const domain: ReviewSettingsDomain = {
  key: 'procurement',
  apiPath: 'procurement/settings',
  companiesPath: 'procurement/settings/companies',
  optionsPath: 'procurement/settings/options',
  canResource: 'procurement.settings',
  editorId: 'purchase-review-rules',
  ui: (key) => `procurement.requestUi.${key}`,
};

export function PurchaseReviewSettingsPanel() {
  const message = usePurchaseError();
  return <ReviewSettingsPanel domain={domain} message={message} />;
}
