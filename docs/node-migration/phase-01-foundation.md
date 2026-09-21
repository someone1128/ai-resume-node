# 阶段 1：Node.js 基础工程与全局规范

## 目标

建立一个薄的、可测试的 TypeScript/Fastify 基础项目。此阶段不实现业务迁移。

## 当前实现状态（2026-09-21）

已完成 `resume-node/` 基础工程：严格 TypeScript、Fastify、Zod、Pino、Kysely、Vitest、统一响应包装、环境校验、Helmet/CORS、健康检查、测试身份开关和错误处理。依赖版本已锁定，`pnpm install --frozen-lockfile`、typecheck、lint、format、test、build、生产依赖审计均通过。

基础阶段已封板。当前 Node 工程已经承载简历、AI、校园市场圈、COS、字典、会员/兑换码、mock 支付、微信登录边界、AI 证件照和 AI 聊天等迁移模块；阶段 2–9 的业务验收仍以本目录的门禁、Java/Node 快照和前端回归为准，不能仅凭构建通过宣布生产切换完成。

## 技术决定

- Node.js 使用受支持的 LTS 版本；
- TypeScript 开启严格模式；
- Fastify 作为 HTTP 层；
- Zod 作为请求参数和环境变量校验；
- Kysely 或 Drizzle 二选一，禁止同时引入多个 ORM；
- Pino 作为日志；
- Vitest 作为测试；
- 前端继续使用 Axios；Node 后端使用 `fetch`/`undici`；
- Vercel AI SDK 只在 AI 模块阶段引入，不在基础工程阶段提前加入所有 provider。

Fastify 官方 TypeScript 示例作为基础参考，不直接采用包含大量业务假设的第三方 boilerplate。AI SDK 相关 API 必须按当前官方文档核对，不能凭旧经验编写。

## 目录规范

```text
src/
  app.ts
  server.ts
  config/
  common/
  infrastructure/
  modules/
test/
scripts/
docs/
```

业务模块采用：

```text
module.routes.ts
module.schemas.ts
module.service.ts
module.repository.ts  # 只有确实需要时创建
module.types.ts
module.test.ts
```

## 必须确定的规范

- 路由命名；
- 参数校验；
- 响应包装；
- 错误码；
- 分页字段；
- 时间、金额和 ID 类型；
- 日志字段；
- Token 请求头；
- 文件上传响应；
- SSE/文本流响应；
- 环境变量命名；
- 项目内部模块统一使用 `@/` 别名导入，禁止新增 `../../` 形式的相对业务导入；
- 数据库事务边界；
- 测试命名和目录。

## 响应兼容

第一阶段默认兼容现有前端：

```ts
type ApiResponse<T> = {
  code: number
  data: T | null
  msg: string
  message?: string
  success: boolean
}
```

保留现有 `token` 请求头和现有错误码行为，不因重构主动修改前端协议。

## 测试实例

- 应用可以在测试环境启动；
- `/health` 返回版本、环境和数据库状态；
- 未配置必需环境变量时启动失败并指出变量名；
- 本地可以通过环境变量启用测试身份，不依赖微信 OAuth 回调；
- 测试身份只能在 development/test 环境启用，production 启动时拒绝相关配置；
- 成功响应符合统一包装；
- 业务错误被转换为统一错误响应；
- 未捕获异常不会泄露堆栈和密钥；
- 日志包含 requestId 且不输出 Token、密钥和完整简历内容；
- TypeScript、ESLint、格式化和 Vitest 全部通过。

别名实现方式：TypeScript `paths` + Vitest alias + `tsc-alias` 构建后处理，保证编辑器、测试、开发运行和生产编译结果一致。

## 通过条件

基础工程可以独立启动、测试和构建；后续任何模块都能按文档新增，不需要重新讨论基础结构。
