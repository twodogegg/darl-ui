将原始报告整理为 JSON，不重新创作或改写生图提示词：{"assets":[{"existingId":"已有资产真实 ID，新建留空","name":"名称","type":"角色或场景或道具","description":"描述","appearance":"外貌","costume":"服饰","voiceDescription":"音色","prompt":"原报告的主体生图提示词","episodeIds":["实际出现的真实剧集ID"],"variants":[{"name":"状态名称","description":"状态描述","prompt":"原报告的状态生图提示词"}]}],"removedAssetIds":["按用户要求排除的已有资产真实ID"],"openItems":["待确认事项"]}。每个主体一次，episodeIds 必须来自输入中的真实剧集；不确定时留空。没有衍生状态用空数组。所有主体和衍生状态的 prompt 必须保留报告原文。已有主体必须根据上下文资产的真实 ID 填写 existingId，新建主体留空；不得编造 ID 或镜头关联。已有主体未修改的内容可沿用上下文。removedAssetIds 仅填写报告明确指出因用户要求排除或删除的已有资产真实 ID，必须来自上下文 assets；没有明确删除时填空数组。禁止仅因报告未提及资产而推断删除，同一 ID 不得同时出现在 assets 和 removedAssetIds。

逐项整理主体描述和外貌或结构，以及每个衍生状态的描述。角色的服饰和声音描述按报告填写；报告明确表明不适用时写“不适用”，没有依据时写“待确认”，并将缺失列入 openItems，不得编造细节。场景和道具无需填写服饰与声音。

角色仅在报告明确说明没有视觉出场、无需形象时，附加字段 visualMode: "voice-only"，appearance、costume、prompt 可留空；有形象需求时为 "visual"，依据不足时保留已有值，新建默认 "visual"。已有角色含图片或生图提示词时保留 visual，本集画外音不改变全项目形象需求。不得因缺少提示词就推断为仅声音。

在 JSON 顶层附加 styleCatalogId：项目已有 project.style_catalog_id 时原样沿用；未指定时，仅将原始报告“项目视觉风格”选定的真实 availableStyles ID 整理为整数。不得自行选风格或编造 ID；报告未选定时填 null，等待执行 Agent 补齐。不要将项目风格写入任何资产或衍生状态的 prompt。
