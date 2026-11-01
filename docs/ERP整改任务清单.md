# ERP 整改任务清单

> 状态：已完成 · 2026-10-22
> 范围：公司作用域、审核配置、导航、空态、工程基线。
> 能力缺口（BOM、财务、成本等）不塞进这次整改，单独立项，见第 5 节。

## 1. 判断

这套 ERP 不是“没做完所以乱”，而是三件事叠在一起：

1. **公司被做成了页面参数**。16 个业务页各自从 URL 读 `subjectId`，各自放一个选择器，各自决定未选时显示什么；没有全局上下文，也不记忆。
2. **同一件事有多份实现**。4 个审核入口、3 份编辑器；销售客户页直接复用供应商列表；空态有卡片、灰字、带按钮三种写法。
3. **入口先于能力开放**。公司发展只有一张 `planned` 卡片；审核配置有 4 个菜单，但规则只有一套。

整改顺序按“先壳层、再入口、后数据”走：公司作用域 → 审核配置收口 → 菜单与空态 → 工程基线。数据模型和已上线迁移不动；需要改 schema 的，另开迁移。

## 2. 任务总表

| ID  | 任务                           | 主要改动                                                                           | 验收                                           | 状态   |
| --- | ------------------------------ | ---------------------------------------------------------------------------------- | ---------------------------------------------- | ------ |
| G1  | 记住公司选择                   | 壳层监听 `subjectId`，写入 localStorage；进入公司页缺参数时补回                    | 单测通过；跨模块不再重复选同一家公司           | 已完成 |
| G2  | 共享公司作用域组件（采购试点） | 一个 `<CompanyScope>` 统一列表、选择、未选/无公司/加载；采购 4 页接入              | 4 页空态一致；单公司自动选中；失效记忆自动清除 | 已完成 |
| G3  | 推广到领用、销售               | 领用 3 页、销售 3 页接入                                                           | 6 页不再各写一套选择器                         | 已完成 |
| G4  | 推广到仓库                     | 仓库 6 页接入                                                                      | 6 页一致；仓库档案页不受影响                   | 已完成 |
| G5  | 顶栏公司切换器                 | 顶栏显示当前公司，切换后写入 URL 与记忆；shell 变更记入规则                        | 任意公司页可切换；无权限公司不可选             | 已完成 |
| R1  | 审核入口 4 合 1                | 侧栏只保留一个“流程与审核规则”，四个域内联标签页；旧地址删除                       | 侧栏 1 个入口；四域可切换；旧地址 404/重定向   | 已完成 |
| R2  | 编辑器 3 合 1                  | 按 lifecycle 的 `parameterConfiguration` 渲染一个编辑器，删除 545/566/487 三份重复 | 三类规则在同一编辑器可配；组/类型不写死        | 已完成 |
| R3  | 参数与 scope 收敛              | 统一 `reviewScope` 构造与字段描述；参数表合并先做数据评估                          | 新旧记录都能读；提交快照不变                   | 已完成 |
| R4  | 审核回归测试                   | 规则解析、快照冻结、409 合并、越权                                                 | 关键路径有测试；改编辑器不改变结果             | 已完成 |
| N1  | 菜单去重与命名                 | 合并审核入口；统一采购/销售/仓库页面命名                                           | 侧栏无重复项；同一页面只有一个名字             | 已完成 |
| N2  | 公司发展占位处理               | `planned` 卡片改为明确“未开放”或移除                                               | 不再出现可点击的空入口                         | 已完成 |
| E1  | 空态与错误统一                 | 无公司、无权限、无数据、加载四种状态共用一套组件                                   | 16 页观感一致；403 用统一页面，可经顶栏切公司  | 已完成 |
| T1  | Node 24 基线                   | 本机 22，`engines` 要求 24；补版本文件与 CI 说明                                   | 构建/测试在 24 下通过；文档写明                | 已完成 |
| T2  | 文档同步                       | 本清单、交接文档、实施进度互相对齐                                                 | 不再出现“已上线/未上线”互相矛盾                | 已完成 |

## 3. 详细说明

### G1 记住公司选择（已完成）

