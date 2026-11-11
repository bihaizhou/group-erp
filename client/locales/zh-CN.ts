import { companyScope } from './company-scope-zh.js';
import { customers } from './customers-zh.js';
import { execution } from './execution-zh.js';
import { demandAttachments } from './demand-attachments-zh.js';
import { materialSources } from './material-sources-zh.js';
import { requisitions } from './requisitions-zh.js';
import { purchaseReferences } from './purchase-reference-zh.js';
import { materials } from './materials-zh.js';
import { procurement } from './procurement-zh.js';
import { people } from './people-zh.js';
import { hse } from './hse-zh.js';
import { production } from './production-zh.js';
import { assets } from './assets-zh.js';
import { reviewSettings } from './review-settings-zh.js';
import { reviewAudit } from './review-audit-zh.js';
import { reviewRules } from './review-rules-zh.js';
import { operations } from './operations-zh.js';
import { dashboard } from './dashboard-zh.js';
import type { AppResource } from './en-US.js';
import fileUi from '../extensions/nocobase-file-component-ui/locales/zh-CN.js';
import agentChat from '../extensions/nocobase-agent-chat/locales/zh-CN.js';
import { pageTitles } from './page-titles-zh.js';
import systemZhCN from './system/zh-CN.js';
import { org, erp } from './organization-zh.js';

const zhCN: AppResource = {
  // The template's own copy; see `./en-US.ts`.
  ...systemZhCN,
  ...fileUi,
  ...agentChat,
  'status.sessionExpired': '登录会话已结束，请重新登录后继续。',
  common: {
    readOnlyView: '只读：你可以查看本页内容，不能新增或修改。',
    readOnlyFill: '只读：确认、审批与发布由负责人操作。',
  },
  actions: { ...systemZhCN.actions, signInAgain: '重新登录' },
  // 侧边栏顶部的品牌标识；名称本身不随语言变化。
  brand: {
    name: '秦望科技',
    tagline: 'QINWANG TECH',
    homeLabel: '秦望科技首页',
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
};

export default zhCN;
