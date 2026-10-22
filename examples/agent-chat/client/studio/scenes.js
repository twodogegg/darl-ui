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

// Remove episode-owned records in the same batch; assets remain shared by the project.
export function removeEpisode(data, episodeId) {
  data.episodes = data.episodes.filter(item => item.id !== episodeId)
  for (const resource of ['shots', 'clips', 'films', 'history']) data[resource] = data[resource].filter(item => item.episodeId !== episodeId)
  data.assets.forEach(asset => { asset.episodeIds = (asset.episodeIds || []).filter(id => id !== episodeId) })
}
