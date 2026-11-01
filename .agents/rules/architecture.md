# ERP 架构与共享机制

适用于所有新增页面、接口和业务模块。目标是让 ERP 随规模增长仍保持同一套 NocoBase 3 约定，而不是每个模块各自发明一套。

## 新增模块的落地顺序

1. 先判断它属于哪个已确认业务域（见 [supply-chain.md](supply-chain.md)、[organization.md](organization.md)、[people.md](people.md)）。没有归属就不建页面。
2. 状态与审批走 `@nocobase/lifecycle`：状态存记录自身字段，只能经声明式 transitions 改变；管理员可调的审核人/阈值放进 `parameterConfiguration`，不另建规则表、不在页面里写审核引擎。
   - 2026-10-23 决策：不接流程设计器。本项目的 `@nocobase/app-client 3.0.0-beta.1` 没有兼容的 workflow 插件（`@nocobase/app-plugin-workflow 2.0.0-beta.1` 只支持 app-client 2.x，经典 `@nocobase/plugin-workflow 3.0.0-alpha.13` 仍依赖 `@nocobase/client 2.x`）；审批步骤留在 lifecycle。官方发布兼容包前不再尝试安装，也不修改第三方插件。
3. 页面在 `client/routes.ts` 声明 `defineAppRoutes()`、懒加载组件、首路由 `authz`；旧地址保留时只留 `breadcrumb`，不要再给 `navigation`。
4. 公司范围：服务端从单据或公司档案取 scope，客户端只传 `subjectId`；列表端点按模块现有授权过滤公司，不新增“全局公司列表”绕过授权。
5. 文案进 `client/locales`；权限拒绝、公司空态、加载态用共享组件，不复制文案分支。
6. 迁移放 `database/main/migrations/`，自包含；已执行的迁移不改写。
7. 跑 `tests/logic/architecture-guard.test.ts`，再跑相关业务测试。

## 模块清单

- `client/module-manifest.ts` 的 `functionModules` 是 `functions` 下业务模块的唯一注册处：模块顺序、路由展开、侧栏入口都从这里生成。新增模块只加一条，不要再往 `client/routes.ts` 里手工拼接路由数组。
- 页面仍以路由声明 `authz` 授权；清单只负责模块注册与顺序，不替代页面级权限。
- 四个模块设置页各有自己的 page id：`procurement-review-settings`、`requisitions-review-settings`、`sales-review-settings`、`warehouse-review-settings`；各域 API 再按 composite 检查，服务端 403 是最终边界。不要再把 `review-settings` 当共享页面权限。
- 首页与职能工作台的卡片也来自 `client/modules/catalog.ts`：新增模块只加一条 `workbenchModules`，首页四张卡只在 `homeModules` 里改；页面不得再用 `useCan` 一条条拼卡片和权限。

## 岗位与权限

- 岗位是组织档案，权限只认 NocoBase 权限集。岗位到权限集的唯一映射表是 `orgPositionPermissionSets`，页面是 `/organization/position-permissions`（page 授权 `position-permissions`），接口是 `/api/position-permissions`。
- 读需要 `authorization.permission-sets:read`，写需要 `:assign`；不要用组织架构的读写权限代替权限集管理权限。
- 保存岗位权限映射时，服务端重写该岗位的映射，并为所有当前在岗、且绑定账号的员工重算。入职、调岗、兼岗、离职生效后，`people-service.applyChange` 调用 `syncAccountPositionPermissions` 自动重算，不再要求管理员手动再保存一次。
- 成员与同步只认 `status=active` 且 `startDate <= 今天 < endDate` 的任职；`data` 可能是 JSON 字符串，必须解析后再判断。结束日期为当天即视为已离岗，不再计入权限。
- 只回收“由岗位映射派生”的权限集（`orgPositionPermissionSets` 中存在的 key），保留 `root` 等手工授予；手动直接授予同一映射 key 的记录无法区分，会被回收。需要长期保留的例外应在权限集层面设计。
- 岗位不是租户边界：跨公司可见范围仍由权限集里的 data scope 决定；不要给岗位表加 `subjectId` 再发明第二套授权引擎。

## 公司作用域

