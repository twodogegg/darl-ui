import { useState } from 'react'
import { useStore } from '../store'
import { promptGroups } from '../data'
import { Button, Field, Confirm } from '../components/ui'

export default function Prompts() {
  const { data, patch, notify } = useStore()
  const [group, setGroup] = useState(0)
  const [selected, setSelected] = useState('0-0')
  const [reset, setReset] = useState(false)
  const item = data.prompts.find((p) => p.id === selected)
  return (
    <div className="prompt-settings-page">
      <header className="prompt-settings-head">
        <h1>提示词设置</h1>
        <p>按创作流程管理当前网站使用的提示词。</p>
      </header>
      <nav className="prompt-stepper" aria-label="设置步骤">
        {promptGroups.map((g, i) => (
          <button
            className={`prompt-stepper-step ${group === i ? 'active' : ''}`}
            key={g.label}
            onClick={() => {
              setGroup(i)
              setSelected(`${i}-0`)
            }}
          >
            <i>{i + 1}</i>
            <strong>{g.label}</strong>
            <small>{g.names.length} 项</small>
          </button>
        ))}
      </nav>
      <div className="prompt-layout">
        <aside className="prompt-tabs">
          <p className="muted">提示词项</p>
          {data.prompts
            .filter((p) => p.group === group)
            .map((p) => (
              <button
                className={`prompt-tab ${selected === p.id ? 'active' : ''}`}
                key={p.id}
                onClick={() => setSelected(p.id)}
              >
                <span>
                  <strong>{p.name}</strong>
                  <small>查看默认内容或自定义替换</small>
                </span>
                <em>{p.mode === 'default' ? '默认' : '替换'}</em>
              </button>
            ))}
        </aside>
        {item && <PromptEditor
          key={item?.id || selected}
          item={item}
          onReset={() => setReset(true)}
        />}
      </div>
      {reset && (
        <Confirm
          title="恢复默认提示词"
          onClose={() => setReset(false)}
          onConfirm={() => {
            patch('prompts', item.id, { mode: 'default', text: '' })
            setReset(false)
            notify('已恢复默认提示词')
          }}
        >
          恢复「{item.name}」的默认内容？当前自定义内容将被清空。
        </Confirm>
      )}
    </div>
  )
}
function PromptEditor({ item, onReset }) {
  const { patch, notify } = useStore()
  const [mode, setMode] = useState(item.mode)
  const [text, setText] = useState(item.text)
  // The saved item can change after restoring defaults without changing selection.
  const [saved, setSaved] = useState(item)
  if ((saved.id !== item.id || saved._version !== item._version) && mode === saved.mode && text === saved.text) {
    setSaved(item)
    setMode(item.mode)
    setText(item.text)
  }
  return (
    <section className="prompt-editor">
      <header>
        <div>
          <h3>{item.name}</h3>
          <p>查看默认内容，或使用我的内容替换。</p>
        </div>
        <span className="badge">
          {item.mode === 'default' ? '默认' : '替换'}
        </span>
      </header>
      <Field label="提示词来源">
        <div className="prompt-modes">
          {[
            ['default', '使用系统提示词'],
            ['replace', '使用我的内容替换'],
          ].map(([value, label]) => (
            <label key={value} className={mode === value ? 'active' : ''}>
              <input
                type="radio"
                name="prompt-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              {label}
            </label>
          ))}
        </div>
      </Field>
      <Field label={mode === 'default' ? '系统提示词' : '我的内容'}>
        <textarea
          aria-label={mode === 'default' ? '系统提示词' : '我的内容'}
          className="prompt-textarea"
          readOnly={mode === 'default'}
          maxLength={5000}
          value={mode === 'default' ? item.defaultText : text}
          onChange={(e) => setText(e.target.value)}
          rows={16}
          placeholder="输入自定义内容…"
        />
      </Field>
      <p className="muted">
        {mode === 'default'
          ? '默认内容仅供查看；选择替换后可编辑。'
          : `替换模式：最终内容 = 我的内容，最多 5000 字（${text.length}/5000）`}
      </p>
      <div className="prompt-actions">
        <Button onClick={onReset}>恢复默认</Button>
        <Button
          primary
          disabled={mode === item.mode && text === item.text}
          onClick={() => {
            if (saved._version !== item._version) return notify('提示词已被其他操作修改，当前草稿已保留，请核对后重新打开')
            if (mode === 'replace' && !text.trim())
              return notify('请输入自定义提示词')
            setSaved({ ...item, mode, text, _version: item._version + 1 })
            patch('prompts', item.id, { mode, text })
            notify('提示词已保存，下次创作时生效')
          }}
        >
          保存
        </Button>
      </div>
    </section>
  )
}
