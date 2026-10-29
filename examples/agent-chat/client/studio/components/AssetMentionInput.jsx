import { imageUrl } from '../../image-url'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const MARKER = /<([^<>|]+)(?:\|([^<>]+))?>/g
const H3_REFERENCE = /^(?:Subject|Picture|Video|Audio) \d+$|^(?:d|\/d|scenetrans|cutoff)$/
const isH3Reference = value => H3_REFERENCE.test(value)

function protocolOf(candidate) {
  return `<${candidate.name}${candidate.variantName ? `|${candidate.variantName}` : ''}>`
}

function parse(value, candidates) {
  const byProtocol = new Map(candidates.map(candidate => [candidate.protocol || protocolOf(candidate), candidate]))
  const result = []
  let cursor = 0
  for (const match of String(value || '').matchAll(MARKER)) {
    if (match.index > cursor) result.push({ text: String(value).slice(cursor, match.index) })
    const protocol = match[0]
    if (isH3Reference(match[1])) {
      result.push({ protocol, h3: true, label: match[1] })
      cursor = match.index + protocol.length
      continue
    }
    const candidate = byProtocol.get(protocol)
    result.push({ protocol, candidate, label: candidate ? `@${candidate.name}${candidate.variantName ? ` · ${candidate.variantName}` : ''}` : `@${match[1]}${match[2] ? ` · ${match[2]}` : ''}` })
    cursor = match.index + protocol.length
  }
  if (cursor < String(value || '').length) result.push({ text: String(value).slice(cursor) })
  return result
}

function serialize(root) {
  if (!root) return ''
  const walk = node => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    if (node.dataset.protocol) return node.dataset.protocol
    return [...node.childNodes].map(walk).join('')
  }
  return [...root.childNodes].map(walk).join('')
}

function textBeforeCaret(root) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return ''
  const range = selection.getRangeAt(0).cloneRange()
  range.selectNodeContents(root)
  range.setEnd(selection.anchorNode, selection.anchorOffset)
  return range.toString()
}

function removeTextBeforeCaret(root, count) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !count) return false
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return false
  let node = range.startContainer
  let offset = range.startOffset
  while (count > 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const take = Math.min(count, offset)
      if (take) {
        const remove = document.createRange()
        remove.setStart(node, offset - take)
        remove.setEnd(node, offset)
        remove.deleteContents()
        count -= take
        offset -= take
      }
    }
    if (!count) break
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let previous = null
    while (walker.nextNode()) {
      if (walker.currentNode === node) break
      previous = walker.currentNode
    }
    if (!previous) break
    node = previous
    offset = node.nodeValue.length
  }
  const next = document.createRange()
  next.setStart(node, offset)
  next.collapse(true)
  selection.removeAllRanges()
  selection.addRange(next)
  return count === 0
}

function removeAdjacentMention(root, direction) {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.isCollapsed) return false
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return false
  let node = range.startContainer
  let offset = range.startOffset
  if (node.nodeType === Node.TEXT_NODE && ((direction === 'backward' && offset > 0) || (direction === 'forward' && offset < node.nodeValue.length))) return false
  if (node.nodeType === Node.TEXT_NODE) node = direction === 'backward' ? node.previousSibling : node.nextSibling
  else node = direction === 'backward' ? node.childNodes[offset - 1] : node.childNodes[offset]
  if (!(node instanceof HTMLElement) || !node.dataset.protocol) return false
  const parent = node.parentNode
  const index = [...parent.childNodes].indexOf(node)
  node.remove()
  const next = document.createRange()
  next.selectNodeContents(parent)
  next.collapse(direction === 'backward' ? false : true)
  const text = parent.childNodes[index - (direction === 'backward' ? 1 : 0)]
  if (text?.nodeType === Node.TEXT_NODE) {
    next.setStart(text, direction === 'backward' ? text.nodeValue.length : 0)
    next.collapse(true)
  }
  selection.removeAllRanges()
  selection.addRange(next)
  return true
}

function render(root, value, candidates) {
  if (!root) return
  root.replaceChildren()
  parse(value, candidates).forEach(part => {
    if (part.text !== undefined) root.appendChild(document.createTextNode(part.text))
    else {
      const chip = document.createElement('span')
      chip.className = `asset-mention-chip ${part.h3 ? 'asset-mention-chip--h3' : part.candidate ? `asset-mention-chip--${part.candidate.typeKey || 'asset'}` : 'asset-mention-chip--unknown'}`
      chip.dataset.protocol = part.protocol
      chip.contentEditable = 'false'
      chip.title = part.h3 ? 'H3 内部引用标签' : part.candidate ? `${part.candidate.type} · ${part.candidate.name}${part.candidate.variantName ? ` · ${part.candidate.variantName}` : ''}` : '无法解析的资产引用，请确认'
      if (part.candidate?.image) {
        const image = document.createElement('img')
        image.src = imageUrl(part.candidate.image, 160); image.loading = 'lazy'
        image.alt = ''
        chip.appendChild(image)
      }
      const label = document.createElement('span')
      label.textContent = part.label
      chip.appendChild(label)
      root.appendChild(chip)
    }
  })
}

function useMentionPreview() {
  const [preview, setPreview] = useState(null)
  useEffect(() => {
    const hide = () => setPreview(null)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => { window.removeEventListener('scroll', hide, true); window.removeEventListener('resize', hide) }
  }, [])
  const show = event => {
    const chip = event.target.closest('.asset-mention-chip')
    const img = chip?.querySelector('img')
    if (!img) return
    const rect = chip.getBoundingClientRect()
    const size = Math.min(220, window.innerWidth - 16, window.innerHeight - 16)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - size - 8))
    const top = rect.top >= size + 8 ? rect.top - size - 6 : Math.min(rect.bottom + 6, window.innerHeight - size - 8)
    setPreview({ src: img.src, left, top, size, root: chip.closest('.rn-studio') })
  }
  return { show, hide: () => setPreview(null), popup: preview && createPortal(<img className="asset-mention-preview" src={preview.src} alt="" style={{ left: preview.left, top: preview.top, width: preview.size, height: preview.size }} />, preview.root || document.body) }
}

