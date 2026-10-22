import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../store'
import {
  Tabs,
  Confirm,
  TextDialog,
  Empty,
} from '../components/ui'

export function Projects() {
  const { data, patch, update, notify } = useStore()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('recent')
  const [rename, setRename] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [menu, setMenu] = useState(null)
  const projects = data.projects
    .filter((p) => `${p.title}${p.summary}`.includes(search))
    .sort((a, b) =>
      sort === 'name'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : sort === 'old'
          ? a.updated - b.updated
          : b.updated - a.updated,
    )
  function remove() {
    update((d) => {
      const episodes = d.episodes
        .filter((e) => e.projectId === deleting.id)
        .map((e) => e.id)
      d.projects = d.projects.filter((p) => p.id !== deleting.id)
      for (const key of ['episodes', 'assets', 'films', 'history'])
        d[key] = d[key].filter((x) => x.projectId !== deleting.id)
      d.clips = d.clips.filter((s) => !episodes.includes(s.episodeId))
      d.shots = d.shots.filter((s) => !episodes.includes(s.episodeId))
    })
    setDeleting(null)
    notify('项目已归档')
  }
  return (
    <div className="projects-page">
      <div className="page-head">
        <Tabs items={['剧本项目']} value="剧本项目" onChange={() => {}} />
        <div className="toolbar">
          <input
            aria-label="搜索项目"
            type="search"
            placeholder="搜索项目名称/简介"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="项目排序"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">最近修改</option>
            <option value="old">最早修改</option>
            <option value="name">名称排序</option>
          </select>
          <Link className="btn primary" to="/">
            新建项目
          </Link>
        </div>
      </div>
      <div className="projects-grid">
        {projects.map((p) => (
          <article className="project-card" key={p.id}>
            <Link to={`/outline?projectId=${encodeURIComponent(p.id)}`}>
              <>{p.cover ? <img className="project-card-cover" src={p.cover} alt={p.title} /> : <div className="studio-cover-empty">未上传封面</div>}</>
              <div className="project-card-body">
                <h2>{p.title}</h2>
                <small>
                  {data.episodes.filter((e) => e.projectId === p.id).length} 集
                  · {p.ratio} · 创作中
                </small>
              </div>
            </Link>
            <div className="project-card-actions">
              <button
                className="project-card-more"
                aria-label={`更多操作：${p.title}`}
                aria-expanded={menu === p.id}
                onClick={() => setMenu(menu === p.id ? null : p.id)}
              >
                ⋯
              </button>
              {menu === p.id && (
                <div className="project-card-menu">
                  <button
                    onClick={() => {
                      setMenu(null)
                      setRename(p)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      setMenu(null)
                      setDeleting(p)
                    }}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {!projects.length && (
        <Empty>没有匹配的项目，试试其他名称或新建项目。</Empty>
      )}
      {rename && (
        <TextDialog
          title="重命名项目"
          label="项目名称"
          value={rename.title}
          onClose={() => setRename(null)}
          onSave={(title) => {
            patch('projects', rename.id, { title, updated: Date.now() })
            setRename(null)
            notify('项目名称已保存')
          }}
        />
      )}
      {deleting && (
        <Confirm
          danger
          title="删除项目"
          onClose={() => setDeleting(null)}
          onConfirm={remove}
        >
          确定删除「{deleting.title}」？关联内容将从工作台移除。
        </Confirm>
      )}
    </div>
  )
}
