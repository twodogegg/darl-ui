import { useEffect, useId, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { readableForeground } from '../../theme/DarlUIProvider';
import './default-model-selector.css';

export type DefaultModelKind = 'text' | 'image' | 'audio' | 'video';

export interface DefaultModelOption {
  id: string;
  name: string;
  type: DefaultModelKind;
  description?: string;
  capabilities?: {
    resolutions?: string[];
    aspectRatios?: string[];
  };
  defaults?: {
    resolution?: string;
    aspectRatio?: string;
  };
}

export interface DefaultModelChoice {
  modelId: string;
  resolution?: string;
  aspectRatio?: string;
}

export type DefaultModelDraft = Partial<Record<DefaultModelKind, DefaultModelChoice>>;
export type DefaultModelSelection = Record<DefaultModelKind, DefaultModelChoice>;

export interface DefaultModelSelectorProps {
  /** Models and their capabilities are supplied and may be replaced by the host. */
  models: DefaultModelOption[];
  /** Restrict the wizard to the supplied model types. Defaults to all four types. */
  kinds?: DefaultModelKind[];
  /** When provided, render the selector as a modal dialog. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controlled selection. When supplied, onChange must update value. */
  value?: DefaultModelDraft;
  /** Uncontrolled initial selection, useful for editing previously saved defaults. */
  defaultValue?: DefaultModelDraft;
  onChange?: (selection: DefaultModelDraft) => void;
  /** Called only after every configured type has an available model. The host persists the result. */
  onComplete: (selection: DefaultModelSelection) => void | Promise<void>;
  accentColor?: string;
  className?: string;
}

const STEPS: { kind: DefaultModelKind; title: string; description: string }[] = [
  { kind: 'text', title: '文本', description: '设置默认文本生成模型' },
  { kind: 'image', title: '图片', description: '设置默认图片模型、分辨率和画幅比例' },
  { kind: 'audio', title: '音频', description: '设置默认音频生成模型' },
  { kind: 'video', title: '视频', description: '设置默认视频模型、分辨率和画幅比例' },
];
const RATIOS = ['3:4', '4:3', '16:9', '9:16'];
const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'];
const VIDEO_RESOLUTIONS = ['480P', '720P', '1080P'];
const ALL_KINDS = STEPS.map(({ kind }) => kind);

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => typeof value === 'string' && value.trim())));
}

export function modelOptions(model: DefaultModelOption, field: 'resolutions' | 'aspectRatios'): string[] {
  if (model.type !== 'image' && model.type !== 'video') return [];
  if (field === 'aspectRatios') {
    const configured = model.capabilities?.aspectRatios ?? RATIOS;
    return unique(configured).filter((ratio) => RATIOS.includes(ratio));
  }
  return unique(model.capabilities?.resolutions ?? (model.type === 'image' ? IMAGE_RESOLUTIONS : VIDEO_RESOLUTIONS));
}

function optionOrDefault(options: string[], candidate: string | undefined, modelDefault: string | undefined, fallback: string): string | undefined {
  const find = (value: string | undefined) => options.find((option) => option.toLowerCase() === value?.toLowerCase());
  return find(candidate) ?? find(modelDefault) ?? find(fallback) ?? options[0];
}

export function normalizeDefaultModels(models: DefaultModelOption[], draft: DefaultModelDraft = {}, kinds: DefaultModelKind[] = ALL_KINDS): DefaultModelDraft {
  const result: DefaultModelDraft = {};
  for (const { kind } of STEPS.filter((step) => kinds.includes(step.kind))) {
    const options = models.filter((model) => model.type === kind);
    const previous = draft[kind];
    const model = options.find((entry) => entry.id === previous?.modelId) ?? options[0];
    if (!model) continue;
    const choice: DefaultModelChoice = { modelId: model.id };
    if (kind === 'image' || kind === 'video') {
      const resolutions = modelOptions(model, 'resolutions');
      const ratios = modelOptions(model, 'aspectRatios');
      choice.resolution = optionOrDefault(resolutions, previous?.modelId === model.id ? previous.resolution : undefined, model.defaults?.resolution, kind === 'image' ? '2K' : '720P');
      choice.aspectRatio = optionOrDefault(ratios, previous?.modelId === model.id ? previous.aspectRatio : undefined, model.defaults?.aspectRatio, '9:16');
      if (choice.resolution === undefined) delete choice.resolution;
      if (choice.aspectRatio === undefined) delete choice.aspectRatio;
    }
    result[kind] = choice;
  }
  return result;
}

