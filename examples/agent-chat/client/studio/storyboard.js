import { sceneLabel } from './scenes'
import { assetMentionCandidates, mediaReferenceKey as referenceKey, mentionedAssets } from '../../asset-mentions'
import { durations } from '../../../../src/components/media-workspace/model'

/** 单条视频片段的时长上限；镜头合计超过时提示调整镜头时长或拆分片段。 */
export const CLIP_DURATION_LIMIT = 15
/** 片段图片字段：分镜图、故事板与站位图与镜头分镜图分开保存，互不覆盖。 */
export const CLIP_IMAGE_COLUMNS = [
  { key: 'image', history: 'imageHistory', label: '分镜图' },
  { key: 'storyboardImage', history: 'storyboardHistory', label: '故事板' },
  { key: 'blockingImage', history: 'blockingHistory', label: '站位图' },
]
export const BLOCKING_COLUMNS = CLIP_IMAGE_COLUMNS.filter(column => column.key === 'blockingImage')
/** 片段自己的分镜图：视频“分镜图”生成方式使用的片段图片。 */
export const clipStoryboardColumns = CLIP_IMAGE_COLUMNS.filter(column => column.key === 'image')
/** 旧代码中的简称保留给站位图相关的调用方。 */
export const blockingColumns = BLOCKING_COLUMNS

