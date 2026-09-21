# 前端实际接口清单（静态调研第一版）

来源：`ai-resume-web/api/`、`offer-star-web/api/`、两个前端的 Axios/request 封装，以及 Next.js API route 中的直接 `fetch`。路径和字段先按现有代码记录，迁移实现必须继续用 Java 对照测试确认响应字段。

## 两个前端共同使用

| 业务 | 兼容路径 | 调用文件 | 状态 |
|---|---|---|---|
| 简历详情/基础信息 | `/c/resume/:id`、`/c/resume/:id/baseInfo` | `resumeApi.ts` | 第一阶段已在 Node 实现只读接口 |
| 简历列表/模板 | `/c/resume/templates*` | `resumeApi.ts` | Node 已实现并完成 Java/Node 只读契约烟测，返回 Java `CommonPage` 字段 |
| 简历编辑 | `/c/resume/create`、`modules`、`name`、`previewImage`、`template`、`styleConfig` | `resumeApi.ts` | Node 已实现；线上测试账号已完成创建、详情、基础信息、编辑、模块保存和软删除回归 |
| 发布/收藏/使用/删除 | `/c/resume/publish`、`unpublish`、`collect`、`disCollect`、`use`、`DELETE` | `resumeApi.ts` | Node 已实现；测试账号已完成会员门禁、公开副本发布/取消、收藏/取消、使用和删除回归 |
| AI 简历 | `/c/resume/import*`、`analysisText`、`translate`、`aiGenerate`、`aiInterview*`、`optimize*` | `aiResumeApi.ts` | Node + Vercel AI SDK 已实现；TXT/不支持格式解析回归通过，脱敏 DOCX/PDF 和真实豆包仍留预发布 |
| 分析报告 | `/c/resume/analyze*` | `analyzeReportApi.ts` | Node 已实现，待 Java/Node 快照对照 |
| 会员/兑换码 | `/c/resume/memberPackage*`、`/c/resume/redeem/:code` | `memberApi.ts` | Node 已实现；真实微信支付保持关闭 |
| 微信身份 | `/oauth/resume/render/wechat`、`/oauth/resume/wx/getCode`、`/oauth/resume/wx/getOpenId*`、`/auth/c/getLoginUser`、`doLogout` | `loginApi.ts` | Node 已实现授权 URL、code exchange、资料同步和 Snowy 兼容 Token；真实回调留预发布 |
| 腾讯云文件 | `/dev/file/uploadTencentReturnUrl` | `api/index.ts` | 只保留 COS 实现 |
| AI 证件照 | `/c/photo/template`、`/c/photo/file/upload`、`/c/photo/quota`、`/c/photo/generation*`、`/c/photo/generate` | Java 证件照页面及兼容客户端 | Node 已实现 COS 上传、额度、记录和豆包生成入口；真实豆包模型留预发布 |
| AI 聊天 | `/aiChat/c/gpt/*`、`/aiChat/c/dialogue*`、`/aiChat/c/message/page` | 当前页面调用较少；旧 Next `/api/chat/ai*` 只保留兼容代理 | Node 已实现 DeepSeek/Vercel AI SDK、最近对话上下文、会话和消息持久化，并保留普通/讯飞星火引导路径；浏览器流式请求已切换到 Node |


## offer-star 额外使用

| 业务 | 兼容路径/前缀 | 调用文件 | 状态 |
|---|---|---|---|
| 校园市场圈 | `/c/resume/campusRecruitment*`（列表、报名/推荐、进度、统计、状态、备注、自定义内容） | `campusRecruitmentApi.ts` | Node 已实现；列表/进度/记录返回 Java `CommonPage` 字段并完成 Java/Node 只读契约烟测，两个用户端校园页面均已通过 Node 浏览器回归 |
| 招聘记录 | 记录的增删改查前缀 | `recruitmentRecordApi.ts` | Node 已实现；线上测试账号已完成自定义记录创建、分页读取、更新、删除和重复删除错误回归 |
| 站内通知 | `/c/resume/notification/*` | `notification.ts` | Node 已实现系统/活动/点赞收藏分页、未读统计、已读和一键已读；Java/Node 只读分页与未读契约烟测已完成（点赞收藏 Java 样本本身返回 500，Node 保持 CommonPage 形状） |
| 广告位 | `/c/resume/adslot/*`、`/c/adSlot/*`、Java 兼容的 `/c/common/adslot/*` | `adSlotApi.ts` | Node 列表/点击入口已实现；接口 smoke 已通过，页面点击属于补充回归 |
| Offer 会员 | `/c/resume/memberPackage/offer*`、JSAPI 下单、`/ws/:userId/WxPay` | `memberApi.ts`、`components/navbar/MemberModal.tsx` | Node mock JSAPI 订单/回调和支付 WebSocket 通知已验证；真实支付保持关闭 |
| 分销/邀请 | `/c/resume/distribution/stat`、`invitationRecords`、`invitedUserDetails`、`redeemCode/:invitationCode` | `resumeApi.ts` | Node 只读兼容入口已实现；邀请记录和被邀请用户分页已完成 Java/Node CommonPage 契约烟测 |
| 微信支付调试接口 | `/test/jsapi/*` | `jsapiTestApi.ts` | 仅测试用途；Node 提供 mock-only 兼容接口，不调用真实微信支付 |
| 浏览器扩展 AI | `/api/extension/ai/analyze`（前端兼容代理）→ Node `/extension/ai/analyze` | `offer-star-web/app/api/extension/ai/analyze`、扩展网关 | Node 校验扩展 Token、字段协议和结构化 AI 响应；Next 只负责兼容转发 |

