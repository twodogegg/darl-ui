import { sceneLabel } from './scenes'
import { imageColumns } from './data'
import { durations } from '../../../../src/components/media-workspace/model'

export const shotNumber = (index) => String(index + 1).padStart(2, '0')
export const totalDuration = (shots) => Math.round(shots.reduce((sum, shot) => sum + Number(shot.duration), 0) * 100) / 100
export function videoDuration(seconds, model) {
  const rounded = Math.ceil(seconds)
  if (!Number.isFinite(rounded) || rounded <= 0) throw new Error('请关联有效时长的分镜')
  const choices = model ? durations(model).filter(Number.isInteger).sort((a, b) => a - b) : []
  if (!choices.length) return rounded
  const supported = choices.find(value => value >= rounded)
  if (supported === undefined) throw new Error(`片段时长超过模型上限 ${choices.at(-1)} 秒，请调整分镜组合`)
  return supported
}
export { mediaReferenceKey as referenceKey, assetMentionCandidates } from '../../asset-mentions'
import { mediaReferenceKey as referenceKey, mentionedAssets } from '../../asset-mentions'
export function clipMediaReferences(clip, data) {
  const episode = data.episodes?.find(episode => episode.id === clip.episodeId)
  const projectAssets = episode ? data.assets.filter(asset => asset.projectId === episode.projectId) : data.assets
  const mentions = mentionedAssets(clip.prompt, projectAssets)
  const assets = projectAssets.filter(asset => (clip.assetIds || []).includes(asset.id) || mentions.some(mention => mention.assetId === asset.id))
  const frames = imageColumns.filter(column => clip[column.key]).map(column => ({ id: `${clip.id}-${column.key}`, name: column.label, kind: 'image', url: clip[column.key] }))
  const imageRefs = [
    ...frames,
    ...assets.filter(asset => asset.image && (!mentions.some(mention => mention.assetId === asset.id && mention.variantId) || mentions.some(mention => mention.assetId === asset.id && !mention.variantId))).map(asset => ({ id: asset.id, name: asset.name, kind: 'image', url: asset.image })),
    ...mentions.filter(mention => mention.image).map(mention => ({ id: mention.id, name: mention.variantName ? `${mention.name} · ${mention.variantName}` : mention.name, kind: 'image', url: mention.image, protocol: mention.protocol })),
  ]
  const seen = new Set(imageRefs.map(referenceKey))
  const additional = []
  for (const [index, raw] of clip.references.entries()) {
    const ref = typeof raw === 'string' ? { url: raw, kind: 'image' } : raw
    if (!ref?.url || seen.has(referenceKey(ref))) continue
    seen.add(referenceKey(ref))
    additional.push({ ...ref, id: ref.id || referenceKey(ref), name: ref.name || `${{ image: '图片', video: '视频', audio: '音频' }[ref.kind] || '素材'} ${index + 1}` })
  }
  const images = [...new Map([...imageRefs, ...additional.filter(ref => ref.kind === 'image')].map(ref => [referenceKey(ref), ref])).values()]
  return { assets, additional, images, frames: frames.filter(frame => !assets.some(asset => asset.image && referenceKey(asset.image) === referenceKey(frame))) }
}
export function videoImageReferences(clip, references, mode) {
  if (mode === '分镜图') return clip?.image ? [{ id: `${clip.id}:storyboard`, name: '分镜图', kind: 'image', url: clip.image }] : []
  return references?.images || []
}
export const formatDialogue = (line) => `${line.type === '旁白' ? '旁白' : line.speaker}｜${line.description || '描述未指定'}｜${line.text}`
export function clipVoices(clip, data) {
  const episode = data.episodes?.find(episode => episode.id === clip.episodeId)
  const projectAssets = episode ? data.assets.filter(asset => asset.projectId === episode.projectId) : data.assets
  const mentioned = mentionedAssets(clip.prompt, projectAssets)
  const characterIds = new Set([
    ...clip.assetIds,
    ...mentioned.filter(asset => asset.type === '角色').map(asset => asset.assetId),
    ...data.shots.filter((shot) => clip.shotIds.includes(shot.id)).flatMap((shot) => shot.dialogue.map((line) => line.assetId)),
  ])
  const characters = data.assets.filter((asset) => characterIds.has(asset.id) && asset.type === '角色')
  return data.voices.filter((voice) => characters.some((asset) => asset.voiceId === voice.id) || clip.references.some((ref) => ref.id === voice.id)).map((voice) => ({
    ...voice,
    characters: characters.filter((asset) => asset.voiceId === voice.id).map((asset) => asset.name).join('、'),
    enabled: !(clip.disabledVoiceIds || []).includes(voice.id),
  }))
}
export function clipPrompt(selected, shots, scenes = []) {
  return selected.map((shot) => {
    const scene = scenes.find((item) => item.id === shot.sceneId)
    return [
      `镜头 ${shotNumber(shots.indexOf(shot))}｜${shot.duration} 秒｜${shot.scale}｜${shot.camera}｜${shot.transition}`,
      ...(scene ? [sceneLabel(scene, scenes.indexOf(scene))] : []),
      `画面：${shot.description}`,
      ...shot.dialogue.map(formatDialogue),
      `音效：${shot.effects || '—'}`,
    ].join('\n')
  }).join('\n\n')
}
