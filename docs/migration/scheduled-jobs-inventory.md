# 定时任务和后台作业盘点

静态扫描 Java 工程的 `@Scheduled` 结果只有分析事件服务中的注释示例，但 Snowy 的 `CommonTimerTaskRunner` 机制仍注册了若干可由 `dev_job` 调度的任务。`DEV_JOB` 初始化样例中的通用示例任务是停止状态，因此不能仅凭类存在就假定线上正在运行；正式切换前必须只读核对线上 `dev_job` 的 `status/action_class`。

已发现的任务按迁移结论登记如下：

| Java 任务 | 业务影响 | Node 结论 |
|---|---|---|
| `AiPhotoQuotaCompensationTaskRunner` | 处理进程崩溃后遗留的 `PROCESSING` 证件照记录并返还次数 | Node 已增加等价的条件更新、事务和额度返还任务；由 `PHOTO_COMPENSATION_ENABLED` 显式开启，默认关闭，避免未审计部署自动写线上数据 |
| `CampusRatingReconcileTaskRunner` | 校园市场圈另一套评分聚合字段校准 | 当前用户端迁移的是 `campusRecruitment` 业务，Node 未使用该评分表；切换前只读核对 `dev_job`，若线上启用或页面重新依赖，再单独迁移 |
| `MaigcRemoveTaskRunner` | Snowy 旧“魔力”签到余额过期扣除和消息 | Node AI 聊天不使用魔力余额，当前前端没有该业务入口；不迁移，保留表和数据不动 |
| `OperationStatTaskRunner` | 运营统计发送飞书 | 不属于用户端保留业务；Java 已改为只从 `FEISHU_WEBHOOK_URL` 读取，未配置时跳过，不把 Webhook 带入 Node |
| `MemberRemoveTaskRunner` | 空实现 | 废弃，不迁移 |

Node 证件照补偿任务只会把仍为 `PROCESSING` 且超过阈值的记录条件更新为 `FAILED`，并在同一事务中返还一次额度；重复实例不会重复返还。启用前要在预发布对一条本次创建的测试记录做回归，不能直接拿真实用户记录做演练。

切换前用 `resume-node` 的 `pnpm db:inspect:scheduled-jobs` 读取线上 `dev_job`，确认哪些任务实际处于运行状态。该脚本只查询任务元数据，不修改任务状态；输出中如出现上述范围外任务，必须先补充迁移结论，不能因为 `DEV_JOB` 页面不在首批后台菜单而直接忽略。

扫描到的其他异步机制：

- AI 聊天/讯飞旧实现的线程和 WebSocket：用户端已迁移到 Node DeepSeek 流式接口；
- Java SSE 心跳线程：不作为 Node 核心依赖；
- Redis key expiration listener：支付关闭订单处理在 Java 中为注释路径，Node mock 订单由显式回调处理；
- 微信支付 WebSocket：Node 已提供 `/ws/:userId/:type`，仅在订单状态变更后通知已连接浏览器。

如果未来启用真正的异步生成任务，应先登记任务、重试、幂等、时区和重启恢复规则，再引入队列或 cron；本轮不凭 Snowy 通用模块推断业务任务。
