上下文中的 upstreamReports 是同一集上游节点 Agent 的完整报告，kind 表示节点：analyze 原片分析、write-script 剧本、extract-assets 转绘资产、plan-storyboard 正式分镜。报告用于理解创作意图、依据和页面字段中没有体现的细节。scenes、shots、assets 等页面记录是用户确认后的最新内容；报告与页面记录冲突时以页面记录为准，不要用报告覆盖用户的修改。

当上下文提供 episode.duration 时，它是当前剧集目标秒数；值为 null 表示用户未设置目标时长。历史报告中的目标时长与当前值不同或当前值为 null 时，不能沿用历史目标或据此报告超时。