export function MentionText({ value, candidates = [] }) {
  const preview = useMentionPreview()
  return <span className="asset-mention-text" onMouseOver={preview.show} onMouseOut={preview.hide}>{preview.popup}{parse(value, candidates).map((part, index) => part.text !== undefined
    ? <span key={index}>{part.text}</span>
    : <span key={index} className={`asset-mention-chip asset-mention-chip--inline ${part.h3 ? 'asset-mention-chip--h3' : part.candidate ? `asset-mention-chip--${part.candidate.typeKey || 'asset'}` : 'asset-mention-chip--unknown'}`} title={part.h3 ? 'H3 内部引用标签' : part.candidate ? `${part.candidate.type} · ${part.candidate.name}${part.candidate.variantName ? ` · ${part.candidate.variantName}` : ''}` : '无法解析的资产引用，请确认'}>{part.candidate?.image && <img loading="lazy" src={imageUrl(part.candidate.image, 160)} alt="" />}<span>{part.label}</span></span>)}</span>
}

export default function AssetMentionInput({ value = '', onChange, onBlur, candidates = [], multiline = true, label, placeholder = '输入文字，键入 @ 选择资产…', inputRef }) {
  const preview = useMentionPreview()
  const root = useRef(null)
  const attach = (element) => { root.current = element; if (typeof inputRef === 'function') inputRef(element); else if (inputRef) inputRef.current = element }
  const focused = useRef(false)
  const [menu, setMenu] = useState(null)
  const [selected, setSelected] = useState(0)
  const Tag = multiline ? 'div' : 'div'
  useEffect(() => {
    if (!focused.current) render(root.current, value, candidates)
  }, [value, candidates])
  const emit = () => onChange?.(serialize(root.current))
  const inspect = () => {
    const before = textBeforeCaret(root.current)
    const match = before.match(/(?:^|\s)@([^\s@<>]*)$/)
    if (!match) return setMenu(null)
    const query = match[1].toLowerCase()
    const filtered = candidates.filter(candidate => `${candidate.name} ${candidate.variantName || ''} ${candidate.type}`.toLowerCase().includes(query))
    setMenu(filtered.length ? { query, items: filtered } : null)
    setSelected(0)
  }
  const choose = candidate => {
    const query = menu?.query || ''
    removeTextBeforeCaret(root.current, query.length + 1)
    const selection = window.getSelection()
    const range = selection.getRangeAt(0)
    const chip = document.createElement('span')
    chip.className = `asset-mention-chip asset-mention-chip--${candidate.typeKey || 'asset'}`
    chip.dataset.protocol = candidate.protocol || protocolOf(candidate)
    chip.contentEditable = 'false'
    chip.title = `${candidate.type} · ${candidate.name}${candidate.variantName ? ` · ${candidate.variantName}` : ''}`
    if (candidate.image) { const image = document.createElement('img'); image.src = imageUrl(candidate.image, 160); image.loading = 'lazy'; image.alt = ''; chip.appendChild(image) }
    const text = document.createElement('span'); text.textContent = `@${candidate.name}${candidate.variantName ? ` · ${candidate.variantName}` : ''}`; chip.appendChild(text)
    range.insertNode(chip)
    const spacer = document.createTextNode(' ')
    chip.after(spacer)
    range.setStartAfter(spacer); range.collapse(true); selection.removeAllRanges(); selection.addRange(range)
    setMenu(null); emit()
  }
  const onKeyDown = event => {
    if (menu?.items.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + menu.items.length) % menu.items.length); return }
      if (event.key === 'Enter') { event.preventDefault(); choose(menu.items[selected]); return }
      if (event.key === 'Escape') { event.preventDefault(); setMenu(null); return }
    }
    if (event.key === 'Backspace' && removeAdjacentMention(root.current, 'backward')) { event.preventDefault(); emit() }
    if (event.key === 'Delete' && removeAdjacentMention(root.current, 'forward')) { event.preventDefault(); emit() }
  }
  return <div className="asset-mention-field" onMouseOver={preview.show} onMouseOut={preview.hide}>
    {preview.popup}
    {label && <span className="asset-mention-label">{label}</span>}
    <Tag ref={attach} className="asset-mention-editor" contentEditable suppressContentEditableWarning role="textbox" aria-label={label} data-placeholder={placeholder} onFocus={() => { focused.current = true }} onBlur={() => { setTimeout(() => setMenu(null), 120); focused.current = false; onBlur?.(serialize(root.current)) }} onInput={() => { emit(); inspect() }} onKeyDown={onKeyDown} />
    {menu && <div className="asset-mention-menu" role="listbox">{menu.items.map((candidate, index) => <span key={candidate.protocol || protocolOf(candidate)}>{(index === 0 || menu.items[index - 1].type !== candidate.type) && <strong className="asset-mention-group">{candidate.type === '图片' ? '参考图' : candidate.type}</strong>}<button className={index === selected ? 'active' : ''} role="option" aria-selected={index === selected} onMouseDown={event => { event.preventDefault(); choose(candidate) }}>{candidate.image && <img loading="lazy" src={imageUrl(candidate.image, 160)} alt="" />}<span><strong>@{candidate.name}{candidate.variantName ? ` · ${candidate.variantName}` : ''}</strong><small>{candidate.type}</small></span></button></span>)}</div>}
  </div>
}
