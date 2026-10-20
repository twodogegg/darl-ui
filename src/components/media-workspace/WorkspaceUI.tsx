import { useId, useRef, useState, type ReactNode } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button } from '../ui/Button';

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
export function Alert({ children }: { children: ReactNode }) { return <div className="darl-mw-alert" role="alert">{children}</div>; }
export function Badge({ children }: { children: ReactNode }) { return <span className="darl-mw-badge">{children}</span>; }
export function Empty({ title, children }: { title: string; children: ReactNode }) { return <div className="darl-mw-empty"><strong>{title}</strong><p>{children}</p></div>; }
