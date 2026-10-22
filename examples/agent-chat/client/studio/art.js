import prompts from '../../prompts/studio-actions.json'

export const assetViews = type => type === '角色'
  ? ['一致性图', '面部特写', '四视图', '自定义']
  : type === '场景' ? ['场景空镜', '场景四视图', '自定义'] : ['道具图', '四视图', '自定义']

export function assetImageRequest(asset, { variantId = '', view = '', customPrompt = '', editPrompt = '', image = '' } = {}) {
  const variant = variantId && asset.variants.find(item => item.id === variantId)
  if (variantId && !variant) throw new Error('当前形态已被删除，请重新选择')
  if (editPrompt.trim()) {
    if (!image) throw new Error('请先选择需要修改的原图')
    return { prompt: `${prompts['asset-image-edit']}\n${editPrompt.trim()}`, references: [image], applyStyle: false }
  }
  if (![asset.prompt, asset.description, asset.appearance, variant?.description, asset.costume].some(value => value?.trim())) throw new Error('请填写资产描述或生图提示词')
  const selectedView = !view || view === '按资产默认方案' ? assetViews(asset.type)[0] : view
  if (selectedView === '自定义' && !customPrompt.trim()) throw new Error('请输入自定义提示词')
  return {
    prompt: [asset.prompt, asset.description, asset.appearance, variant?.description || asset.costume, selectedView === '自定义' ? customPrompt : prompts['asset-image-views'][selectedView]].filter(Boolean).join('\n'),
    references: [...new Set([asset.image, ...(asset.references || []).map(item => typeof item === 'string' ? item : item.url)].filter(Boolean))],
  }
}

export const pendingJob = job => job && ['queued', 'running'].includes(job.status)
export const assetJob = (jobs, id, variantId) => jobs.filter(job => job.options?.studioTarget?.resource === 'assets' && job.options.studioTarget.id === id && (job.options.studioTarget.variantId || null) === (variantId || null)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
export const jobLabel = job => ({ queued: '排队中', running: '生成中', completed: '生成完成', failed: '生成失败', uncertain: '结果待确认', cancelled: '已取消' }[job?.status] || '')
