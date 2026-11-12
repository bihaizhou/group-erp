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
  permissionGuide: {
    rolesDescription:
      '先勾选页面，再点行尾“字段权限”设置字段；后台管理权限在“后台管理”标签里。保存一次即可。',
    pageHint:
      '勾选页面后，点行尾“字段权限”设置该页字段；页面和字段会一起保存。',
    admin: '后台管理',
    adminHint:
      '管理角色、默认范围、用户与账号安全等系统功能；普通业务页面请在上面的“页面访问”里勾选。',
    saveHint: '页面、字段和后台权限会在点“保存”后一起生效。',
    defaultAccessNote:
      '这里只补充已有操作权限的用户能访问哪些记录，不控制页面与字段；页面和字段权限请到角色里配置。',
    rolesLink: '去角色与权限配置',
  },
  fieldPermission: {
    open: '字段权限',
    openFor: '配置“{{page}}”的字段权限',
    title: '{{page}} · 字段权限',
    description:
      '这里只列出属于该页面的字段。改完关闭即可，修改会和角色一起保存。',
    sharedPages: '这些字段同时作用于：{{pages}}',
    empty: '该页面没有可单独配置的字段。',
    loading: '正在加载字段权限…',
    loadFailed: '字段权限加载失败。',
    readOnly: '只读：你可以查看但不能修改字段权限。',
    stagedHint: '修改会暂存，点页面下方的“保存”后生效。',
    done: '完成',
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
