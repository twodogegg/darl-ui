const typeKeys = { 角色: 'character', 场景: 'scene', 道具: 'prop', 图片: 'reference' }
export const mentionGroups = ['角色', '场景', '道具', '图片']
export const isH3Reference = value => /^(?:Subject|Picture|Video|Audio) \d+$|^(?:d|\/d|scenetrans|cutoff)$/.test(value)
export const mediaReferenceKey = item => {
  const url = typeof item === 'string' ? item : item?.url || ''
  return item?.fileId || url.match(/\/api\/files\/([^/?#]+)/)?.[1] || url.split('?')[0]
}

// Callers supply only current-project assets and currently enabled images, never the global library.
export function assetMentionCandidates(assets = [], input = []) {
  const options = Array.isArray(input) ? { references: input } : input || {}
  // The caller has already scoped assets to the current project. Keep the full
  // project set available so an @ mention can establish the shot association.
  const scopedAssets = assets
  const candidates = scopedAssets.flatMap(asset => {
    const base = { assetId: asset.id, name: asset.name, type: asset.type, typeKey: typeKeys[asset.type], image: asset.image || '' }
    return [{ ...base, id: asset.id, protocol: `<${asset.name}>` }, ...(asset.variants || []).map(variant => ({
      ...base, id: `${asset.id}:${variant.id}`, variantId: variant.id, variantName: variant.name,
      // A missing variant image must never silently use the base appearance.
      image: variant.image || '', protocol: `<${asset.name}|${variant.name}>`,
    }))]
  })
  ;(options.references || []).forEach((reference, index) => {
    if (!(typeof reference === 'string' || reference?.url) || reference?.kind && reference.kind !== 'image') return
    candidates.push({ id: `picture:${reference.id || mediaReferenceKey(reference)}`, name: reference.name || `图片 ${index + 1}`, type: '图片', typeKey: 'reference', image: typeof reference === 'string' ? reference : reference.url, protocol: `<Picture ${index + 1}>` })
  })
  return mentionGroups.flatMap(type => candidates.filter(candidate => candidate.type === type))
}

export const mentionLabel = candidate => `@${candidate.name}${candidate.variantName ? ` · ${candidate.variantName}` : ''}`

export function parseAssetMentions(value = '', candidates = []) {
  const byProtocol = new Map()
  for (const candidate of candidates) byProtocol.set(candidate.protocol, [...(byProtocol.get(candidate.protocol) || []), candidate])
  const parts = []
  let cursor = 0
  // Match the complete marker, including its state. Never replace a base-name substring first.
  for (const match of String(value).matchAll(/<([^<>\n]+)>/g)) {
    const protocol = match[0]
    if (match.index > cursor) parts.push({ text: value.slice(cursor, match.index) })
    if (isH3Reference(match[1])) {
      parts.push({ protocol, label: match[1], kind: 'h3', error: '' })
      cursor = match.index + protocol.length
      continue
    }
    const matches = byProtocol.get(protocol) || []
    const candidate = matches.length === 1 ? matches[0] : undefined
    const [name, ...state] = match[1].split('|')
    parts.push({ protocol, candidate, label: candidate ? mentionLabel(candidate) : `@${name}${state.length ? ` · ${state.join('|')}` : ''}`, error: matches.length > 1 ? '同名资产引用不明确，请确认资产名称' : candidate ? '' : '资产或形态不存在，或参考图未启用，请确认' })
    cursor = match.index + protocol.length
  }
  if (cursor < value.length) parts.push({ text: value.slice(cursor) })
  return parts
}

export function validateAssetMentions(value, candidates) {
  const invalid = parseAssetMentions(value, candidates).filter(part => part.error)
  if (invalid.length) return `请确认无法解析的引用：${[...new Set(invalid.map(part => part.label))].join('、')}`
  // Dangling brackets are not silently treated as a valid reference.
  const remaining = value.replace(/<[^<>\n]+>/g, '')
  if (/[<>]/.test(remaining)) return '引用标记不完整，请确认尖括号内容或删除无效引用'
  return ''
}

export function mentionedAssets(value, assets) {
  return parseAssetMentions(value || '', assetMentionCandidates(assets)).flatMap(part => part.candidate?.assetId ? [part.candidate] : [])
}
