# 外部服务盘点

| 服务 | 当前用途 | Node 实现 | 可执行验收 | 当前边界 |
|---|---|---|---|---|
| 腾讯云 COS | 简历/证件照/素材文件 | 统一 COS service 和上传路由 | 真实测试对象上传、HEAD、签名 URL、删除通过 | 只保留 COS，不迁移其他存储 |
| Redis | Snowy Token、Node 会话/临时状态 | ioredis 封装 | 生产 Redis PING、TTL、读写和清理通过 | 不删除真实 Token |
| DeepSeek | 文本分析、聊天、优化 | Vercel AI SDK provider | 隔离账号短回答、上下文和失败返还通过 | API key 只运行时注入 |
| 豆包/火山引擎 | AI 证件照及预留文本能力 | OpenAI-compatible/HTTP 适配边界 | 失败、超时和 COS 回滚可测 | 真实图像生成需预发布凭据 |
| 微信 OAuth | 微信登录 | 授权 URL、code exchange、资料同步 | URL 和旧 Token 兼容已测 | 真实回调需预发布凭据 |
| 微信支付 | 套餐支付 | mock 订单、幂等回调、支付 WebSocket；live fail-closed | mock 全链路通过 | 真实验签、证书和扣款不在本轮执行 |

外部服务错误统一分类为超时、4xx、5xx、非法结构或未配置，不把密钥、Token、支付签名和完整简历正文写入日志。
