import { useLayoutEffect, useRef } from 'react';

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
export function AgentComposerInput({ value, onChange, onSubmit, insertion, onInserted }: {
  value: string; onChange: (value: string) => void; onSubmit: () => void;
  insertion: { token: string; key: number } | null; onInserted: () => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const caret = useRef<Range | null>(null);
  const lastValue = useRef('');
  const sync = () => {
    const next = Array.from(editor.current!.childNodes).map(read).join('');
    lastValue.current = next; onChange(next);
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
      span.className = 'darl-agent-inline-reference';
      span.textContent = `${match[2] === 'app' ? '◈' : '◇'} ${match[1]}`;
      fragment.append(span); end = match.index! + match[0].length;
    }
    if (text.slice(end)) fragment.append(text.slice(end)); return fragment;
  };
  useLayoutEffect(() => {
    if (lastValue.current !== value || !editor.current?.hasChildNodes()) {
      editor.current?.replaceChildren(nodes(value)); lastValue.current = value; caret.current = null;
    }
  }, [value]);
  useLayoutEffect(() => {
    if (!insertion || !editor.current) return;
    const element = editor.current;
    const range = caret.current && element.contains(caret.current.startContainer) ? caret.current : document.createRange();
    if (range !== caret.current) { range.selectNodeContents(element); range.collapse(false); }
    range.deleteContents(); const fragment = nodes(insertion.token); const tail = document.createTextNode(' '); fragment.append(tail); range.insertNode(fragment);
    range.setStartAfter(tail); range.collapse(true); element.focus();
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    remember(); sync(); onInserted();
  }, [insertion]);
  return <div ref={editor} contentEditable suppressContentEditableWarning role="textbox" aria-label="输入消息" aria-multiline="true" className="darl-agent-editor" data-placeholder="输入消息，选择应用或 Skill 插入引用…" onInput={sync} onKeyUp={remember} onMouseUp={remember} onBlur={remember} onPaste={(event) => {
    event.preventDefault(); const selection = window.getSelection(); if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0); range.deleteContents(); const text = document.createTextNode(event.clipboardData.getData('text/plain')); range.insertNode(text); range.setStartAfter(text); range.collapse(true); remember(); sync();
  }} onKeyDown={(event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmit(); }
  }} />;
}
export function ReferenceText({ value }: { value: string }) {
  let end = 0; const parts = [];
  for (const match of value.matchAll(referencePattern)) {
    parts.push(value.slice(end, match.index));
    parts.push(<span className="darl-agent-inline-reference" key={match.index}>{match[2] === 'app' ? '◈' : '◇'} {match[1]}</span>);
    end = match.index! + match[0].length;
  }
  parts.push(value.slice(end)); return <>{parts}</>;
}
