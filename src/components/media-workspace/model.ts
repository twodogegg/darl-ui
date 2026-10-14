import type { GenerateRequest, MediaModel, MediaReferences } from './types';

export function outputLimit(model: MediaModel): number {
  const value = model.capabilities.maxOutputs;
  return value && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1;
}
export function durations(model: MediaModel): number[] {
  if (model.type !== 'video' || !model.capabilities.durations) return [];
  const value = model.capabilities.durations;
  if (Array.isArray(value)) return value.filter((n) => Number.isFinite(n) && n > 0);
  const min = Math.max(1, Math.ceil(value.min)), max = Math.floor(value.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
export function normalizeOptions(model: MediaModel, values = model.defaults): GenerateRequest['options'] {
  const caps = model.capabilities;
  const select = (choices: string[] | undefined, value: string | undefined) => choices?.includes(value ?? '') ? value : choices?.[0];
  const aspectRatio = select(caps.aspectRatios, values?.aspectRatio);
  const resolution = select(caps.resolutions, values?.resolution);
  const options: GenerateRequest['options'] = {
    count: Math.max(1, Math.min(outputLimit(model), Math.floor(values?.count ?? 1) || 1)),
    ...(aspectRatio ? { aspectRatio } : {}), ...(resolution ? { resolution } : {})
  };
  if (model.type === 'video') {
    const videoValues = values as Partial<GenerateRequest['options']> | undefined;
    const choices = durations(model);
    if (choices.length) options.duration = choices.includes(videoValues?.duration ?? -1) ? videoValues!.duration : choices[0];
    if (model.capabilities.generateAudio === true) options.generateAudio = videoValues?.generateAudio ?? false;
  }
  return options;
}
export function referenceLimit(model: MediaModel, kind: 'images' | 'videos' | 'audios'): number {
  const value = kind === 'images' ? model.capabilities.images : model.type === 'video' ? model.capabilities[kind] : undefined;
  return value && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}
export type MediaInputMode = 'references' | 'frames';
export function supportsFrames(model?: MediaModel): boolean {
  return model?.type === 'video' && model.capabilities.firstLastFrame === true;
}
export function filterReferences(model: MediaModel, references: MediaReferences, inputMode: MediaInputMode = references.firstFrame || references.lastFrame ? 'frames' : 'references'): MediaReferences | undefined {
  const result: MediaReferences = {};
  if (supportsFrames(model) && inputMode === 'frames') {
    if (references.firstFrame) result.firstFrame = references.firstFrame;
    if (references.lastFrame) result.lastFrame = references.lastFrame;
  } else {
    for (const kind of ['images', 'videos', 'audios'] as const) {
      if (referenceLimit(model, kind) && references[kind]?.length) result[kind] = [...references[kind]!];
    }
  }
  return Object.keys(result).length ? result : undefined;
}
