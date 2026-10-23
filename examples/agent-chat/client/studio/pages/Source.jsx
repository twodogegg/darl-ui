import { useProject, Workflow } from '../components/Shell'
import { RedrawSource } from '../components/VideoRedraw'

export default function Source() {
  const context = useProject()
  const { project } = context
  const text = String(project?.sourceScript || '').trim()
  const requirements = String(project?.requirements || '').trim()
  if (project?.creationMode === 'video-redraw') return <Workflow context={context} projectLevel><RedrawSource key={context.projectId} context={context} /></Workflow>
  return (
    <Workflow key={context.projectId} context={context} projectLevel>
      <header className="workspace-toolbar">
        <div>
          <h2>原始素材</h2>
          <p className="muted">小说、剧本或其他文字资料，只作为创作依据，不直接作为剧集正文。</p>
        </div>
        {text && <span className="muted">{text.length} 字</span>}
      </header>
      <div className="source-page">
        {requirements && <section className="source-requirements">
          <h3>创作要求</h3>
          <p>{requirements}</p>
        </section>}
        {text ? <section className="source-text">
          <h3>提交的资料</h3>
          <pre>{text}</pre>
        </section> : <div className="empty">
          <h2>暂无原始素材</h2>
          <p>创建项目时上传的小说、剧本或其他文字资料会显示在这里。</p>
        </div>}
      </div>
    </Workflow>
  )
}
