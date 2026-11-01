import { useIssueError } from '../requisitions/requests/hooks.js';
import { ReviewSettingsPanel, type ReviewSettingsDomain } from './runtime.js';

const domain: ReviewSettingsDomain = {
  key: 'requisitions',
  apiPath: 'requisitions/settings',
  companiesPath: 'requisitions/settings/companies',
  optionsPath: 'requisitions/settings/options',
  canResource: 'requisitions.settings',
  editorId: 'issue-review-rules',
  ui: (key) => `requisitions.requestUi.${key}`,
};

export function IssueReviewSettingsPanel() {
  const message = useIssueError();
  return <ReviewSettingsPanel domain={domain} message={message} />;
}
