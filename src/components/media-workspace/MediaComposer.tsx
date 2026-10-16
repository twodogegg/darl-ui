import { useId, useRef, type KeyboardEvent } from 'react';
import { Button } from '../ui/Button';
import { Alert, Choice, Popover } from './WorkspaceUI';
import { durations, filterReferences, generationModeLabels, outputLimit, referenceLimit, selectedGenerationMode, supportsFrames, type MediaInputMode } from './model';
import type { GenerateRequest, MediaModel } from './types';
import type { ReferenceDraft } from './useReferences';

const labels = { images: '参考图片', videos: '参考视频', audios: '参考音频' };
const typeLabels = { image: '图片', video: '视频' };
export function MediaComposer({ models, model, mediaType, onMediaTypeChange, options, onModelChange, onOptionsChange, prompt, onPromptChange, draft, inputMode, onInputModeChange, error, onError, pending, canGenerate, onGenerate }: {
  models: MediaModel[]; model?: MediaModel; mediaType: MediaModel['type']; onMediaTypeChange: (type: MediaModel['type']) => void;
  options: GenerateRequest['options'];
  onModelChange: (id: string) => void; onOptionsChange: (options: GenerateRequest['options']) => void;
  prompt: string; onPromptChange: (prompt: string) => void; draft: ReferenceDraft;
  inputMode: MediaInputMode; onInputModeChange: (mode: MediaInputMode) => void;
  error: string; onError: (message: string) => void; pending: boolean; canGenerate: boolean; onGenerate: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const frameInput = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const frameRole = useRef<'firstFrame' | 'lastFrame'>('firstFrame');
  const modelTypes = (['image', 'video'] as const).filter((type) => models.some((item) => item.type === type));
  const accept = model ? (['images', 'videos', 'audios'] as const).filter((kind) => referenceLimit(model, kind)).map((kind) => kind === 'images' ? 'image/*' : kind === 'videos' ? 'video/*' : 'audio/*') : [];
  const selectedMode = model ? selectedGenerationMode(model, inputMode, filterReferences(model, draft.references, inputMode) || {}) : undefined;
  const add = (files: File[]) => {
    if (!model) return;
    onError('');
    if (inputMode === 'frames') {
      const images = files.filter((file) => file.type.startsWith('image/'));
      const slots = (['firstFrame', 'lastFrame'] as const).filter((role) => !draft.frame(role).hasValue);
      images.slice(0, slots.length).forEach((image, index) => draft.frame(slots[index]).add([image]));
      if (images.length !== files.length) onError('首尾帧只支持图片');
      else if (images.length > slots.length) onError('首尾帧最多两张图片，请移除或点击对应位置替换');
      return;
    }
    const supported = files.filter((file) => accept.some((pattern) => file.type.startsWith(pattern.split('/')[0] + '/')));
    if (supported.length !== files.length) onError('部分文件类型不受当前模型支持');
    draft.addFiles(supported);
  };
  const chooseFrame = (role: 'firstFrame' | 'lastFrame') => {
    frameRole.current = role;
    frameInput.current?.click();
  };
  const chooseFiles = () => {
    input.current?.click();
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (canGenerate) onGenerate(); }
  };
  return <footer className="darl-mw-composer-shell"><div className="darl-mw-composer" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); add(Array.from(event.dataTransfer.files)); }} onPaste={(event) => {
    const images = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => !!file);
    if (images.length) { event.preventDefault(); add(images); }
  }}>
    <input ref={input} type="file" multiple accept={accept.join(',')} hidden aria-label="选择参考素材" onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); if (files.length) add(files); event.currentTarget.value = ''; }}/>
    <input ref={frameInput} type="file" accept="image/*" hidden aria-label="选择帧图片" onChange={(event) => { onError(''); draft.frame(frameRole.current).add(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }}/>
    {modelTypes.length > 1 && <div className="darl-mw-type" role="radiogroup" aria-label="生成类型">{modelTypes.map((type) => <Button key={type} variant={type === mediaType ? 'secondary' : 'ghost'} size="sm" role="radio" aria-checked={type === mediaType} aria-label={`生成${typeLabels[type]}`} onClick={() => onMediaTypeChange(type)}>{type === 'image' ? '▧' : '▷'} {typeLabels[type]}</Button>)}</div>}
    <div className="darl-mw-references">{inputMode === 'references' && (['images', 'videos', 'audios'] as const).map((kind) => draft.previews(kind).map((item) => <div key={item.key} className="darl-mw-reference" data-unsupported={!model || !referenceLimit(model, kind)} title={`${labels[kind]}：${item.name}`}>
      {kind === 'images' && item.url ? <img src={item.url} alt={item.name}/> : <span>{kind === 'videos' ? '视频' : kind === 'audios' ? '音频' : '图片'}</span>}
      <Button variant="secondary" size="icon" onClick={item.remove} aria-label={`移除${labels[kind]} ${item.name}`}>×</Button>
    </div>))}
    {inputMode === 'frames' && supportsFrames(model) && (['firstFrame', 'lastFrame'] as const).map((role) => {
      const frame = draft.frame(role), label = role === 'firstFrame' ? '首帧' : '尾帧';
      return <div className="darl-mw-frame" key={role} onDrop={(event) => { event.preventDefault(); event.stopPropagation(); onError(''); draft.frame(role).add(Array.from(event.dataTransfer.files)); }}><Button variant="outline" size="sm" onClick={() => chooseFrame(role)} aria-label={`添加${label}`}>{frame.url && <img src={frame.url} alt={label}/>} {label}{frame.hasValue ? ' · 已添加' : ' ＋'}</Button>{frame.hasValue && <Button size="icon" variant="ghost" onClick={frame.clear} aria-label={`移除${label}`}>×</Button>}</div>;
    })}
    {!supportsFrames(model) && (draft.references.firstFrame || draft.references.lastFrame) && <span className="darl-mw-retained">已保留首尾帧，本模型不使用 <Button variant="ghost" size="sm" onClick={() => { draft.frame('firstFrame').clear(); draft.frame('lastFrame').clear(); }}>移除首尾帧</Button></span>}
    </div>
    <label htmlFor={inputId} className="darl-visually-hidden">生成提示词</label><textarea id={inputId} className="darl-mw-prompt" rows={2} value={prompt} onChange={(event) => onPromptChange(event.target.value)} onKeyDown={keyDown} aria-invalid={Boolean(error)} placeholder="描述想生成的画面，或添加参考素材后说明修改要求…"/>
    {error && <Alert>{error}</Alert>}
    <div className="darl-mw-controls">
      {supportsFrames(model) && !!accept.length && <Choice label="素材方式" value={inputMode === 'frames' ? '首尾帧' : '参考素材'} choices={['首尾帧', '参考素材']} onChange={(value) => onInputModeChange(value === '首尾帧' ? 'frames' : 'references')}/>}
      {inputMode === 'references' && !!accept.length && <Button variant="secondary" size="sm" onClick={chooseFiles} aria-label="添加参考素材">＋ 素材</Button>}
      {selectedMode && <span className="darl-mw-mode" aria-label={`生成方式：${generationModeLabels[selectedMode]}`}>生成方式 · {generationModeLabels[selectedMode]}</span>}
      {inputMode === 'references' && model && <span className="darl-mw-capacity">{(['images', 'videos', 'audios'] as const).filter((kind) => referenceLimit(model, kind)).map((kind) => `${labels[kind]} ${draft.references[kind]?.length ?? 0}/${referenceLimit(model, kind)}`).join(' · ')}</span>}
      <Popover label="选择模型" trigger={model ? `${model.type === 'image' ? '▧' : '▷'} ${model.name}` : '无可用模型'}>{(close) => <div className="darl-mw-models">{models.filter((item) => item.type === mediaType).map((item) => <Button key={item.id} variant={item.id === model?.id ? 'secondary' : 'ghost'} size="sm" onClick={() => { onModelChange(item.id); close(); }} aria-pressed={item.id === model?.id}>{item.name}</Button>)}</div>}</Popover>
      {!!model?.capabilities.aspectRatios?.length && <Choice label="比例" choices={model.capabilities.aspectRatios} value={options.aspectRatio} onChange={(aspectRatio) => onOptionsChange({ ...options, aspectRatio: String(aspectRatio) })}/>}
      {!!model?.capabilities.resolutions?.length && <Choice label="分辨率" choices={model.capabilities.resolutions} value={options.resolution} onChange={(resolution) => onOptionsChange({ ...options, resolution: String(resolution) })}/>}
      {model && durations(model).length > 0 && <Choice label="时长" choices={durations(model)} value={options.duration} format={(value) => `${value}秒`} onChange={(duration) => onOptionsChange({ ...options, duration: Number(duration) })}/>}
      {model && outputLimit(model) > 1 && <Choice label="数量" choices={Array.from({ length: outputLimit(model) }, (_, i) => i + 1)} value={options.count} onChange={(count) => onOptionsChange({ ...options, count: Number(count) })}/>}
      {model?.type === 'video' && model.capabilities.generateAudio === true && <Button variant="secondary" size="sm" role="switch" aria-label="生成声音" aria-checked={options.generateAudio ?? false} onClick={() => onOptionsChange({ ...options, generateAudio: !options.generateAudio })}>生成声音 {options.generateAudio ? '开' : '关'}</Button>}
      <Button className="darl-mw-generate" size="sm" disabled={!canGenerate} onClick={onGenerate}>{pending ? '提交中…' : '✧ 生成'}</Button>
    </div>
  </div><div className="darl-mw-composer-hint">Enter 生成 · Shift + Enter 换行 · 支持粘贴和拖入参考素材</div></footer>;
}
