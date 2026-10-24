import { describe, expect, it } from 'vitest'
import { assetMentionCandidates, parseAssetMentions, validateAssetMentions } from '../examples/agent-chat/asset-mentions'

const assets = [{ id: 'chloe', name: 'Chloe', type: '角色', image: '/api/files/chloe', variants: [{ id: 'young', name: '19岁样子', image: '/api/files/young' }] }]

describe('asset protocol mentions', () => {
  it('keeps the full subject and variant marker when the base name also exists', () => {
    const candidates = assetMentionCandidates(assets)
    const parts = parseAssetMentions('她看向 <Chloe|19岁样子>，再看向 <Chloe>。', candidates)
    expect(parts.filter(part => part.candidate).map(part => part.candidate?.protocol)).toEqual(['<Chloe|19岁样子>', '<Chloe>'])
    expect(parts.find(part => part.protocol === '<Chloe|19岁样子>')?.candidate?.image).toBe('/api/files/young')
  })

  it('reports unknown and ambiguous references instead of silently matching text', () => {
    const candidates = assetMentionCandidates([{ ...assets[0], id: 'chloe-2' }, ...assets])
    expect(validateAssetMentions('看向 <Unknown>', candidates)).toContain('Unknown')
    expect(validateAssetMentions('看向 <Chloe>', candidates)).toContain('Chloe')
  })

  it('keeps H3 internal labels separate from project asset mentions', () => {
    const candidates = assetMentionCandidates(assets)
    const parts = parseAssetMentions('<Subject 1> is <Chloe>.', candidates)
    expect(parts.find(part => part.protocol === '<Subject 1>')).toMatchObject({ kind: 'h3', label: 'Subject 1', error: '' })
    expect(validateAssetMentions('<Subject 1> is <Chloe>.', candidates)).toBe('')
  })
})
