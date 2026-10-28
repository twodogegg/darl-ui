import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { StudioProvider, useStore } from './store'
import Shell from './components/Shell'
import Home from './pages/Home'
import { Projects } from './pages/Projects'
import Script, { Outline } from './pages/Script'
import Source from './pages/Source'
import Dialogue from './pages/Dialogue'
import Art from './pages/Art'
import VideoProduction from './pages/VideoProduction'
import Assets from './pages/Assets'
import Prompts from './pages/Prompts'
import { RedrawFilm } from './components/VideoRedraw'
import { MediaGenerationPage } from '../MediaGenerationPage'
import { ReferencePicker } from './components/ui'
import './styles/brand-tokens.css'
import './styles/base.css'
import './styles/shell.css'
import './styles/home.css'
import './styles/workspaces.css'
import './styles/selects.css'
import './styles/art.css'
import './styles/art-drawer.css'
import './styles/migration.css'
import './styles/production.css'
import './styles/integration.css'
import './styles/video-redraw.css'

function StudioMediaPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const projectId = params.get('projectId') || undefined
  const labels = { images: '图片', videos: '视频', audios: '音频' }
  return <MediaGenerationPage onBack={() => navigate('/')} renderReferencePicker={({ references, kinds, onApply, onClose }) => <ReferencePicker
    projectId={projectId}
    kinds={kinds.map(kind => labels[kind])}
    selected={kinds.flatMap(kind => (references[kind] || []).flatMap(input => input instanceof File ? [] : [{ ...input, kind: { images: 'image', videos: 'video', audios: 'audio' }[kind], name: input.id }]))}
    onClose={onClose}
    onApply={items => onApply({ ...references, ...Object.fromEntries(kinds.map(kind => [kind, items.filter(item => item.kind === { images: 'image', videos: 'video', audios: 'audio' }[kind]).map(item => {
      const fileId = item.fileId || item.url.match(/^\/api\/files\/([a-f0-9-]+)/)?.[1]
      return { id: item.id, url: item.url, ...(fileId ? { fileId } : {}), ...(item.thumbnailUrl ? { thumbnailUrl: item.thumbnailUrl } : {}) }
    })])) })}
  />} />
}

function Pages({ onContextChange }) {
  const location = useLocation()
  const { data } = useStore()
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    onContextChange({ page: location.pathname, projectId: params.get('projectId') || '', episodeId: params.get('episodeId') || '' })
    window.scrollTo(0, 0)
  }, [location.pathname, location.search, onContextChange])
  return <Shell><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/projects" element={<Projects />} />
    <Route path="/projects/:id" element={<Navigate to="/projects" replace />} />
    <Route path="/outline" element={<Outline key={data.projects.map(item => item.id).join(',')} />} />
    <Route path="/source" element={<Source key={data.projects.map(item => item.id).join(',')} />} />
    <Route path="/dialogue" element={<Dialogue />} />
    <Route path="/script" element={<Script />} />
    <Route path="/art" element={<Art />} />
    <Route path="/video" element={<VideoProduction />} />
    <Route path="/film" element={<RedrawFilm />} />
    <Route path="/assets" element={<Assets />} />
    <Route path="/media" element={<StudioMediaPage />} />
    <Route path="/settings/prompts" element={<Prompts />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Shell>
}
export function StudioApp(props) {
  if (!location.pathname.startsWith('/studio')) history.replaceState(null, '', '/studio/')
  return <div className="rn-studio"><BrowserRouter basename="/studio"><StudioProvider {...props}><Pages onContextChange={props.onContextChange} /></StudioProvider></BrowserRouter></div>
}