## 当前保留的后台接口

| 业务 | 兼容路径 | 调用页面 | 状态 |
|---|---|---|---|
| 管理员启动配置 | `/dev/config/sysBaseList` | `snowy-admin-web` 启动流程 | Node 已提供公开的非敏感配置列表 |
| 字典管理 | `/biz/dict/*`、`/dev/dict/*` | `snowy-admin-web/src/views/biz/dict` | Node 已实现分页、树查询、详情、增删改和父项删除保护；数据库管理员统一拥有完整保留后台权限 |

## 已确认的协议约束

- 用户端 Axios 会发送 `token` 和 `invitationCode` 请求头；Node 必须继续接受 `token`；
- 用户端按响应体 `code`、`data`、`msg/message`、`success` 判断结果；Node 保留这些字段；
- `401` 主要由响应体 `code` 判断，迁移期间继续兼容当前行为；
- 未经专项回归，不调整路径、Token 名称和响应字段命名；
- 文件上传必须保持 multipart 字段 `file` 和腾讯云返回 URL 语义。
- Java 校园分页的 `CommonPage` 字段是 `page`、`limit`、`totalPage`、`total`、`list`、`reservedObject`；用户端请求封装会剥掉最外层 `CommonResult.data`，组件因此需要兼容直接分页对象和历史嵌套对象。

## Java 接口排除记录

阶段 0 的静态调用扫描限定在两个用户端的业务源码（`app/`、`components/`、`stores/`、`api/`，排除 `node_modules`、构建产物和公共依赖）。截至 2026-09-21，Java 中以下接口没有在用户端源码中发现调用，因此不进入 Node 首批兼容面：

| Java 接口族 | 排除理由 | 后续处理 |
|---|---|---|
| `/c/resume/questionnaire`、`/c/resume/config` | 两个用户端没有对应请求或页面 | 保留调研记录；若产品重新启用再单独评估，不迁移 Snowy 配置/问卷模块 |
| `/c/resume/icon/*`、`/c/resume/cardImg/*`、`cardShadowImg/*`、`cardMaterial/*`、`cases/upload` | 用户端实际上传入口是腾讯云 COS 兼容接口和 AI 证件照上传 | 不迁移旧图片上传链路；保留 COS 和证件照上传 |
| `/c/resume/memberPackage/syncOrder/*`、Stripe 相关接口 | 当前线上支付方式是微信支付，前端只调用套餐、免费订单、微信 JSAPI/回调路径 | 不迁移 Stripe 和订单同步旁路；真实微信支付上线前另做签名/回调门禁 |
| `/c/resume/notification` 发布、删除等管理写接口 | 当前用户端只读取通知、已读和一键已读；后台首批只保留首页和字典 | 写入/删除通知留预发布后台需求，不复制 Snowy 通知管理页 |

这不是删除 Java 路由，而是把“Java 曾经提供过”与“当前用户端真实依赖”分开。若后续静态扫描或运行日志发现调用，先补 Node 兼容实现和契约测试，再调整本表。

## 调研待补全

1. 在预发布环境补齐通知写入后的内容字段快照，并确认页面是否仍展示；
2. 在预发布环境用有邀请关系的测试账号补充统计数值和脱敏结果快照；
3. 对仍有页面实际调用的 AI、分析报告和广告点击接口补充 Java/Node 字段级快照；
4. 扩展两个前端的浏览器回归，覆盖广告位和会员主流程；校园页面、首页和 Node 简历编辑写流程已完成；
5. 对 offer-star 的校园接口在预发布补全系统岗位投递、取消投递和状态机样本，避免触碰现有用户关系记录。


