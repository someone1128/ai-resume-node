# 数据库使用盘点

完整表数量和聚合数据见 [live-database-inventory.md](live-database-inventory.md)。当前迁移只为实际保留业务建立类型和查询；其他 Snowy 表保留在数据库中，不在迁移中删除。

## 迁移重点

- `client_user`：微信身份、昵称、会员有效期和基础用户信息；
- `sc_resume` / `sc_resume_modules`：核心简历及模块正文，模块表约 85 万行，读取必须按用户和分页过滤；
- `sc_user_function_limits`：AI 与功能次数，扣减和失败返还使用事务；
- `sc_ai_photo_generation_record`：证件照记录，历史有效样本不足，真实生成使用测试记录；
- `sc_campus_recruitment` / `sc_campus_recruitment_user`：校园内容与用户状态；
- `t_payment_order` / `t_recharge_record` / `t_redeem_code`：订单、权益和兑换码状态；
- `dev_dict`：后台实际需要的字典分类，目前线上主要为 `FRM`；
- `sys_user`：现有 2 个管理员，统一拥有保留后台权限。

所有线上写入都使用登记的测试账号和唯一前缀；迁移过程不改表结构、不批量更新真实用户、不删除真实数据。
