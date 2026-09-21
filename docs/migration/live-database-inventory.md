# 线上数据库只读盘点结果

盘点方式：Node 临时只读脚本连接现有 MySQL，查询表元数据、精确行数、字段元数据和有限的状态聚合。没有执行 DDL、INSERT、UPDATE、DELETE，也没有输出行级个人信息、Token、密码、支付密钥或配置值。

## 数据库概况

- 数据库：`ai-resume`；
- MySQL：`5.7.44-log`；
- 表数量：78；
- 当前连接脚本：`resume-node/scripts/inspect-database.ts`、`resume-node/scripts/inspect-core-data.ts`。

## 核心业务数据量

以下是本次只读查询得到的精确 `COUNT(*)`，不是 InnoDB 估算值：

| 表 | 行数 | 迁移意义 |
|---|---:|---|
| `client_user` | 35,056 | 用户、微信标识、会员字段和功能额度 |
| `sys_user` | 2 | 当前管理员账号 |
| `sc_resume` | 2,122 | 用户简历主记录 |
| `sc_resume_modules` | 852,875 | 简历模块正文，迁移时重点关注性能和 JSON 体积 |
| `sc_user_function_limits` | 1,711 | 功能次数/权益 |
| `sc_ai_photo_generation_record` | 47 | AI 证件照生成记录 |
| `sc_campus_recruitment` | 11,590 | 校园招聘内容 |
| `sc_campus_recruitment_user` | 118,589 | 校园招聘与用户关系/记录 |
| `t_payment_order` | 15,215 | 支付订单 |
| `t_recharge_record` | 6,343 | 充值记录 |
| `t_redeem_code` | 21,659 | 兑换码 |

AI 证件照记录的状态聚合显示 47 条全部为 `delete_flag=DELETED`，其中 1 条为 `PROCESSING`、46 条为 `SUCCESS`，provider 均为火山引擎。当前线上没有可直接作为“未删除记录”回归样本的证件照记录；迁移测试必须使用新建的测试记录或隔离的模拟服务，不能把已删除历史记录当作正常业务样本。

## 已确认的状态数据

`t_payment_order` 当前存在：

- `待支付`：8,982；
- `支付成功`：6,233。

这说明 Node 迁移必须保留未支付订单查询、过期策略和订单状态兼容，不能只迁移已支付记录。

`sys_user` 当前有 2 个未删除且启用的管理员账号。后台可以按约定保留管理员账号，并让每个管理员拥有全部保留后台权限。

## 字典与配置

`dev_dict` 当前有 133 条未删除字典项，实际业务分类聚合结果为：

- `FRM`：132 条。

这与“只保留业务实际使用的字典”一致，但还需要通过前端和 Java 服务调用位置确认 `FRM` 中哪些项被使用。

`dev_config` 当前有 67 条未删除配置。配置类别包括业务定义、文件存储、短信、邮件、系统基础和第三方登录。Node 只迁移阶段 0 清单确认需要的业务配置；腾讯云 COS、DeepSeek、豆包和微信配置改为环境变量，不把 Snowy 配置中心整体迁移。

## 关键表关系线索

- `sc_resume.user_id -> client_user.id`；
- `sc_resume_modules.resume_id -> sc_resume.id`；
- `sc_user_function_limits.user_id -> client_user.id`；
- `t_payment_order.user_id -> client_user.id`；
- `t_payment_order.recharge_record_id -> t_recharge_record.id`；
- `sc_ai_photo_generation_record.user_id -> client_user.id`；
- 校园市场圈包含独立的用户、内容、招聘、解锁、审核、上传和日志表。

正式实现前还要读取这些表的索引、默认值、删除标志约定和外键/逻辑关联，不能仅凭列名实现写入。

## 当前结论

1. 数据规模适合先兼容现有表，不需要先做全库重建。
2. `sc_resume_modules` 是最大核心业务表，简历读写必须避免无条件全量加载。
3. 会员和支付数据必须独立做幂等和状态机测试。
4. 后台字典确实有真实数据，不能从迁移范围中删除；目前至少要继续调查 `FRM` 分类。
5. Snowy 的文件、短信、邮件和第三方配置表包含大量未必需要的配置，不能直接全部转成 Node 环境变量。
