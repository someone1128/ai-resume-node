# 阶段 0：真实业务调研与迁移清单

## 目标

确定哪些业务真的在使用，避免把 Snowy 的冗余功能迁移到 Node.js。

## 调研范围

- `ai-resume-web` 用户端；
- `offer-star-web` 用户端；
- `snowy-admin-web` 后台；
- Java Controller、Service、Mapper 和配置；
- MySQL 表、Redis Key 和文件 URL；
- 微信登录、微信支付、腾讯云 COS、DeepSeek、豆包回调和凭据；
- 生产访问日志、错误日志和定时任务。

## 工作项

1. 扫描两个用户端的 API 文件、直接 `fetch`、Next.js `app/api` 路由和页面调用。
2. 将每个前端调用映射到 Java Controller 方法。
3. 标记接口所属完整用户流程，而不是只记录单个接口。
4. 扫描后台 API 和页面，区分 Snowy 默认页面与真实业务页面。
5. 统计每个接口使用的表、Redis Key、文件存储和外部服务。
6. 检查生产日志验证静态代码中仍存在的接口是否真的被调用。
7. 标记“必须迁移、待确认、废弃”。
8. 扫描 `@Scheduled`、任务调度配置、异步线程和消息消费代码，建立定时/后台任务清单。
9. 盘点历史文件 URL、COS 对象 Key、下载重定向和过期链接行为。
10. 盘点敏感数据、隐私字段、日志输出和数据保留要求。
11. 记录 Java 当前的部署、反向代理、健康检查、日志目录、备份和发布脚本。
12. 直接读取现有数据库中的配置和业务数据，核对 YAML 中的腾讯云 COS、AI、微信和业务字典配置；数据库结果优先作为线上实际状态参考。

## 产出

```text
docs/migration/
  frontend-api-inventory.md
  frontend-flow-inventory.md
  admin-page-inventory.md
  backend-dependency-map.md
  database-usage-inventory.md
  external-integration-inventory.md
  scheduled-jobs-inventory.md
  file-url-compatibility.md
  privacy-data-inventory.md
  deployment-inventory.md
  migration-scope.md
```

当前已完成的线上数据库只读盘点见：[live-database-inventory.md](../../docs/migration/live-database-inventory.md)。该盘点只保存表名、字段元数据和聚合计数，不保存用户内容、配置值、密码或 Token。

## 必须回答的问题

- 每个用户端页面调用哪些接口？
- 每个核心流程是否存在 Java 之外的隐式依赖？
- 哪些接口被两个用户端同时使用？
- 后台字典中哪些分类被业务读取？
- 哪些历史数据必须兼容？
- 哪些定时任务和异步任务必须迁移？
- 历史文件 URL 是否必须长期保持不变？
- 哪些个人简历、联系方式和支付数据需要脱敏、加密或限制日志输出？
- 当前生产部署、备份和回滚具体依赖哪些脚本和外部配置？
- 数据库中的实际 COS 配置、字典和业务开关是否与 YAML 一致？
- 哪些支付回调、登录回调和定时任务不能遗漏？
- AI 证件照和校园市场圈是否使用独立表和独立文件目录？

## 测试与验证

本阶段不写业务测试，但必须完成：

- 静态接口扫描结果人工复核；
- 前端页面到接口的调用链复核；
- 生产日志接口命中情况复核；
- 数据库表和接口映射抽样复核；
- 外部回调 URL 清单复核。

## 通过条件

没有“核心接口但不知道对应数据或依赖”的条目；每一个保留业务都有明确的迁移边界和验证方式。
