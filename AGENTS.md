# AGENTS.md

## 文件作用

本文件是仓库级协作规则，供 Codex、Claude Code 和其他代码代理在处理本项目时读取。它约束代码修改、测试、数据库操作和交接方式，不参与 Node.js 运行时，也不会被打包到生产服务。

## 项目定位

- 项目名称：ai-resume-node。
- 这是原 Java/Snowy 后端的全新 Node.js 后端，位于独立 GitHub 仓库 `someone1128/ai-resume-node`。
- Java 旧后端位于另一个 `ai-resume-service` 仓库，本项目不把 Java 模块复制进来，也不把 Snowy 通用后台能力全部迁移过来。
- 迁移目标是保留真实用户需要的简历、校园市场圈、AI 证件照、AI 聊天、微信登录、微信支付、腾讯云 COS、会员权益和必要后台字典能力。
- 兼容优先：默认保持现有前端 API 路径、Token 传递方式、响应对象和数据库表结构。

## 技术和目录约定

- Node.js 22 或更高版本，使用 pnpm。
- TypeScript + Fastify + Kysely + mysql2 + ioredis。
- AI 使用 Vercel AI SDK，模型通过 DeepSeek 或豆包/火山引擎适配器接入。
- 内部源码导入必须使用 `@/` 别名，禁止新增业务代码相对路径导入。
- `src/modules/` 按业务模块拆分路由和服务；`src/common/` 放通用错误、响应和 HTTP 客户端；`src/infrastructure/` 放数据库和基础设施；`src/config/` 负责环境变量解析。
- `scripts/` 只放可重复的调研、测试夹具、AI 验证和性能脚本；`test/` 放不依赖线上真实服务的自动化测试和脱敏样例。
- 迁移计划、接口盘点、数据库盘点和验收门禁位于 `docs/node-migration/` 与 `docs/migration/`。

## 编码规则

- 优先保持 Java 现有协议兼容，除非迁移文档明确记录了必要的兼容修正。
- 所有新增环境变量必须同步更新 `.env.example`、环境变量清单和交接文档。
- 不在源码、测试、日志、文档或提交信息中写入 API Key、Token、密码、证书私钥、支付密钥或真实个人简历内容。
- 对外部服务设置超时、错误分类和 fail-closed 行为；支付、管理员登录和真实 OAuth 失败时不能默认放行。
- 写数据库时优先使用事务、行锁、用户归属校验和 Snowy 逻辑删除规则；读取已删除记录必须明确排除 `DELETED` 状态。
- 不为了迁移方便修改现有数据库结构。需要结构变化时先写调研和兼容方案，暂停代码实施等待明确决策。
- 测试夹具只能写入带 `codex_migration_test_` 前缀的数据，并且必须使用脚本中的显式写入开关；禁止删除或批量修改线上真实数据。
- 微信支付本地和普通测试默认使用 mock 订单与模拟回调，禁止产生真实扣款。
- 不要为了修复后台旧 Snowy 页面而引入完整权限体系；当前管理员模型是已有管理员全部后台权限，字典管理是必要模块。

## 常用命令

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --prod --audit-level=high
pnpm dev
```

上线前还要运行 `pnpm bench:health` 做只读健康检查基准。使用数据库或 Redis 的脚本前，先确认环境变量来源、目标环境和写入边界。

## 完成标准

每个迁移阶段都必须同时有代码、配置说明、接口清单、自动化测试、手工验证记录、已知风险和回滚方式。不能只因为本地服务能启动就宣布阶段完成。

任何变更完成后，先检查 `git status` 和 `git diff`，再运行受影响的测试；提交前确认 `.env`、构建产物、`node_modules`、数据库检查快照和日志没有进入 Git。

## 继续工作时先读的文件

1. `README.md`：项目入口和启动命令。
2. `docs/maintenance-handoff.md`：电脑维修后的恢复顺序、待办和需要用户配合的事项。
3. `docs/migration/progress.md`：已完成工作和当前剩余门禁。
4. `docs/node-migration/test-and-acceptance.md`：统一测试和发布验收标准。
5. `docs/node-migration/phase-09-cutover.md`：切换、灰度和回滚约束。
