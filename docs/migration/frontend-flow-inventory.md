# 用户端流程盘点

本文件把静态接口清单提升为用户可见流程，作为 Java/Node 契约和浏览器回归的索引。接口路径继续以现有 Axios 封装为准，Node 不改变路径、Token 名称或响应外层结构。

| 流程 | 入口 | 关键接口 | 当前证据 | 结论 |
|---|---|---|---|---|
| 简历浏览与编辑 | 两个用户端简历页 | 详情、基础信息、创建、模块、名称、模板、封面、样式 | 线上测试账号完成全链路写回归；测试简历已软删除 | Node 保留 |
| 简历发布与收藏 | 简历模板/详情页 | publish、unpublish、collect、disCollect、use、DELETE | 会员测试账号完成发布、取消发布、收藏/取消收藏、使用和删除 | Node 保留 |
| AI 简历 | 导入、分析、优化、面试题页 | import、analysisText、analyze、aiGenerate、optimize、translate、aiInterview | DeepSeek 回归、额度失败返还、TXT 文件解析通过；真实 DOCX/PDF 样本和豆包留预发布 | Node 保留 |
| 会员购买 | 会员页和会员弹窗 | 套餐、免费订单、JSAPI 订单、微信回调、`/ws/:userId/WxPay` | mock 订单、回调幂等和 WebSocket 通知通过；真实支付未执行 | Node 保留 |
| 校园市场圈 | offer 用户端 | 列表、内推、进度、状态、备注、记录、统计、custom | 列表浏览器回归；自定义记录创建/更新/删除线上回归 | Node 保留 |
| 通知 | 两个用户端通知组件 | 系统/活动/点赞收藏、未读、已读 | Java/Node 只读结构对照；写流程留预发布 | Node 保留 |
| AI 证件照 | 后台和预留用户端入口 | quota、template、generation、generate | COS 读写和失败边界已实现；真实豆包图片调用留预发布 | Node 保留 |
| AI 聊天 | AI 聊天页面 | dialogue、message、chat stream、guide | DeepSeek 会话、消息分页、软删除和流式入口通过 | Node 保留 |
| 微信登录 | 登录页 | 授权 URL、code、openId、current user、logout | Snowy Token 兼容；真实 OAuth 回调留预发布 | Node 保留 |
| 广告与反馈 | 首页/校园页 | adslot list/click、feedback | API smoke 已通过；真实页面点击回归留补充 | Node 保留 |

Next API route 仅保留兼容代理功能；用户端业务请求的目标服务已经统一指向 Node 兼容接口。
