# 集团 ERP 全站 UX / 美工优化 · 审计与整改清单

> 审计方式:登录后逐页 DOM 程序化测量(40+ 页面/路由)+ 共享组件源码走查 + 对照大厂 ERP(蚂蚁 Ant Design Pro、SAP Fiori、Notion/Linear)的成熟交互范式。
> 审计基线:1440px 视口,Chrome。实测数值取自 Playwright DOM 测量(本地审计脚本,未入库)。

## 一、总体结论

- **核心病灶:共享组件 `PeopleSelect` 在 `SelectTrigger` 上硬编码 `w-full`**,作为筛选工具栏的裸 flex 子项时按容器内容宽解析为整行宽度(实测 1152px),造成"选项框太长"的观感;下拉浮层本身已有 `w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width)` 自适应,触发框收窄后浮层安全。
- 参照大厂范式(Ant Design Pro 列表页):**筛选下拉自适应宽度(w-40)、搜索框固定宽度(max-w-xs)、控件间距 gap-2/3、移动端全宽堆叠(sm: 断点)**。本项目 people/list、materials/list 已是正确样板,其余列表页漏用了包装层。
- 另外发现 2 个全站性问题:next-themes 在 React 树内渲染死代码 `<script>` 导致 React 19 每帧报错 ×41;若干原生 `<select>` 未用语义 token,浅色/深色下与 shadcn 视觉不一致。

## 二、问题清单(按严重度)

### P0 · 全站性

| #   | 问题                                                                                                                        | 现状(实测)                                                                                                               | 整改                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0-1 | next-themes 的 ThemeProvider 在 React 树内渲染 `<script>`,React 19 每渲染一次报一次 "Encountered a script tag…"(全站 41 次) | 死代码 script 落在 #root 内,永不执行                                                                                     | 自研极简 ThemeModeProvider 替换 next-themes,复刻 `{theme,setTheme,resolvedTheme,systemTheme}` API,保留 ModeStorageSync/PresetContext 逻辑;theme/index.ts、theme-settings.tsx 改导入 |
| 0-2 | 原生 `<select>` 类名缺语义 token                                                                                            | shift-reports: `border bg-transparent`;schedules/report/equipment: `border bg-background`,高 h-9 且无 focus-visible 样式 | 统一为 `border-input bg-background`,补 focus ring token,与 shadcn SelectTrigger 视觉对齐                                                                                            |

### P1 · 列表页"选项框/搜索框太长"(用户主诉)

| 页面                                                                                          | 元素(实测宽)                                                                                                 | 整改                                                                              |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 采购·申请单 `/functions/procurement/requests`                                                 | 全部公司 1152px、全部识别进度 1152px、全部申请 1152px、每页20条 1152px                                       | 筛选包 `w-full sm:w-40`;每页包 `w-full sm:w-auto`(紧凑自适应,与 people/list 一致) |
| 采购申请·用途 `/functions/requisitions/purposes`                                              | 全部状态 1152px                                                                                              | 包 `w-full sm:w-40`                                                               |
| 采购申请·申请单 `/functions/requisitions/requests`                                            | 每页20条 1152px                                                                                              | 包 `w-full sm:w-auto`                                                             |
| 供应商 `/functions/procurement/suppliers`、客户 `/sales/customers`(同文件 suppliers/list.tsx) | 搜索输入框 828px(`min-w-0 sm:min-w-64 sm:flex-1`)                                                            | 改 `w-full sm:max-w-xs`(Ant Design Pro 搜索框范式)                                |
| 采购设置 `/functions/procurement/settings`、申请设置(共享 review-rule-editor)                 | 账号 select 836px、搜索公司 input 806px、删除条件按钮 836px、新增候选组按钮 867px、允许并行审核 select 867px | 见 P2 组件重构                                                                    |

### P2 · 审批规则编辑器(review-rule-editor)交互优化(减点击)

现状:boolean 字段(允许并行审核)用 **select 下拉 2 选 1**,需 2 次点击;条件行 `grid gap-3` 导致所有控件全宽;新增候选组/删除条件按钮全宽。

整改(参照 Ant Design 表单行 + Linear 快捷控件):

1. **boolean 字段改用 RadioGroup(两项并排)** —— 1 次点击完成,选项全可见;
2. **条件行改并排布局**:类型 select 定宽(`sm:w-40`)+ 人员/职位选择器弹性占位,一行一条,视觉与筛选工具栏一致;
3. **删除条件/删除组/新增候选组**改为左对齐窄按钮(`w-auto`),不再拉伸满行。

### P3 · 生产模块表单宽度

| 页面                                     | 现状                                                                                    | 整改                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| 排班 `/production/schedules`             | 备注 input 917px(footer 内 flex-1)                                                      | 加 `sm:max-w-md` 上限                |
| 交接班记录 `/production/shift-reports`   | select+日期各 556px(2 列网格,正常);原生 select 缺 token                                 | 补 token(P0-2);表单页含表格,保持全宽 |
| 生产日报 `/production/report`            | 556px×2/546px×2 为网格列宽(正常);textarea 备注 1123px、材料说明 1100px 为跨列全宽(正常) | 不改宽度,仅统一原生控件 token        |
| 设备档案 `/production/equipment`         | 526px(正常)                                                                             | 不改                                 |
| 维保计划 `/production/maintenance-plans` | 1109px 为 checklist 有意跨列                                                            | 不改                                 |

### P4 · 观察项(本轮不改,列入后续迭代)

- 列表页表格密度、批量操作栏、空状态插画、加载骨架屏的统一性。
- 移动端(375px)导航抽屉的层级与手势细节。
- 表单校验错误信息的定位与滚动策略。

## 三、验证计划(每处修改后)

