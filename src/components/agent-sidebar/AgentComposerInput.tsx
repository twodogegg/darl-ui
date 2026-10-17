import { useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import type { AgentApplication, AgentSkill } from './types';

// References have a stable identifier; their visible label stays inside the sentence.
export const referencePattern = /\[([^\]]+)\]\((app|skill):([^\s)]+)\)/g;
function decodeId(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
export function referenceIds(value: string, kind: 'app' | 'skill') {
  return [...new Set(Array.from(value.matchAll(referencePattern)).filter((match) => match[2] === kind).map((match) => decodeId(match[3])))];
}
function read(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.reference) return node.dataset.reference;
  if (node.nodeName === 'BR') return '\n';
  const text = Array.from(node.childNodes).map(read).join('');
  return node.nodeType === Node.TEXT_NODE ? node.textContent || '' : text + (node.nodeName === 'DIV' ? '\n' : '');
}
export function AgentComposerInput({ value, onChange, onSubmit, insertion, onInserted, applications = [], skills = [] }: {
  applications?: AgentApplication[]; skills?: AgentSkill[];
  value: string; onChange: (value: string) => void; onSubmit: () => void;
  insertion: { token: string; key: number } | null; onInserted: () => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const caret = useRef<Range | null>(null);
  const lastValue = useRef('');
  const composing = useRef(false);
  const mentionRange = useRef<Range | null>(null);
  const [mention, setMention] = useState<{ query: string } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const options = [...applications.filter((item) => !item.status || item.status === 'connected').map((item) => ({ ...item, kind: 'app' as const })), ...skills.map((item) => ({ ...item, kind: 'skill' as const }))]
    .filter((item) => `${item.name} ${item.description ?? ''}`.toLowerCase().includes(mention?.query.toLowerCase() ?? ''));
  const detectMention = () => {
    if (composing.current) return;
    const selection = window.getSelection();
    if (!selection?.isCollapsed || !selection.rangeCount || !editor.current?.contains(selection.anchorNode)) { setMention(null); return; }
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest('[data-reference]')) { setMention(null); return; }
    const before = (node.textContent ?? '').slice(0, range.startOffset);
    const match = before.match(/(?:^|[^\w@])(@)([^\s@]*)$/);
    if (!match) { setMention(null); return; }
    const replacement = range.cloneRange();
    replacement.setStart(node, range.startOffset - match[2].length - 1);
    mentionRange.current = replacement;
    setMention({ query: match[2] }); setActiveIndex(0);
  };
  const sync = () => {
    const next = Array.from(editor.current!.childNodes).map(read).join('');
    lastValue.current = next; onChange(next); remember(); detectMention();
  };
  const remember = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.current?.contains(selection.anchorNode)) caret.current = selection.getRangeAt(0).cloneRange();
  };
  const nodes = (text: string) => {
    const fragment = document.createDocumentFragment(); let end = 0;
    for (const match of text.matchAll(referencePattern)) {
      fragment.append(text.slice(end, match.index));
      const span = document.createElement('span');
      span.contentEditable = 'false'; span.dataset.reference = match[0];
      span.className = `darl-agent-inline-reference darl-agent-inline-reference--${match[2]}`;
      span.textContent = `@${match[1]}`;
      fragment.append(span); end = match.index! + match[0].length;
    }
    if (text.slice(end)) fragment.append(text.slice(end)); return fragment;
  };
  useLayoutEffect(() => {
    if (lastValue.current !== value || !editor.current?.hasChildNodes()) {
      editor.current?.replaceChildren(nodes(value)); lastValue.current = value; caret.current = null;
    }
  }, [value]);
  const insertToken = (token: string, replacement: Range | null = caret.current) => {
    if (!editor.current) return;
    const element = editor.current;
    const range = replacement && element.contains(replacement.startContainer) ? replacement : document.createRange();
    if (range !== replacement) { range.selectNodeContents(element); range.collapse(false); }
    range.deleteContents(); const fragment = nodes(token); const tail = document.createTextNode(' '); fragment.append(tail); range.insertNode(fragment);
    range.setStartAfter(tail); range.collapse(true); element.focus();
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    remember(); sync(); setMention(null);
  };
  const deleteAdjacentReference = (key: 'Backspace' | 'Delete') => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed || !editor.current?.contains(selection.anchorNode)) return false;
    const range = selection.getRangeAt(0);
    const container = range.startContainer;
    const offset = range.startOffset;
    let adjacent: Node | null = null;
    if (container.nodeType === Node.TEXT_NODE) {
      if (key === 'Backspace' && offset === 0) adjacent = container.previousSibling;
      if (key === 'Delete' && offset === (container.textContent?.length ?? 0)) adjacent = container.nextSibling;
    } else {
      adjacent = container.childNodes[key === 'Backspace' ? offset - 1 : offset] ?? null;
    }
    if (!(adjacent instanceof HTMLElement) || !adjacent.dataset.reference || !adjacent.parentNode) return false;
    const parent = adjacent.parentNode;
    const index = Array.prototype.indexOf.call(parent.childNodes, adjacent) as number;
    parent.removeChild(adjacent);
    range.setStart(parent, index);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    sync();
    return true;
  };
  const choose = (index: number) => {
    const item = options[index];
    if (!item || !mention) return;
    insertToken(`[${item.name.replace(/[\[\]]/g, '')}](${item.kind}:${encodeURIComponent(item.id)})`, mentionRange.current);
  };
  useLayoutEffect(() => {
    if (!insertion) return;
    insertToken(insertion.token); onInserted();
  }, [insertion]);
  useLayoutEffect(() => {
    if (mention) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listId, mention]);
  return <div className="darl-agent-editor-shell"><div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label="输入消息" aria-multiline="true" aria-autocomplete="list" aria-expanded={Boolean(mention)} aria-controls={mention ? listId : undefined} aria-activedescendant={mention && options[activeIndex] ? `${listId}-${activeIndex}` : undefined} className="darl-agent-editor" data-placeholder="输入消息，@ 引用应用或 Skill…" onInput={sync} onCompositionStart={() => { composing.current = true; setMention(null); }} onCompositionEnd={() => { composing.current = false; sync(); }} onKeyUp={(event) => { remember(); if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) detectMention(); }} onMouseUp={() => { remember(); detectMention(); }} onBlur={() => { remember(); setMention(null); }} onPaste={(event) => {
    event.preventDefault(); const selection = window.getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); range.deleteContents(); const text = document.createTextNode(event.clipboardData.getData('text/plain')); range.insertNode(text); range.setStartAfter(text); range.collapse(true); remember(); sync();
  }} onKeyDown={(event) => {
    if (event.nativeEvent.isComposing || composing.current) return;
    if ((event.key === 'Backspace' || event.key === 'Delete') && deleteAdjacentReference(event.key)) { event.preventDefault(); setMention(null); return; }
    if (mention) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => options.length ? (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : 0); return; }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') { event.preventDefault(); choose(activeIndex); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMention(null); return; }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit(); }
  }} />{mention && <div className="darl-agent-mention-menu">
    <div className="darl-agent-mention-heading">@ 引用应用或 Skill</div>
    <div id={listId} role="listbox" aria-label="能力建议">
      {options.map((item, index) => <Button key={`${item.kind}:${item.id}`} variant="ghost" role="option" id={`${listId}-${index}`} aria-selected={activeIndex === index} className="darl-agent-mention-option" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}><span className={`darl-agent-inline-reference darl-agent-inline-reference--${item.kind}`}>@</span><span><strong>{item.name}</strong><small>{item.kind === 'app' ? '应用 · ' : 'Skill · '}{item.description}</small></span></Button>)}
      {!options.length && <p className="darl-agent-empty">没有匹配的应用或 Skill</p>}
    </div>
  </div>}</div>;
}
export function ReferenceText({ value }: { value: string }) {
  let end = 0; const parts = [];
  for (const match of value.matchAll(referencePattern)) {
    parts.push(value.slice(end, match.index));
    parts.push(<span className={`darl-agent-inline-reference darl-agent-inline-reference--${match[2]}`} key={match.index}>@{match[1]}</span>);
    end = match.index! + match[0].length;
  }
  parts.push(value.slice(end)); return <>{parts}</>;
}
