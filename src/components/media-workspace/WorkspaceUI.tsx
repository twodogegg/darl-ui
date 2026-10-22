import { useId, useRef, useState, type ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';
import { useDarlTheme } from '../../theme/DarlUIProvider';

/** shadcn/ui Radix composition, adapted to the library's standalone CSS. */
export function Popover({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false);
  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}><PopoverPrimitive.Trigger asChild><Button size="sm" variant="secondary" aria-label={label}>{trigger}</Button></PopoverPrimitive.Trigger><PopoverPrimitive.Content className="darl-mw-popover" side="top" align="start" sideOffset={10} collisionPadding={12} aria-label={label}><h3>{label}</h3>{typeof children === 'function' ? children(() => setOpen(false)) : children}</PopoverPrimitive.Content></PopoverPrimitive.Root>;
}
export function Choice({ label, value, choices, onChange, format = String, ariaLabel }: { label: string; value: string | number | undefined; choices: (string | number)[]; onChange: (value: string | number) => void; format?: (value: string | number) => string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const radioName = useId();
  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}><PopoverPrimitive.Trigger asChild><Button size="sm" variant="secondary" aria-label={ariaLabel || label}>{label} <b>{value === undefined ? '选择' : format(value)}</b></Button></PopoverPrimitive.Trigger><PopoverPrimitive.Content className="darl-mw-popover" side="top" align="start" sideOffset={10} collisionPadding={12} aria-label={label}><h3>{label}</h3><div className="darl-mw-choices" role="radiogroup" aria-label={label}>{choices.map((item) => <label key={item} className="darl-mw-choice" data-selected={item === value}><input type="radio" name={radioName} checked={item === value} onChange={() => { onChange(item); setOpen(false); }}/>{format(item)}</label>)}</div></PopoverPrimitive.Content></PopoverPrimitive.Root>;
}
export function Modal({ title, open, onOpenChange, children }: { title: string; open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const opener = useRef<HTMLElement | null>(null);
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Overlay className="darl-mw-overlay"/><DialogPrimitive.Content className="darl-mw-dialog" aria-describedby={undefined} onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement; }} onCloseAutoFocus={(event) => { event.preventDefault(); if (opener.current?.isConnected) opener.current.focus(); }}><div className="darl-mw-dialog-header"><DialogPrimitive.Title>{title}</DialogPrimitive.Title><DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="关闭">×</Button></DialogPrimitive.Close></div>{children}</DialogPrimitive.Content></DialogPrimitive.Root>;
}
/** Small anchored confirmation bubble. Replaces window.confirm for inline delete actions. */
export function ConfirmPopover({ label, message, confirmLabel = '删除', cancelLabel = '取消', onConfirm, trigger }: { label: string; message: ReactNode; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const theme = useDarlTheme();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirm = async () => {
    setBusy(true);
    try { await onConfirm(); setOpen(false); } catch { /* host surfaces its own error */ } finally { setBusy(false); }
  };
  return <PopoverPrimitive.Root open={open} onOpenChange={(next) => { if (!busy) setOpen(next); }}>
    <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content className="darl-mw-confirm" data-darl-theme={theme?.resolvedMode ?? 'light'} side="bottom" align="end" sideOffset={6} collisionPadding={12} aria-label={label} onOpenAutoFocus={(event) => { event.preventDefault(); confirmRef.current?.focus(); }} onCloseAutoFocus={(event) => event.preventDefault()}>
        <p className="darl-mw-confirm-text">{message}</p>
        <div className="darl-mw-confirm-actions">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen(false)}>{cancelLabel}</Button>
          <Button size="sm" className="darl-mw-confirm-danger" disabled={busy} onClick={() => void confirm()} ref={confirmRef}>{busy ? '删除中…' : confirmLabel}</Button>
        </div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}
export function Alert({ children }: { children: ReactNode }) { return <div className="darl-mw-alert" role="alert">{children}</div>; }
export function Badge({ children }: { children: ReactNode }) { return <span className="darl-mw-badge">{children}</span>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="darl-mw-empty"><strong>{title}</strong><p>{children}</p></div>; }

function ratioParts(value: string): [number, number] | undefined {
  const match = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(value);
  if (!match) return undefined;
  const w = Number(match[1]), h = Number(match[2]);
  return w > 0 && h > 0 ? [w, h] : undefined;
}
function RatioGlyph({ value }: { value: string }) {
  const parts = ratioParts(value);
  const w = parts?.[0] ?? 1, h = parts?.[1] ?? 1;
  const scale = 22 / Math.max(w, h);
  return <span className="darl-mw-ratio-glyph" aria-hidden="true"><i style={{ width: `${Math.max(7, Math.round(w * scale))}px`, height: `${Math.max(7, Math.round(h * scale))}px` }} /></span>;
}
function Segmented({ label, value, choices, onChange, format = String }: { label: string; value: string | number | undefined; choices: (string | number)[]; onChange: (value: string | number) => void; format?: (value: string | number) => string }) {
  return <div className="darl-mw-option-section"><h4>{label}</h4><div className="darl-mw-segmented" role="radiogroup" aria-label={label}>{choices.map((choice) => <button key={choice} type="button" role="radio" className="darl-mw-segment" aria-label={`${label} ${format(choice)}`} aria-checked={choice === value} data-selected={choice === value} onClick={() => onChange(choice)}>{format(choice)}</button>)}</div></div>;
}
/** Combined generation settings panel: quality, aspect ratio, duration, output count. */
export function OptionPanel({ label, summary, quality, ratio, duration, output, generation }: {
  label: string; summary: string;
  quality?: { values: string[]; value?: string; onChange: (value: string) => void };
  ratio?: { label?: string; values: string[]; value?: string; onChange: (value: string) => void };
  duration?: { values: number[]; value?: number; onChange: (value: number) => void };
  output?: { values: number[]; value?: number; onChange: (value: number) => void };
  generation: { values: number[]; value: number; onChange: (value: number) => void };
}) {
  const [open, setOpen] = useState(false);
  const theme = useDarlTheme();
  return <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
    <PopoverPrimitive.Trigger asChild><Button size="sm" variant="secondary" className="darl-mw-option-trigger" aria-label={label}>{summary}</Button></PopoverPrimitive.Trigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content className="darl-mw-option-panel" data-darl-theme={theme?.resolvedMode ?? 'light'} side="top" align="start" sideOffset={10} collisionPadding={12} aria-label={label}>
        {quality && <Segmented label="清晰度" value={quality.value} choices={quality.values} onChange={(next) => quality.onChange(String(next))} />}
        {ratio && <div className="darl-mw-option-section"><h4>{ratio.label ?? '比例'}</h4><div className="darl-mw-ratio-grid" role="radiogroup" aria-label={ratio.label ?? '比例'}>{ratio.values.map((choice) => <button key={choice} type="button" role="radio" className="darl-mw-ratio-card" aria-checked={choice === ratio.value} data-selected={choice === ratio.value} onClick={() => ratio.onChange(choice)}><RatioGlyph value={choice}/><span>{choice}</span></button>)}</div></div>}
        {duration && duration.values.length > 0 && <Segmented label="时长" value={duration.value} choices={duration.values} format={(next) => `${next}秒`} onChange={(next) => duration.onChange(Number(next))} />}
        {output && output.values.length > 0 && <Segmented label="单次输出" value={output.value} choices={output.values} format={(next) => `${next}张`} onChange={(next) => output.onChange(Number(next))} />}
        <Segmented label="生成数量" value={generation.value} choices={generation.values} format={(next) => `${next}张`} onChange={(next) => generation.onChange(Number(next))} />
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}