- 位置：`client/lib/company-scope.ts`、`client/layouts/components/company-scope-memory.tsx`，挂在 `client/layouts/app-layout.tsx`。
- 行为：URL 里出现合法 `subjectId` 就记住；进入 16 个公司页之一且 URL 没有该参数时，用记住的值补上（`replace`，不污染历史）。显式空值 `subjectId=` 不覆盖，视为“用户主动清空”。
- 验证：`tests/logic/company-scope.test.ts` 6 项通过；`pnpm typecheck` 通过。
- G2 已补上校验：模块公司总数不超过 50 时，记住的公司不在列表里会被清空；更大的列表依赖接口报错与用户改选，不做本地猜测。

### G2 共享公司作用域组件（采购试点）

目标不是“再抽一个 Select”，而是把四件事收进一个组件：

1. 列表：由页面现有的公司接口提供（各模块鉴权不同，不新造全局接口）。
2. 选择：写回 URL 的 `subjectId`，同时写记忆。
3. 空态：未选、无公司、加载、无权限四种，一套文案。
4. 校验：记住的公司不在当前列表里时清掉，不带着越权值发请求。

采购 4 页先接：申请、审核配置、采购订单、供应商。供应商页当前是 Popover + 整页 Empty，改成同一个组件后不应再出现“整页只有选择公司”。

实现（2026-10-22）：

- 组件：`client/components/company-scope.tsx`，`companyScope` 文案表；`useOnlyCompany` 在 `client/hooks/use-only-company.ts`。
- 供应商：`CompanyScope` 包整页，原 Popover + `ChoicePicker` 删除；加载/错误仍由 `SupplierLoading`/`SupplierError` 承担。
- 采购申请与审核配置：`CompanyScope` 替换原 `ReferencePicker` 和两段 `chooseCompany` 文本；配置页表单内的公司控件换成 `CompanyPicker`。
- 采购订单：与销售订单共用 `client/pages/execution/index.tsx`，公司控件换 `CompanyPicker`，未选空态换 `CompanyEmpty`，因此这一页的改动会随 G3/G4 一起影响销售与仓库。
- 失效记忆：`CompanyScope` 在模块公司总数不超过 50 时校验当前 `subjectId`，不在列表就清空；超过 50 的模块只依赖接口报错，不再假装能本地判定。
- 验证：`tests/components/company-scope.test.tsx` 5 项；组件测试 30 文件 159 项；typecheck、lint 通过。全量 `pnpm test` 仍受本机 node 22 与 `.ts` 迁移加载限制（见 T1）。

### G3 / G4 推广（已完成）

领用、销售、仓库按同一模式替换，不再保留各自的 `chooseCompany` 文案分支。仓库档案页不在此列。

- 领用：`requests`、`settings` 用 `CompanyScope`；`purposes` 用 `CompanyScope` + `CompanyEmpty`，三页都接 `useOnlyCompany`。
- 销售：客户页直接复用 `SupplierList`，已随 G2 完成；销售订单与销售审核设置分别复用 `execution/index.tsx`、`execution/settings.tsx`，不必另写。
- 仓库：入库/出库/调拨/盘点复用 `execution/index.tsx`；库存用共享 `CompanyPicker` + `CompanyEmpty`（筛选行里还有仓库/调拨选择器，不属公司门禁）；仓库审核设置复用 `execution/settings.tsx` 与 `settings-edit.tsx`。
- 结果：16 个公司页现在共用 `client/components/company-scope.tsx`；`execution/index.tsx` 的“去建公司”CTA 仍在，其余页无公司时只显示统一空态。
- 验证：组件测试 30 文件 160 项；typecheck、lint 通过。

### G5 顶栏切换器（已完成）

- 新增 `client/layouts/components/company-switcher.tsx`：只在公司页渲染，按当前路径查 `companyScopeEndpoint()` 得到该页已授权的公司端点，拉前 100 家；选中的公司写回 URL `subjectId`，若页面有 `reviewSubjectId` 一并更新，并清掉 `page`。
- 不新造全局端点，也不做跨模块公司并集：顶栏列出的公司一定能在当前页面使用。
- 挂载在 `client/layouts/components/header-actions.tsx`，位于主题与用户菜单左侧；这是壳层改动，原因写进 `.agents/rules/shell.md`。
- 无 ServiceProvider 的壳层测试不会触碰 API：`CompanySwitcher` 先判路径，子组件 `CompanySwitcherMenu` 才调用 `useApiClient`。
- 已知限制：下拉只取前 100 家；公司超过 100 的部署需要给顶栏加搜索或分页。
- 验证：`tests/components/company-switcher.test.tsx` 3 项（当前公司、切换、设置页 `reviewSubjectId` 同步、非公司页不渲染）；组件全量 31 文件 163 项；typecheck、lint 通过。

