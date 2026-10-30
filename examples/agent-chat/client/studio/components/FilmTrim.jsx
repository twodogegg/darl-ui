import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconX } from '@tabler/icons-react'
import { Modal } from './ui'

export default function FilmTrim({ source, ratio, onClose, onSaved }) {
  const video = useRef(null)
  const track = useRef(null)
  const abort = useRef(null)
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [time, setTime] = useState(0)
  const [frames, setFrames] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const frameVideo = document.createElement('video')
    frameVideo.muted = true
    frameVideo.preload = 'auto'
    frameVideo.src = source.url
    const canvas = document.createElement('canvas')
    canvas.width = 120; canvas.height = 68
    const capture = async () => {
      try {
        await new Promise((resolve, reject) => { frameVideo.onloadedmetadata = resolve; frameVideo.onerror = reject; frameVideo.load() })
        const length = frameVideo.duration
        if (!Number.isFinite(length) || length <= 0) return
        const result = []
        for (let i = 0; i < 12 && !cancelled; i++) {
          const at = Math.min(length * (i + 0.5) / 12, Math.max(0, length - 0.01))
          await new Promise((resolve, reject) => { frameVideo.onseeked = resolve; frameVideo.onerror = reject; frameVideo.currentTime = at })
          canvas.getContext('2d').drawImage(frameVideo, 0, 0, canvas.width, canvas.height)
          result.push(canvas.toDataURL('image/jpeg', 0.7))
          if (!cancelled) setFrames([...result])
        }
      } catch { if (!cancelled) setFrames([]) }
    }
    capture()
    return () => { cancelled = true; frameVideo.pause(); frameVideo.removeAttribute('src'); frameVideo.load(); abort.current?.abort() }
  }, [source.url])

  const seek = value => { if (video.current) video.current.currentTime = value; setTime(value) }
  const changeBoundary = (which, value) => {
    const next = Math.max(0, Math.min(duration, value))
    if (which === 'start') { const bounded = Math.min(next, Math.max(0, end - 0.01)); setStart(bounded); seek(bounded) }
    else { const bounded = Math.max(next, Math.min(duration, start + 0.01)); setEnd(bounded); seek(bounded) }
  }
  const drag = (event, which) => {
    event.preventDefault()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const move = e => {
      const bounds = track.current?.getBoundingClientRect()
      if (bounds?.width) changeBoundary(which, (e.clientX - bounds.left) / bounds.width * duration)
    }
    move(event)
    const stop = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', stop); element.removeEventListener('pointercancel', stop) }
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', stop); element.addEventListener('pointercancel', stop)
  }
  async function save() {
    if (busy || !duration || end <= start) return
    const controller = new AbortController(); abort.current = controller; setBusy(true); setError('')
    try {
      const response = await fetch('/api/video-editing/compose', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ratio, selections: [{ url: source.url, start, end }] }), signal: controller.signal })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '裁剪失败')
      await onSaved(result)
      onClose()
    } catch (reason) { if (!controller.signal.aborted) setError(reason.message || '裁剪失败') }
    finally { if (abort.current === controller) abort.current = null; setBusy(false) }
  }
  const percent = value => duration ? `${value / duration * 100}%` : '0%'
  return <Modal title="裁剪视频" wide panelClassName="film-trim-dialog" bodyClassName="film-trim-body" onClose={() => { if (!busy) onClose() }} header={<div className="film-trim-heading">{source.name}</div>}>
    <div className="film-trim-preview"><video ref={video} src={source.url} controls playsInline preload="metadata" onLoadedMetadata={event => { const value = event.currentTarget.duration; if (Number.isFinite(value) && value > 0) { setDuration(value); setEnd(value) } else setError('无法读取视频时长') }} onError={() => setError('视频加载失败')} onTimeUpdate={event => setTime(event.currentTarget.currentTime)} /></div>
    <div className="film-trim-bar">
      <button className="film-trim-cancel" aria-label="取消裁剪" disabled={busy} onClick={onClose}><IconX size={24} /></button>
      <div className="film-trim-track" ref={track} onClick={event => { if (!duration || busy) return; const bounds = event.currentTarget.getBoundingClientRect(); seek(Math.max(0, Math.min(duration, (event.clientX - bounds.left) / bounds.width * duration))) }}>
        <div className="film-trim-frames">{Array.from({ length: 12 }, (_, index) => <div key={index}>{frames[index] && <img src={frames[index]} alt="" />}</div>)}</div>
        <div className="film-trim-shade" style={{ left: 0, width: percent(start) }} /><div className="film-trim-shade" style={{ left: percent(end), right: 0 }} />
        <div className="film-trim-selection" style={{ left: percent(start), width: percent(end - start) }}><span>{(end - start).toFixed(2)} s</span></div>
        <div className="film-trim-playhead" style={{ left: percent(time) }} />
        {['start', 'end'].map(which => <button key={which} className={`film-trim-handle ${which}`} style={{ left: percent(which === 'start' ? start : end) }} role="slider" aria-label={which === 'start' ? '裁剪开始时间' : '裁剪结束时间'} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Number((which === 'start' ? start : end).toFixed(2))} aria-valuetext={`${(which === 'start' ? start : end).toFixed(2)} 秒`} disabled={!duration || busy} onClick={event => event.stopPropagation()} onPointerDown={event => drag(event, which)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); changeBoundary(which, (which === 'start' ? start : end) + (event.key === 'ArrowLeft' ? -0.1 : 0.1)) } }}><span /></button>)}
      </div>
      <button className="film-trim-confirm" aria-label="确认裁剪" title="确认裁剪" disabled={busy || !duration || end <= start} onClick={save}><IconCheck size={26} /></button>
    </div>
    <div className="film-trim-meta"><span>{start.toFixed(2)} s — {end.toFixed(2)} s</span><span>{busy ? '正在保存…' : '拖动两端选择保留范围，点击画面预览位置'}</span>{busy && <button onClick={() => abort.current?.abort()}>取消保存</button>}</div>
    {error && <p className="production-edit-error" role="alert">{error}</p>}
  </Modal>
}
