# Node 迁移实施进度

更新时间：2026-09-22

## 已完成

- 建立 `resume-node/` TypeScript + Fastify 工程，固定依赖版本和 pnpm 安装策略；
- 配置 `@/` 项目内导入别名，并通过 Vitest alias 与 `tsc-alias` 保证测试、开发和生产构建一致；
- 建立统一环境变量、响应包装、错误处理、CORS 白名单、健康/就绪检查；
- 建立 Kysely + mysql2 数据库连接层和核心简历表类型；
- 只读盘点线上 MySQL 版本、78 张表、核心数据量、支付状态、字典分类、管理员数量和 AI 证件照历史状态；
- 静态盘点两个用户端 API，并记录微信登录、微信支付、COS、简历、AI、校园市场圈和通知等保留范围；
- 创建并登记第一组隔离测试夹具；
- 实现并验证兼容接口：
  - `GET /c/resume/:resumeId`
  - `GET /c/resume/:resumeId/baseInfo`
- 已补齐并用线上测试用户验证简历创建、模板列表、模块编辑、名称/模板/样式/封面编辑、收藏/取消收藏、使用次数和软删除；
- 已补齐简历分类、会员套餐只读列表、兑换码查询和功能次数初始化；
- 已接入 Vercel AI SDK + DeepSeek，验证 AI 测试、简历分析/报告读取、面试题生成/读取；AI 测试数据已登记。
- 接入只读 Snowy Sa-Token/Redis 兼容校验，线上客户端 Token 已通过受保护接口验证；
- 实现校园市场圈列表、内推、进度、统计、状态/备注和投递记录兼容接口，并完成测试记录创建、编辑、删除回归；
- 实现字典分页、列表、树、详情及管理员测试模式下的增删改查路径；
- 实现 COS 上传适配器和 `/dev/file/uploadTencentReturnUrl`，并支持对象存在检查、删除和签名下载 URL；已使用线上配置完成上传/HEAD/签名/删除回归，未配置 COS 时安全返回配置错误；
- 实现 mock 微信支付订单、测试回调和幂等会员权益发放；live 创建和回调在验签实现完成前 fail-closed，不会发送真实支付请求或确认未验签的权益；
- 为 offer 前端 JSAPI 诊断页增加 mock-only `/test/jsapi/*` 兼容接口，支持测试订单查询与回放回调，不会调用微信或产生真实扣款；
- 实现微信授权 URL、WeChat OAuth code exchange、用户资料同步、幂等创建/更新和 Snowy 兼容客户端 Token；真实微信回调仍需预发布凭据验证；
- 实现 AI 证件照模板、额度、记录和火山方舟生成适配器，以及 `/aiChat/c/gpt/*` 的 Vercel AI SDK 兼容入口；补齐 `t_chat_dialogue`、`t_chat_message` 持久化、最近对话上下文、会话分页、消息分页、重新回答、普通/讯飞星火兼容引导路径，并完成 DeepSeek 隔离账号回归；
- 为简历公开发布补上与 Java 一致的普通会员有效期门禁，并完成测试账号发布、取消发布和软删除回归；
- 字典管理员校验同时支持测试管理员和 Redis 中解析出的有效 Snowy `sys_user`，保留现有两个管理员的完整后台权限边界；
- 增加 Node 管理员认证兼容层：支持 Redis 中现有 Snowy B 端 Token、可配置 SM2 密码登录、会话 TTL、退出和精简的全权限菜单；菜单当前暴露已迁移的首页与字典管理，未迁移页面不会被误显示；
- 补齐用户分销/邀请统计、邀请记录、被邀请用户脱敏列表、邀请码兑换码查询，以及广告位列表/点击兼容入口；已在线上验证分销、邀请、广告位列表和通知兼容响应；
- 补齐站内系统/活动/点赞收藏通知分页、未读统计、最新未读和已读兼容入口，并在线上测试用户验证空数据响应；
- 所有 Node 内部导入统一使用 `@/`，构建阶段通过 `tsc-alias` 生成可运行的 dist 路径；
- 使用线上 MySQL 测试夹具验证详情模块、基础信息、收藏标志和 Token 失败响应；
- 修复并验证简历归属隔离：用户只能访问自己的简历或公开副本，不能读取、收藏或使用其他用户的未公开简历；
- 通过安装、格式、Lint、类型、40 个基础测试（新增保留前端接口 HTTP 方法/路径完整契约测试、合成 DOCX/PDF 文本解析回归、火山方舟图片尺寸请求不变量和低于 provider 最小像素数的环境配置拒绝、AI 输出 token 上限配置和 provider 输出图片文件签名/大小校验；并覆盖旧版微信支付 WebSocket 通知回归、证件照上传图片签名校验、Snowy 逻辑删除标记不变量、Java 兼容的 3 次 AI 初始额度和证件照卡死记录补偿阈值、mock JSAPI 参数兼容、production 诊断路由关闭、支付成功状态机只允许待支付订单转换、Java 广告位兼容别名；同时含分销、通知、精简管理员菜单保护、扩展 AI 网关保护和请求契约校验、空 JSON Action 兼容、AI 输出安全断言、外部 HTTP 超时/错误分类、空可选环境变量处理和微信支付 live 回调 fail-closed 保护）、构建和生产依赖审计。
- 增加只读性能基线工具 `pnpm bench:health`，支持对 `/health` 或 `/ready` 统计成功率、状态码、p50/p95/p99、最大延迟和压测进程 RSS，不会写入业务数据；正式 Java/Node 对比仍留预发布。
- 为简历写入、发布/取消发布、模块替换和 mock 会员订单/回调增加数据库事务与行锁边界；线上隔离测试账号已完成 mock 订单创建、连续两次成功回调幂等回归，`/health` 与 `/ready` 均通过。
- 按 Snowy 全局逻辑删除约定统一修复 Node 的 `NOT_DELETE/DELETED` 读写边界，覆盖 AI 证件照记录、支付订单、JSAPI 测试订单、字典和微信用户读取，避免 MySQL 中 `NULL != 'DELETED'` 导致新写入记录不可见。
- 将可重复测试夹具脚本改为显式写入保护：默认拒绝、生产环境永久拒绝、支持 dry-run，实际只在事务中插入带 `codex_migration_test_` 前缀的测试用户/简历/模块，不执行 DDL、更新既有数据或删除。
- 对 AI 分析、智能生成、AI 面试题和两类简历优化补上与 Java 一致的非会员次数限制：会员免扣，非会员原子预扣，模型或后续数据库失败会返还次数；使用 `resumeId` 读取 AI 上下文时增加当前用户归属校验。
- 修正新用户 AI 功能次数初始化：与 Java `FrontUserFunctionLimitsServiceImpl` 一致，首次创建功能限制记录为 3 次，不再误初始化为 2 次；Node 测试固定该迁移不变量。
- 两个用户端均完成生产构建；后台 Vue 依赖安装后完成 Vite 生产构建，并补齐缺失的 `src/api/app/gaApi.js` 首页流量分析客户端文件；后台生产 `.env` 中不再覆盖 Vite 管理的 `NODE_ENV`，构建只保留旧依赖弃用和审计提示。
- 清理旧 Java 各 profile YAML 中的硬编码数据库、Redis、微信、OAuth、Stripe、豆包和后台统计凭据，统一改为环境变量占位符；Node 和 Java 均不再从仓库读取这些敏感值。
- 重新审计 Java `CommonTimerTaskRunner` 任务，补上 Node 的 AI 证件照卡死记录补偿任务（条件更新、事务返还额度、多实例幂等，默认关闭并由 `PHOTO_COMPENSATION_*` 显式开启）；校园评分、旧魔力过期和飞书运营统计已记录为当前范围外任务。清理 Java 源码和 YAML 中残留的硬编码飞书 Webhook，统一使用 `FEISHU_WEBHOOK_URL`，未配置时安全跳过。
- Offer Star 浏览器扩展 AI 网关已从 Next 内部 DeepSeek 调用迁移到 Node `/extension/ai/analyze`，Next 路由只做兼容代理，扩展 Token、请求字段和结构化响应校验均在 Node 完成。
- AI 聊天流式入口已使用 Vercel AI SDK 的 `streamText` 产生分块响应，并在流正常结束后保存 AI 消息；两个前端的旧 Next `/api/chat/ai*` 已改为 Node 兼容代理，浏览器请求携带现有 Token；网络中断后的重连与外部模型错误回放仍需预发布专项验收。
- 校园市场圈分页已按 Java `CommonPage` 恢复为 `page/limit/totalPage/total/list/reservedObject` 字段；offer 前端新增兼容归一化，覆盖直接返回和旧的 `records/current` 嵌套形式，并补充 3 个单元测试。
- 使用同一个有效 Snowy C 端 Token 完成 Java/Node 只读契约烟测，覆盖简历分类、会员套餐、模板（含我的模板/收藏）、校园列表、通知分页/未读统计和邀请分页；发现并修复模板、通知、分销分页字段不兼容问题，记录见 [java-node-contract-smoke-20260921.md](java-node-contract-smoke-20260921.md)。点赞收藏 Java 样本自身返回 500，Node 已保持统一 CommonPage 形状。
- 使用生产 YAML 的数据库和 Redis 连接做本地 Node 浏览器回归（支付保持 mock）：offer 首页和 AI 简历校园页都从 Node 加载真实校园记录和统计（11304 条、566 页、76/643/11590），并显示“中国保利”等真实记录；简历首页正常加载；后台登录页通过 Node 的公开 `sysBaseList` 启动接口加载，无启动错误。
- 收尾校验已完成：Java Snowy 全 Maven 测试/编译通过（22 个模块，当前工程没有可执行 JUnit 用例）；Node 生产依赖当前无已知漏洞（0 low、0 moderate、0 high、0 critical）；Java/Node 源码扫描未发现仓库内 DeepSeek、私钥、支付密钥或飞书 Webhook；Java 示例简历中的个人信息已替换为脱敏占位数据。
- 重新安装并验证三个前端和扩展依赖：两个 Next 用户端的 lint、`next typegen` 类型检查、生产构建和生产审计通过；Offer Star 扩展 54 个测试文件/337 个测试及三浏览器构建通过；后台生产构建通过。两个用户端已通过 pnpm override 消除 PrismJS 中危漏洞，后台已安全升级 Axios、lodash-es、qs、PostCSS、SM2、TinyMCE 和 Vue I18n；后台仍有 4 个高危和 1 个中危 Snowy 旧页面依赖告警，涉及 G2Plot/ECharts/TinyMCE 的大版本或构建链升级，因后台计划精简替换而未做破坏性强制升级。
- 清理已跟踪用户端 `.env.local` 中的火山引擎密钥，并将 Java OCR 手工示例改为从环境变量读取百度 OCR 凭据和图片路径；已重新扫描源码、配置和资源，未发现这些已暴露密钥或飞书 Webhook，相关凭据需要在服务商控制台轮换。
- 修正 mock 微信 JSAPI 订单响应，使会员页可以继续读取 `data.jsapiParams`；`/test/jsapi/*` 诊断接口在 production 统一关闭，并增加 Node 回归测试。
- 修正两个 Next.js 用户端的 `/api/*` 重写目标：自动识别 `NEXT_PUBLIC_API_URL` 是否已经包含 `/api`，避免生产环境切到 Node 后出现重复 `/api/api` 路径；本地和线上配置现在使用同一套归一化规则。
- 按统一规范清理三套前端的源码模块导入：用户端和 Snowy 管理端均改用已配置的 `@/` 别名；两套 Next.js 通过 lint、类型检查和生产构建，管理端通过 Vite 生产构建。样式文件、文档示例中的相对路径不属于运行时代码导入。
- 增加 Node 进程的 `SIGTERM`/`SIGINT` 优雅关闭处理，关闭 Fastify、MySQL 连接池、Redis 会话连接和保留任务定时器；新增 `verify:doubao` 临时环境验证脚本，已使用不落盘的火山方舟密钥成功生成并下载图片结果。
- 将 `/ready` 扩展为同时检查 MySQL 和 Redis；AI 证件照在上传源图前先原子预扣额度，COS 上传失败会返还额度，避免生成失败或资源错误造成测试账号权益丢失。
- 修正 AI 证件照成功响应的 `sourceImageUrl` 兼容字段，并对生成接口的 data URL 做 MIME 和文件签名校验，保持与上传接口和 Java 的输入边界一致。

