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
  settingsHub: {
    title: '设置中心',
    description: '管理账号、角色与默认数据范围。',
    users: '用户管理',
    usersHint: '查看、创建与停用账号，重置密码。',
    roles: '角色与权限',
    rolesHint: '按页面配置字段的可见与写入权限。',
    defaultAccess: '默认范围',
    defaultAccessHint: '补充已有操作权限的用户能访问哪些记录。',
  },
  permissionGuide: {
    rolesDescription:
      '所有页面统一按字段权限配置：点开页面，为字段勾选“可见”或“写入”；都不勾选＝看不到该字段。后台管理权限在“后台管理”标签里。保存一次即可。',
    pages: '页面与字段',
    pageHint:
      '点击页面为字段勾选权限：“写入”自动带上“可见”，取消“写入”回落到“可见”；都不勾选＝隐藏。绿点表示该页面已有字段配置。',
    admin: '后台管理',
    adminHint: '管理角色、默认范围、用户与账号安全等系统功能。',
    saveHint: '页面、字段和后台权限会在点“保存”后一起生效。',
    defaultAccessNote:
      '这里只补充已有操作权限的用户能访问哪些记录，不控制页面与字段；页面和字段权限请到角色里配置。',
    rolesLink: '去角色与权限配置',
  },
  fieldPermission: {
    openFor: '配置“{{page}}”',
    title: '{{page}} · 字段',
    description:
      '勾选“可见”字段才会显示（能看不能改）；勾选“写入”会自动勾上“可见”（可编辑）。都不勾选＝看不到该字段。灰色的“写入”表示该字段本身不可写。改完关闭即可，修改会和角色一起保存。',
    accessible: '可访问',
    configured: '已配置字段权限',
    sharedPages: '这些字段同时作用于：{{pages}}',
    empty: '该页面没有可配置的字段。',
    loading: '正在加载字段权限…',
    loadFailed: '字段权限加载失败。',
    readOnly: '只读：你可以查看但不能修改字段权限。',
    stagedHint: '修改会暂存，点下方“保存”后生效。',
    done: '完成',
    levelVisible: '可见',
    levelWrite: '写入',
  },
  fieldCatalog: {
    date: '日期',
    status: '状态',
    code: '编码',
    name: '名称',
    operation: '操作',
    actorName: '操作人',
    reason: '原因',
    beforeValue: '修改前',
    afterValue: '修改后',
    location: '位置',
    currency: '币种',
    lineNo: '行号',
    requestNo: '单号',
    compensation: '补偿方式',
    approverName: '审批人',
    materialRole: '物料角色',
    sortOrder: '排序',
    commissionedOn: '启用日期',
    commissionDate: '投产日期',
    region: '区域',
    lineCode: '产线编码',
    processType: '工艺类型',
    designCapacityTpd: '设计产能（吨/天）',
    reviewerSelections: '复核人',
    permissionSet: '权限集',
    approvalTitle: '审批环节',
    decidedAt: '决定时间',
    description: '描述',
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
