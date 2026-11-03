将原始输出整理为视频片段页面字段，不重新创作。只输出 JSON 对象：{"conflicts":[],"clips":[{"sceneId":"真实场次 ID","title":"片段名称","globalStart":0,"globalEnd":8.5,"duration":10,"prompt":"原文完整视频提示词","assetIds":["真实资产 ID"],"shotIds":["真实镜头 ID"]}]}。

每段 prompt 必须逐字完整复制原文，保留对白、换行和限制，不增删或优化。场次、资产与镜头 ID 从上下文核对，不得编造。原片镜头片段的 globalStart、globalEnd 为真实原片时间（数字秒）；sourceKind=original 的原创镜头单独编组，不填 globalStart、globalEnd，不得虚构原片时间。duration 为数字秒，使用上下文中视频模型支持的时长。无法确定或不满足格式要求时如实记录 conflicts，不虚构内容。

片段可以跨多个场次：sceneId 填片段开头镜头所属场次，shotIds 按顺序保留所有涉及镜头，assetIds 包含涉及的场景资产。同一镜头或一段对白可以拆入相邻片段；原片时间范围与生成时长各自记录，可以不同。这些情况均属正常安排，不要写入 conflicts。
