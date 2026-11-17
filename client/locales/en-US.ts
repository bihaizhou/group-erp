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
import { finance } from './finance-en.js';
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
  settingsHub: {
    title: 'Settings',
    description: 'Manage accounts, roles and default record scopes.',
    empty: 'You have no settings modules available.',
    users: 'Users',
    usersHint: 'Browse, create and deactivate accounts, reset passwords.',
    roles: 'Roles and permissions',
    rolesHint: 'Grant field visibility and write access per page.',
    defaultAccess: 'Default access',
    defaultAccessHint:
      'Supplement which records existing operation grants can reach.',
  },
  permissionGuide: {
    rolesDescription:
      'Every page is configured through its fields: open a page and tick "Visible" or "Writable" per field; unticked fields stay hidden. Back-office permissions live in the Administration tab. Save once.',
    pages: 'Pages & Fields',
    pageHint:
      'Tick the box to allow access; click the page name to configure fields. "Writable" includes "Visible"; unticking it falls back to "Visible"; no ticks means hidden. A green dot marks pages with field settings.',
    admin: 'Administration',
    adminHint: 'Manage roles, default access, users and account security.',
    saveHint:
      'Page, field and administration changes take effect when you save.',
    inheritedPage: 'Inherited from the parent page',
    sharedPage: 'Shares one page permission',
    newPage: 'New',
    editPage: 'Edit',
    detailPage: 'Detail',
    defaultAccessNote:
      'This only extends which records users with existing operation access can reach. It does not control pages or fields; configure those on the role.',
    rolesLink: 'Configure pages and fields in Roles',
  },
  fieldPermission: {
    openFor: 'Configure {{page}}',
    title: '{{page}} · Fields',
    description:
      'Tick "Visible" for a field to appear (view only); ticking "Writable" also ticks Visible. Nothing ticked means the field stays hidden. A greyed-out "Writable" means the field can never be edited. Close when done; changes are saved with the role.',
    accessible: 'Access granted',
    configured: 'Fields configured',
    sharedPages: 'These fields also apply to: {{pages}}',
    empty: 'This page has no configurable fields.',
    loading: 'Loading field permissions…',
    loadFailed: 'Could not load field permissions.',
    readOnly: 'Read-only: you can view but not change field permissions.',
    stagedHint: 'Changes are staged and apply when you save below.',
    done: 'Done',
    levelVisible: 'Visible',
    levelWrite: 'Writable',
  },
  pageFieldVisibility: {
    open: 'Configure fields for {{page}}',
    title: '{{page}} · page fields',
    description:
      'Choose which fields this page renders. This only changes the form layout for this page; it does not grant or revoke data access. Fields not listed here use the resource-level field permission.',
    show: 'Show',
    showField: 'Show {{field}} on this page',
    saved: 'Page fields saved',
    loading: 'Loading page fields…',
    loadFailed: 'Could not load page fields.',
    readOnly: 'Read-only: you can view but not change page fields.',
    empty: 'This page has no configurable fields.',
    stagedHint:
      'Only this page is affected; other pages using the same data keep their own layout.',
    save: 'Save page fields',
    saveRoleFirst: 'Save the role first, then configure its page fields.',
    requiredBadge: 'Required',
    requiredField: 'Required on this page; it cannot be hidden.',
    inheritTitle: 'Follow the create page',
    inheritHint: 'This page uses the create page field visibility by default.',
    overrideTitle: 'Customize this page',
    overrideHint: 'This page no longer follows the create page.',
    overrideAction: 'Customize',
    restoreAction: 'Follow the create page',
    expandRoutes: 'Show {{count}} more routes',
    collapseRoutes: 'Show fewer routes',
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
  finance,
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
