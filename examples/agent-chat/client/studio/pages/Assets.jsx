import { useState } from 'react'
import { useStore, useAgentTask } from '../store'
import { id, types } from '../data'
import {
  Button,
  Field,
  Tabs,
  FileButton,
  Modal,
  TextDialog,
  Confirm,
  MediaPreview,
  Empty,
  Processing,
  VoiceModal,
} from '../components/ui'
import { download } from '../files'

export default function Assets() {
  const { data, update, patch, notify } = useStore()
  const [source, setSource] = useState('素材库')
  const [type, setType] = useState('全部')
  const [projectId, setProjectId] = useState('全部项目')
  const [audioType, setAudioType] = useState('音乐')
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState(null)
  const [folderDialog, setFolderDialog] = useState(null)
  const [preview, setPreview] = useState(null)
  const [voice, setVoice] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [moving, setMoving] = useState(null)
  const [targetFolder, setTargetFolder] = useState('')
  const [prompt, setPrompt] = useState('')
  const { busy, run, cancel } = useAgentTask()
  const projectAssets = data.assets
    .filter((a) => projectId === '全部项目' || a.projectId === projectId)
    .map((a) => ({ ...a, source: '项目素材', collection: 'assets' }))
  const items = (
    source === '项目素材'
      ? projectAssets
      : data.library
          .filter((a) => a.source === source)
          .map((a) => ({ ...a, collection: 'library' }))
  ).filter(
    (a) =>
      (type === '全部' || a.type === type) &&
      `${a.name}${a.description}`.includes(search) &&
      (source !== '我的素材' || (a.folderId || '') === (folder?.id || '')),
  )
  function switchSource(value) {
    cancel()
    setSource(value)
    setFolder(null)
    setSearch('')
  }
  function upload(item) {
    setEditing({
      id: id(),
      name: item.name.replace(/\.[^.]+$/, '').slice(0, 100),
      description: '',
      image: item.url,
      type: type === '全部' ? '角色' : type,
      source: '我的素材',
      folderId: folder?.id || '',
      collection: 'library',
      isNew: true,
    })
  }
  function save() {
    if (!editing.name.trim()) return notify('请输入素材名称')
    const { collection, isNew, ...record } = editing
    if (!isNew && data[collection].find(item => item.id === record.id)?._version !== record._version) return notify('素材已被其他操作修改，当前草稿已保留，请核对后重新打开')
    if (isNew) update((d) => d.library.push(record))
    else patch(collection, record.id, record)
    setEditing(null)
    notify('素材已保存')
  }
  return (
    <div className="assets-page">
      <header className="assets-toolbar">
        <Tabs
          items={['素材库', '项目素材', '我的素材', '音乐音效']}
          value={source}
          onChange={switchSource}
        />
        <div className="toolbar">
          {source === '项目素材' && (
            <select
              aria-label="项目筛选"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option>全部项目</option>
              {data.projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          )}
          <input
            type="search"
            aria-label="搜索素材"
            placeholder="搜索素材名称 / 描述"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </header>
      {source === '音乐音效' ? (
        <>
          <Tabs
            items={['音乐', '音效']}
            value={audioType}
            onChange={(value) => {
              cancel()
              setAudioType(value)
            }}
          />
          <div className="music-form">
            <Field label={`${audioType}描述`}>
              <textarea
                aria-label={`${audioType}描述`}
                rows={2}
                maxLength={2000}
                value={prompt}
                placeholder={`描述想要的${audioType}…`}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </Field>
            <div className="toolbar">
              <Button
                primary
                disabled={busy}
                onClick={() => {
                  if (!prompt.trim()) return notify(`请填写${audioType}描述`)
                  run({ action: 'audio', type: audioType, notes: prompt })
                }}
              >
                生成{audioType}
              </Button>
              <FileButton
                kind="audio"
                onSelect={(item) => {
                  update((d) => d.audio.unshift({ ...item, type: audioType }))
                  notify('音频已上传并加入素材库')
                }}
              >
                选择本地{audioType}
              </FileButton>
            </div>
          </div>
          <Processing busy={busy} cancel={cancel} />
          <div className="audio-grid">
            {data.audio
              .filter((a) => a.type === audioType && a.name.includes(search))
              .map((a) => (
                <article className="panel audio-card" key={a.id}>
                  <h3>♫ {a.name}</h3>
                  <audio controls preload="none" src={a.url} />
                  <div className="toolbar">
                    <Button
                      onClick={() => {
                        download(
                          a.url,
                          a.name.includes('.') ? a.name : `${a.name}.wav`,
                        )
                        notify('已下载当前音频')
                      }}
                    >
                      下载
                    </Button>
                    <Button
                      onClick={() => setEditing({ ...a, collection: 'audio' })}
                    >
                      编辑名称
                    </Button>
                    <Button
                      danger
                      onClick={() => setDeleting({ ...a, collection: 'audio' })}
                    >
                      删除
                    </Button>
                  </div>
                </article>
              ))}
          </div>
          {!data.audio.some(
            (a) => a.type === audioType && a.name.includes(search),
          ) && <Empty>暂无匹配的{audioType}</Empty>}
        </>
      ) : (
        <>
          <Tabs items={['全部', ...types]} value={type} onChange={setType} />
          {source === '我的素材' && (
            <div className="toolbar folder-toolbar">
              {folder ? (
                <Button onClick={() => setFolder(null)}>‹ 返回全部素材</Button>
              ) : (
                <Button onClick={() => setFolderDialog({ name: '' })}>
                  ＋ 新建文件夹
                </Button>
              )}
              <FileButton onSelect={upload}>选择本地图片</FileButton>
              {folder && <h2>{folder.name}</h2>}
            </div>
          )}
          {source === '我的素材' && !folder && (
            <div className="folder-grid">
              {data.folders
                .filter((f) => f.name.includes(search))
                .map((f) => (
                  <article className="folder-card" key={f.id}>
                    <button onClick={() => setFolder(f)}>
                      ▱ <strong>{f.name}</strong>
                      <small>
                        {data.library.filter((a) => a.folderId === f.id).length}{' '}
                        个素材
                      </small>
                    </button>
                    <div className="toolbar">
                      <Button onClick={() => setFolderDialog(f)}>重命名</Button>
                      <Button
                        danger
                        onClick={() =>
                          setDeleting({ ...f, collection: 'folders' })
                        }
                      >
                        删除
                      </Button>
                    </div>
                  </article>
                ))}
            </div>
          )}
          <div className="library-grid">
            {items.map((a) => (
              <article className="library-card" key={a.id}>
                <button
                  className="library-image"
                  onClick={() => setPreview({ name: a.name, url: a.image })}
                >
                  {a.image ? <img src={a.image} alt={a.name} /> : <span className="studio-cover-empty">暂无图片</span>}
                </button>
                <div className="library-card-body">
                  <h3>{a.name}</h3>
                  <p>
                    {a.type} · {a.description}
                  </p>
                  <div className="toolbar">
                    <Button
                      onClick={() => setPreview({ name: a.name, url: a.image })}
                    >
                      预览
                    </Button>
                    {source !== '素材库' && (
                      <>
                        <Button onClick={() => setEditing({ ...a })}>
                          编辑
                        </Button>
                        {a.collection === 'assets' && a.type === '角色' && (
                          <Button onClick={() => setVoice(a.id)}>
                            {a.voiceId ? '已配置音色' : '配置音色'}
                          </Button>
                        )}
                        {source === '我的素材' && (
                          <Button
                            onClick={() => {
                              setMoving(a)
                              setTargetFolder(a.folderId || '')
                            }}
                          >
                            移动
                          </Button>
                        )}
                        <Button danger onClick={() => setDeleting(a)}>
                          删除
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          {!items.length && <Empty>暂无匹配的素材</Empty>}
        </>
      )}
      {voice && data.assets.some(a => a.id === voice) && (
        <VoiceModal asset={data.assets.find(a => a.id === voice)} onClose={() => setVoice(null)} />
      )}
      {folderDialog && (
        <TextDialog
          title={folderDialog.id ? '重命名文件夹' : '新建文件夹'}
          label="文件夹名称"
          value={folderDialog.name}
          onClose={() => setFolderDialog(null)}
          onSave={(name) => {
            if (
              data.folders.some(
                (f) => f.name === name && f.id !== folderDialog.id,
              )
            )
              return notify('已有同名文件夹')
            if (folderDialog.id) patch('folders', folderDialog.id, { name })
            else update((d) => d.folders.push({ id: id(), name }))
            setFolderDialog(null)
            notify('文件夹已保存')
          }}
        />
      )}
      {editing &&
        (editing.collection === 'audio' ? (
          <TextDialog
            title="编辑音频名称"
            label="音频名称"
            value={editing.name}
            onClose={() => setEditing(null)}
            onSave={(name) => {
              patch('audio', editing.id, { name })
              setEditing(null)
              notify('音频名称已保存')
            }}
          />
        ) : (
          <Modal
            title={editing.isNew ? '填写素材信息' : '编辑素材信息'}
            onClose={() => setEditing(null)}
            footer={
              <>
                <Button onClick={() => setEditing(null)}>取消</Button>
                <Button primary disabled={!editing.name.trim()} onClick={save}>
                  保存
                </Button>
              </>
            }
          >
            <div className="form-stack">
              <img
                className="edit-library-image"
                src={editing.image}
                alt="素材预览"
              />
              <FileButton
                onSelect={(item) =>
                  setEditing((a) => ({ ...a, image: item.url }))
                }
              >
                更换图片
              </FileButton>
              <Field label="素材名称">
                <input
                  aria-label="素材名称"
                  maxLength={100}
                  value={editing.name}
                  onChange={(e) =>
                    setEditing((a) => ({ ...a, name: e.target.value }))
                  }
                />
              </Field>
              <Field label="素材类型">
                <select
                  value={editing.type}
                  onChange={(e) =>
                    setEditing((a) => ({ ...a, type: e.target.value }))
                  }
                >
                  {types.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              {[
                ['description', '素材描述'],
                ...(editing.collection === 'assets' && editing.type === '角色'
                  ? [
                      ['appearance', '外貌特征'],
                      ['costume', '服饰'],
                      ['voiceDescription', '声音描述'],
                    ]
                  : []),
                ['prompt', '生图提示词'],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <textarea
                    aria-label={label}
                    rows={3}
                    maxLength={5000}
                    value={editing[key] || ''}
                    onChange={(e) =>
                      setEditing((a) => ({ ...a, [key]: e.target.value }))
                    }
                  />
                </Field>
              ))}
            </div>
          </Modal>
        ))}
      {moving && (
        <Modal
          title="移动素材"
          onClose={() => setMoving(null)}
          footer={
            <>
              <Button onClick={() => setMoving(null)}>取消</Button>
              <Button
                primary
                onClick={() => {
                  patch('library', moving.id, { folderId: targetFolder })
                  setMoving(null)
                  notify('素材已移动')
                }}
              >
                确认移动
              </Button>
            </>
          }
        >
          <Field label={`移动「${moving.name}」到`}>
            <select
              aria-label="目标文件夹"
              value={targetFolder}
              onChange={(e) => setTargetFolder(e.target.value)}
            >
              <option value="">全部素材（根目录）</option>
              {data.folders.map((f) => (
                <option value={f.id} key={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </Field>
        </Modal>
      )}
      {deleting && (
        <Confirm
          title="删除素材"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            update((d) => {
              d[deleting.collection] = d[deleting.collection].filter(
                (a) => a.id !== deleting.id,
              )
              if (deleting.collection === 'folders')
                d.library.forEach((a) => {
                  if (a.folderId === deleting.id) a.folderId = ''
                })
              if (deleting.collection === 'assets')
                d.clips.forEach((s) => {
                  s.assetIds = s.assetIds.filter((x) => x !== deleting.id)
                })
            })
            setDeleting(null)
            notify('已删除')
          }}
        >
          确定删除「{deleting.name}」？
          {deleting.collection === 'folders' && '文件夹中的素材将移回根目录。'}
        </Confirm>
      )}
      {preview && (
        <MediaPreview item={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  )
}
