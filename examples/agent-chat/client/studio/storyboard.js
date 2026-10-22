import { sceneLabel } from './scenes'

export const shotNumber = (index) => String(index + 1).padStart(2, '0')
export const totalDuration = (shots) => Math.round(shots.reduce((sum, shot) => sum + Number(shot.duration), 0) * 100) / 100
export const formatDialogue = (line) => `${line.type === '旁白' ? '旁白' : line.speaker}｜${line.description || '描述未指定'}｜${line.text}`
export function clipVoices(clip, data) {
  const characterIds = new Set([
    ...clip.assetIds,
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
