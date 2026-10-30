export const steps = [
  { path: '/outline', label: '剧本大纲', english: 'OUTLINE' },
  { path: '/script', label: '剧本', english: 'SCRIPT' },
  { path: '/art', label: '美术资产', english: 'ASSETS' },
  { path: '/video', label: '分镜', english: 'STORYBOARD' },
  { path: '/film', label: '短片', english: 'FILM' },
]
export const redrawSteps = [
  { path: '/source', label: '原片', english: 'SOURCE' },
  { path: '/storyboard', label: '原片分镜', english: 'STORYBOARD' },
  { path: '/art', label: '转绘资产', english: 'ASSETS' },
  { path: '/video', label: '分镜', english: 'STORYBOARD' },
  { path: '/film', label: '短片', english: 'FILM' },
]
export const projectSteps = project => project?.creationMode === 'video-redraw' ? redrawSteps : steps
export const types = ['角色', '场景', '道具']
export const imageColumns = [
  {
    key: 'image',
    history: 'imageHistory',
    label: '分镜图',
  },
  {
    key: 'storyboardImage',
    history: 'storyboardHistory',
    label: '故事板',
  },
  {
    key: 'blockingImage',
    history: 'blockingHistory',
    label: '站位图',
  },
]
export const id = () => crypto.randomUUID()
export const makeOutline = project => ({ core: project.summary || '', story: '', keep: '', remove: '', merge: '', risks: '', episodes: '', roles: [], scenes: [], props: [] })
export const makeClips = episodeId => [{ id: id(), episodeId, sceneId: '', title: '', shotIds: [], sourceSignature: '', description: '', duration: 5, prompt: '', assetIds: [], references: [], disabledVoiceIds: [], image: '', imageHistory: [], imageSource: 'clip', blocking: '', blockingImage: '', blockingHistory: [], videos: [], model: '', resolution: '', ratio: '9:16', mode: '参考生成', firstFrame: '', lastFrame: '' }]
export const promptGroups = [{ label: '项目生成', names: ['项目大纲', '整集剧本', '剧本重写'] }, { label: '资产生成', names: ['角色一致性图', '场景空镜', '道具资产图', '服装与衍生形态'] }, { label: '分镜设计', names: ['分镜提取', '分镜图', '镜头设计', '画面描述优化'] }, { label: '视频制作', names: ['视频提示词', '参考素材说明'] }, { label: '视频转绘', names: ['转绘资产', '转绘镜头'] }]
