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

export const canBatchGenerate = (asset, jobs) => !jobs.some(job => job.options?.studioTarget?.resource === 'assets' && job.options.studioTarget.id === asset.id && job.options.studioTarget.variantId && pendingJob(job)) && (!pendingJob(assetJob(jobs, asset.id)) || asset.variants.length > 0)

async function waitForImage(job, readJob, signal) {
  while (pendingJob(job)) {
    signal.throwIfAborted()
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 2000)
      signal.addEventListener('abort', abort, { once: true })
    })
    signal.throwIfAborted()
    job = await readJob(job.id, signal)
  }
  signal.throwIfAborted()
  if (job.status !== 'completed' || job.error || !job.resultFileIds?.length) throw new Error(job.error || jobLabel(job) || '生成结果为空')
  return `/api/files/${job.resultFileIds[0]}`
}

export async function generateAssetBatch(assets, { jobs, generateMedia, readJob, reload, view, customPrompt, styleId, signal }) {
  const submitted = [], failed = []
  await Promise.all(assets.filter(asset => canBatchGenerate(asset, jobs)).map(async asset => {
    const submit = async (current, variantId) => {
      signal.throwIfAborted()
      const job = await generateMedia({ ...assetImageRequest(current, { variantId, view, customPrompt }), styleId, target: { resource: 'assets', id: current.id, field: 'image', ...(variantId ? { variantId } : {}) } })
      submitted.push(job.id)
      return job
    }
    try {
      const pending = assetJob(jobs, asset.id)
      if (pendingJob(pending) && styleId !== undefined && pending.style?.id !== String(styleId)) throw new Error('主图正在按其他风格生成，请完成后重试')
      const mainJob = pendingJob(pending) ? pending : await submit(asset)
      if (!asset.variants.length) return
      const mainImage = await waitForImage(mainJob, readJob, signal)
      for (const variant of asset.variants) {
        try {
          const current = (await reload()).assets.find(item => item.id === asset.id)
          signal.throwIfAborted()
          if (!current) throw new Error('资产已被删除')
          if (current.image !== mainImage) throw new Error('主图已变化或尚未应用，请核对后重新生成')
          const job = await submit(current, variant.id)
          // Each write changes the asset version; read it again before the next variant.
          await waitForImage(job, readJob, signal)
        } catch (reason) {
          if (signal.aborted) throw reason
          failed.push(`${asset.name} / ${variant.name}：${reason.message}`)
        }
      }
    } catch (reason) {
      if (signal.aborted) throw reason
      failed.push(`${asset.name}：${reason.message}${asset.variants.length ? '（已跳过衍生资产）' : ''}`)
    }
  }))
  return { submitted, failed }
}
