import { imageUrl } from '../../image-url'
import { useState } from 'react'
import { ReferencePicker, MediaPreview } from './ui'
import { useStore } from '../store'
import { clipMediaReferences, clipVoices, referenceKey } from '../storyboard'

export default function ClipReferences({ clip, projectId }) {
  const { data, patch } = useStore()
  const [picker, setPicker] = useState(null)
  const [preview, setPreview] = useState(null)
  const { assets, additional, images, frames } = clipMediaReferences(clip, data)
  const voices = clipVoices(clip, data)
  return (
    <>
      <div className="sb-ref-summary-row">
        {[
          [
            '图片',
            images.length,
          ],
          ['视频', additional.filter((r) => r.kind === 'video').length],
          ['音频', voices.filter((voice) => voice.enabled).length + additional.filter((r) => r.kind === 'audio' && !voices.some((voice) => voice.id === r.id)).length],
        ].map(([name, count]) => (
          <span className="sb-ref-sum" key={name}>
            <span className="label">{name}</span>
            <span className="num">{count}</span>
          </span>
        ))}
      </div>
      {['角色', '场景', '道具'].map((type) => (
        <div className="sb-asset-row" key={type}>
          <span className="sb-asset-label">{type}</span>
          {assets
            .filter((a) => a.type === type)
            .map((a) => (
              <span className="sb-asset-chip" key={a.id}>
                <button
                  className="sb-chip-open"
                  disabled={!a.image}
                  onClick={() => setPreview({ name: a.name, url: a.image })}
                >
                  {a.image && <img loading="lazy" className="sb-asset-chip__thumb" src={imageUrl(a.image, 160)} alt="" />}
                  <span className="sb-asset-chip__name">{a.name}{!a.image && '（未生成图片）'}</span>
                </button>
                <button
                  className="sb-asset-chip__remove"
                  aria-label={`移除关联${a.name}`}
                  onClick={() =>
                    patch('clips', clip.id, {
                      assetIds: clip.assetIds.filter((x) => x !== a.id),
                    })
                  }
                >
                  ×
                </button>
              </span>
            ))}
          <button className="sb-asset-add" onClick={() => setPicker('assets')}>
            +{type}
          </button>
        </div>
      ))}
      {frames.length > 0 && <div className="sb-ref-row-wrap"><span className="sb-asset-label">分镜参考图</span>{frames.map(frame => <button className="sb-asset-chip" key={frame.id} onClick={() => setPreview(frame)}><img loading="lazy" className="sb-asset-chip__thumb" src={imageUrl(frame.url, 160)} alt="" /><span>{frame.name}</span></button>)}</div>}
      <fieldset className="clip-voices">
        <legend>音色引用</legend>
        {voices.map((voice) => <div className="clip-voice-row" key={voice.id}>
          <label><input type="checkbox" aria-label={`引用音色 ${voice.name}`} checked={voice.enabled} onChange={(e) => patch('clips', clip.id, { disabledVoiceIds: e.target.checked ? (clip.disabledVoiceIds || []).filter((voiceId) => voiceId !== voice.id) : [...(clip.disabledVoiceIds || []), voice.id] })} /><span>{voice.characters && <strong>{voice.characters}</strong>}<span>{voice.name}</span></span></label>
          <button className="btn" onClick={() => setPreview({ ...voice, kind: 'audio' })}>试听</button>
        </div>)}
        {!voices.length && <p className="muted">角色尚未配置音色，可在美术资产中配置，或添加音色。</p>}
        <button className="sb-ref-upload" onClick={() => setPicker('音色')}>＋ 添加音色</button>
      </fieldset>
      <div className="sb-ref-row-wrap">
        <span className="sb-asset-label">其他参考素材</span>
        {additional.filter((r) => !voices.some((voice) => voice.id === r.id)).map((r) => (
          <span className="sb-asset-chip" key={r.id}>
            <button className="sb-chip-open" onClick={() => setPreview(r)}>
              {r.kind === 'image' && (
                <img loading="lazy" className="sb-asset-chip__thumb" src={imageUrl(r.url, 160)} alt="" />
              )}
              <span className="sb-asset-chip__name">{r.name}</span>
            </button>
            <button
              className="sb-asset-chip__remove"
              aria-label={`移除${r.name}`}
              onClick={() =>
                patch('clips', clip.id, {
                  references: additional.filter((x) => referenceKey(x) !== referenceKey(r)),
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        {['图片', '视频', '音频'].map((t) => (
          <button
            className="sb-ref-upload"
            key={t}
            onClick={() => setPicker(t)}
          >
            +{t}
          </button>
        ))}
      </div>
      {picker && (
        <ReferencePicker
          projectId={projectId}
          initialKind={picker === 'assets' ? '关联资产' : picker}
          assetSelection={picker === 'assets'}
          selected={
            picker === 'assets'
              ? assets.map((a) => ({
                  id: a.id,
                  name: a.name,
                  url: a.image,
                  kind: 'image',
                  asset: true,
                }))
              : additional
          }
          onClose={() => setPicker(null)}
          onApply={(items) => {
            patch(
              'clips',
              clip.id,
              picker === 'assets'
                ? { assetIds: items.map((i) => i.id) }
                : { references: items },
            )
            setPicker(null)
          }}
        />
      )}
      {preview && (
        <MediaPreview item={preview} onClose={() => setPreview(null)} />
      )}
    </>
  )
}
