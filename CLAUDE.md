# CLAUDE.md

## 项目简介

`ai-resume-node` 是简历平台的全新 Node.js 后端，目标是逐步替换原来基于 Snowy 的 Java 8 后端。项目位于独立仓库：`https://github.com/someone1128/ai-resume-node`。

项目坚持先调研、再迁移、再对照验收。现有前端继续使用原来的 API 路径、Token 和响应格式；数据库先兼容现有核心表，不做 DDL，不删除线上数据。

## 业务范围

需要保留：

- 微信登录和用户信息；
- 简历创建、编辑、模块、模板、收藏、预览、发布和导出；
- AI 简历分析、生成、优化和面试题；
- AI 证件照；
- 校园市场圈；
- AI 聊天，优先级较低但保留，使用 Vercel AI SDK；
- 会员套餐、功能次数、兑换码、订单和微信支付兼容接口；
- 腾讯云 COS 文件上传、签名和删除；
- 必要通知、分销、邀请和广告位；
- 精简后台管理员和字典管理。

不需要迁移 Snowy 的细粒度角色、资源、按钮、字段权限，组织岗位体系、代码生成器和未被线上业务使用的通用模块。

## 当前状态

截至 2026-09-22，Node 项目已经完成基础工程、核心兼容接口、数据库和 Redis 适配、AI、图片、COS、mock 支付、微信 OAuth 兼容层、校园圈、通知、分销、管理员和字典 API，并完成 40 个基础自动化测试、构建、依赖审计和多轮线上测试账号回归。

当前 `main` 最新提交为 `074bf56 docs: add Chinese project overview`。生产环境尚未切换，Java 仍是线上基准。当前工作重点是预发布契约对照、外部服务回归、浏览器回归、备份恢复和可回滚切换。

## 环境变量

所有变量名称以 `.env.example`、`docs/node-migration/environment-inventory.md` 和原 Java YAML 为准。数据库、Redis、腾讯云 COS、微信、支付、DeepSeek、豆包等真实值只能通过本地未提交 `.env` 或部署平台注入。

禁止从 Git 历史、聊天记录或日志中复制旧密钥继续使用。之前在协作中出现过的 DeepSeek 和火山引擎密钥需要在服务商控制台轮换；轮换后只写入部署环境，不写入仓库。

支付默认使用 `PAYMENT_MODE=mock`。`PAYMENT_MODE=live` 只有在预发布环境完成证书、签名、回调幂等和异常重放测试后才允许开启。

## 数据安全边界

- 可以对线上数据库做只读调研。
- 可以创建独立测试账号，并为测试账号写入会员、简历、模块、订单等测试数据。
- 测试数据必须使用 `codex_migration_test_` 前缀，并登记到 `docs/migration/test-data-registry.md`。
- 禁止修改数据库结构、删除线上真实数据、批量更新真实用户数据或用真实支付回调发放权益。
- 测试结束时只能清理本次创建的测试对象，清理前确认对象前缀和记录清单。

## Claude 接续工作方式

进入项目后先执行：

```bash
git status
git log -3 --oneline
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

然后阅读 `docs/maintenance-handoff.md`，按照其中的“恢复后第一批工作”继续，不要重新设计项目结构，也不要从 Java 文件逐个机械翻译。

修改前确认前端实际调用的路径和响应结构；修改后至少完成对应模块测试、类型检查和生产构建。遇到微信 OAuth、真实支付或外部图片模型时，先使用 mock/fake 和预发布凭据，不能直接触碰线上真实支付。

## 参考文档

- `README.md`：中文项目介绍和常用命令。
- `docs/maintenance-handoff.md`：电脑维修前后的交接事项。
- `docs/node-migration/README.md`：完整迁移阶段。
- `docs/migration/progress.md`：详细进度和未完成事项。
- `docs/node-migration/test-and-acceptance.md`：测试分层和验收标准。
- `docs/node-migration/environment-inventory.md`：环境变量来源和敏感级别。
- `docs/node-migration/phase-09-cutover.md`：发布、灰度和回滚。
