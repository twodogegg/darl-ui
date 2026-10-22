import { useState } from 'react'
import { Button, Field, Modal } from './ui'
import { id } from '../data'
import { useStore } from '../store'

export default function DialogueEditor({ shot, characters, onClose, onSave }) {
  const [lines, setLines] = useState(() => structuredClone(shot.dialogue))
  const { notify } = useStore()
  const [version] = useState(shot._version)
  const change = (index, values) => setLines((old) => old.map((line, i) => i === index ? { ...line, ...values } : line))
  function save() {
    if (shot._version !== version) return notify('镜头已被其他操作修改，当前台词草稿已保留，请核对后重新打开')
    if (lines.some((line) => !line.text.trim() || (line.type === '角色' && !characters.some((asset) => asset.id === line.assetId)))) return notify('请选择角色资产并填写台词，空记录请删除')
    onSave(lines.map((line) => ({ ...line, speaker: line.type === '旁白' ? '旁白' : characters.find((asset) => asset.id === line.assetId).name, description: line.description.trim(), text: line.text.trim() })))
  }
  function move(index, offset) {
    setLines((old) => { const next = [...old]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; return next })
  }
  return (
    <Modal title="台词/对白" wide onClose={onClose} footer={<><Button onClick={onClose}>取消</Button><Button primary onClick={save}>保存台词</Button></>}>
      <p className="muted">按发声顺序记录：谁说、怎么说、说什么。没有台词时留空。</p>
      <div className="dialogue-records">
        {lines.map((line, index) => (
          <div className="panel" key={line.id}>
            <div className="row"><strong>发声 {index + 1}</strong><Button aria-label={`删除发声${index + 1}`} onClick={() => setLines((old) => old.filter((item) => item.id !== line.id))}>删除</Button></div>
            <div className="dialogue-fields">
              <Field label={`发声类型 ${index + 1}`}><select value={line.type} onChange={(e) => change(index, { type: e.target.value, assetId: '', speaker: '' })}><option>角色</option><option>旁白</option></select></Field>
              {line.type === '角色' && <Field label={`角色 ${index + 1}`}><select value={line.assetId || ''} onChange={(e) => change(index, { assetId: e.target.value, speaker: characters.find((asset) => asset.id === e.target.value)?.name || '' })}><option value="">选择角色资产</option>{characters.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></Field>}
            </div>
            {line.type === '角色' && !characters.length && <p className="muted">暂无角色资产，请先在美术资产中添加角色。</p>}
            <Field label={`描述 ${index + 1}（怎么说）`}><input value={line.description} maxLength={1000} placeholder="如：压低声音，带着试探；未指定可留空" onChange={(e) => change(index, { description: e.target.value })} /></Field>
            <Field label={`台词 ${index + 1}（说什么）`}><textarea rows={3} maxLength={10000} value={line.text} placeholder="只写实际说出的文字" onChange={(e) => change(index, { text: e.target.value })} /></Field>
            <div className="toolbar"><Button disabled={!index} onClick={() => move(index, -1)}>上移</Button><Button disabled={index === lines.length - 1} onClick={() => move(index, 1)}>下移</Button></div>
          </div>
        ))}
        {!lines.length && <p className="muted">本镜无台词</p>}
        <Button onClick={() => setLines((old) => [...old, { id: id(), speaker: '', assetId: '', type: '角色', description: '', text: '' }])}>＋ 添加发声</Button>
      </div>
    </Modal>
  )
}
