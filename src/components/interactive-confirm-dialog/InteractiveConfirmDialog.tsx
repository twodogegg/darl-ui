import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, X } from 'lucide-react';
import { Button, type ButtonProps } from '../ui/Button';
import { readableForeground, useDarlTheme } from '../../theme/DarlUIProvider';
import './interactive-confirm-dialog.css';

export type ConfirmAnswer = string | string[];
export type ConfirmAnswers = Record<string, ConfirmAnswer>;
export interface ConfirmOption { value: string; label: string; description?: string; disabled?: boolean }
export interface ConfirmQuestion {
  id: string;
  label: string;
  type: 'single' | 'multiple' | 'text' | 'textarea';
  description?: string;
  options?: ConfirmOption[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: ConfirmAnswer;
}
export interface InteractiveConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  questions: ConfirmQuestion[];
  /** Optional read-only action details. */
  details?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Button variant for the optional cancel action. */
  cancelVariant?: ButtonProps['variant'];
  showCancel?: boolean;
  onConfirm: (answers: ConfirmAnswers) => void | Promise<void>;
  onCancel?: () => void;
  accentColor?: string;
  className?: string;
}

function startingAnswers(questions: ConfirmQuestion[]): ConfirmAnswers {
  return Object.fromEntries(questions.map((question) => {
    const choices = question.options?.filter((option) => !option.disabled).map((option) => option.value) ?? [];
    const initial = question.defaultValue;
    if (question.type === 'multiple') {
      return [question.id, Array.isArray(initial) ? initial.filter((value) => choices.includes(value)) : []];
    }
    return [question.id, typeof initial === 'string' && (question.type === 'text' || question.type === 'textarea' || choices.includes(initial)) ? initial : ''];
  }));
}

export function InteractiveConfirmDialog({
  open, onOpenChange, title, description, questions, details, confirmText = '确认', cancelText = '取消',
  cancelVariant = 'outline', showCancel = false, onConfirm, onCancel, accentColor, className = '',
}: InteractiveConfirmDialogProps) {
  const headingId = useId();
  const theme = useDarlTheme();
  const [answers, setAnswers] = useState<ConfirmAnswers>(() => startingAnswers(questions));
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const busy = useRef(false);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setAnswers(startingAnswers(questions));
      setError('');
      setInvalid([]);
    }
    wasOpen.current = open;
  }, [open, questions]);

  const setAnswer = (id: string, value: ConfirmAnswer) => {
    setAnswers((previous) => ({ ...previous, [id]: value }));
    setInvalid((previous) => previous.filter((item) => item !== id));
    setError('');
  };

  const requestOpen = (next: boolean) => {
    if (busy.current) return;
    if (!next) onCancel?.();
    onOpenChange(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy.current) return;
    const missing = questions.filter((question) => {
      if (!question.required) return false;
      const value = answers[question.id];
      return Array.isArray(value) ? value.length === 0 : !value?.trim();
    }).map((question) => question.id);
    setInvalid(missing);
    if (missing.length) {
      setError('请完成所有必填问题');
      return;
    }
    busy.current = true;
    setSubmitting(true);
    setError('');
    try {
      const result: ConfirmAnswers = {};
      for (const question of questions) {
        const value = answers[question.id];
        result[question.id] = Array.isArray(value) ? [...value] : value ?? '';
      }
      await onConfirm(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提交失败，请重试');
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  const vars = {
    '--darl-confirm-accent': accentColor ?? theme?.theme.primaryColor ?? (theme?.resolvedMode === 'dark' ? '#f1f5f9' : '#18181b'),
    '--darl-confirm-accent-foreground': readableForeground(accentColor ?? theme?.theme.primaryColor ?? (theme?.resolvedMode === 'dark' ? '#f1f5f9' : '#18181b')),
    ...(theme?.theme.radius !== undefined ? { '--darl-radius': theme.theme.radius + 'px' } : {}),
    ...(theme?.resolvedMode === 'dark' ? { '--darl-confirm-bg': '#111827', '--darl-confirm-text': '#f1f5f9', '--darl-confirm-muted': '#94a3b8', '--darl-confirm-border': '#344155' } : {}),
  } as CSSProperties;

  return <Dialog.Root open={open} onOpenChange={requestOpen}>
    <Dialog.Portal>
      <Dialog.Overlay className="darl-confirm-overlay" />
      <Dialog.Content
        aria-describedby={description ? undefined : headingId}
        className={['darl-confirm-dialog', theme?.resolvedMode === 'dark' ? 'darl-confirm-dark' : '', className].filter(Boolean).join(' ')}
        style={vars}
      >
        <div className="darl-confirm-header">
          <Dialog.Title className="darl-confirm-title">{title}</Dialog.Title>
          {description ? <Dialog.Description className="darl-confirm-description">{description}</Dialog.Description> : <span id={headingId} className="darl-confirm-sr">请完成以下确认问题</span>}
          <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="关闭弹窗" disabled={submitting}><X size={18} /></Button></Dialog.Close>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="darl-confirm-questions">
            {details && <div className="darl-action-confirm-details">{details}</div>}
            {questions.map((question) => {
              const value = answers[question.id];
              const hasError = invalid.includes(question.id);
              return <fieldset key={question.id} className="darl-confirm-question" aria-invalid={hasError}>
                <legend>{question.label}{question.required && <span className="darl-confirm-required" aria-label="必填"> *</span>}</legend>
                {question.description && <p className="darl-confirm-hint">{question.description}</p>}
                {question.type === 'single' || question.type === 'multiple'
                  ? <div className="darl-confirm-options">{(question.options ?? []).map((option) => {
                    const checked = Array.isArray(value) ? value.includes(option.value) : value === option.value;
                    return <label key={option.value} className="darl-confirm-option">
                      <input type={question.type === 'single' ? 'radio' : 'checkbox'} name={question.id}
                        value={option.value} checked={checked} disabled={submitting || option.disabled}
                        onChange={() => {
                          if (question.type === 'single') setAnswer(question.id, option.value);
                          else {
                            const selected = Array.isArray(value) ? value : [];
                            setAnswer(question.id, checked ? selected.filter((item) => item !== option.value) : [...selected, option.value]);
                          }
                        }} />
                      <span className="darl-confirm-option-text">{option.label}{option.description && <small>{option.description}</small>}</span>
                    </label>;
                  })}</div>
                  : question.type === 'text' ? <input className="darl-confirm-input" type="text" placeholder={question.placeholder} disabled={submitting}
                    aria-label={question.label} value={typeof value === 'string' ? value : ''} onChange={(e) => setAnswer(question.id, e.target.value)} />
                  : <textarea className="darl-confirm-input darl-confirm-textarea" placeholder={question.placeholder} disabled={submitting}
                    aria-label={question.label} rows={3} value={typeof value === 'string' ? value : ''} onChange={(e) => setAnswer(question.id, e.target.value)} />}
                {hasError && <p className="darl-confirm-field-error">此问题为必填项</p>}
              </fieldset>;
            })}
          </div>
          <div className="darl-confirm-footer">
            {error && <p role="alert" className="darl-confirm-error">{error}</p>}
            <div className="darl-confirm-actions">
              {showCancel && <Button variant={cancelVariant} type="button" onClick={() => requestOpen(false)} disabled={submitting}>{cancelText}</Button>}
              <Button type="submit" disabled={submitting}>{submitting ? '提交中…' : confirmText}{!submitting && <ArrowRight size={16} aria-hidden="true" />}</Button>
            </div>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
