import labels from '../../prompts/video-generation.json'

export function isH3FormattedPrompt(prompt) {
  return /^\s*(?:subject_definitions|integrated_multimodal_description)\s*:/im.test(prompt || '') && /^\s*overall_soundscape\s*:/im.test(prompt || '')
}

export function videoPrompt(prompt, style, images, audios = [], includeContext = true) {
  const context = []
  if (includeContext && style) context.push(`${labels.style}：${style.name}${style.description?.trim() ? `。${style.description.trim()}` : ''}`)
  if (includeContext && images?.length) context.push(`${labels.references}：\n${images.map((image, index) => `${labels.picture} ${index + 1}（<Picture ${index + 1}>）：${image.protocol || image.name || `图片 ${index + 1}`}`).join('\n')}`)
  if (includeContext && audios?.length) context.push(`${labels.audioReferences}：\n${audios.map((audio, index) => `${labels.audio} ${index + 1}（<Audio ${index + 1}>）：${audio.name || `音频 ${index + 1}`}${audio.characters ? `（${audio.characters}）` : ''}`).join('\n')}`)
  return [...context, prompt.trim()].filter(Boolean).join('\n\n')
}

export function h3ReferenceSnapshot(references, images, audios = []) {
  return [...(references || []).filter(ref => !ref?.h3PromptReference), ...images.map(image => ({ ...image, kind: 'image', h3PromptReference: true })), ...audios.map(audio => ({ ...audio, kind: 'audio', h3PromptReference: true }))]
}
