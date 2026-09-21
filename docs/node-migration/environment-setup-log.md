# 迁移环境安装与访问记录

本文档记录为迁移工作自行安装或启用的工具、运行时和测试依赖。真实密钥、数据库密码、Token 和证书路径不写入本文档。

## 安装原则

- 缺少的开发工具由迁移工作自行安装；
- 优先使用项目级依赖，避免污染全局环境；
- 每次安装记录版本、用途和验证命令；
- 不安装与当前阶段无关的重量级服务；
- 依赖安装完成后执行 typecheck、lint、test 或健康检查；
- 生产服务器只安装运行所需依赖。

## 已完成安装与验证

| 项目 | 版本 | 用途 | 安装位置 | 验证方式 |
|---|---|---|---|---|
| Node.js | 22.23.2 | Node API 运行时 | 本机；部署环境待发布阶段确认 | `node --version` |
| pnpm | 12.4.2 | 依赖安装与 lockfile | `resume-node/` 项目级 | `pnpm install --frozen-lockfile` |
| TypeScript | 5.9.3 | 编译和类型检查 | `resume-node/` | `pnpm typecheck` |
| Kysely + mysql2 | 0.29.6 / 3.24.4 | MySQL 只读调研及后续数据层 | `resume-node/` | 只读连接脚本成功 |
| ioredis | 6.0.0 | 会话/缓存兼容 | `resume-node/` | 线上配置已完成 PING、TTL、读取和删除回归 |
| Fastify | 5.12.5 | HTTP API | `resume-node/` | `/health` 集成测试 |
| CORS 白名单 | `CORS_ORIGINS` | 仅允许已配置前端来源携带凭据 | 环境变量 | 预发布浏览器回归 |
| Vercel AI SDK | ai 7.0.107 | AI 聊天与模型适配 | `resume-node/` | 阶段 5 用例验证 |
| COS SDK | cos-nodejs-sdk-v5 3.0.0 | 腾讯云 COS 上传、删除和签名 URL | `resume-node/` | 线上配置已完成上传、HEAD、签名 URL、删除和删除后不存在回归 |
| 文档解析 | mammoth 1.11.0 / pdf-parse 2.4.5 | DOCX/PDF 简历文本提取 | `resume-node/` | 类型检查、构建通过；需用真实样本文档回归 |
| 火山方舟图片尺寸 | `DOUBAO_IMAGE_SIZE=2048x2048` | Seedream 图片生成的 provider 输出尺寸；与一寸/二寸业务记录尺寸分离 | `resume-node/` | 真实模型调用成功；尺寸不变量有自动化测试 |
| Node 管理员密码解密 | sm-crypto 0.5.7 | 兼容 Snowy 管理端 SM2 密码传输并生成 SM3 密码摘要 | `resume-node/` | 密钥只从 `ADMIN_SM2_PRIVATE_KEY` 注入；单元测试验证缺失密钥时拒绝启动；真实账号登录留在预发布回归 |
| Snowy 管理端依赖 | Vue 3 / Vite 4.2.1 及 `package.json` 声明依赖 | 验证现有后台页面可继续构建 | `ai-resume-service/snowy-admin-web/` | `npm install` 后 `npm run build` 通过；当前 `npm audit --omit=dev` 为 5 个残余漏洞（4 high、1 moderate、0 critical），未执行可能破坏旧页面的跨大版本升级 |

前端构建脚本依赖安装补充：

- `ai-resume-web/` 与 `offer-star-web/` 的 pnpm workspace 配置已允许 `canvas`、`core-js`、`esbuild`、`unrs-resolver` 的构建脚本；这是 pnpm 12 的显式供应链授权，不是关闭全部生命周期脚本；
- `ai-resume-service/snowy-admin-web/` 按项目原有方式使用 npm 安装依赖并执行构建；后台不引入新的 pnpm lockfile，避免改变原有 Yarn/Node 依赖管理边界；
- `offer-star-extension/` 已允许 `esbuild`，并完成 54 个测试文件、337 个测试、Chrome/Edge/Firefox 构建、manifest、字段契约和密钥扫描。

说明：本机没有可用的 `mysql` 命令行客户端，因此数据库调研使用项目内 `mysql2` 驱动完成。pnpm 的 workspace 配置显式允许 `esbuild` 安装脚本，`pnpm install --frozen-lockfile` 已验证可重复安装。

## 基础工程验证记录（2026-09-22）