### R1–R4 审核配置

- R1 已完成：新增 `/functions/review-settings`（page id `review-settings`），按采购、领用、销售、库存四个标签页内联编辑，只显示当前账号 `useCan` 允许的域；`?tab=` 可深链。四个旧地址已删除，统一走 `?tab=`；侧栏只剩一个入口。
  - 2026-10-23 调整：审核配置回到各模块设置页（`/functions/{procurement,requisitions,sales,warehouse}/settings`），中央 `review-settings` 页删除；四页仍共用 `ReviewSettingsPanel` 与 `review-settings` 页面授权。
- 授权：新增 `database/main/migrations/202611010007_review_settings_page.ts`。凡是原有权限集含四个旧 page 任一，就补 `review-settings` 的 `access`；`down` 只移除新增的这一条，不动原有 grants。
- R2 已完成：字段描述改由服务端从 lifecycle 读取。`server/providers/review-rule-fields.ts` 的 `reviewRuleFields(runtime, lifecycle, group, exclude)` 调 `runtime.describe()` 取 `parameterConfiguration`，只返回 `reviewers`/`boolean`；采购、领用、执行三个设置接口都返回 `fields`，页面不再保留字段常量。`requireProject` 是锁定为 false 的字段，服务端显式排除，避免被渲染成可编辑开关。
- R3 已完成（参数表不合并）：scope 键统一走 `server/providers/review-scope.ts` 的 `reviewScope(kind, subjectId)`，取值仍是 `procurement:` / `requisitions:` / `${kind}:` 前缀，历史记录与提交快照不变。数据评估结论：参数行分属 `purchaseParameterCollections` 与 `issueParameterCollections`（执行与领用共用后者），合并需要搬行并重建 revision/requestId 语义，查询上没有收益，因此保留两套表，只收敛代码入口。
- R4 已完成：规则解析、提交快照、409 合并、越权在既有 `tests/logic/purchase-requests.test.ts`、`tests/logic/issue-requests.test.ts`、`tests/logic/warehouse-execution.test.ts` 中覆盖；本轮新增设置接口 `fields` 的结构断言。全量 101 文件、510 通过、6 跳过。
- 权限：沿用现有 page 授权，不因入口合并放宽；新页只做导航，不代替旧页的权限判断。

### N1 / N2 导航

- N1 已完成：四个审核页合并为“流程与审核规则”一个入口；旧设置路由已删除，深链统一走 `?tab=`。
- N2 已完成：公司发展卡片不可点击，徽标与说明都从“规划中”改为“暂未开放”；不再暗示近期可用。

### E1 空态

- 公司四态由 `client/components/company-scope.tsx` 统一：加载、未选、无档案（可去建）、记忆失效。
- 无权限统一用 `client/components/access-denied.tsx`（`ShieldCheck` + `Empty`），已替换采购申请/设置/表单、领用申请/设置/用途/表单、人员表单里的裸 `<p>{forbidden}</p>`。
- 无数据仍由各表自带空行与筛选提示；这次不强行改表格空态，避免把“筛选无结果”和“没有数据”混成一句。

### T1 工程基线

已完成：Node 24.22.1 安装在 `/home/bhz/.local/node24`，`.node-version` 固定 24，README 写明原生模块 ABI 137。`pnpm build` 与全量测试都在 24 下通过；切回 Node 22 会因原生模块 ABI 不匹配失败。

## 4. 依赖与顺序

```
G1 → G2 → G3 → G4 → G5
              ↘ E1
R1 → R2 → R3 → R4
N1（依赖 R1）
N2、T1、T2 可并行
```

G2 是分水岭：它之前只是“记住”，它之后 16 页才有统一行为。

## 5. 单独立项（不在这轮）

这些不是“页面没写完”，是产品能力缺失，需要单独定范围、数据和验收：

