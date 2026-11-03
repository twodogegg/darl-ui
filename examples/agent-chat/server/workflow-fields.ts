import type { StudioRecord } from '../studio-schema';

const requiredText = (value: unknown, path: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} 缺少必填内容，请从原始报告提取；报告没有时不要编造`);
};

/** Additional completeness checks before the existing business validation and atomic save. */
export function validateWorkflowFields(kind: string, value: unknown, existing: StudioRecord[] = [], mode = '参考生成') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const result = value as Record<string, unknown>;
  if ((kind === 'script-assets' || kind === 'extract-assets') && Array.isArray(result.assets)) {
    for (const [index, item] of result.assets.entries()) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const asset = item as Record<string, unknown>;
      const label = `资产 ${typeof asset.name === 'string' && asset.name.trim() ? asset.name : `第 ${index + 1} 项`}`;
      const prior = existing.find(record => record.id === asset.existingId);
      const field = (key: string) => typeof asset[key] === 'string' && asset[key].trim() ? asset[key] : prior?.[key];
      if (asset.type === '角色' && asset.visualMode === 'voice-only' && prior?.visualMode !== 'voice-only' && (prior?.image || prior?.prompt)) throw new Error(`${label} 已有视觉形象，请保留形象需求；仅在片段中关闭图片引用`);
      const voiceOnly = asset.type === '角色' && field('visualMode') === 'voice-only';
      requiredText(asset.name, `${label} 的名称 (name)`);
      requiredText(asset.type, `${label} 的类型 (type)`);
      if (!voiceOnly) requiredText(field('prompt'), `${label} 的主体生图提示词 (prompt)`);
      for (const [key, name] of [['description', '描述'], ['appearance', '外貌或结构']] as const) {
        if (voiceOnly && key === 'appearance') continue;
        const value = field(key);
        requiredText(value, `${label} 的${name} (${key})`);
        if (/^(待确认|不适用|未知|暂无|未说明)[。.!！]?$/u.test(String(value).trim())) throw new Error(`${label} 的${name} (${key}) 只有待确认标记，请整理报告中已有的具体信息；报告不足时应重新提取`);
      }
      if (asset.type === '角色') {
        for (const [key, name] of [['costume', '服饰'], ['voiceDescription', '声音描述']] as const) if (!voiceOnly || key !== 'costume') requiredText(field(key), `${label} 的${name} (${key})；不适用或无法确认时请如实说明`);
      }
      if (Array.isArray(asset.variants)) for (const [variantIndex, item] of asset.variants.entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const variant = item as Record<string, unknown>;
        const old = Array.isArray(prior?.variants) ? (prior.variants as Array<Record<string, unknown>>).find(v => v.name === variant.name) : undefined;
        requiredText(variant.name, `${label} 的第 ${variantIndex + 1} 个衍生状态名称 (name)`);
        const description = typeof variant.description === 'string' && variant.description.trim() ? variant.description : old?.description;
        requiredText(description, `${label} 的衍生状态 ${variant.name || variantIndex + 1} 的描述 (description)`);
        const prompt = typeof variant.prompt === 'string' && variant.prompt.trim() ? variant.prompt : old?.prompt;
        requiredText(prompt, `${label} 的衍生状态 ${variant.name || variantIndex + 1} 的生图提示词 (prompt)`);
      }
    }
  }
  if (kind === 'analyze' && Array.isArray(result.shots)) for (const [index, item] of result.shots.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const shot = item as Record<string, unknown>;
    requiredText(shot.sceneKey, `第 ${index + 1} 镜的场次标识 (sceneKey)`);
    requiredText(shot.description, `第 ${index + 1} 镜的画面描述 (description)`);
    if (Array.isArray(shot.dialogue)) for (const [lineIndex, line] of shot.dialogue.entries()) {
      if (line && typeof line === 'object' && !Array.isArray(line)) requiredText((line as Record<string, unknown>).text, `第 ${index + 1} 镜第 ${lineIndex + 1} 条对白 (text)`);
    }
  }
  if (kind === 'analyze' && Array.isArray(result.scenes)) for (const [index, item] of result.scenes.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const scene = item as Record<string, unknown>;
    for (const [key, name] of [['key', '场次标识'], ['location', '地点'], ['setting', '内外景']] as const) requiredText(scene[key], `第 ${index + 1} 场的${name} (${key})`);
  }
  if ((kind === 'write-script' || kind === 'revise-script') && Array.isArray(result.scenes)) for (const [index, item] of result.scenes.entries()) {
    if (item && typeof item === 'object' && !Array.isArray(item)) requiredText((item as Record<string, unknown>).sceneId, `第 ${index + 1} 场的场次 ID (sceneId)`);
  }
  if (kind === 'novel-script' && Array.isArray(result.scenes)) for (const [index, item] of result.scenes.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const scene = item as Record<string, unknown>;
    for (const [key, name] of [['location', '地点'], ['setting', '内外景'], ['time', '时间'], ['content', '正文']] as const) requiredText(scene[key], `第 ${index + 1} 场的${name} (${key})`);
  }
  if ((kind === 'script-storyboard' || kind === 'video-prompts') && Array.isArray(result.clips)) for (const [index, item] of result.clips.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const clip = item as Record<string, unknown>;
    for (const [key, name] of [['sceneId', '场次 ID'], ['title', '片段名称'], ['prompt', '视频提示词']] as const) requiredText(clip[key], `第 ${index + 1} 个片段的${name} (${key})`);
    if (typeof clip.duration !== 'number' || !Number.isFinite(clip.duration) || clip.duration <= 0) throw new Error(`第 ${index + 1} 个片段的时长 (duration) 缺失或无效`);
    if (kind === 'script-storyboard' && mode === '分镜图') requiredText(clip.storyboardPrompt, `第 ${index + 1} 个片段的分镜图提示词 (storyboardPrompt)`);
  }
  if (kind === 'revise-cuts' && Array.isArray(result.shots)) for (const [index, item] of result.shots.entries()) {
    if (item && typeof item === 'object' && !Array.isArray(item)) requiredText((item as Record<string, unknown>).sceneId, `第 ${index + 1} 镜的场次 ID (sceneId)`);
  }
  if ((kind === 'plan-storyboard' || kind === 'revise-storyboard') && Array.isArray(result.changes)) for (const [index, item] of result.changes.entries()) {
    if (item && typeof item === 'object' && !Array.isArray(item)) requiredText((item as Record<string, unknown>).shotId, `第 ${index + 1} 条修改建议的镜头 ID (shotId)`);
  }
}
