import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Info, Link2, Pencil, Save, Trash2, X } from 'lucide-react'
import { iconMap } from '../flow/icons'
import type { PhaseInfo, WorkflowNode, WorkflowNodeData } from '../flow/types'

type DetailStyle = CSSProperties & {
  '--phase': string
  '--phase-soft': string
}

type Props = {
  node: WorkflowNode
  phase: PhaseInfo
  previous?: WorkflowNode
  next?: WorkflowNode
  editable?: boolean
  onClose: () => void
  onPrevious: () => void
  onNext: () => void
  onSaveNode?: (data: WorkflowNodeData) => void
  onDeleteNode?: () => void
}

type EditorDraft = {
  title: string
  subtitle: string
  summary: string
  chips: string
  inputs: string
  outputs: string
  note: string
}

const toLines = (value: string) =>
  value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

function toDraft(data: WorkflowNodeData): EditorDraft {
  return {
    title: data.title,
    subtitle: data.subtitle,
    summary: data.summary,
    chips: data.chips.join('\n'),
    inputs: data.inputs.join('\n'),
    outputs: data.outputs.join('\n'),
    note: data.note ?? '',
  }
}

function Section({
  title,
  children,
  variant = 'default',
}: {
  title: string
  children: ReactNode
  variant?: 'default' | 'steps' | 'checks' | 'chips' | 'ports'
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {variant === 'steps' ? (
        <ol className="detail-steps">{children}</ol>
      ) : variant === 'checks' ? (
        <ul className="detail-checks">{children}</ul>
      ) : variant === 'chips' ? (
        <div className="detail-tools">{children}</div>
      ) : variant === 'ports' ? (
        <ul className="detail-list detail-port-list">{children}</ul>
      ) : (
        <ul className="detail-list">{children}</ul>
      )}
    </section>
  )
}

