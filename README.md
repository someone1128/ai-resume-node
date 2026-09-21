# 简历服务 Node.js 后端

这是简历平台 Java/Snowy 后端的全新 Node.js 实现。项目采用兼容优先的迁移策略，在不修改现有数据库结构的前提下，复用原有 MySQL 表、登录 Token、接口路径和响应格式，让现有前端可以逐步切换到 Node.js 服务。

## 当前技术方案

- Node.js 22+
- TypeScript
- Fastify
- Kysely + MySQL2
- Redis（ioredis）
- Vercel AI SDK
- 腾讯云 COS
- DeepSeek、豆包兼容接口
- `@/` 路径别名，禁止业务代码使用内部相对路径导入

当前已覆盖的迁移范围包括登录与用户信息、简历编辑与导出、AI 简历功能、AI 证件照、校园市场圈、AI 聊天、会员与支付兼容接口、通知、分销、广告位、后台管理员和字典管理，以及浏览器扩展需要的接口。

## 本地启动

```bash
pnpm install
Copy-Item .env.example .env
pnpm dev
```

启动前请根据实际环境填写 `.env`。真实凭证只允许保存在本地或部署平台环境变量中，禁止提交到 Git。

## 常用检查命令

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod --audit-level=high
```

完整验证流程会同时检查类型、代码规范、单元测试、生产构建、依赖安全和接口兼容性。

## AI 与图片验证

如需只验证豆包图片接口，可以临时注入 `DOUBAO_API_KEY` 后执行：

```bash
pnpm verify:doubao
```

该脚本使用内存中的测试图片，不写入文件、不写入数据库，只输出模型名称和返回图片大小。

## 性能基线

对正在运行的服务执行只读健康检查基准：

```bash
BENCH_URL=http://127.0.0.1:8823/health BENCH_REQUESTS=100 BENCH_CONCURRENCY=10 pnpm bench:health
```

脚本只发送 `GET` 请求，输出状态码统计、平均延迟、p50/p95/p99 和进程 RSS，不会创建或修改业务数据。

## 测试支付边界

设置 `PAYMENT_MODE=mock` 后，兼容支付接口和 `/test/jsapi/*` 诊断接口只允许配置的测试账号调用。它们只创建带有测试前缀的订单并模拟回调，不会请求微信支付，也不会产生真实扣款。

只有完成预生产环境的签名、证书和回调重放验收后，才允许设置 `PAYMENT_MODE=live`。

## 目录结构

```text
src/
  auth/              请求用户与 Token 解析
  common/            HTTP 客户端、响应对象和错误处理
  config/            环境变量校验
  infrastructure/    数据库访问和基础设施
  modules/           按业务模块拆分的路由和服务
scripts/             数据库检查、AI 验证和性能基准脚本
test/                单元测试、接口契约测试和业务样例
docs/                迁移调研、阶段计划和验收文档
```

## 迁移文档

- [Node.js 迁移总览](docs/node-migration/README.md)
- [分阶段开发文档](docs/node-migration/phase-00-research.md)
- [接口与数据库调研](docs/migration/frontend-api-inventory.md)
- [测试与验收标准](docs/node-migration/test-and-acceptance.md)
- [当前迁移进度](docs/migration/progress.md)
- [切换与回滚方案](docs/node-migration/phase-09-cutover.md)

项目坚持先调研、再迁移、再对照验收。任何涉及真实数据库、微信登录、微信支付、腾讯云 COS 或线上 AI 的验证，都必须遵循对应文档中的安全边界。
