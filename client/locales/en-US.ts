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
import { supplyChain } from './supply-chain-en.js';
import { fieldLabel } from './field-labels-en.js';
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
  settings: {
    ...systemEnUS.settings,
    permissionSearch: 'Search pages or fields',
    discard: 'Discard',
  },
  permissionActions: {
    read: 'View',
    manage: 'Manage',
    approve: 'Approve',
    readAll: 'View all',
    report: 'Reports',
    update: 'Maintain',
  },
  settingsHub: {
    title: 'Settings',
    description: 'Manage accounts, roles and default record scopes.',
    empty: 'You have no settings modules available.',
    users: 'Users',
    usersHint: 'Browse, create and deactivate accounts, reset passwords.',
    roles: 'Roles and permissions',
    rolesHint: 'Make fields editable, read-only or hidden on each page.',
    defaultAccess: 'Default access',
    defaultAccessHint:
      'Supplement which records existing operation grants can reach.',
  },
  permissionGuide: {
    rolesDescription:
      'Tick a page box to allow access to that page and its sub-pages. Click a page or sub-page name to set each field as Editable, Read-only or Hidden on the right. Back-office permissions live in the Administration tab. Save once.',
    pages: 'Pages & Fields',
    pageHint:
      'Tick the box to allow access, including the new/edit/detail pages below it; click a page or sub-page name to set its field permissions on the right. A green dot marks pages with saved field settings, a purple dot unsaved changes.',
    configure: 'Configure',
    morePages: 'More pages ({{count}})',
    pageNoFields: 'No fields to configure',
    listPage: 'List',
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
    pageTab: 'Field access',
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
  pageFieldPermission: {
    description:
      'Each page keeps its own field permissions: Editable / Read-only / Hidden. Required fields cannot be hidden.',
    selectPageHint: 'Pick a page or sub-page on the left to set its fields.',
    empty: 'This page is not wired for per-page field permissions yet.',
    field: 'Field',
    permission: 'Permission',
    required: 'Required',
    editable: 'Editable',
    readonly: 'Read-only',
    hidden: 'Hidden',
    readOnlyRoleHint:
      'This role only reads data, so fields default to read-only. Grant update actions under Backend administration to make them editable.',
    modifiedRecently: 'Modified just now',
    footnote:
      'Only this page is affected; other pages using the same data keep their own settings.',
    copyToPages: 'Copy to other pages',
    copyNoCandidates:
      'No other page has exactly the same fields',
    copyHint:
      'Only pages with exactly the same fields are listed. Copying overwrites their current settings with this page’s settings.',
    sharedEntry:
      'Both entries open the same page, so they share these field permissions.',
    copyConfirm: 'Copy',
    copied: 'Field settings copied to {{count}} pages.',
  },
  pageFieldVisibility: {
    pageTab: 'Page display',
    description:
      'Choose which fields this page renders. This only changes the form layout for this page; it does not grant or revoke data access. Fields not listed here use the resource-level field permission.',
    show: 'Show',
    showField: 'Show {{field}} on this page',
    loading: 'Loading page fields…',
    loadFailed: 'Could not load page fields.',
    readOnly: 'Read-only: you can view but not change page fields.',
    empty: 'This page has no configurable fields.',
    stagedHint:
      'Only this page is affected; other pages using the same data keep their own layout.',
    requiredBadge: 'Required',
    requiredField: 'Required on this page; it cannot be hidden.',
    inheritTitle: 'Follow the create page',
    inheritHint:
      'This page uses the create page field display; changing any field makes it independent.',
    overrideTitle: 'Customize this page',
    overrideHint: 'This page no longer follows the create page.',
    restoreAction: 'Follow the create page',
    pageUnsaved: 'Unsaved field changes',
    unsavedHint:
      '{{count}} field changes are staged; they apply to this role when you save.',
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
  fieldLabel,
  supplyChain,
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
