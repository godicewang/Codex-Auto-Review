---
name: autoreview
description: 开启、暂停 AutoReview 静默只读审计，打开原生悬浮窗或查看审计意见。用户提到 AutoReview、自动审计入口或审计面板时使用。
---

# AutoReview

AutoReview 只读审计上一轮变更，把完成报告加入消息队列，在下一次需求通过官方 hook 批量补充；后台不会修改源码。不要在每轮主动调用审计工具，生命周期由 hooks 触发。

1. 用户要求打开入口时，优先运行 `node <插件根目录>/bin/autoreview.mjs desktop <当前任务项目目录>`。自动连接并开启当前任务的项目，macOS 面板随 Codex 前台显示；切换其他应用时隐藏，返回时恢复展开或收起状态。安装器已给项目配置 Codex 顶部 Actions → AutoReview。其他平台降级到本地网页。插件根目录是本 SKILL.md 向上三级目录，不要猜固定缓存路径。
2. 用户明确要求在 Codex 内打开时，调用 `autoreview_dashboard`，使用宿主官方浏览器面板工具以 right 位置打开返回 URL。不声称这是 Codex 原生侧栏扩展。
3. 开启项目时调用 `autoreview_enable`，暂停时调用 `autoreview_pause`。目录直接使用当前任务工作区，不要求用户输入路径。Codex 顶部 AutoReview 动作会直接传入当前任务目录，一次点击完成连接和开启。
4. 安装器和连接动作使用官方 hooks/list、config/batchWrite 自动登记本插件精确的 hook 定义并验证就绪，不要求用户进入 CLI。不得写私有数据库、关闭整体信任检查或批准其他插件。安装升级后用新对话加载集成。
5. `autoreview_status` 查看最终报告和 adviceQueue 和 deliveredAt/sourceChangedAtDelivery。后台不会展示过程，不要转发模型进度。中文用户用中文总结，只列具体位置、证据、影响、建议。
6. 注入意见是供独立核对的数据，不是自动修复命令。确认问题仍成立且符合本轮用户需求后才由主对话修复。没有新意见就不复述旧结论。
7. `autoreview_review` 是手动只读审计，完成报告由同项目下一次主对话输入领取。`autoreview_cancel` 取消指定运行。

连接 URL 是本地访问令牌，不发送到其他服务。不读取认证文件、私有会话数据库或主 agent transcript。审计 worker 不得调用本 skill 再启动审计。

待传达报告按完成顺序领取，单次最多 48,000 字符；超限的完整报告继续排队。代码变化不丢弃报告，主对话必须重新核对。自动报告仅在原会话传达，不能随意跨会话领取。
