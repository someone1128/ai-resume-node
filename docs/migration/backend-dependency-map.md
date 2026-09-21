# 后端依赖映射

| Node 模块 | 核心表 | Redis | COS | 外部依赖 |
|---|---|---|---|---|
| auth | `client_user`、`sys_user` | Snowy `token:C:token:*`、Node 管理员 Token | - | 微信 OAuth |
| resume | `sc_resume`、`sc_resume_modules`、`sc_user_actions`、`client_user` | Token | 预览图/上传文件 | - |
| AI resume | 简历表、`sc_resume_report`、`sc_interview_questions`、`sc_user_function_limits` | Token/额度事务 | 输入文件和结果文件按场景使用 | DeepSeek、豆包 |
| photo | `sc_ai_photo_generation_record`、`sc_user_function_limits` | Token/额度事务 | 输入和生成结果 | 豆包图像接口 |
| membership/payment | `sc_member_package`、`t_payment_order`、`t_recharge_record`、`t_redeem_code`、`client_user` | Token、支付通知由 WebSocket 内存连接管理 | - | 微信支付；mock 模式不出网 |
| campus | `sc_campus_recruitment`、`sc_campus_recruitment_user` | Token | 岗位图片按现有 URL 语义 | - |
| notification | `sc_notification`、`sc_user_notification` | Token | - | - |
| distribution/ad | 分销、广告位相关 `sc_*` 表 | Token | 广告素材沿用 URL | - |
| admin/dict | `dev_dict`、`dev_dict_item` | 管理员 Token | - | - |

Node 通过 Kysely 集中访问数据库；业务模块不直接创建 MySQL/Redis/COS 客户端。数据库结构继续兼容现有表，不执行 DDL。
