import { useId, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
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
  /** Controlled selection. When supplied, onChange must update value. */
  value?: DefaultModelDraft;
  /** Uncontrolled initial selection, useful for editing previously saved defaults. */
  defaultValue?: DefaultModelDraft;
  onChange?: (selection: DefaultModelDraft) => void;
  /** Called only after all four types have an available model. The host persists the result. */
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

export function normalizeDefaultModels(models: DefaultModelOption[], draft: DefaultModelDraft = {}): DefaultModelDraft {
  const result: DefaultModelDraft = {};
  for (const { kind } of STEPS) {
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

/** Four-step, host-configured selector. Only navigation and Finish are buttons. */
export function DefaultModelSelector({
  models, value, defaultValue, onChange, onComplete, accentColor, className = '',
}: DefaultModelSelectorProps) {
  const id = useId();
  const [step, setStep] = useState(0);
  const [localDraft, setLocalDraft] = useState<DefaultModelDraft>(defaultValue ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selection = normalizeDefaultModels(models, value ?? localDraft);
  const current = STEPS[step];
  const candidates = models.filter((item) => item.type === current.kind);
  const selected = selection[current.kind];
  const model = candidates.find((item) => item.id === selected?.modelId);
  const complete = STEPS.every(({ kind }) => Boolean(selection[kind]?.modelId));
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

  return <section className={'darl-default-model-selector ' + className} style={style} aria-label="默认模型配置">
    <header className="darl-default-header">
      <span className="darl-default-eyebrow">默认模型设置</span>
      <h2>选择你的创作模型</h2>
      <p>依次为文本、图片、音频和视频设置默认模型。</p>
      <ol className="darl-default-steps" aria-label="设置进度">
        {STEPS.map((item, index) => <li key={item.kind} aria-current={index === step ? 'step' : undefined} className={index === step ? 'is-current' : index < step ? 'is-past' : ''}>
          <span className="darl-default-step-number">{index < step ? <Check size={13} aria-hidden="true" /> : index + 1}</span>
          <span>{item.title}</span>
        </li>)}
      </ol>
    </header>

    <div className="darl-default-content">
      <div className="darl-default-heading">
        <span>步骤 {step + 1} / 4</span>
        <h3>{current.title}模型</h3>
        <p>{current.description}</p>
      </div>

      <fieldset className="darl-default-fieldset" disabled={saving}>
        <legend>选择{current.title}模型</legend>
        {candidates.length ? <div className="darl-default-models">
          {candidates.map((item) => <label key={item.id} className="darl-default-model-card">
            <input type="radio" name={id + '-model-' + current.kind} value={item.id}
              checked={selected?.modelId === item.id}
              onChange={() => change(current.kind, { modelId: item.id })} />
            <span className="darl-default-model-copy"><strong>{item.name}</strong><small>{item.description || item.id}</small></span>
            <span className="darl-default-radio-dot" aria-hidden="true" />
          </label>)}
        </div> : <p role="alert" className="darl-default-empty">未提供{current.title}模型。请由网站传入至少一个可用模型。</p>}
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

      {step === 3 && <aside className="darl-default-summary" aria-label="当前默认配置">
        <h4>当前默认配置</h4>
        {STEPS.map((item) => {
          const picked = selection[item.kind];
          const matched = models.find((option) => option.type === item.kind && option.id === picked?.modelId);
          return <div key={item.kind} className="darl-default-summary-row">
            <span>{item.title}</span>
            <div><strong>{matched?.name ?? '未选择'}</strong>
              {picked && (picked.resolution || picked.aspectRatio) && <small>{[picked.resolution, picked.aspectRatio].filter(Boolean).join(' · ')}</small>}
            </div>
          </div>;
        })}
      </aside>}
      {error && <p className="darl-default-error" role="alert">{error}</p>}
    </div>

    <footer className="darl-default-footer">
      <Button variant="outline" className="darl-default-nav" disabled={saving || step === 0}
        onClick={() => { setStep((index) => Math.max(0, index - 1)); setError(''); }}>
        <ArrowLeft size={16} aria-hidden="true" /> 上一步
      </Button>
      {step === 3 ? <Button className="darl-default-nav" disabled={!complete || saving} onClick={finish}>
        {saving ? '保存中…' : '完成'} <Check size={16} aria-hidden="true" />
      </Button> : <Button className="darl-default-nav" disabled={!selected || saving}
        onClick={() => { setStep((index) => Math.min(3, index + 1)); setError(''); }}>
        下一步 <ArrowRight size={16} aria-hidden="true" />
      </Button>}
    </footer>
  </section>;
}