## 当前不能宣布完成的部分

- 微信 OAuth 的真实回调仍需在预发布环境补做外部服务回归；旧 Snowy Token 已兼容；
- 简历发布/取消发布的会员门禁和公开副本快照已完成测试账号回归，仍需 Java/Node 快照对照；
- AI 文件解析已支持 DOCX/PDF/TXT/MD/JSON/HTML 并结构化创建；AI 生成简历和一键优化已恢复 Java 的“创建新简历并返回 ID”协议，AI 次数和失败返还已补齐，仍需用线上实际样本补充字段快照；AI 证件照和 AI 聊天入口及会话持久化已迁移，但 AI 证件照外部模型仍需预发布配置回归；
- 会员、兑换码和 mock 微信支付已迁移；旧版 `/ws/:userId/WxPay` 支付结果通知已由 Node 提供并完成连接/推送回归，真实微信支付保持关闭直到专项验收；
- 校园市场圈、COS、广告位、分销和站内通知入口已迁移；通知和邀请分页已完成只读 Java/Node 契约快照，剩余内容字段、写流程和预发布数据场景需要继续验收；
- Snowy 管理员 Token 兼容校验、Node 管理员认证入口、精简菜单和字典 API 已迁移；已完成 Node 公开启动配置和用户端浏览器回归，后台真实密码登录和完整保留页面仍需预发布验证；
- Java/Node 全接口快照对比、真实管理员 SM2 登录、微信 OAuth/支付外部回调、AI 证件照外部模型、备份恢复和切换演练仍未完成；COS 真实上传/删除、Redis TTL、字典全 CRUD、两个用户端校园/简历首页及后台启动页浏览器回归已完成。

下一步进入迁移验收阶段：补齐 Java/Node 全接口快照、AI 文件样本，再做真实管理员登录、完整保留页面回归、备份恢复和可回滚的灰度切换。微信 OAuth 真实回调、真实微信支付和豆包图片模型仍保持在预发布/专项验收边界内，不直接触碰线上真实支付。






