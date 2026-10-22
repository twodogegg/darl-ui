/** Existing RN web fields. Version is transport metadata, not an editable field. */
export const studioFields = {
  projects: 'title summary cover ratio style_catalog_id generationMode planned durationMin durationMax duration requirements outline sourceScript updated',
  episodes: 'projectId number title cover script scenes duration stage',
  assets: 'projectId episodeIds name type role alias description appearance costume voiceDescription image prompt variants history voiceId references',
  shots: 'episodeId sceneId description scale camera transition dialogue effects duration',
  clips: 'episodeId sceneId title shotIds sourceSignature description duration prompt assetIds references disabledVoiceIds lastGenerationVoiceIds image imageHistory storyboardImage storyboardHistory blockingImage blockingHistory videos currentVideo model resolution ratio mode firstFrame lastFrame',
  films: 'projectId episodeId title name url',
  history: 'projectId episodeId message time',
  folders: 'name',
  library: 'name type source image description folderId',
  audio: 'name type url',
  voices: 'name url language gender favorite',
  prompts: 'group name mode text defaultText',
} as const;
export type StudioResource = keyof typeof studioFields;
export type StudioRecord = { id: string; _version: number; _position?: number; [key: string]: unknown };
export type StudioData = Record<StudioResource, StudioRecord[]>;
export type StudioChange = { resource: StudioResource; op: 'create' | 'update' | 'delete'; id: string; version?: number; position?: number; values?: Record<string, unknown> };
export const emptyStudioData = (): StudioData => Object.fromEntries(Object.keys(studioFields).map(key => [key, []])) as unknown as StudioData;

