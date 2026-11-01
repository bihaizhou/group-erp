import { materials } from './materials-en.js';
import { supplyChain } from './supply-chain-en.js';
import { procurement } from './procurement-en.js';
import type { LocaleResource } from '@nocobase/i18n';

const enUS = { materials, supplyChain, procurement };

export type AppServerResource = LocaleResource<typeof enUS>;

export default enUS;