export const shotNumber = (index) => String(index + 1).padStart(2, '0')
export const totalDuration = (shots) => Math.round(shots.reduce((sum, shot) => sum + Number(shot.duration), 0) * 100) / 100
export const hasScene = (sceneId) => Boolean(sceneId)
export function videoDuration(seconds, model) {
  const rounded = Math.ceil(seconds)
  if (!Number.isFinite(rounded) || rounded <= 0) throw new Error('请填写大于 0 的片段时长')
  const choices = model ? durations(model).filter(Number.isInteger).sort((a, b) => a - b) : []
  if (!choices.length) return rounded
  const supported = choices.find(value => value >= rounded)
  if (supported === undefined) throw new Error(`片段时长超过模型上限 ${choices.at(-1)} 秒，请缩短片段或拆分`)
  return supported
}
export { referenceKey, assetMentionCandidates }
export function clipMediaReferences(clip, data) {
  const episode = data.episodes?.find(episode => episode.id === clip.episodeId)
  const projectAssets = episode ? data.assets.filter(asset => asset.projectId === episode.projectId) : data.assets
  const mentions = mentionedAssets(clip.prompt, projectAssets)
  const assets = projectAssets.filter(asset => (clip.assetIds || []).includes(asset.id) || mentions.some(mention => mention.assetId === asset.id))
  const references = Array.isArray(clip.references) ? clip.references : []
  const frames = CLIP_IMAGE_COLUMNS.filter(column => clip[column.key]).map(column => ({ id: `${clip.id}-${column.key}`, name: column.label, kind: 'image', url: clip[column.key] }))
  const imageRefs = [
    ...frames,
    ...assets.filter(asset => asset.image && (!mentions.some(mention => mention.assetId === asset.id && mention.variantId) || mentions.some(mention => mention.assetId === asset.id && !mention.variantId))).map(asset => ({ id: asset.id, name: asset.name, kind: 'image', url: asset.image })),
    ...mentions.filter(mention => mention.image).map(mention => ({ id: mention.id, name: mention.variantName ? `${mention.name} · ${mention.variantName}` : mention.name, kind: 'image', url: mention.image, protocol: mention.protocol })),
  ]
  const seen = new Set(imageRefs.map(referenceKey))
  const additional = []
  for (const [index, raw] of references.entries()) {
    const ref = typeof raw === 'string' ? { url: raw, kind: 'image' } : raw
    if (!ref?.url || seen.has(referenceKey(ref))) continue
    seen.add(referenceKey(ref))
    additional.push({ ...ref, id: ref.id || referenceKey(ref), name: ref.name || `${{ image: '图片', video: '视频', audio: '音频' }[ref.kind] || '素材'} ${index + 1}` })
  }
  const images = [...new Map([...imageRefs, ...additional.filter(ref => ref.kind === 'image')].map(ref => [referenceKey(ref), ref])).values()]
  return { assets, additional, images, frames: frames.filter(frame => !assets.some(asset => asset.image && referenceKey(asset.image) === referenceKey(frame))) }
}
/** 视频制作使用片段当前分镜图或页面所选参考素材。 */
export function videoImageReferences(clip, references, mode, shots = []) {
  if (mode === '分镜图') return clip?.image ? [{ id: `${clip.id}:storyboard`, name: '分镜图', kind: 'image', url: clip.image }] : []
  return references?.images || []
}
/** 图片生成方式为“分镜图”时，按片段选择的分镜图来源决定参考图。 */
export function sourceImageReferences(clip, shots, source) {
  if (source === 'shots') return shots.filter(shot => shot.image).map(shot => ({ id: `${shot.id}:image`, name: '镜头分镜图', kind: 'image', url: shot.image }))
  return clip?.image ? [{ id: `${clip.id}:storyboard`, name: '片段分镜图', kind: 'image', url: clip.image }] : []
}
/** 两个分镜图来源各自的可用数量与当前选用状态。 */
export function imageSourceOptions(clip, shots) {
  const shotImages = shots.filter(shot => shot.image)
  return [
    { key: 'clip', label: '片段自己的分镜图', available: clip?.image ? 1 : 0, total: 1, ready: Boolean(clip?.image) },
    { key: 'shots', label: '镜头的分镜图', available: shotImages.length, total: shots.length, ready: shots.length > 0 && shotImages.length === shots.length },
  ]
}
export function shotNeedsImage(shot) { return !shot?.image }
/** 片段内镜头顺序以 clip.shotIds 为准，不补全未关联的镜头；缺失的 id 直接忽略。 */
export function clipShots(shots, clip) {
  if (!clip) return []
  const byId = new Map((shots || []).map(shot => [shot.id, shot]))
  return (clip.shotIds || []).map(shotId => byId.get(shotId)).filter(Boolean)
}
/** 把镜头移动到片段内指定位置（0 起）；返回新的 shotIds 顺序。 */
export function moveShotId(shotIds, shotId, to) {
  const order = (shotIds || []).filter(id => id !== shotId)
  order.splice(Math.max(0, Math.min(to, order.length)), 0, shotId)
  return order
}
export const formatDialogue = (line) => `${line.type === '旁白' ? '旁白' : line.speaker}｜${line.description || '描述未指定'}｜${line.text}`
export function dialogueSummary(shot) {
  const lines = Array.isArray(shot?.dialogue) ? shot.dialogue : []
  return lines.map(line => formatDialogue(line))
}
export function clipVoices(clip, data) {
  const episode = data.episodes?.find(episode => episode.id === clip.episodeId)
  const projectAssets = episode ? data.assets.filter(asset => asset.projectId === episode.projectId) : data.assets
  const mentioned = mentionedAssets(clip.prompt, projectAssets)
  const references = Array.isArray(clip.references) ? clip.references : []
  const characterIds = new Set([
    ...(clip.assetIds || []),
    ...mentioned.filter(asset => asset.type === '角色').map(asset => asset.assetId),
  ])
  const characters = data.assets.filter((asset) => characterIds.has(asset.id) && asset.type === '角色')
  return data.voices.filter((voice) => characters.some((asset) => asset.voiceId === voice.id) || references.some((ref) => ref.id === voice.id)).map((voice) => ({
    ...voice,
    characters: characters.filter((asset) => asset.voiceId === voice.id).map((asset) => asset.name).join('、'),
    enabled: !(clip.disabledVoiceIds || []).includes(voice.id),
  }))
}
/** 镜头在片段内的序号：场景属于片段时按片段自身顺序编号。 */
function segmentNumber(shot, shots) {
  return shotNumber(shots.indexOf(shot))
}
function shotLines(shot, shots, scenes = []) {
  const dialogue = Array.isArray(shot.dialogue) ? shot.dialogue : []
  const scene = scenes.find((item) => item.id === shot.sceneId)
  return [
    `镜头 ${segmentNumber(shot, shots)}｜${shot.duration} 秒｜${shot.scale || '景别待定'}｜${shot.camera || '运镜待定'}｜${shot.transition || '硬切'}`,
    ...(scene ? [sceneLabel(scene, scenes.indexOf(scene))] : []),
    `画面：${shot.description || '—'}`,
    ...dialogue.map(formatDialogue),
    `音效：${shot.effects || '—'}`,
  ]
}
/** 逐镜头组织整段视频指令。 */
export function clipPrompt(selected, shots, scenes = []) {
  return selected.map((shot) => shotLines(shot, shots, scenes).join('\n')).join('\n\n')
}
/** 无关联镜头的片段（如手动上传的成片）可使用不依赖镜头的整段描述。 */
export function clipPromptFromDescription(clip) {
  return [clip?.blocking && `初始站位与状态：${clip.blocking}`, clip?.description].filter(Boolean).join('\n\n')
}
/** 片段层图片提示词：参考片段内镜头内容整理，但不依赖镜头是否已经出图。 */
export function clipImagePrompt(clip, shots, scenes = [], label = '') {
  if (!shots.length) return [label, clip?.prompt?.trim()].filter(Boolean).join('\n\n')
  return [
    ...(label ? [label] : []),
    clip?.blocking && `初始站位与状态：${clip.blocking}`,
    ...shots.map((shot) => shotLines(shot, shots, scenes).filter(line => !line.startsWith('音效：')).join('\n')),
  ].filter(Boolean).join('\n\n')
}
/** 片段图片字段对应的提示词字段；三张图各自独立维护，互不覆盖。 */
export const imageColumnPrompt = (key) => key === 'storyboardImage' ? 'storyboardPrompt' : key === 'blockingImage' ? 'blockingPrompt' : 'storyboardPrompt'
export function shotPrompt(shot) {
  return [`画面：${shot.description || '—'}`, ...(Array.isArray(shot.dialogue) ? shot.dialogue : []).map(formatDialogue)].join('\n')
}
/** 按场次与顺序排列的镜头列表，附带片段归属；未关联片段的镜头 clipId 为空。 */
export function shotInventory(shots, clips) {
  const owners = new Map()
  for (const clip of clips || []) for (const shotId of clip.shotIds || []) owners.set(shotId, clip)
  return (shots || []).map(shot => ({ ...shot, clipId: owners.get(shot.id)?.id || '', clipTitle: owners.get(shot.id)?.title || '' }))
}
