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
  fieldPermission: {
    open: '字段权限',
    openFor: '配置“{{page}}”的字段权限',
    pageHint:
      '先配置页面访问，再点页面右侧的“字段权限”，设置该页面里每个字段的可见与可编辑程度。',
    createHint:
      '保存角色后，可在每个页面右侧的“字段权限”中配置该页面的字段权限。',
    title: '{{page}} · 字段权限',
    description:
      '这里只列出属于该页面的字段。字段权限按页面保存并立即生效；页面访问权限随角色一起保存。',
    sharedPages: '这些字段同时作用于：{{pages}}',
    empty: '该页面没有可单独配置的字段。',
    loading: '正在加载字段权限…',
    loadFailed: '字段权限加载失败。',
    readOnly: '只读：你可以查看但不能修改字段权限。',
    save: '保存字段权限',
    saving: '正在保存…',
    saveHint: '字段权限单独保存，不影响上方尚未保存的页面权限。',
    saved: '已保存',
    saveFailed: '保存失败，请重试。',
  },
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
