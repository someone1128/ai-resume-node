# Node.js 全量迁移执行文档

## 目标

将当前 Java/Snowy 后端替换为一个轻量、模块化、可维护的 Node.js 后端。迁移以真实用户业务为边界，不迁移 Snowy 的通用平台能力。

保留范围：

- 简历核心业务；
- 校园市场圈；
- AI 证件照；
- AI 聊天（低优先级）；
- 微信登录；
- 微信支付；
- 腾讯云 COS；
- 会员、订单、兑换码和次数权益；
- 后台业务页面和字典管理。

不保留：

- Snowy 细粒度角色/资源/按钮/字段权限；
- 组织、岗位和移动端资源体系；
- 代码生成器；
- 多云存储；
- 未被真实业务使用的 Snowy 模块。

## 总原则

1. 先调研，后编码。
2. 先兼容现有数据库和前端协议；本次迁移不删除线上表、不修改数据库结构，历史结构只做记录和后续评估。
3. 以完整用户流程为迁移单位，不按 Java 文件逐个翻译。
4. 每个阶段都有独立测试和验收条件。
5. 阶段未通过时，不进入下一个业务阶段。
6. 前端 API 路径、Token 传递和响应包装默认保持兼容。
7. 腾讯云 COS、DeepSeek、豆包作为固定外部实现，只通过环境变量配置。
8. 微信 OAuth 不可用时，使用仅限本地/测试环境的测试用户 Token 验证登录后的业务接口。
9. 定时任务、备份恢复、运行监控、隐私数据和依赖许可也是迁移范围的一部分。
10. 环境变量以现有 YAML 和前端 `.env*` 为迁移来源，但真实密钥只通过部署环境注入。
11. 可以直接连接现有数据库进行只读调研和测试数据写入；禁止修改数据库结构、删除线上真实数据或批量改动真实业务数据。
12. 缺少的依赖和工具由迁移工作自行安装，并记录在 [environment-setup-log.md](environment-setup-log.md)。
13. 支付测试默认使用测试订单和模拟回调，不产生线上真实扣款。

## 阶段顺序

| 阶段 | 文档 | 结果 |
|---|---|---|
| 0 | [phase-00-research.md](phase-00-research.md) | 真实接口、页面、表和外部依赖清单 |
| 1 | [phase-01-foundation.md](phase-01-foundation.md) | Node 基础工程、编码规范和测试框架 |
| 2 | [phase-02-infrastructure.md](phase-02-infrastructure.md) | 数据库、Redis、Token、COS、AI 基础能力 |
| 3 | [phase-03-identity-and-admin.md](phase-03-identity-and-admin.md) | 微信登录、管理员登录、字典和基础用户能力 |
| 4 | [phase-04-resume-core.md](phase-04-resume-core.md) | 简历完整用户流程 |
| 5 | [phase-05-ai.md](phase-05-ai.md) | 简历 AI、AI 证件照、低优先级 AI 聊天 |
| 6 | [phase-06-membership-payment.md](phase-06-membership-payment.md) | 会员、权益、兑换码、微信支付 |
| 7 | [phase-07-campus.md](phase-07-campus.md) | 校园市场圈 |
| 8 | [phase-08-admin-web.md](phase-08-admin-web.md) | 精简后台和业务管理页面 |
| 9 | [phase-09-cutover.md](phase-09-cutover.md) | 全量切换、验证和 Java 下线 |

统一测试和验收规则见：[test-and-acceptance.md](test-and-acceptance.md)。

实际编码进度见：[docs/migration/progress.md](../migration/progress.md)。

逐项完成、可跳过外部门禁和切换前门禁见：[Node 迁移完成审计](../migration/completion-audit.md)。

## 阶段通用验收规则

每个阶段完成时必须提交：

- 代码变更；
- 配置变更；
- 数据库变更或兼容说明；
- 接口清单；
- 自动化测试；
- 手工验证记录；
- 已知风险和回滚方式。

阶段验收不允许以“本地能启动”作为唯一标准。
