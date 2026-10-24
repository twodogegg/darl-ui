const detailLabels: Record<string, string> = {
  notes: '补充要求',
  type: '类型',
  name: '名称',
  description: '描述',
  referenceAudio: '参考音频',
  assetName: '目标资产',
  episodes: '计划集数',
}

export function studioAgentContent(task: Record<string, unknown>) {
  const prompt = typeof task.prompt === 'string' ? task.prompt.trim() : ''
  const details = Object.entries(detailLabels).flatMap(([key, label]) => {
    const value = task[key]
    const text = typeof value === 'number' ? String(value) : value
    return typeof text === 'string' && text.trim() ? [`${label}：${text.trim()}`] : []
  })
  return [prompt, details.join('\n')].filter(Boolean).join('\n\n')
}