/** Keep unchanged records in place so one insertion/deletion does not rewrite a large list. */
export function studioPositions(before: Array<{ id: string; _position?: number }>, next: Array<{ id: string }>): Map<string, number> {
  const old = new Map(before.map((item, index) => [item.id, item._position ?? index]));
  const tails: number[] = [], links = new Map<number, number>();
  next.forEach((item, index) => {
    const position = old.get(item.id);
    if (position === undefined) return;
    let low = 0, high = tails.length;
    while (low < high) { const middle = (low + high) >>> 1; if (old.get(next[tails[middle]].id)! < position) low = middle + 1; else high = middle; }
    links.set(index, low ? tails[low - 1] : -1); tails[low] = index;
  });
  const anchors = new Set<number>();
  for (let index = tails.at(-1) ?? -1; index !== -1; index = links.get(index) ?? -1) anchors.add(index);
  const positions = new Map<string, number>();
  let start = 0, left = anchors.size ? before.reduce((min, item, index) => Math.min(min, item._position ?? index), Infinity) - 1 : -1;
  for (let index = 0; index <= next.length; index++) {
    if (index !== next.length && !anchors.has(index)) continue;
    const right = index < next.length ? old.get(next[index].id)! : left + (index - start) + 1;
    for (let cursor = start; cursor < index; cursor++) positions.set(next[cursor].id, left + (right - left) * (cursor - start + 1) / (index - start + 1));
    if (index < next.length) positions.set(next[index].id, right);
    left = right; start = index + 1;
  }
  return positions;
}
export const studioDefaults: Partial<Record<StudioResource, Record<string, unknown>>> = {
  projects: { cover: '', generationMode: '故事版', planned: null, durationMin: 2, durationMax: 5, duration: 120, requirements: '', outline: { core: '', story: '', keep: '', remove: '', merge: '', risks: '', episodes: '', roles: [], scenes: [] }, sourceScript: '' },
  episodes: { number: 1, title: '新剧集', cover: '', script: '', scenes: [], duration: 120, stage: 1 },
  assets: { episodeIds: [], name: '', type: '角色', role: '', alias: '', description: '', appearance: '', costume: '', voiceDescription: '', image: '', prompt: '', variants: [], history: [], voiceId: '', references: [] },
  shots: { description: '', scale: '中景', camera: '固定', transition: '硬切', dialogue: [], effects: '', duration: 3 },
  clips: { title: '新片段', shotIds: [], sourceSignature: '', description: '', duration: 0, prompt: '', assetIds: [], references: [], disabledVoiceIds: [], lastGenerationVoiceIds: [], image: '', imageHistory: [], storyboardImage: '', storyboardHistory: [], blockingImage: '', blockingHistory: [], videos: [], model: '', resolution: '', ratio: '9:16', mode: '文本生成', firstFrame: '', lastFrame: '' },
};
export function studioResource(value: unknown): StudioResource {
  if (typeof value !== 'string' || !Object.hasOwn(studioFields, value)) throw new Error('不支持的资源类型');
  return value as StudioResource;
}
const idFields = new Set(['projectId', 'episodeId', 'sceneId', 'voiceId', 'folderId']);
const arrayFields = new Set(['episodeIds', 'scenes', 'variants', 'history', 'references', 'dialogue', 'shotIds', 'assetIds', 'disabledVoiceIds', 'lastGenerationVoiceIds', 'imageHistory', 'storyboardHistory', 'blockingHistory', 'videos']);
const numericFields = new Set(['number', 'duration', 'stage', 'planned', 'durationMin', 'durationMax', 'updated', 'group', 'style_catalog_id']);
export const studioRequiredOnCreate: Partial<Record<StudioResource, string[]>> = {
  projects: ['title', 'ratio', 'style_catalog_id'], episodes: ['projectId'], assets: ['projectId', 'name'],
  shots: ['episodeId', 'sceneId'], clips: ['episodeId', 'sceneId'], films: ['projectId'], history: ['projectId'],
};
const dialogueSchema = {
  type: 'object', properties: { id: { type: 'string' }, type: { type: 'string', enum: ['角色', '旁白'] },
    assetId: { type: 'string', description: '角色对白必须引用当前项目的真实角色资产 ID；旁白可省略。' },
    speaker: { type: 'string' }, description: { type: 'string' }, text: { type: 'string' } },
  required: ['type', 'text'],
  allOf: [{ if: { properties: { type: { const: '角色' } } }, then: { required: ['assetId'], properties: { assetId: { minLength: 1 } } } }],
};
/** Share the field contract between resource discovery and the model's edit schema. */
export function studioValueSchema(resource: StudioResource): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: Object.fromEntries(studioFields[resource].split(' ').map(key => {
    let schema: Record<string, unknown> = { type: 'string' };
    if (numericFields.has(key)) schema = { type: key === 'planned' ? ['number', 'null'] : 'number' };
    if (arrayFields.has(key)) schema = { type: 'array' };
    if (key === 'outline') schema = { type: 'object' };
    if (key === 'favorite') schema = { type: 'boolean' };
    if (key === 'projectId' || key === 'episodeId' || key === 'sceneId') schema = { type: 'string', minLength: 1, description: '关联记录的真实 ID；同批新建记录可用该记录的 ID。' };
    if (key === 'dialogue') schema = { type: 'array', items: dialogueSchema };
    return [key, schema];
  })) };
}
export const studioChangeSchema = {
  type: 'object', properties: { resource: { type: 'string', enum: Object.keys(studioFields) }, op: { type: 'string', enum: ['create', 'update', 'delete'] },
    id: { type: 'string', minLength: 1 }, version: { type: 'integer', minimum: 1 }, position: { type: 'number' }, values: { type: 'object' } },
  required: ['resource', 'op', 'id'], additionalProperties: false,
  allOf: [
    ...(Object.keys(studioFields) as StudioResource[]).map(resource => ({
      if: { properties: { resource: { const: resource } } }, then: { properties: { values: studioValueSchema(resource) },
        allOf: [{ if: { properties: { op: { const: 'create' } } }, then: { required: ['values'], properties: { values: { required: studioRequiredOnCreate[resource] || [] } } } }] },
    })),
    { if: { properties: { op: { enum: ['update', 'delete'] } } }, then: { required: ['version'] } },
  ],
};
export function validateStudioValues(resource: StudioResource, values: unknown): Record<string, unknown> {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('修改字段必须是对象');
  const allowed = new Set(studioFields[resource].split(' '));
  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) throw new Error(`资源 ${resource} 不允许修改字段 ${key}`);
    if (idFields.has(key) && typeof value !== 'string') throw new Error(`${key} 必须是记录编号`);
    if (arrayFields.has(key) && !Array.isArray(value)) throw new Error(`${key} 必须是数组`);
    if (numericFields.has(key) && !(key === 'planned' && value === null) && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${key} 必须是有限数字`);
    if (key === 'outline' && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error('大纲格式无效');
    if (!idFields.has(key) && !arrayFields.has(key) && !numericFields.has(key) && key !== 'outline' && key !== 'favorite' && typeof value !== 'string') throw new Error(`${key} 必须是文本`);
    if (key === 'favorite' && typeof value !== 'boolean') throw new Error('收藏状态无效');
  }
  return values as Record<string, unknown>;
}
