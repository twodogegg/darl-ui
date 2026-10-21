import { useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Hand, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Button } from '../ui/Button';
import type { AgentApprovalMode } from './types';

const modes = [
  { value: 'ask', label: '请求批准', description: '文件写入、命令和外部写操作执行前询问', icon: Hand },
  { value: 'auto', label: '帮我批准', description: '自动批准低风险操作，其余操作仍询问', icon: ShieldCheck },
  { value: 'full', label: '完全访问', description: '当前工具权限内直接执行，包括付费和危险操作', icon: ShieldAlert },
] as const;

export interface ApprovalModeSelectorProps {
  value: AgentApprovalMode;
  onChange: (mode: AgentApprovalMode) => void | Promise<void>;
  disabled?: boolean;
}

export function ApprovalModeSelector({ value, onChange, disabled }: ApprovalModeSelectorProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const name = useId();
  const selectedInput = useRef<HTMLInputElement>(null);
  const selected = modes.find(mode => mode.value === value) || modes[0];
  const Icon = selected.icon;
  const choose = async (mode: AgentApprovalMode) => {
    setSaving(true); setError('');
    try { await onChange(mode); setOpen(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '保存审批模式失败'); }
    finally { setSaving(false); }
  };
  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><Button variant="ghost" size="sm" className="darl-agent-approval-trigger" data-mode={value} aria-label={`审批模式：${selected.label}`} disabled={disabled || saving}><Icon data-icon="inline-start" /><span>{selected.label}</span><ChevronDown data-icon="inline-end" /></Button></Popover.Trigger>
    <Popover.Content className="darl-agent-approval-menu" side="top" align="start" sideOffset={8} collisionPadding={12} aria-label="审批模式" onOpenAutoFocus={event => { event.preventDefault(); selectedInput.current?.focus(); }}>
      <fieldset disabled={disabled || saving}><legend>应如何批准 Agent 操作？</legend>{modes.map(({ value: mode, label, description, icon: ModeIcon }) => <label key={mode} className="darl-agent-approval-option" data-mode={mode} data-selected={mode === value}>
        <input ref={mode === value ? selectedInput : undefined} type="radio" name={name} value={mode} checked={mode === value} onChange={() => void choose(mode)} />
        <ModeIcon aria-hidden="true" /><span><strong>{label}</strong><small>{description}</small></span>{mode === value && <Check aria-hidden="true" />}
      </label>)}</fieldset>
      <p>应用于所有对话及子 Agent，从下一轮请求生效。命令在本机执行，审批模式不提供沙箱隔离。</p>
      {error && <p role="alert">{error}</p>}
    </Popover.Content>
  </Popover.Root>;
}
