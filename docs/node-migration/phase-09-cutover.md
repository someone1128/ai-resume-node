# 阶段 9：切换、清理和 Java 下线

## 目标

确认所有保留业务已由 Node 接管，再移除 Java/Snowy。

## 切换前清单

- 用户端核心流程回归通过；
- 微信登录回归通过；
- 微信支付沙箱/测试回调通过；
- 会员权益和兑换码一致；
- COS 历史文件可访问；
- AI 失败和计费行为正确；
- 校园市场圈回归通过；
- 后台日常操作通过；
- 定时任务和第三方回调已迁移；
- 数据库和文件已备份；
- Node 运行日志和错误监控已启用；
- Java 回滚包和旧配置仍可用。

## 切换方式

按现有兼容路径或 API 域名切换，而不是一次改所有前端。前端请求本身不带额外的 `/api` 前缀，反向代理如果配置了前缀，必须在代理层显式重写，不能把下面的兼容路径改成另一套公开 API：

```text
/c/resume/*                         -> Node
/c/photo/*                          -> Node
/aiChat/*                           -> Node
/oauth/resume/*                     -> Node
/auth/c/*                           -> Node
/dev/file/uploadTencentReturnUrl    -> Node
/extension/ai/analyze               -> Node
/ws/*                               -> Node（WebSocket）
/dev/config/sysBaseList             -> Node
/auth/b/*、/sys/userCenter/loginMenu -> Node（保留后台）
/biz/dict/*、/dev/dict/*            -> Node（字典）
```

`/test/jsapi/*` 只在诊断环境启用 mock 接口，不进入生产流量。具体路径以[前端真实接口清单](../migration/frontend-api-inventory.md)为准。

## 切换后验证

- 真实用户登录；
- 创建和编辑真实简历；
- 使用一次 AI 权益；
- 上传和读取一张图片；
- 完成一次测试支付回调；
- 管理员登录后访问首页和字典管理；
- 校园市场圈访问、投递和状态变更；
- 检查错误率、响应时间、数据库连接和 Redis 连接。

## Java 清理顺序

1. 停止前端对旧接口的调用；
2. 保留旧数据库表和备份；
3. 下线 Java 流量；
4. 删除无用 Snowy 插件和构建配置；
5. 删除不再使用的 Java 外部依赖；
6. 只清理 Node 不再读取的旧配置；数据库表和字段保留，不在本次迁移中删除或改结构；
7. 删除旧后台页面；
8. 最后归档 Java 仓库和部署脚本。

## 通过条件

所有保留业务均由 Node 提供，Java 可以停止且无用户流程、支付回调、后台操作或定时任务中断。
