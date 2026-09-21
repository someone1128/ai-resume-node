# 迁移测试数据登记

这里只登记迁移工作自行创建、允许后续清理的数据。真实用户、简历、订单和文件不纳入清理范围。

## 规则

- 账号、简历标题和内容统一使用 `codex_migration_test_` 前缀；
- 测试 Token 只通过本地环境变量注入，不写入仓库；
- 测试支付只允许模拟订单和回调，不产生真实扣款；
- 清理只能针对本表登记的主键，并优先使用软删除；
- 每次写入前后都记录 SQL 用途和验证结果。

## 可重复创建夹具

`resume-node/scripts/create-test-fixture.ts` 只允许创建带 `codex_migration_test_` 前缀的用户、简历和模块，并且默认拒绝写入。执行前必须显式设置 `ALLOW_TEST_FIXTURE_WRITE=true`；`NODE_ENV=production` 永远拒绝。可以先使用 `FIXTURE_DRY_RUN=true` 查看将要生成的标识，不会连接数据库。

```powershell
$env:NODE_ENV = 'development'
$env:ALLOW_TEST_FIXTURE_WRITE = 'true'
$env:FIXTURE_DRY_RUN = 'true'
pnpm db:create-test-fixture
```

实际写入时还必须通过 `INSPECT_DB_HOST`、`INSPECT_DB_PORT`、`INSPECT_DB_NAME`、`INSPECT_DB_USER` 和 `INSPECT_DB_PASSWORD` 注入数据库连接；脚本只执行三张核心表的事务性 `INSERT`，不执行 DDL、更新既有数据或删除操作。

## 当前夹具

### 2026-09-21：第一组只读接口夹具

脚本使用事务写入一个测试用户、一份简历和一个简历模块，不触碰既有数据。

| 类型 | 主键/标识 | 备注 |
|---|---|---|
| `client_user` | `991789926895305490` | `codex_migration_test_1789926895305490` |
| `sc_resume` | `codex_migration_test_1789926895305490` | 基础信息和详情接口测试 |
| `sc_resume_modules` | `codex_migration_test_module_178992689530` | 基本信息模块 |
| `sc_resume_report` | `6a509ab29ee04bd4a9d82dc5e9258d05` | DeepSeek 分析接口测试 |
| `sc_interview_questions` | `227a53b2be7b4e2984e4f3e5fe54a928` | DeepSeek 面试题接口测试 |
| `sc_user_function_limits` | 测试用户 + `简历分析` | 接口初始化的 3 次测试额度 |
| `t_payment_order` | `codex_migration_test_order_1789931179910_acd41133` | mock 微信支付订单，已模拟成功回调；仅属于测试用户 |
| `sc_campus_recruitment_user` | `efc46390dc71475cb3a60711ed444b8b` | 校园自定义记录创建/编辑/删除回归，已删除 |

验证状态：已提交事务；测试订单状态为“支付成功”，测试账号会员时长已更新；校园自定义记录已删除；真实数据未删除。

### 2026-09-21：非会员 AI 权限隔离夹具

为验证 AI 次数限制和简历归属校验，创建了第二个无会员权益的测试用户和一份测试简历；只调用失败的越权 AI 请求，没有调用外部模型，也没有删除其他数据。

| 类型 | 主键/标识 | 备注 |
|---|---|---|
| `client_user` | `991789940176087651` | `codex_migration_test_1789940176087651` |
| `sc_resume` | `codex_migration_test_1789940176087651` | 用于非本人简历 ID 越权测试 |
| `sc_resume_modules` | `codex_migration_test_module_178994017608` | 基本信息模块 |
| `sc_user_function_limits` | 测试用户 + `简历分析` | 查询初始化为 3 次；越权失败前后仍为 3 次 |

验证状态：已提交事务；该夹具没有会员权益，没有支付订单，没有调用真实 AI；后续清理只允许针对本表登记主键。

### 2026-09-21：Node mock JSAPI 诊断接口回归

为验证现有 `offer-star-web/app/test/jsapi-payment` 页面切换 Node 后仍可运行，使用第一组测试账号创建一笔 mock JSAPI 订单，查询待支付状态，回放成功回调，再查询支付成功状态。没有调用微信接口或产生扣款。

| 类型 | 主键/标识 | 备注 |
|---|---|---|
| `t_payment_order` | `codex_jsapi_test_1789941068339_9125a77b` | Node mock JSAPI 订单，已回放成功回调；仅属于第一组测试用户 |

验证状态：创建、查询、回调和幂等前置路径通过；后续清理只允许针对本表登记订单。

### 2026-09-21：Node AI 聊天会话回归

使用第二组无会员测试账号创建会话，调用 DeepSeek 生成一次短回答，读取消息分页和下一步引导，再通过 Node 删除接口软删除本次会话及消息。未修改其他用户数据。

| 类型 | 主键/标识 | 备注 |
|---|---|---|
| `t_chat_dialogue` | `178994195523935847` | AI 聊天持久化回归，已软删除 |
| `t_chat_message` | `178994195544875223`, `178994195581221029` | 用户消息和 AI 消息，已软删除 |

验证状态：会话创建、DeepSeek 返回、消息分页、引导接口和软删除均通过；测试数据仅保留数据库软删除记录。

### 2026-09-21：Node 简历编辑全链路回归

使用第一组测试账号创建一份新的简历，完成详情、基础信息、名称、模板、封面、样式、模块、收藏、使用、发布、取消发布和软删除；没有保留线上可见副本。

| 类型 | 主键/标识 | 备注 |
|---|---|---|
| `sc_resume` | `7e22cecc80074e88acea67d2937a04e4` | 创建、编辑、发布和软删除回归 |
| `sc_resume_modules` | 该简历创建的模块 UUID | 随简历软删除 |
| `sc_user_actions` | 该简历的收藏动作 | 已取消收藏 |

验证状态：所有步骤返回兼容 `code=200`；公开副本已先取消发布再删除原简历，测试数据不再对用户端可见。

### 2026-09-21：Node 校园自定义投递记录回归

使用第一组测试账号创建自定义校园记录，读取分页、更新公司和状态、删除并验证重复删除错误；记录已删除。

| 类型 | 主键/标识 | 备注 |
|---|---|---|
| `sc_campus_recruitment_user` | `a0e839b4658349018d7fa1a690ec8adf` | 自定义投递记录创建/读取/更新/删除回归，已删除 |

验证状态：创建、分页、更新、读取、删除均符合兼容响应；第二次删除返回业务 `code=404`，没有删除其他用户数据。
