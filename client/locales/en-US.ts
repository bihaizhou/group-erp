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
import type { LocaleResource } from '@nocobase/i18n';

import systemEnUS from './system/en-US.js';
import { org, erp } from './organization-en.js';

const enUS = {
  // The template's own copy: the shell, the sign-in pages, shared components and the homepage. Keep it in
  // `./system/` so a template upgrade can replace it without touching the application's copy below.
  ...systemEnUS,
  'status.sessionExpired': 'Your session has ended. Sign in again to continue.',
  actions: { ...systemEnUS.actions, signInAgain: 'Sign in again' },
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
