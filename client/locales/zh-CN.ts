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
import { finance } from './finance-zh.js';
import { reviewSettings } from './review-settings-zh.js';
import { reviewAudit } from './review-audit-zh.js';
import { reviewRules } from './review-rules-zh.js';
import { operations } from './operations-zh.js';
import { dashboard } from './dashboard-zh.js';
import type { AppResource } from './en-US.js';
import fileUi from '../extensions/nocobase-file-component-ui/locales/zh-CN.js';
import agentChat from '../extensions/nocobase-agent-chat/locales/zh-CN.js';
import { pageTitles } from './page-titles-zh.js';
import { supplyChain } from './supply-chain-zh.js';
import { fieldLabel } from './field-labels-zh.js';
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
  settings: {
    ...systemZhCN.settings,
    permissionSearch: '搜索页面或字段',
    discard: '放弃',
  },
  permissionActions: {
    read: '查看',
    manage: '管理',
    approve: '审批',
    readAll: '查看全部',
    report: '报表',
    update: '维护',
  },
  settingsHub: {
    title: '设置中心',
    description: '管理账号、角色与默认数据范围。',
    empty: '你没有任何可用的设置模块。',
    users: '用户管理',
    usersHint: '查看、创建与停用账号，重置密码。',
    roles: '角色与权限',
    rolesHint: '为每个页面设置字段可编辑、只读或不显示。',
    defaultAccess: '默认范围',
    defaultAccessHint: '补充已有操作权限的用户能访问哪些记录。',
  },
  permissionGuide: {
    rolesDescription:
      '在页面树里勾选方框＝允许访问该页面及其子页面；点击页面或子页面名称，在右侧把字段设为“可编辑”“只读”或“不显示”。后台管理权限在“后台管理”标签里。保存一次即可。',
    pages: '页面与字段',
    pageHint:
      '勾选页面左侧方框＝允许访问，其下新建/编辑/详情等子页面一起开放；点击页面或子页面名称，在右侧设置该页面的字段权限。绿点表示该页面已有字段配置，紫点表示有未保存的修改。',
    configure: '配置',
    morePages: '更多页面 ({{count}})',
    listPage: '列表',
    admin: '后台管理',
    adminHint: '管理角色、默认范围、用户与账号安全等系统功能。',
    saveHint: '页面、字段和后台权限会在点“保存”后一起生效。',
    inheritedPage: '随上级页面开放',
    sharedPage: '与关联入口共用同一页面权限',
    newPage: '新建',
    editPage: '编辑',
    detailPage: '详情',
    defaultAccessNote:
      '这里只补充已有操作权限的用户能访问哪些记录，不控制页面与字段；页面和字段权限请到角色里配置。',
    rolesLink: '去角色与权限配置',
  },
  fieldPermission: {
    openFor: '配置“{{page}}”',
    title: '{{page}} · 字段',
    pageTab: '字段权限',
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
  pageFieldPermission: {
    description: '每个页面独立一份字段权限：可编辑 / 只读 / 不显示。必填字段不能设为“不显示”。',
    selectPageHint: '从左侧选择一个页面或子页面，设置其字段权限。',
    empty: '该页面没有可配置的字段。',
    field: '字段',
    permission: '权限',
    required: '必填',
    editable: '可编辑',
    readonly: '只读',
    hidden: '不显示',
    modifiedRecently: '修改于刚才',
    footnote: '只影响此页面；使用同一份数据的其他页面保持各自的设置。',
    copyToPages: '复制到其他页面',
    copyHint: '把当前页面的字段设置复制到所选页面，覆盖它们原有的设置。',
    copyConfirm: '复制',
    copied: '字段设置已复制到 {{count}} 个页面。',
  },
  pageFieldVisibility: {
    pageTab: '页面显示',
    description:
      '选择这个页面显示哪些字段。只改变当前页面的表单显示，不授予也不收回数据权限；未勾选的字段仍然按原字段权限处理。',
    show: '显示',
    showField: '在此页面显示{{field}}',
    loading: '正在加载页面字段…',
    loadFailed: '页面字段加载失败。',
    readOnly: '只读：你可以查看但不能修改页面字段。',
    empty: '该页面没有可配置的字段。',
    stagedHint: '只影响当前页面；使用同一份数据的其他页面保持各自的显示。',
    requiredBadge: '必填',
    requiredField: '该字段在此页面为必填，不能隐藏。',
    inheritTitle: '跟随新建页',
    inheritHint: '此页面使用新建页的字段显示；修改任一字段后自动单独设置。',
    overrideTitle: '单独设置此页面',
    overrideHint: '此页面的字段显示不再跟随新建页。',
    restoreAction: '恢复跟随新建页',
    pageUnsaved: '有未保存的字段修改',
    unsavedHint: '{{count}} 处字段修改已暂存，点“保存”后对该角色生效。',
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
};

export default zhCN;