1. 生产计划 / BOM / MRP。
2. 财务、成本、计价、税额。
3. 项目档案（公司发展入口）。
4. 质量检验。
5. 批次 / 库位 / 效期。
6. 安环检查、作业票、培训。
7. 固定资产扩围（当前只有最小台账）。
8. 生产、安环、运营的状态机与权限审计：这三个模块本轮没有重写，是否迁到 lifecycle 需单独评估。

## 6. 执行记录

| 日期       | 项                 | 结果                                                                                                                                                              |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-22 | G1                 | 新增公司记忆与 URL 回填；6 项单测、typecheck 通过                                                                                                                 |
| 2026-10-22 | G2                 | 共享 `CompanyScope` 接入采购 4 页；单公司自动选中、失效记忆清理；5 项单测、组件全量、typecheck、lint 通过                                                         |
| 2026-10-22 | R2                 | 抽出共享 ReviewRuleEditor；采购/领用/执行三页接入；保留焦点、校验、409 语义；组件 165 项通过                                                                      |
| 2026-10-22 | R1/N1              | 新增 review-settings 导航页，旧四页隐藏菜单；授权迁移按旧 page 授权并集补新页；2 项组件测试                                                                       |
| 2026-10-22 | G5                 | 顶栏切换器按页面端点取公司，写 `subjectId`/`reviewSubjectId`；3 项测试、组件 163 项、typecheck、lint 通过                                                         |
| 2026-10-22 | N2                 | 公司发展卡片由“规划中”改为“暂未开放”，保持不可点击                                                                                                                |
| 2026-10-22 | G3/G4              | 领用 3 页、销售 3 页（复用供应商/执行页）、仓库 6 页（复用执行页 + 库存/设置）接入；16 页公司控件统一；组件 160 项、typecheck、lint 通过                          |
| 2026-10-22 | R2/R3              | 设置接口返回 lifecycle 字段描述；scope 统一 `reviewScope`；参数表评估后不合并；类型检查通过                                                                       |
| 2026-10-22 | R4/E1              | 补 `fields` 断言；403 统一为 `AccessDenied`；全量 510 通过、6 跳过                                                                                                |
| 2026-10-22 | T2                 | 本清单、交接文档、实施进度同步本轮结果                                                                                                                            |
| 2026-10-22 | 底层               | 公司门禁上移到 `ClientRoute` + `CompanyGate`；16 页页面级门禁全部删除；5 项门禁测试                                                                               |
| 2026-10-22 | 路由               | 公司作用域改由路由声明 `companyScope`，`route-scopes.ts` 从路由树生成映射；删除 `COMPANY_SCOPED_PATHS` 全局路径表；顶栏/记忆读同一路由声明                        |
| 2026-10-22 | 审核               | `/functions/review-settings` 改为四域标签页内联编辑器，`?tab=` 深链；四个旧设置页/路由删除；编辑子路由挂在审核页下                                                |
| 2026-10-22 | 账号               | 新增 `account/context` 解析员工档案默认公司；`CompanyGate` 在模块授权列表内自动选中，未命中退回选择；组件 7 项测试                                                |
| 2026-10-22 | 公司体验           | 门禁按“账号默认 → 上次选择 → 模块第一家公司”自动选中，页面中间不再弹选择器；顶栏切换器移到左上；7 项门禁测试、typecheck、lint 通过                                |
| 2026-10-22 | 审核运行时         | 采购/领用审核配置合并到 `review-settings/runtime.tsx`：一套查询/版本/requestKey/409 合并/离开确认；两个面板只剩域声明；守卫改为检查 runtime 与薄面板              |
| 2026-10-22 | 审核运行时（执行） | 执行单据的四种 kind 设置改用同一 `ReviewSettingsPanel`；`settings-edit.tsx` 只剩页头 + 域配置（`kind`/`reviewSubjectId`/`invalidationKey`）                       |
| 2026-10-22 | 模块清单           | 新增 `client/module-manifest.ts`，`functions` 下 9 个模块的路由/顺序统一注册；`routes.ts` 改为展开清单；新增清单守卫测试                                          |
| 2026-10-22 | 首页/工作台清单    | 新增 `client/modules/catalog.ts` 与 `useModuleAccess`；首页、工作台卡片改为清单展开，权限一次批量解析，页面不再逐卡 `useCan`                                      |
| 2026-10-22 | 规则版本留痕       | 采购/领用审批记录显示提交版本冻结的审核规则版本；执行侧在 `parameterSnapshot` 写入 `revision` 并在冻结规则区显示；不新增表列                                      |
| 2026-10-22 | 审批记录           | 新增 `ReviewAudit`，采购/领用详情按轮次列出时间、候选、决定人、意见与单据版本；执行审核补发起/决定时间；组件 2 项、守卫 7 项、全量 517 通过                       |
| 2026-10-23 | 岗位权限           | 新增 `orgPositionPermissionSets` 映射与 `/organization/position-permissions`：岗位→权限集，保存时同步在岗账号的权限集；读/写分别要求权限集 read/assign            |
| 2026-10-23 | 运维公司卡片       | 总览新增“按公司”视图，一家公司一张卡；卡片展示产量/库存/未结单/问题/安环/人员/停机，可切回汇总并定位到该公司                                                      |
| 2026-10-23 | 部署               | 生产发布 `erp-rearch-20261023-0717`：7 迁移 + 1 seed，50→57 / 158→161 表；healthz、登录、公司/资产接口与页面 200；旧容器保留可回滚                                |
| 2026-10-23 | 部署（日报/岗位）  | 生产发布 `erp-20261023-1200`：迁移 008–010，临时库演练通过；healthz 200、容器 healthy、`db apply --dry-run` 无待执行；生产无公司/单元，日报仅验到空态；旧容器保留 |

