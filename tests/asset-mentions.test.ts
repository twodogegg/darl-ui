import { describe, expect, it } from 'vitest'
import { assetMentionCandidates, parseAssetMentions, validateAssetMentions } from '../examples/agent-chat/asset-mentions'
import { storyboardImageRequest, updateClipReferences } from '../examples/agent-chat/client/studio/storyboard'

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

  it('keeps a reference image identity across renames and sends its actual attachment number', () => {
    const reference = { id: 'upload', fileId: 'file-a', name: '车内构图', kind: 'image', url: 'https://example.com/original.png' }
    const candidate = assetMentionCandidates([], { references: [reference], stableReferences: true })[0]
    expect(candidate.protocol).toBe(assetMentionCandidates([], { references: [{ ...reference, name: '新名称' }], stableReferences: true })[0].protocol)
    const data = { episodes: [{ id: 'episode', projectId: 'project' }], assets: [{ ...assets[0], projectId: 'project' }] }
    const clip = { id: 'clip', episodeId: 'episode', mode: '分镜图', assetIds: ['chloe'], references: [reference], storyboardPrompt: `参考 ${candidate.protocol}，保持 <Chloe> 形象。` }
    const result = storyboardImageRequest(clip, data)
    expect(result.references).toEqual(['/api/files/chloe', 'https://example.com/original.png'])
    expect(result.prompt).toContain('图片1：<Chloe>\n图片2：参考图「车内构图」')
    expect(result.prompt).toContain('参考 图片2，保持 <Chloe> 形象。')
    expect(() => storyboardImageRequest({ ...clip, references: [] }, data)).toThrow('参考图已移除')
  })

  it('removes only the deleted reference marker, preserving the other references and prompt', () => {
    const removed = { fileId: 'file-a', url: '/api/files/file-a', kind: 'image' }
    const kept = { fileId: 'file-b', url: '/api/files/file-b', kind: 'image' }
    const clip = { references: [removed, kept], storyboardPrompt: '参考 <参考图|file-a> 和 <参考图|file-b>，保持 <Chloe>。' }
    expect(updateClipReferences(clip, [kept])).toEqual({ references: [kept], storyboardPrompt: '参考  和 <参考图|file-b>，保持 <Chloe>。' })
    expect(updateClipReferences(clip, [removed, kept])).toEqual({ references: [removed, kept] })
  })
})