- 公司门禁是路由级：页面在路由定义上声明 `companyScope: '<模块公司端点>'`，`client/company/route-scopes.ts` 从路由树收集，`client/routing/client-route.tsx` 据此套 `CompanyGate`。新页面只需在路由上声明，不要自己再包一层门禁。
- `CompanyGate` 用当前路由对应的模块端点取列表并完成选择/失效校验；页面从 URL 读 `subjectId`（公司唯一来源），不再请求公司列表，也不另建公司内存态。
- 页面不得自己写“先选择公司”的 `<p>`、`Popover + ChoicePicker` 或第二套公司列表请求；`CompanyScope` 已删除，页面级门禁没有合法用法。
- 表单里需要保留公司上下文切换时，才用 `CompanyPicker`（必须带未保存确认）；页面级只用 `CompanyGate`。
- 公司空态用 `CompanyEmpty`。
- 顶栏 `CompanySwitcher` 读取当前路由声明的同一个端点（`client/company/company-route-scope.ts`），不跨模块并集，也不再有全局路径表。
- 首次进入公司页时，门禁按“账号默认公司 → 上次显式选择 → 模块第一家授权公司”自动选中，不再在页面中间弹选择器；记忆失效也由这条顺序替换。
- 顶栏左上角的 `CompanySwitcher` 是唯一切换入口；页面中间只允许出现加载态或无公司档案态。表单内确有未保存内容时，才保留 `CompanyPicker` 并带离开确认。
- 账号默认公司由 `account/context` 从员工档案（`personnelEmployees.accountId → subjectId`）解析；默认值只有命中当前模块公司列表才自动选中，未命中退回选择器，不能拿默认值绕过授权。
- 服务端 scope 永远从记录/档案推导；不能把请求里的 `subjectId` 直接当授权依据（列表查询除外，仍要过模块 policy）。

## 审核配置

- 审核配置入口放在对应模块的设置页：采购 `/functions/procurement/settings`、领用 `/functions/requisitions/settings`、销售 `/functions/sales/settings`、仓库 `/functions/warehouse/settings`。四个入口都组合同一个 `ReviewSettingsPanel`，不得复制保存逻辑；模块设置只保留一个审核入口，不再建中央审核页。
- 四个设置页分别由自己的 page id 授权；域内再按 composite `procurement.settings` / `requisitions.settings` / `warehouse.settings` 检查读写，服务端 403 是最终边界。
- 唯一编辑器是 `client/components/review-rule-editor.tsx`；字段由服务端 `reviewRuleFields()` 从 lifecycle 的 `parameterConfiguration` 读出，页面不得再声明 `reviewerSelections` 条件表、组号输入或第二套校验。
- 锁定字段（如 `requireProject` 恒为 false）留在 lifecycle 定义里，但服务端描述时排除，避免被渲染成可编辑开关。
- 审批留痕统一用 `client/components/review-audit.tsx`，按任务显示轮次、状态、时间、候选人、决定人、意见、单据版本与审核规则版本；规则版本从提交版本冻结的 `parameterSnapshot` 读取，不再加一份可漂移的当前配置副本。
- 所有审核配置（采购、领用、销售、库存）只组合 `client/pages/review-settings/runtime.tsx` 的 `ReviewSettingsPanel`；域文件只声明 `apiPath`、`companiesPath`、`optionsPath`、`canResource`、`editorId`、`ui`（执行另加 `kind`、`invalidationKey`），版本号、requestKey、409 合并、离开确认不得再复制。

## 页面状态

- 403/无权限：`AccessDenied`；不要裸 `<p>{t(...forbidden)}</p>`，也不要在页面里各写一套 Alert。
- 无公司/无档案/记忆失效：`CompanyEmpty`；加载用 `Loading`/`Spinner`。
- 空表格与“筛选无结果”保持区分，不强行合并成一句文案。

## 防漂移

`tests/components/company-gate.test.tsx` 锁住路由级门禁的四种状态：未选不挂载、有效公司挂载、单公司自动选中、失效公司清理。

`tests/logic/architecture-guard.test.ts` 会检查：条件表是否被复制、公司门禁文案是否回到页面、403 是否回到裸 `<p>`、审核菜单是否重复、字段描述是否仍由服务端生成。它失败时先修代码，不要改测试绕过；确需放宽，必须在本文记录原因。

## 角色权限矩阵

- 权限矩阵是验证工具，不是第二套授权表。`tests/logic/role-matrix.test.ts` 默认跳过；需要时用 `ROLE_MATRIX=1 ERP_BASE=http://127.0.0.1:13000/main pnpm vitest run tests/logic/role-matrix.test.ts`，会创建临时账号逐个授予权限集、读取 `authorization/permissions`，并把结果写到 `docs/角色权限矩阵-2026-10-23.md`。
- 矩阵只证明权限集到页面的映射；真实账号没有分配权限集时，菜单不会出现。