| 2026-10-23 | 岗位权限自动重算 | 新增 `position-permission-sync`；任职按 `startDate <= 今天 < endDate` 判定；入职/调岗/兼岗/离职生效后自动重算，保留手工授予的 `root` 等权限集 |
| 2026-10-23 | 安环公司边界 | 新增 `GET /hse/companies`；安环总览/事件/隐患/证照四条路由声明 `companyScope`，由路由级公司门禁统一选择 |
| 2026-10-23 | 生产主数据 | 生产环境建板块/区域/公司 HQ/单元 P1/岗位 PROD-MGR/仓库 WH-MAIN/METAL01/SAND01/员工 EMP001；生产日报出勤名单可用 |
| 2026-10-23 | 部署（岗位/安环/主数据） | 发布 `erp-20261023-1427`：无迁移；healthz 200、容器 healthy；日报与安环页顶栏显示 HQ；旧容器保留 |

## 7. 长效机制

这轮不只修页面，还留了四道防线，防止下一个模块继续“各自为政”：

1. **规范入口**：`.agents/rules/architecture.md` 写清新模块落地顺序、公司作用域、审核配置、页面状态和防漂移要求；`AGENTS.md` 已加索引，新会话启动即可看到。
2. **自动检查**：`tests/logic/architecture-guard.test.ts` 7 项，扫源码拦截七类回退：复制条件表、页面重写公司门禁、路由外再建公司路径表、403 回到裸 `<p>`、审核菜单重复、字段描述绕过服务端、详情页在版本块里重复渲染审核任务。
3. **共享组件**：公司门禁用 `CompanyGate`，控件用 `CompanyPicker`/`CompanyEmpty`，审核用 `ReviewRuleEditor`，403 用 `AccessDenied`，scope 用 `reviewScope`；新模块只能组合这些入口。
4. **经验与目录**：根因、踩坑和取舍写进 `docs/开发经验与踩坑记录.md` 的“2026-10-22 整改”；可复用入口写进 `docs/可复用能力目录.md`。

约束仍然明确：不建第二套状态机，不建全局公司端点，不为“未来可能”预建泛化平台；没有第二个真实场景前，共享组件只收已经重复出现的实现。

## 2026-10-23 审核入口调整

- 审核配置从中央 `review-settings` 页回到采购/领用/销售/仓库各自的设置页。
- 四个页面仍组合 `client/pages/review-settings/runtime.tsx`，不得复制保存逻辑。
- 页面授权拆成四个 page id（`procurement-review-settings` / `requisitions-review-settings` / `sales-review-settings` / `warehouse-review-settings`）；域内仍按 composite `*.settings` 检查。迁移 `202611010009_module_review_settings_pages` 按旧模块授权拆分，只有共享页授权的角色才会补全四个。
  | 2026-10-23 | 页面权限 | 审核设置拆四个 page id，迁移 009 按旧模块授权拆分；菜单、路由、守卫和测试同步 |
