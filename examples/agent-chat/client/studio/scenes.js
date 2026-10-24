export function parseScenes(script, episodeId) {
  const scenes = []
  let foundHeading = false
  for (const line of script.split('\n')) {
    const heading = line.trim().match(/^第[一二三四五六七八九十百零〇两\d]+场\s*[·.、：:\s]\s*(.*)$/)
    if (heading) {
      const [location = '', second = '待定', third] = heading[1].split(/\s*[·｜|]\s*/)
      const values = { location, setting: third ? second : '内', time: third || second }
      if (!foundHeading && scenes.length === 1) Object.assign(scenes[0], values)
      else scenes.push({ id: `${episodeId}-scene-${scenes.length + 1}`, ...values, suggestedDuration: '', content: '' })
      foundHeading = true
    } else {
      if (!scenes.length && !line.trim()) continue
      if (!scenes.length) scenes.push({ id: `${episodeId}-scene-1`, location: '', setting: '内', time: '待定', suggestedDuration: '', content: '' })
      scenes[scenes.length - 1].content += `${line}\n`
    }
  }
  return scenes.map((scene) => ({ ...scene, content: scene.content.trim() }))
}

export const episodeScenes = (episode) => episode.scenes || parseScenes(episode.script, episode.id)
export const sceneLabel = (scene, index) => `第${index + 1}场 · ${scene.location || '地点待填写'} · ${scene.setting} · ${scene.time || '待定'}`
export const scenesToScript = (scenes) => scenes.map((scene, index) => `${sceneLabel(scene, index)}\n\n${scene.content}`).join('\n\n')
export const orderedShots = (shots, scenes) => scenes.flatMap((scene) => shots.filter((shot) => shot.sceneId === scene.id))

// Split the submitted source material by its own scene headings (01｜内景｜地点｜日 or 第1场…).
export function sourceScenes(text) {
  const scenes = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    const heading = line.match(/^(\d{1,3})\s*[｜|]\s*(内景|外景|内外景)\s*[｜|]\s*([^｜|]+?)\s*[｜|]\s*(.+)$/) || line.match(/^第\s*(\d{1,3})\s*场\s*[·.、：:\s]\s*([^｜|]+?)\s*[｜|]\s*([^｜|]+?)\s*[｜|]\s*(.+)$/)
    if (heading) {
      const [, , setting, location, time] = heading
      scenes.push({ number: Number(heading[1]), setting: { 内景: '内', 外景: '外' }[setting] || '内外', location: location.trim(), time: time.trim(), content: '' })
    } else if (scenes.length) scenes[scenes.length - 1].content += `${raw.trimEnd()}\n`
  }
  return scenes.map(scene => ({ ...scene, content: scene.content.trim() })).filter(scene => scene.content)
}
// Body sentences that do not appear verbatim in the source: rewritten, invented or truncated content.
export function unmatchedSentences(content, source) {
  const sentences = String(content || '').split(/(?<=[。！？!?\n])/).map(item => item.trim()).filter(item => item.length > 8)
  return sentences.filter(sentence => !String(source || '').includes(sentence))
}

// Remove episode-owned records in the same batch; assets remain shared by the project.
export function removeEpisode(data, episodeId) {
  data.episodes = data.episodes.filter(item => item.id !== episodeId)
  for (const resource of ['shots', 'clips', 'films', 'history']) data[resource] = data[resource].filter(item => item.episodeId !== episodeId)
  data.assets.forEach(asset => { asset.episodeIds = (asset.episodeIds || []).filter(id => id !== episodeId) })
}
