# 部署、健康检查和回滚盘点

## 当前组件

- Node 后端：`resume-node`，编译产物通过 `node dist/src/server.js` 启动；
- 用户端：`ai-resume-web` 端口 3200，`offer-star-web` 使用 Next 默认端口；
- 后台：现有 Vue/Vite Snowy 后台，迁移首批只依赖 Node 启动配置、管理员会话和字典接口；
- MySQL、Redis、腾讯云 COS 沿用现有服务；
- 反向代理需把保留 API、SSE 和 WebSocket `/ws/*` 转发到 Node。

## Node 运维接口

- `/health`：进程存活，不访问数据库；
- `/ready`：验证 MySQL 和 Redis 可用；
- Fastify 优雅关闭会释放 Kysely、Redis 和 WebSocket 连接；
- `requestId` 和错误类别进入结构化日志，业务正文不进入日志。

## 切换与回滚

先按域名或路径将测试流量转到 Node，观察登录、简历、AI、会员、校园和后台字典，再扩大范围。回滚只切换反向代理流量和配置，不删除 Node 或 Java 数据；Java 包和旧配置在首个稳定窗口前保留。

当前已完成 Node 冷启动与健康检查基线；备份恢复、真实管理员登录、真实 OAuth、真实支付签名和正式灰度切换必须在预发布环境执行。