1. 受影响文件范围 `pnpm exec tsc --noEmit` / eslint 单文件检查;
2. 浏览器实测:浅色/深色 × 375px/1440px × 中英双语言;
3. DOM 探针复测确认:宽 select 消失(全部 ≤ 320px)、搜索框 ≤ 320px、console 无 script 报错;
4. 截图前后对比存档(/tmp/ux-shots/)。

## 四、执行顺序

1. 页面级宽度修复(P1,低风险、覆盖面最大)→ 2. 生产模块 token 统一(P0-2/P3)→ 3. review-rule-editor 重构(P2)→ 4. theme provider 替换(P0-1)→ 5. 全量验证。

## 五、验证结果(2026-11-13,已全部通过)

DOM 复测(Playwright 探针,1440px 视口,zh-CN + en-US):

| 页面                       | 整改前                    | 整改后                                                               |
| -------------------------- | ------------------------- | -------------------------------------------------------------------- |
| 采购申请列表 proc-requests | 4 个筛选 select 各 1152px | 96–144px(全部公司 144 / 全部识别进度 122 / 全部申请 144 / 每页 96)   |
| 申请用途 req-purposes      | 全部状态 1152px           | 144px                                                                |
| 申请单 req-requests        | 每页 1152px               | 96px(其余筛选 122px)                                                 |
| 供应商 / 客户搜索框        | 828px                     | 320px(`sm:max-w-xs`)                                                 |
| 设置页账号 select          | 836px                     | 144px;允许并行审核改为 RadioGroup 单选(减 1 次点击)                  |
| 交接班记录筛选             | select/日期 556px         | 单元 select 176px + 日期 138px,并排                                  |
| 排班备注 input             | 917px                     | 448px(`sm:max-w-md`)                                                 |
| 设置页「搜索公司」input    | 806px                     | 806px(保留:位于条件卡内联搜索面板,全宽是卡片内搜索的标准范式,非缺陷) |

其他验证:

- console 报错 "Encountered a script tag..." 从全站 41 次 → 0 次(已用自研 ThemeModeProvider 替换 next-themes,浅/深色切换实测正常:dark 类与 colorScheme 同步生效)。
- 所有复测页面 1440px 与 375px 下均无横向溢出。
- en-US 语言下控件宽度同样合规(自动截断,无溢出)。
- tsc --noEmit 与受影响文件 eslint(--max-warnings 0)全绿。

整改前后截图: 整改前 /tmp/ux-shots/,整改后 /tmp/ux-verify/。

## 六、第二轮:逐页深审与整改(40 路由)

第一轮只覆盖了宽度类问题,第二轮按 40 个路由逐页抓取 DOM 骨架(标题/卡片/按钮/表单项/表格列),逐页修正布局、标签、点击目标与视觉一致性。

### 6.1 结构性问题

| 问题                                                                                                            | 影响页面                                | 处理                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `/settings` 直接访问为空白(父路由无页面)                                                                        | 设置                                    | 新增设置中心页(三张入口卡:用户管理 / 角色与权限 / 默认范围),挂在 `/settings` 索引路由                                   |
| `/users`、`/roles` 静默跳回首页                                                                                 | 用户/角色                               | 新增兼容重定向页 → `/settings/users`、`/settings/roles`                                                                 |
| 原生 `<select>` 与 Input/SelectTrigger 不一致(`h-9 rounded-md bg-background px-3`,缺边框 token、焦点环与禁用态) | 生产、运营、资产、HSE、排班等 12 个页面 | 抽出 `native-controls.ts`(`nativeSelectClass` / `readOnlyValueClass`),全站统一为 `h-8 rounded-lg border-input` + 焦点环 |
| Tabs 触发器仅 22px 高,点击目标过小                                                                              | 运营总览等                              | 修正 Root 的 `data-horizontal` 属性(此前 `group-data-horizontal` 变体永不匹配),触发器 29px                              |
| 页头工具条 `label` 在 flex 容器内收缩,导致窄屏 select 仅 96px                                                   | 设备 / 保养 / 加班 / 资产筛选           | label 加 `w-full sm:w-44`(或 `sm:w-40`)                                                                                 |

### 6.2 逐页明细

- **设备与维修**:删除只含一个下拉的筛选卡,筛选并入页头(带可见标签);台账与维修工单表单由 placeholder 改为显式标签,两列表单网格。
- **设备保养计划**:同上;新建计划表单三列网格,检查项目占满整行。
- **生产报表**:运行/停机分钟改为 `max-w-2xl` 两列;只读值统一为只读框样式;备注改 `Textarea`;考勤表状态下拉加 `min-w-24`。
- **加班记录 / 排班 / 停线记录 / 班次设置 / 交接班记录**:筛选并页头、补标签、统一原生下拉样式;交接班明细卡补标题。
- **问题督办 / 月度目标**:原生下拉统一 token。
- **固定资产**:筛选行加标签(状态/保管人),刷新按钮右对齐;新建资产弹窗改标签网格;行内编辑下拉统一。
- **HSE**:`HseSelect` 复用统一原生下拉类。
- **全局页头**:移动端隐藏分隔竖线,消除 375px 下 4px 横向溢出。

### 6.3 验证

- 38 页 DOM 扫描:console error 0;除生产报表「填写原因 / 如:抢修破碎机」(示例提示文案)外无「以 placeholder 充当标签」的控件;无小于 24px 的按钮。
- 1440px 与 375px 均无横向溢出(表格在滚动容器内正常滚动);深色模式下 `dark` 类与 `colorScheme` 同步。
- `/settings`、`/users`、`/roles` 均正确渲染;设置中心三张卡片指向正确子页。
- `tsc --noEmit`、受影响文件 `eslint --max-warnings 0`、`prettier --check` 全绿。
