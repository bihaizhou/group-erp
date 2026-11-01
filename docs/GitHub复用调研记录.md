# GitHub 复用调研记录

检索日期：2026-10-16。用户要求针对登录、权限、附件、导入导出、审批、消息等具体功能块搜索 GitHub，尽量避免重复开发。组织架构等企业业务模型按已确认方案实现，不将整个业务领域作为寻找替代插件的目标。复用优先级：已注册官方能力 → 官方 V3 仓库和组件 → 兼容且维护中的社区项目 → 应用已有能力 → 必要自研。

## 已核查的基础能力与版本边界

关键词：nocobase v3 skills app-template-default organization departments positions；nocobase plugin departments organization；app-plugin-departments-example。

| 候选                                                                                                                                                        | 核查与结论                                                                                                           | 采用方式                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [官方 V3 Skills](https://github.com/nocobase/skills-v3)                                                                                                     | 仓库说明源自 nocobase/nocobase 的 v3-develop，不能混用 V2 Skills                                                     | 已使用创建应用、部署指引和应用本地同步 Skills                           |
| [官方组织维度指引](https://github.com/nocobase/nocobase/blob/v3-develop/packages/app/app-skills/skills/nocobase-app-development/references/organization.md) | 原始内容已读取；组织权限以 permission sets 与自定义维度接入，示例包含成员归属，岗位需要按业务建模                    | 复用官方权限机制；人员事务归职能平台／人事，人才战略归人力资源          |
| [官方组织示例](https://github.com/nocobase/plugin-organization-demo/blob/main/package.json)                                                                 | package.json 版本 1.4.27，peerDependencies 为 @nocobase/client/server/test 1.x；未见该文件提供明确许可证声明         | 不能直接用于当前 V3；未复制其源码                                       |
| [V3 部门示例发行记录](https://github.com/nocobase/nocobase3/releases)                                                                                       | 发布记录包含 app-plugin-departments-example；这是示例，尚未完成当前源码及许可证核实；旧 nocobase3 仓库页面已标为归档 | 参考存在性，不作为当前生产插件安装依据                                  |
| 官方 authentication / authorization / users 与 UI Library                                                                                                   | 当前应用已有注册包和同步 Skills，版本在 pnpm-lock.yaml 固定；官方组织指引建议在应用建模                              | 已直接复用登录、权限、账号管理、路由覆盖页及 UI；业务约束由应用服务实现 |

登录、权限、用户管理和基础 UI 已使用官方能力。组织主体、板块区域、部门岗位、关系与审计属于已确认的业务实现，不以寻找完整组织插件作为开发前置条件。旧版组织示例的检索保留为版本兼容性参考，后续调研按具体功能块进行。

## 后续检索记录模板

每项新增能力记录：日期；需求边界；关键词；仓库/具体版本或 commit；兼容性；许可证；最近维护状态；依赖与数据边界；采用/适配/不采用原因；验证结果。已有结论在版本和需求不变时直接引用，避免重复检索。

## 人事与人才首期：审批、雷达和照片（2026-10-16）

检索边界为具体能力，不寻找整套 HR 替换。官方生命周期与 ECharts 的仓库/发行记录已经检索，以下结合当前已安装包核实。

| 能力／来源                                                                                                                | 本地核实与兼容边界                                                                                                                                                      | 采用与验证                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| [NocoBase 官方 V3 生命周期](https://github.com/nocobase/nocobase/releases)                                                | 已安装 @nocobase/lifecycle 0.1.0-beta.2；同步应用 Skill 指定用于固定阶段单据。包元数据未单独声明 license，不把它误写为 Apache/MIT；沿用项目已有官方依赖与其发行许可边界 | 直接用 LifecycleRuntime、repository store、jobs 与事务；未手写审批引擎或另装 V2 workflow 插件。状态、幂等、旧版本、回滚由逻辑测试覆盖 |
| [Apache ECharts](https://github.com/apache/echarts)、[Radar 文档](https://echarts.apache.org/en/option.html#series-radar) | 原项目已有 echarts，实际解析 5.6.0，Apache-2.0；官方活跃图表仓库。按已安装版本使用 RadarChart、SVGRenderer、AriaComponent，没有升级依赖                                 | 直接复用，颜色取应用 tokens，保留维度文本表；浏览器验证实际 SVG 与主题响应                                                            |
| 官方 app-plugin-file                                                                                                      | 原项目已注册并有同步 Skill；查看公开 file repository API 与上传组件，不读取插件私有表                                                                                   | 员工照片复用仓储/上传，附加业务权限和格式校验；真实上传与越权读取有 API 回归测试                                                      |

未来能力版本不变时先引用这些结论；不要重复检索已明确的官方集成，也不要把固定业务流程升级成通用流程设计平台。

## A2.4 私有需求附件与格式校验（2026-10-18）

官方 `app-plugin-file 1.0.0-beta.23` 已注册，现有 FileUploadField/FileList/FilePreviewDialog 与 `@silurus/ooxml 0.85.1` 已安装；继续复用标准仓储、会话、上传元数据和同源 stream，本批只添加业务范围及绑定，不重建文件平台。已实际检查 Client 上传 options 仅支持 signal，业务适配只为官方请求补充父单 query。

- [file-type](https://github.com/sindresorhus/file-type)、[package.json](https://github.com/sindresorhus/file-type/blob/main/package.json)：MIT，当前主分支持续维护；二进制签名属于尽力判断，官方 README 明确 OOXML 目录回退可能把含 word/xl/ppt 目录的普通 ZIP 判为 Office。不能单独满足“对应 OOXML 容器”校验，未采用其推测结果作为授权上传依据。
- [yauzl](https://github.com/thejoshwolfe/yauzl)、[API](https://github.com/thejoshwolfe/yauzl/blob/master/README.md)、[版本与许可证](https://github.com/thejoshwolfe/yauzl/blob/master/package.json)：已安装并固定3.4.0为server dependencies，Node >=12、MIT，支持中央目录、lazyEntries 和 validateEntrySizes。使用现成 ZIP 解析，在内存限制内校验 Content_Types 与对应主文档，不自研 ZIP 解压器或把 OOXML 送第三方。DOCX/XLSX/PPTX、图像和PDF共7种真实格式已通过上传及私有权限的SQLite/PG验证。该包未带类型声明，应用仅声明实际使用的3.4公开Promise API。
