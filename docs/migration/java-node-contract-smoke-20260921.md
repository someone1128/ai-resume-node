# Java / Node 只读契约烟测

日期：2026-09-21

使用 Redis 中现有有效 Snowy C 端 Token，仅做只读请求；Token 没有写入文件、数据库或 Redis。Java 请求发送到线上兼容 API，Node 请求发送到本地编译产物并连接同一 MySQL/Redis。结果只记录响应形状，不记录用户内容、简历正文或 Token。

| 路径 | Java code/success | Node code/success | 数据形状 |
|---|---|---|---|
| `/c/resume/category` | `200/true` | `200/true` | 两边均为数组，样本数量均为 11 |
| `/c/resume/memberPackage` | `200/true` | `200/true` | 两边均为套餐数组 |
| `/c/resume/templates?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |
| `/c/resume/campusRecruitment?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |
| `/c/resume/notification/unreadCount` | `200/true` | `200/true` | 两边均包含 `systemCount, activityCount, likeCount, collectCount, likeAndCollectCount, totalCount` |
| `/c/resume/notification/page/system?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |
| `/c/resume/notification/page/activity?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |
| `/c/resume/notification/page/like?page=1&limit=1` | 线上 Java 样本返回 `500` | `200/true` | Node 返回 Java `CommonPage` 形状；Java 样本错误属于原服务数据/查询问题，未作为 Node 兼容基线 |
| `/c/resume/invitationRecords?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |
| `/c/resume/invitedUserDetails?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |
| `/c/resume/templates/my?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |
| `/c/resume/templates/myCollects?page=1&limit=1` | `200/true` | `200/true` | 两边均为 `page, limit, totalPage, total, list, reservedObject` |

本次烟测发现并修复了 Node 简历模板分页曾返回 `records/current/size/pages` 的兼容问题，现已改为 Java `CommonPage` 字段，两个用户端直接读取 `data.list` 可以继续工作。字段顺序不作为契约要求。

本烟测不覆盖写接口、微信 OAuth、真实支付、豆包图片生成和管理员密码登录；这些分别由测试夹具或预发布外部服务门禁覆盖。系统公告第一次取样出现过一次短时 `401`，使用同一 Redis 扫描策略重新获取有效 Token 后恢复为 `200/true`，不属于持续性接口差异。
