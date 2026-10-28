import { resolveAssetDependencies, validateAssetDependencies } from '../../asset-dependencies'
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
  const selectedView = !view || view === '按资产默认方案' ? assetViews(asset.type)[0] : view
  if (selectedView === '自定义' && !customPrompt.trim()) throw new Error('请输入自定义提示词')
  // 最终生图提示词 = 生图提示词（角色有值优先）+ 生图模板提示词；全局风格由服务端追加。
  // 角色未填写生图提示词时回退可见的 appearance 与当前服饰（主形象 costume、衍生形态 description），
  // 叙事描述 description 与声音 voiceDescription 始终不进入生图请求。
  const characterPrompt = (variant || asset).prompt?.trim() || ''
  const prompt = selectedView === '自定义' ? customPrompt.trim()
    : asset.type === '角色'
      ? characterPrompt || [asset.appearance, variant ? variant.description : asset.costume].filter(value => value?.trim()).join('\n')
      : (variant || asset).prompt?.trim() || ''
  if (!prompt.trim()) throw new Error(asset.type === '角色' ? '请填写角色生图提示词，或至少填写外貌与当前服饰设定' : `请填写${asset.type}生图提示词`)
  return {
    prompt: [prompt, selectedView === '自定义' ? '' : prompts['asset-image-views'][selectedView]].filter(Boolean).join('\n'),
    references: [...new Set([...(asset.dependencies?.length ? [] : [asset.image]), ...(!asset.image ? asset.source?.frames?.map(frame => frame.url) || [] : []), ...(asset.references || []).map(item => typeof item === 'string' ? item : item.url)].filter(Boolean))],
  }
}

export const pendingJob = job => job && ['queued', 'running'].includes(job.status)
export const assetJob = (jobs, id, variantId) => jobs.filter(job => job.options?.studioTarget?.resource === 'assets' && job.options.studioTarget.id === id && (job.options.studioTarget.variantId || null) === (variantId || null)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
const pendingAssetJob = (jobs, id, variantId) => assetJob(jobs.filter(pendingJob), id, variantId)
export const jobLabel = job => ({ queued: '排队中', running: '生成中', completed: '生成完成', failed: '生成失败', uncertain: '结果待确认', cancelled: '已取消' }[job?.status] || '')

export const canBatchGenerate = (asset, jobs) => !jobs.some(job => job.options?.studioTarget?.resource === 'assets' && job.options.studioTarget.id === asset.id && job.options.studioTarget.variantId && pendingJob(job))
  && ((!asset.image && !pendingAssetJob(jobs, asset.id)) || asset.variants.some(variant => !variant.image))

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

export function assetBatchPlan(assets, allAssets) {
  validateAssetDependencies(allAssets)
  const plan = new Map()
  const include = asset => {
    if (plan.has(asset.id)) return
    plan.set(asset.id, asset)
    for (const dependency of asset.dependencies || []) {
      const source = allAssets.find(item => item.id === dependency.assetId)
      const image = dependency.variantId ? source?.variants.find(item => item.id === dependency.variantId)?.image : source?.image
      if (source && !image) include(source)
    }
  }
  assets.forEach(asset => {
    const current = allAssets.find(item => item.id === asset.id)
    if (current && (!current.image || current.variants.some(variant => !variant.image))) include(current)
  })
  return plan
}

export async function generateAssetBatch(assets, { jobs, generateMedia, readJob, reload, view, customPrompt, styleId, signal }) {
  assets = assets.filter(asset => canBatchGenerate(asset, jobs))
  const submitted = [], failed = []
  const initial = await reload()
  const plan = assetBatchPlan(assets, initial.assets)
  const running = new Map()
  const run = asset => {
    if (running.has(asset.id)) return running.get(asset.id)
    const task = (async () => {
      const submit = async (current, variantId) => {
        signal.throwIfAborted()
        const job = await generateMedia({ ...assetImageRequest(current, { variantId, view, customPrompt }), styleId, target: { resource: 'assets', id: current.id, field: 'image', ...(variantId ? { variantId } : {}) } })
        submitted.push(job.id)
        return job
      }
      try {
        for (const dependency of asset.dependencies || []) {
          if (plan.has(dependency.assetId) && !await run(plan.get(dependency.assetId))) throw new Error('依赖资产生成失败，已跳过')
        }
        let current = (await reload()).assets.find(item => item.id === asset.id)
        if (!current) throw new Error('资产已被删除')
        resolveAssetDependencies(current, (await reload()).assets)
        const pending = pendingAssetJob(jobs, asset.id)
        if (pendingJob(pending) && styleId !== undefined && pending.style?.id !== String(styleId)) throw new Error('主图正在按其他风格生成，请完成后重试')
        if (!current.image) {
          const mainJob = pendingJob(pending) ? pending : await submit(current)
          const mainImage = await waitForImage(mainJob, readJob, signal)
          current = (await reload()).assets.find(item => item.id === asset.id)
          if (!current || current.image !== mainImage) throw new Error('主图已变化或尚未应用，请核对后重新生成')
        }
        let success = true
        for (const variant of current.variants) {
          const pendingVariant = pendingAssetJob(jobs, asset.id, variant.id)
          if (variant.image) continue
          try {
            current = (await reload()).assets.find(item => item.id === asset.id)
            if (!current) throw new Error('资产已被删除')
            const latestVariant = current.variants.find(item => item.id === variant.id)
            if (!latestVariant) throw new Error('衍生形态已被删除')
            if (latestVariant.image) continue
            const job = pendingJob(pendingVariant) ? pendingVariant : await submit(current, variant.id)
            const image = await waitForImage(job, readJob, signal)
            const saved = (await reload()).assets.find(item => item.id === asset.id)
            if (saved?.variants.find(item => item.id === variant.id)?.image !== image) throw new Error('衍生形态已变化或尚未应用，请核对后重新生成')
          } catch (reason) {
            if (signal.aborted) throw reason
            success = false
            failed.push(`${asset.name} / ${variant.name}：${reason.message}`)
          }
        }
        return success
      } catch (reason) {
        if (signal.aborted) throw reason
        failed.push(`${asset.name}：${reason.message}`)
        return false
      }
    })()
    running.set(asset.id, task)
    return task
  }
  await Promise.all([...plan.values()].map(run))
  return { submitted, failed }
}
