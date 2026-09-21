# 环境变量迁移清单

## 原则

现有 Java 配置是环境变量和配置迁移的来源。迁移时读取：

- `ai-resume-service/snowy-web-app/src/main/resources/application.yml`
- `application-local.yml`
- `application-test.yml`
- `application-prod.yml`
- `application-shuai.yml`
- 两个用户端的 `.env*`
- 后台的 `.env*`

只迁移 Node 实际使用的配置。YAML 中的明文密钥可以作为迁移核对来源，但不能直接复制到新仓库、`.env.example` 或文档。

## Node 目标配置分组

### 应用

```text
NODE_ENV
PORT
PUBLIC_API_URL
PUBLIC_WEB_URL
LOG_LEVEL
```

### MySQL

```text
DATABASE_HOST
DATABASE_PORT
DATABASE_NAME
DATABASE_USER
DATABASE_PASSWORD
DATABASE_CONNECTION_LIMIT
```

### Redis

```text
REDIS_URL
REDIS_DATABASE
REDIS_PASSWORD
REDIS_MAX_CONNECTIONS
REDIS_CONNECT_TIMEOUT_MS
```

### 测试身份

只允许 development/test：

```text
TEST_AUTH_ENABLED
TEST_USER_ID
TEST_AUTH_TOKEN
```

```text
CLIENT_TOKEN_TTL_SECONDS
```

不把现有 YAML 中的固定 Token 作为 Node 仓库默认值。

### 微信登录

```text
WECHAT_APP_ID
WECHAT_APP_SECRET
WECHAT_REDIRECT_URI
WECHAT_REDIRECT_URI_OFFER
WECHAT_REDIRECT_URI_PHOTO
WECHAT_REDIRECT_URI_CAMPUS
WECHAT_MP_REDIRECT_URI_CAMPUS
```

实际保留哪些回调地址，以阶段 0 的前端和生产入口清单为准。

### 微信支付

```text
PAYMENT_MODE=mock|live
```

迁移和本地验收固定使用 `mock`。`live` 只有在微信支付签名、证书和预发布商户专项验收后才允许打开；证书路径通过 `WECHAT_PAY_CERT_P12_PATH`、`WECHAT_PAY_CERT_PATH`、`WECHAT_PAY_PRIVATE_KEY_PATH` 和 `WECHAT_PAY_CERT_SERIAL_NO` 注入，不能放进仓库。

```text
WECHAT_PAY_APP_ID
WECHAT_PAY_MCH_ID
WECHAT_PAY_MCH_KEY
WECHAT_PAY_API_V3_KEY
WECHAT_PAY_CERT_SERIAL_NO
WECHAT_PAY_PRIVATE_KEY_PATH
WECHAT_PAY_CERT_PATH
WECHAT_PAY_NOTIFY_URL
```

### 腾讯云 COS

```text
TENCENT_COS_SECRET_ID
TENCENT_COS_SECRET_KEY
TENCENT_COS_REGION
TENCENT_COS_BUCKET
TENCENT_COS_PUBLIC_BASE_URL
```

不迁移阿里云、MinIO、本地文件目录和存储引擎选择配置。

### AI

```text
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
DEEPSEEK_MODEL
DOUBAO_API_KEY
DOUBAO_BASE_URL
DOUBAO_TEXT_MODEL
DOUBAO_IMAGE_MODEL
DOUBAO_IMAGE_SIZE
AI_REQUEST_TIMEOUT_MS
AI_MAX_INPUT_LENGTH
AI_MAX_OUTPUT_TOKENS
PHOTO_COMPENSATION_ENABLED
PHOTO_COMPENSATION_INTERVAL_MS
PHOTO_COMPENSATION_STALE_MINUTES
```

模型 ID 以当前线上实际使用和 provider 文档为准，不从旧配置盲目复制失效模型名。

`PHOTO_COMPENSATION_ENABLED` 默认关闭。只有完成预发布测试、确认 Node 实例拥有对应表的最小写权限后才开启；该任务只补偿超时的 AI 证件照记录，不替代真实豆包调用。

### 前端兼容

```text
NEXT_PUBLIC_API_URL
NEXT_PUBLIC_WS_URL
NEXT_PUBLIC_URL
NEXT_PUBLIC_GA_ID
VITE_BASE_URL
```

微信 OAuth 完成登录后使用 `token:C:token:<token>` Redis 映射保存客户端会话；
不同产品的微信回调和前端跳转地址分别由 `WECHAT_REDIRECT_URI_*` 与
`FRONT_REDIRECT_URI_*` 提供，避免把生产域名写死在 Node 源码中。

这些属于前端或后台部署配置，Node 项目只记录它们与 API 路由切换的关系，不把前端公开变量误认为服务端密钥。

### 调研与测试夹具脚本

只读盘点脚本使用 `INSPECT_DB_HOST`、`INSPECT_DB_PORT`、`INSPECT_DB_NAME`、`INSPECT_DB_USER` 和 `INSPECT_DB_PASSWORD`。测试夹具脚本额外要求显式设置 `ALLOW_TEST_FIXTURE_WRITE=true`，并在 `NODE_ENV=production` 下永久拒绝；`FIXTURE_DRY_RUN=true` 只生成测试标识，不连接数据库。脚本不执行 DDL，也不更新或删除既有数据。

## 迁移方法

1. 从 YAML 和 `.env*` 提取键名；
2. 按 Node 目标配置分组；
3. 为每个键标记来源、环境、是否必需、是否敏感；
4. 生成 `.env.example`，敏感值留空；
5. 由部署环境注入真实值；
6. 启动时用 Zod 校验必需项；
7. 对本地、测试、生产分别执行配置检查；
8. 迁移完成后轮换已经在仓库或聊天中暴露过的密钥。

## 验收

- Node 启动时能指出缺少的必需变量；
- 本地可以只配置本地数据库、Redis、测试 Token 和测试 COS；
- 生产不能使用测试 Token；
- 生产不依赖仓库内的明文配置；
- 每个外部服务都有清晰的配置来源；
- `.env.example` 不含任何真实密钥；
- 日志和错误信息不会打印敏感变量值。