- `pnpm typecheck`：通过；
- `pnpm lint`：通过；
- `pnpm test`：通过，40 个基础测试（新增保留前端接口 HTTP 方法/路径完整契约测试、合成 DOCX/PDF 文本解析回归、火山方舟图片尺寸请求不变量和低于 provider 最小像素数的环境配置拒绝、AI 输出 token 上限配置和 provider 图片结果文件签名/大小校验；并覆盖保护路由、扩展请求契约、空 JSON Action、AI 输出安全辅助函数、外部 HTTP 超时/错误分类、空可选环境变量、微信支付 live 回调 fail-closed、微信支付 WebSocket 通知、证件照上传图片签名校验、Snowy 逻辑删除标记不变量和 Java 兼容的 3 次 AI 初始额度测试、证件照卡死记录补偿阈值、mock JSAPI 参数兼容、production 诊断路由关闭、支付成功状态机和 Java 广告位兼容别名测试）；
- `pnpm format:check`：通过；
- `pnpm build`：通过；
- `pnpm audit --prod --json`：通过；Node 生产依赖当前无已知漏洞（0 low、0 moderate、0 high、0 critical）；
- `ai-resume-web`：`pnpm lint`（26 条既有 warning、0 error）、`pnpm check-types`、`pnpm build` 和 `pnpm audit --prod` 通过；通过 pnpm override 将 `prismjs` 统一为 1.30.0，剩余 `quill@2.0.3` 仅有一个低危且暂无上游修复版本；
- `offer-star-web`：`pnpm lint`（21 条既有 warning、0 error）、`pnpm check-types`、`pnpm test`（22/22）、`pnpm build` 和 `pnpm audit --prod` 通过；同样保留一个无已知修复版本的 Quill 低危告警；
- `offer-star-extension`：`pnpm verify` 通过，54 个测试文件、337 个测试、Chrome/Edge/Firefox 构建、manifest、字段契约、Firefox lint 和密钥扫描全部通过；
- `snowy-admin-web/npm run build`：通过；首次失败原因是仓库未安装前端依赖，安装后再次构建成功；旧依赖仍有弃用和安全审计提示，未执行破坏性强制升级；
- 后台生产依赖更新后 `npm audit --omit=dev` 为 0 critical、4 high、1 moderate；已安全升级 Axios、lodash-es、qs、PostCSS，以及此前已调整的 SM2、TinyMCE 和 Vue I18n。剩余告警来自 G2Plot/fmin/Rollup、ECharts 6 大版本和 TinyMCE 8 大版本升级，涉及当前不保留的 Snowy 页面，留在后台替换阶段处理；
- 数据库元数据和核心业务聚合查询：成功，均为只读 SQL。
- 火山方舟图片模型：通过 `DOUBAO_API_KEY` 临时进程环境变量运行 `pnpm verify:doubao`，模型 `doubao-seedream-4-5-251128` 成功返回并下载非空图片；密钥未写入文件、日志或响应。

## 数据库访问记录

数据库连接信息通过安全环境变量注入，不记录具体值。

每次数据库操作记录：

- 日期和操作者；
- 只读或写入；
- SQL/脚本用途；
- 涉及的表；
- 测试数据前缀；
- 创建的主键；
- 是否允许清理；
- 验证结果。

## 测试数据规则

测试数据使用唯一前缀，例如：

```text
codex_migration_test_
```

只有明确由迁移工作创建、并且带有该前缀或登记主键的数据，才允许在后续清理。线上原有数据、真实用户、真实订单和真实文件永不删除。

## 支付测试规则

默认只创建测试订单并模拟或回放支付回调，不产生线上真实扣款。真实微信支付只在明确的测试商户环境中执行。
## Secret hygiene note

本次迁移没有把用户提供的 DeepSeek 密钥写入 Node 源码、测试、构建产物或文档。对旧 Java 工程做静态扫描时发现历史文件中仍存在若干硬编码的 AI provider key；它们不是本次迁移新增内容，但在 Node 切换前应在对应供应商处轮换并从 Java 配置/源码中移除，Node 只通过环境变量读取新密钥。

本轮安全清理已将 `snowy-web-app/src/main/resources/application*.yml` 中的数据库、Redis、微信、OAuth、Stripe、豆包和后台统计凭据统一改为环境变量占位符；生产部署必须注入对应变量，仓库配置不再保存这些值。旧凭据已经暴露在历史文件中，切换前仍应在供应商侧轮换，不能把仓库中的旧值当作有效凭据继续使用。

微信支付的 `p12`、证书和私钥也已从 Java 资源目录移除，配置改为 `WECHAT_PAY_CERT_P12_PATH`、`WECHAT_PAY_CERT_PATH`、`WECHAT_PAY_PRIVATE_KEY_PATH` 和 `WECHAT_PAY_CERT_SERIAL_NO`。证书只允许由预发布/生产部署系统挂载；在证书重新注入并完成签名验收前，Node 的 `PAYMENT_MODE=live` 继续拒绝请求。



