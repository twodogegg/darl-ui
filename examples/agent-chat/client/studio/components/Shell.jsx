import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import {
  IconHome,
  IconLayoutGrid,
  IconPhoto,
  IconSettings,
  IconMovie,
  IconNotebook,
  IconScript,
  IconLayoutList,
  IconVideo,
  IconFileText,
} from '@tabler/icons-react'
import { useStore } from '../store'
import { projectSteps } from '../data'

const stepIcons = [IconNotebook, IconScript, IconLayoutList, IconPhoto, IconVideo]
// 项目级步骤：整个项目共用同一份内容，不按集拆分
const projectLevelPaths = ['/source', '/outline', '/script', '/art', '/film']
// 分集步骤：进入后才选择具体剧集
const episodeLevelPaths = ['/video']

const nav = [
  { to: '/', label: '工作台', mobile: '工作台', icon: IconHome },
  { to: '/projects', label: '我的项目', mobile: '项目', icon: IconLayoutGrid },
  { to: '/assets', label: '资产库', mobile: '资产', icon: IconPhoto },
  { to: '/media', label: '生成媒体', mobile: '生成', icon: IconMovie },
  {
    to: '/settings/prompts',
    label: '提示词设置',
    mobile: '提示词',
    icon: IconSettings,
  },
]
export default function Shell({ children }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { data, onNavigate } = useStore()
  const [params] = useSearchParams()
  const projectId = params.get('projectId')
  const activeProject = data.projects.find((p) => p.id === projectId)
  const flowSteps = projectSteps(activeProject)
  const workflow = flowSteps.find((s) => s.path === pathname)
  const activeEpisodeList = data.episodes.filter(
    (e) => e.projectId === projectId,
  )
  const activeEpisode = (() => {
    const requested = params.get('episodeId')
    return requested
      ? activeEpisodeList.find((e) => e.id === requested)
      : activeEpisodeList[0]
  })()
  const isProjectLevel = projectLevelPaths.includes(pathname) || pathname === '/media'
  const flowLink = (path) =>
    projectLevelPaths.includes(path) || !activeEpisode
      ? `${path}?projectId=${encodeURIComponent(projectId)}`
      : `${path}?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(activeEpisode.id)}`
  const crumb =
    workflow?.label || (pathname === '/source' ? '原始素材' : nav.find((n) => n.to === pathname)?.label) || '工作台'
  const showFlow = !!activeProject && (!!workflow || projectLevelPaths.includes(pathname) || pathname === '/media')
  const mediaLink = activeProject ? `/media?projectId=${encodeURIComponent(projectId)}` : '/media'
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <aside className="br-sidebar" aria-label="主导航">
        <Link className="br-brand" to="/">
          <span className="br-brand-symbol">
            <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
              <path
                d="M8 21h32v23H8z"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              <path d="M5 12 36 3l4 12-31 9-4-12Z" fill="currentColor" />
              <path
                d="m12 10 5 9m5-12 5 9m5-12 5 9"
                stroke="var(--br-theme-brand-dot)"
                strokeWidth="3"
              />
              <path d="m22 28 10 5-10 5z" fill="currentColor" />
            </svg>
          </span>
          <span>
            <span className="br-brand-title">本入剧出</span>
            <span className="br-brand-sub">AI FILM STUDIO</span>
          </span>
        </Link>
        {showFlow ? (
          <nav className="br-flow" aria-label="项目创作流程">
            <div className="br-flow-head">
              <Link className="br-flow-back" to="/projects" aria-label="返回我的项目">
                ◀
              </Link>
              <span className="br-flow-project" title={activeProject.title}>
                {activeProject.title}
              </span>
              <span className="br-flow-scope">
                {isProjectLevel
                  ? '全项目'
                  : activeEpisode
                    ? `第${activeEpisode.number}集`
                    : '本集'}
              </span>
            </div>
            <p className="br-group-title">创作流程</p>
            {flowSteps.map((s, i) => {
              const Icon = stepIcons[i]
              const active = pathname === s.path
              const done =
                !projectLevelPaths.includes(s.path) &&
                (activeEpisode?.stage || 0) > i + 1
              const state = active
                ? '进行中'
                : projectLevelPaths.includes(s.path)
                  ? '全项目'
                  : done
                    ? '已完成'
                    : '待创作'
              return (
                <NavLink
                  className={({ isActive }) =>
                    `br-flow-step ${isActive ? 'br-flow-step--active' : ''}`
                  }
                  to={flowLink(s.path)}
                  key={s.path}
                >
                  <span className="br-flow-icon">
                    <Icon size={17} stroke={1.7} />
                  </span>
                  <span className="br-flow-label">
                    <span className="br-flow-num">0{i + 1}</span>
                    {s.label}
                  </span>
                  <span
                    className={`br-flow-state ${active ? 'active' : done ? 'done' : ''}`}
                  >
                    {state}
                  </span>
                </NavLink>
              )
            })}
            <div className="br-flow-foot">
              <div className="br-menu-divider" />
              <p className="br-group-title">创作管理</p>
              <NavLink
                className={({ isActive }) => `br-flow-step br-flow-step--plain ${isActive ? 'br-flow-step--active' : ''}`}
                to={flowLink('/source')}
              >
                <span className="br-flow-icon"><IconFileText size={17} stroke={1.7} /></span>
                <span className="br-flow-label">原始素材</span>
              </NavLink>
              <NavLink
                className={({ isActive }) => `br-flow-step br-flow-step--plain ${isActive ? 'br-flow-step--active' : ''}`}
                to={mediaLink}
              >
                <span className="br-flow-icon"><IconMovie size={17} stroke={1.7} /></span>
                <span className="br-flow-label">生成媒体</span>
              </NavLink>
              <NavLink
                className={({ isActive }) =>
                  `br-flow-step br-flow-step--plain ${isActive ? 'br-flow-step--active' : ''}`
                }
                to="/settings/prompts"
              >
                <span className="br-flow-icon">
                  <IconSettings size={17} stroke={1.7} />
                </span>
                <span className="br-flow-label">提示词设置</span>
              </NavLink>
              <Link className="br-flow-exit" to="/projects">
                全部项目
              </Link>
            </div>
          </nav>
        ) : (
          <nav className="br-menu">
            <p className="br-group-title">创作空间</p>
            {nav.map((n) => (
              <div key={n.to}>
                {n.to === '/settings/prompts' && (
                  <>
                    <div className="br-menu-divider" />
                    <p className="br-group-title">创作管理</p>
                  </>
                )}
                <NavLink
                  end={n.to === '/'}
                  className={({ isActive }) =>
                    `br-nav ${isActive ? 'br-nav--active' : ''}`
                  }
                  to={n.to}
                >
                  <n.icon size={18} stroke={1.8} />
                  {n.label}
                </NavLink>
              </div>
            ))}
          </nav>
        )}
        {!showFlow && <div className="br-sidebar-art" />}
        {!showFlow && (
          <div className="br-sidebar-quote">
            让<br />
            好故事
            <br />
            被看见
            <b />
            <small>
              GOOD STORIES
              <br />
              BIGGER AUDIENCES
            </small>
          </div>
        )}
      </aside>
      <div className="br-main">
        <header className="br-topbar">
          <div className="br-crumb">
            <IconMovie className="br-mobile-mark" size={20} />
            <span>本入剧出</span> / <strong>{crumb}</strong>
          </div>
          <div className="br-top-actions"><button onClick={() => onNavigate('chat')}>AI 助手</button><button onClick={() => onNavigate('agents')}>Agents</button><button onClick={() => navigate(mediaLink)}>独立生成</button><button onClick={() => onNavigate('settings')}>设置</button></div>
        </header>
        <main
          id="main-content"
          className={`br-content ${workflow ? 'br-content--flush' : ''}`}
        >
          {children}
        </main>
      </div>
      <nav className="br-mobile-nav" aria-label="移动导航">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            end={n.to === '/'}
            to={n.to === '/media' ? mediaLink : n.to}
            className={({ isActive }) =>
              isActive ? 'br-mobile-nav--active' : ''
            }
          >
            <n.icon size={19} stroke={1.8} />
            {n.mobile}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export function useProject() {
  const { data } = useStore()
  const [params] = useSearchParams()
  const projectId = params.get('projectId') || data.projects[0]?.id
  const project = data.projects.find((p) => p.id === projectId)
  const episodes = data.episodes.filter((e) => e.projectId === projectId)
  const requested = params.get('episodeId')
  const episode = requested
    ? episodes.find((e) => e.id === requested)
    : episodes[0]
  const link = (path, e = episode) =>
    `${path}?projectId=${encodeURIComponent(projectId)}${e ? `&episodeId=${encodeURIComponent(e.id)}` : ''}`
  return {
    project,
    projectId,
    episodes,
    episode,
    link,
    invalidEpisode: !!requested && !episode,
  }
}
export function Banner({ context, projectLevel = false }) {
  const { project, episodes, episode, projectId, link } = context
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const stepLink = (path) =>
    projectLevelPaths.includes(path) || !episode
      ? `${path}?projectId=${encodeURIComponent(projectId)}`
      : `${path}?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(episode.id)}`
  const stepState = (path, i) => {
    if (pathname === path) return '进行中'
    if (projectLevelPaths.includes(path)) return '全项目'
    return (episode?.stage || 0) > i + 1 ? '已完成' : '待创作'
  }
  return (
    <div className="workflow-banner">
      <div className="workflow-context">
        <Link
          className="icon-btn"
          aria-label="返回我的项目"
          to="/projects"
        >
          ◀
        </Link>
        <strong>{project?.title || '项目不存在'}</strong>
        <span className="workflow-project-scope">
          {projectLevel ? '全项目' : episode ? `第${episode.number}集` : '—'}
        </span>
        {!projectLevel && <select
          aria-label="选择剧集"
          value={episode?.id || ''}
          onChange={(e) =>
            navigate(
              `${pathname}?projectId=${encodeURIComponent(projectId)}&episodeId=${encodeURIComponent(e.target.value)}`,
            )
          }
        >
          {!episodes.length && <option value="">暂无剧集</option>}
          {episodes.map((e) => (
            <option key={e.id} value={e.id}>
              第{e.number}集 · {e.title}
            </option>
          ))}
        </select>}
      </div>
      <nav className="workflow-steps" aria-label="五步创作流程">
        {projectSteps(project).map((s, i) => (
          <Link
            className={pathname === s.path ? 'active' : ''}
            to={stepLink(s.path)}
            key={s.path}
          >
            <span className="step-number">{i + 1}</span>
            <span>
              {s.label}
              <small>
                {stepState(s.path, i, episode, pathname)}
              </small>
            </span>
          </Link>
        ))}
      </nav>
    </div>
  )
}
export function Workflow({ context, children, projectLevel = false }) {
  if (!context.project || (!projectLevel && !context.episode))
    return (
      <div className="empty">
        <h2>{context.project ? '剧集不存在或暂无剧集' : '项目不存在'}</h2>
        <p>请返回项目列表选择有效项目与剧集。</p>
        <Link className="btn primary" to="/projects">
          返回项目列表
        </Link>
      </div>
    )
  return (
    <>
      <Banner context={context} projectLevel={projectLevel} />
      {children}
    </>
  )
}
