import { companyScope } from './company-scope-en.js';
import { customers } from './customers-en.js';
import { execution } from './execution-en.js';
import { demandAttachments } from './demand-attachments-en.js';
import { materialSources } from './material-sources-en.js';
import { requisitions } from './requisitions-en.js';
import { purchaseReferences } from './purchase-reference-en.js';
import { materials } from './materials-en.js';
import { procurement } from './procurement-en.js';
import { people } from './people-en.js';
import { hse } from './hse-en.js';
import { production } from './production-en.js';
import { assets } from './assets-en.js';
import { reviewSettings } from './review-settings-en.js';
import { reviewAudit } from './review-audit-en.js';
import { reviewRules } from './review-rules-en.js';
import { operations } from './operations-en.js';
import { dashboard } from './dashboard-en.js';
import fileUi from '../extensions/nocobase-file-component-ui/locales/en-US.js';
import agentChat from '../extensions/nocobase-agent-chat/locales/en-US.js';
import { pageTitles } from './page-titles-en.js';
import type { LocaleResource } from '@nocobase/i18n';

import systemEnUS from './system/en-US.js';
import { org, erp } from './organization-en.js';

const enUS = {
  // The template's own copy: the shell, the sign-in pages, shared components and the homepage. Keep it in
  // `./system/` so a template upgrade can replace it without touching the application's copy below.
  ...systemEnUS,
  ...fileUi,
  ...agentChat,
  'status.sessionExpired': 'Your session has ended. Sign in again to continue.',
  common: {
    readOnlyView:
      'Read-only: you can view this page but cannot add or change anything.',
    readOnlyFill:
      'Read-only: confirming, approving and publishing are reserved for managers.',
  },
  actions: { ...systemEnUS.actions, signInAgain: 'Sign in again' },
  permissionGuide: {
    rolesDescription:
      'Every page is configured through its fields: open a page and set each field to Hidden, Read-only or Writable. Back-office permissions live in the Administration tab. Save once.',
    pages: 'Pages & Fields',
    pageHint:
      'Open a page to configure its fields. A green dot marks pages with field settings. Field permissions apply once saved.',
    admin: 'Administration',
    adminHint: 'Manage roles, default access, users and account security.',
    saveHint:
      'Page, field and administration changes take effect when you save.',
    defaultAccessNote:
      'This only extends which records users with existing operation access can reach. It does not control pages or fields; configure those on the role.',
    rolesLink: 'Configure pages and fields in Roles',
  },
  fieldPermission: {
    openFor: 'Configure {{page}}',
    title: '{{page}} · Fields',
    description:
      'Fields on this page, each settable to Hidden, Read-only or Writable; unchecked fields follow the default. A greyed-out "Writable" means the field can never be edited, so only Hidden or Read-only apply. Close when done; changes are saved with the role.',
    accessible: 'Access granted',
    configured: 'Fields configured',
    sharedPages: 'These fields also apply to: {{pages}}',
    empty: 'This page has no configurable fields.',
    loading: 'Loading field permissions…',
    loadFailed: 'Could not load field permissions.',
    readOnly: 'Read-only: you can view but not change field permissions.',
    stagedHint: 'Changes are staged and apply when you save below.',
    done: 'Done',
  },
  fieldCatalog: {
    date: 'Date',
    status: 'Status',
    code: 'Code',
    name: 'Name',
    operation: 'Operation',
    actorName: 'Actor',
    reason: 'Reason',
    beforeValue: 'Before',
    afterValue: 'After',
    location: 'Location',
    currency: 'Currency',
    lineNo: 'Line no.',
    requestNo: 'No.',
    compensation: 'Compensation',
    approverName: 'Approver',
    materialRole: 'Material role',
    sortOrder: 'Sort order',
    commissionedOn: 'Commissioned on',
    commissionDate: 'Commission date',
    region: 'Region',
    lineCode: 'Line code',
    processType: 'Process type',
    designCapacityTpd: 'Design capacity (t/d)',
    reviewerSelections: 'Reviewers',
    permissionSet: 'Permission set',
    approvalTitle: 'Approval stage',
    decidedAt: 'Decided at',
    description: 'Description',
  },
  // The shell's lockup. The name is the brand itself and stays in its own script in every language.
  brand: {
    name: '秦望科技',
    tagline: 'QINWANG TECH',
    homeLabel: 'Qinwang Technology home',
  },
  companyScope,
  customers,
  execution,
  demandAttachments,
  materialSources,
  purchaseReferences,
  materials,
  procurement,
  requisitions,
  people,
  hse,
  production,
  assets,
  reviewSettings,
  reviewAudit,
  reviewRules,
  operations,
  dashboard,
  org,
  erp,
  pageTitles,
  // The application's copy goes here, one group per feature. A shared group such as `navigation` is extended by
  // spreading the system one first, `navigation: { ...systemEnUS.navigation, orders: 'Orders' }`, since a group
  // written here replaces the system group of the same name rather than merging with it.
};

/**
 * The shape every locale of this application follows, derived from the English wording above.
 *
 * Anything a plugin does not translate falls back to this namespace, so a term defined here is reused everywhere
 * without each plugin repeating it.
 */
export type AppResource = LocaleResource<typeof enUS>;

export default enUS;