/** Host-configured selector. Only navigation and Finish are buttons. */
export function DefaultModelSelector({
  models, kinds = ALL_KINDS, open, onOpenChange, value, defaultValue, onChange, onComplete, accentColor, className = '',
}: DefaultModelSelectorProps) {
  const id = useId();
  const [step, setStep] = useState(0);
  const [localDraft, setLocalDraft] = useState<DefaultModelDraft>(defaultValue ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const steps = STEPS.filter((item) => kinds.includes(item.kind));
  const selection = normalizeDefaultModels(models, value ?? localDraft, kinds);
  const current = steps[step] ?? steps[0] ?? STEPS[0];
  const candidates = models.filter((item) => item.type === current.kind);
  const selected = selection[current.kind];
  const model = candidates.find((item) => item.id === selected?.modelId);
  const complete = steps.length > 0 && steps.every(({ kind }) => Boolean(selection[kind]?.modelId));
  const modal = open !== undefined;
  const style = accentColor ? {
    '--darl-default-accent': accentColor,
    '--darl-default-accent-text': readableForeground(accentColor),
  } as CSSProperties : undefined;

  const change = (kind: DefaultModelKind, next: DefaultModelChoice) => {
    const updated = { ...selection, [kind]: next };
    if (value === undefined) setLocalDraft(updated);
    onChange?.(updated);
    setError('');
  };

  const finish = async () => {
    if (!complete || saving) return;
    setSaving(true);
    setError('');
    try {
      await onComplete(selection as DefaultModelSelection);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const close = () => onOpenChange?.(false);

  useEffect(() => {
    setStep((index) => Math.min(index, Math.max(0, steps.length - 1)));
  }, [steps.length]);

  useEffect(() => {
    if (!modal || !open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [modal, open, saving]);

  if (open === false) return null;

  const content = <section className={'darl-default-model-selector ' + className} style={style} aria-label={!modal ? '默认模型配置' : undefined}>
    <header className="darl-default-header">
      <div className="darl-default-header-copy">
        <span className="darl-default-eyebrow">默认模型设置</span>
        <h2 id={modal ? `${id}-title` : undefined}>选择你的创作模型</h2>
        <p>依次为{steps.map(({ title }) => title).join('、')}设置默认模型。</p>
      </div>
      {modal && <Button variant="ghost" size="icon" className="darl-default-close" onClick={close} disabled={saving} aria-label="关闭默认模型选择"><X aria-hidden="true" /></Button>}
      <ol className="darl-default-steps" aria-label="设置进度">
        {steps.map((item, index) => <li key={item.kind} aria-current={index === step ? 'step' : undefined} className={index === step ? 'is-current' : index < step ? 'is-past' : ''}>
          <span className="darl-default-step-number">{index < step ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
          <span>{item.title}</span>
        </li>)}
      </ol>
    </header>

    <div className="darl-default-content">
      <div className="darl-default-heading">
        <span>步骤 {step + 1} / {steps.length}</span>
        <h3>{current.title}模型</h3>
        <p>{current.description}</p>
      </div>

      <fieldset className="darl-default-fieldset" disabled={saving}>
        <legend>选择{current.title}模型</legend>
        {candidates.length ? <label className="darl-default-select-wrap">
          <select aria-label={`选择${current.title}模型`} value={selected?.modelId ?? ''} onChange={(event) => {
            const next = candidates.find((item) => item.id === event.target.value);
            if (next) change(current.kind, { modelId: next.id });
          }}>
            {candidates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <span aria-hidden="true">⌄</span>
        </label> : <p role="alert" className="darl-default-empty">未提供{current.title}模型。请由网站传入至少一个可用模型。</p>}
        {model && <p className="darl-default-selected-description">{model.description || model.id}</p>}
      </fieldset>

      {model && (current.kind === 'image' || current.kind === 'video') && <div className="darl-default-options">
        {(['resolutions', 'aspectRatios'] as const).map((field) => {
          const options = modelOptions(model, field);
          if (!options.length) return null;
          const key = field === 'resolutions' ? 'resolution' : 'aspectRatio';
          const title = field === 'resolutions' ? '默认分辨率' : '默认画幅比例';
          return <fieldset key={field} className="darl-default-fieldset" disabled={saving}>
            <legend>{title}</legend>
            <div className="darl-default-chips">
              {options.map((option) => <label key={option} className="darl-default-chip">
                <input type="radio" name={id + '-' + current.kind + '-' + field} value={option}
                  checked={selected?.[key] === option}
                  onChange={() => change(current.kind, { ...selected!, [key]: option })} />
                <span>{option}</span>
              </label>)}
            </div>
          </fieldset>;
        })}
      </div>}

      {error && <p className="darl-default-error" role="alert">{error}</p>}
    </div>

    <footer className={`darl-default-footer ${step > 0 ? 'has-back' : 'first-step'}`}>
      {step > 0 && <Button variant="outline" className="darl-default-nav" disabled={saving}
        onClick={() => { setStep((index) => Math.max(0, index - 1)); setError(''); }}>
        <ArrowLeft size={16} aria-hidden="true" /> 上一步
      </Button>}
      {step === steps.length - 1 ? <Button className="darl-default-nav" disabled={!complete || saving} onClick={finish}>
        {saving ? '保存中…' : '完成'} <Check size={16} aria-hidden="true" />
      </Button> : <Button className="darl-default-nav" disabled={!selected || saving}
        onClick={() => { setStep((index) => Math.min(steps.length - 1, index + 1)); setError(''); }}>
        下一步 <ArrowRight size={16} aria-hidden="true" />
      </Button>}
    </footer>
  </section>;

  if (!modal) return content;
  return <section className="darl-default-modal" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}
    onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) close(); }}>
    <div className="darl-default-modal-panel">{content}</div>
  </section>;
}