export function DetailPanel({
  node,
  phase,
  previous,
  next,
  editable = false,
  onClose,
  onPrevious,
  onNext,
  onSaveNode,
  onDeleteNode,
}: Props) {
  const Icon = iconMap[node.data.icon]
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<EditorDraft>(() => toDraft(node.data))
  const style: DetailStyle = { '--phase': phase.color, '--phase-soft': phase.soft }

  useEffect(() => {
    setEditing(false)
    setDraft(toDraft(node.data))
  }, [node.id])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copied])

  async function copyLink() {
    const url = new URL(window.location.href)
    url.searchParams.set('node', node.id)
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
    } catch {
      window.prompt('复制这个节点链接', url.toString())
    }
  }

  function saveDraft() {
    if (!onSaveNode) return
    const inputs = toLines(draft.inputs)
    const outputs = toLines(draft.outputs)
    onSaveNode({
      ...node.data,
      title: draft.title.trim() || '未命名节点',
      subtitle: draft.subtitle.trim(),
      summary: draft.summary.trim(),
      chips: toLines(draft.chips),
      inputs: inputs.length ? inputs : ['待补充输入'],
      outputs: outputs.length ? outputs : ['待补充输出'],
      note: draft.note.trim() || undefined,
    })
    setEditing(false)
  }

  return (
    <aside className="detail-panel" style={style} aria-label={`${node.data.title}节点详情`}>
      <header className="detail-panel__head">
        <div className="detail-panel__eyebrow">
          <span className="detail-panel__step">{node.data.step}</span>
          <span>
            {phase.order} {phase.title} / {phase.en}
          </span>
          {editable && <span className="detail-copy-tag">副本 · 可编辑</span>}
          <button type="button" className="detail-close" onClick={onClose} aria-label="关闭节点详情">
            <X size={17} />
          </button>
        </div>

        <div className="detail-panel__title">
          <span className="detail-panel__icon" aria-hidden="true">
            <Icon size={20} strokeWidth={1.7} />
          </span>
          <div>
            <h2>{node.data.title}</h2>
            <p>{node.data.subtitle}</p>
          </div>
        </div>
        <p className="detail-panel__surface">{node.data.surface}</p>

        {editable && (
          <div className="detail-edit-actions">
            {editing ? (
              <>
                <button type="button" className="detail-edit-button" onClick={saveDraft}>
                  <Save size={12} />
                  保存修改
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(toDraft(node.data))
                    setEditing(false)
                  }}
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="detail-edit-button"
                  onClick={() => {
                    setDraft(toDraft(node.data))
                    setEditing(true)
                  }}
                >
                  <Pencil size={12} />
                  编辑节点
                </button>
                {onDeleteNode && (
                  <button type="button" className="detail-delete-button" onClick={onDeleteNode}>
                    <Trash2 size={12} />
                    删除节点
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </header>

      <div className="detail-panel__body">
        {editing ? (
          <div className="detail-editor">
            <p className="detail-editor__hint">
              仅修改当前编辑副本；原始流程保持只读。端口和标签每行一个。
            </p>
            <label>
              节点标题
              <input
                value={draft.title}
                maxLength={40}
                onChange={(event) => setDraft((state) => ({ ...state, title: event.target.value }))}
              />
            </label>
            <label>
              副标题
              <input
                value={draft.subtitle}
                maxLength={60}
                onChange={(event) => setDraft((state) => ({ ...state, subtitle: event.target.value }))}
              />
            </label>
            <label>
              节点说明
              <textarea
                rows={3}
                value={draft.summary}
                onChange={(event) => setDraft((state) => ({ ...state, summary: event.target.value }))}
              />
            </label>
            <div className="detail-editor__row">
              <label>
                输入端口（每行一个）
                <textarea
                  rows={4}
                  value={draft.inputs}
                  onChange={(event) => setDraft((state) => ({ ...state, inputs: event.target.value }))}
                />
              </label>
              <label>
                输出端口（每行一个）
                <textarea
                  rows={4}
                  value={draft.outputs}
                  onChange={(event) => setDraft((state) => ({ ...state, outputs: event.target.value }))}
                />
              </label>
            </div>
            <label>
              关键信息标签（每行一个）
              <textarea
                rows={2}
                value={draft.chips}
                onChange={(event) => setDraft((state) => ({ ...state, chips: event.target.value }))}
              />
            </label>
            <label>
              备注提示
              <textarea
                rows={2}
                value={draft.note}
                onChange={(event) => setDraft((state) => ({ ...state, note: event.target.value }))}
              />
            </label>
          </div>
        ) : (
          <>
            <p className="detail-lead">{node.data.summary}</p>

            {node.data.note && (
              <div className="detail-note">
                <Info size={15} />
                <span>{node.data.note}</span>
              </div>
            )}

            <Section
              title={`输入 · ${String(node.data.inputs.length).padStart(2, '0')} 个端口`}
              variant="ports"
            >
              {node.data.inputs.map((item, index) => (
                <li key={item}>
                  <span className="detail-port-key detail-port-key--in">
                    IN {String(index + 1).padStart(2, '0')}
                  </span>
                  {item}
                </li>
              ))}
            </Section>

            <Section title="执行动作" variant="steps">
              {node.data.actions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </Section>

            <Section
              title={`输出 · ${String(node.data.outputs.length).padStart(2, '0')} 个端口`}
              variant="ports"
            >
              {node.data.outputs.map((item, index) => (
                <li key={item}>
                  <span className="detail-port-key detail-port-key--out">
                    OUT {String(index + 1).padStart(2, '0')}
                  </span>
                  {item}
                </li>
              ))}
            </Section>

            <Section title="通过标准" variant="checks">
              {node.data.gates.map((item) => (
                <li key={item}>
                  <span className="check-dot" />
                  {item}
                </li>
              ))}
            </Section>

            <Section title="关联工具 / 文件" variant="chips">
              {node.data.tools.map((item) => (
                <code key={item}>{item}</code>
              ))}
            </Section>
          </>
        )}
      </div>

      <footer className="detail-panel__foot">
        <button type="button" onClick={onPrevious} disabled={!previous} aria-label="查看上一个节点">
          <ChevronLeft size={14} />
          上一步
        </button>
        <button type="button" className="detail-copy" onClick={copyLink}>
          <Link2 size={13} />
          {copied ? '已复制' : '复制链接'}
        </button>
        <button type="button" onClick={onNext} disabled={!next} aria-label="查看下一个节点">
          下一步
          <ChevronRight size={14} />
        </button>
      </footer>
    </aside>
  )
}
