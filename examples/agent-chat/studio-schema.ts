/** Existing RN web fields. Version is transport metadata, not an editable field. */
export const studioFields = {
  projects: 'title summary cover ratio style_catalog_id generationMode adaptation planned durationMin durationMax duration requirements outline sourceScript updated creationMode targetRegion targetLanguage sourceVideo',
  episodes: 'projectId number title cover script scenes duration stage',
  assets: 'projectId episodeIds name type role alias description appearance costume voiceDescription image prompt variants history voiceId references dependencies imageDependencies source',
  shots: 'episodeId sceneId description scale camera transition dialogue effects duration source assetIds',
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
  projects: { cover: '', generationMode: '故事版', adaptation: '抽核', planned: null, durationMin: 2, durationMax: 5, duration: 120, requirements: '', outline: { core: '', story: '', keep: '', remove: '', merge: '', risks: '', episodes: '', roles: [], scenes: [], props: [] }, sourceScript: '', creationMode: 'script' },
  episodes: { number: 1, title: '新剧集', cover: '', script: '', scenes: [], duration: 120, stage: 1 },
  assets: { episodeIds: [], name: '', type: '角色', role: '', alias: '', description: '', appearance: '', costume: '', voiceDescription: '', image: '', prompt: '', variants: [], history: [], voiceId: '', references: [], dependencies: [], imageDependencies: {} },
  shots: { description: '', scale: '中景', camera: '固定', transition: '硬切', dialogue: [], effects: '', duration: 3 },
  clips: { title: '新片段', shotIds: [], sourceSignature: '', description: '', duration: 0, prompt: '', assetIds: [], references: [], disabledVoiceIds: [], lastGenerationVoiceIds: [], image: '', imageHistory: [], storyboardImage: '', storyboardHistory: [], blockingImage: '', blockingHistory: [], videos: [], model: '', resolution: '', ratio: '9:16', mode: '参考生成', firstFrame: '', lastFrame: '' },
};
export function studioResource(value: unknown): StudioResource {
  if (typeof value !== 'string' || !Object.hasOwn(studioFields, value)) throw new Error('不支持的资源类型');
  return value as StudioResource;
}
const idFields = new Set(['projectId', 'episodeId', 'sceneId', 'voiceId', 'folderId']);
const arrayFields = new Set(['episodeIds', 'scenes', 'variants', 'history', 'references', 'dependencies', 'dialogue', 'shotIds', 'assetIds', 'disabledVoiceIds', 'lastGenerationVoiceIds', 'imageHistory', 'storyboardHistory', 'blockingHistory', 'videos']);
const numericFields = new Set(['number', 'duration', 'stage', 'planned', 'durationMin', 'durationMax', 'updated', 'group', 'style_catalog_id']);
const objectFields = new Set(['outline', 'sourceVideo', 'source', 'imageDependencies']);
const frameSchema = { type: 'object', additionalProperties: false, properties: { fileId: { type: 'string' }, time: { type: 'number', minimum: 0 }, url: { type: 'string' } }, required: ['fileId', 'time', 'url'] };
const segmentSchema = { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, start: { type: 'number', minimum: 0 }, end: { type: 'number', exclusiveMinimum: 0 }, frames: { type: 'array', items: frameSchema, maxItems: 12 } }, required: ['id', 'start', 'end', 'frames'] };
const videoSourceSchema = { type: 'object', additionalProperties: false, properties: {
  fileId: { type: 'string' }, url: { type: 'string' }, name: { type: 'string' }, duration: { type: 'number', exclusiveMinimum: 0 },
  width: { type: 'integer', minimum: 1 }, height: { type: 'integer', minimum: 1 }, fps: { type: 'number', minimum: 0 }, hasAudio: { type: 'boolean' },
  segments: { type: 'array', items: segmentSchema, maxItems: 80 },
} };
export const sourceSchema = {
  type: 'object', additionalProperties: false, properties: {
    fileId: { type: 'string' }, segmentId: { type: 'string' }, start: { type: 'number', minimum: 0 }, end: { type: 'number', exclusiveMinimum: 0 },
    frames: { type: 'array', items: frameSchema, maxItems: 12 }, name: { type: 'string' }, description: { type: 'string' },
    dialogue: { type: 'string' }, confirmed: { type: 'boolean' }, notes: { type: 'string' },
  }, required: ['fileId', 'start', 'end', 'frames'],
};
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
const sceneSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 }, location: { type: 'string' }, setting: { type: 'string', enum: ['内', '外', '内外'] }, time: { type: 'string' },
    suggestedDuration: { type: ['number', 'string', 'null'], description: '本场预计秒数，可留空。' },
    content: { type: 'string', description: '页面显示和编辑的完整场次正文。按剧情顺序交错保存动作、人物名（表演提示）和每句台词，保留 Markdown 格式。场次没有独立 dialogue 字段；不可把对白从正文拆走。' },
  }, required: ['id', 'location', 'setting', 'time', 'content'],
};
const dependencyImagesSchema = { type: 'object', additionalProperties: { type: 'array', items: { type: 'object', properties: { assetId: { type: 'string' }, variantId: { type: 'string' }, purpose: { type: 'string' }, image: { type: 'string' }, name: { type: 'string' } }, required: ['assetId', 'purpose', 'image', 'name'], additionalProperties: false } } };
const dependenciesSchema = { type: 'array', items: { type: 'object', properties: { assetId: { type: 'string', minLength: 1 }, variantId: { type: 'string' }, purpose: { type: 'string', minLength: 1 } }, required: ['assetId', 'purpose'], additionalProperties: false }, description: '融合资产依赖的同项目资产及具体形态。purpose 说明参考用途；引用图片准备好后才能生成。禁止自引用和循环引用。' };
const variantSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string', minLength: 1 }, name: { type: 'string' }, description: { type: 'string' },
    prompt: { type: 'string', description: '场景、道具衍生形态的完整生图提示词，生图时必填，不回退到描述或主资产 prompt。角色默认按主资产 appearance 与当前形态 description（服饰/视觉变化）生成，prompt 仅供自定义模式。' },
    image: { type: 'string' }, history: { type: 'array', items: { type: 'string' } }, imageDependencies: dependencyImagesSchema,
  }, required: ['id', 'name'],
};
/** Share the field contract between resource discovery and the model's edit schema. */
export function studioValueSchema(resource: StudioResource): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: Object.fromEntries(studioFields[resource].split(' ').map(key => {
    let schema: Record<string, unknown> = { type: 'string' };
    if (numericFields.has(key)) schema = { type: key === 'planned' ? ['number', 'null'] : 'number' };
    if (arrayFields.has(key)) schema = { type: 'array' };
    if (objectFields.has(key)) schema = key === 'source' ? sourceSchema : key === 'sourceVideo' ? videoSourceSchema : { type: 'object' };
    if (key === 'creationMode') schema = { type: 'string', enum: ['script', 'video-redraw'] };
    if (key === 'adaptation') schema = { type: 'string', enum: ['忠实', '抽核', '借壳'] };
    if (key === 'targetRegion') schema = { type: 'string', enum: ['japan', 'western'] };
    if (key === 'targetLanguage') schema = { type: 'string', enum: ['ja', 'en'] };
    if (resource === 'projects' && ['targetRegion', 'targetLanguage', 'sourceVideo'].includes(key)) schema.description = '仅适用于 creationMode=video-redraw 的视频转绘项目；剧本项目不返回、不接受此字段。';
    if (key === 'assetIds') schema = { type: 'array', items: { type: 'string' }, uniqueItems: true };
    if (key === 'favorite') schema = { type: 'boolean' };
    if (key === 'projectId' || key === 'episodeId' || key === 'sceneId') schema = { type: 'string', minLength: 1, description: '关联记录的真实 ID；同批新建记录可用该记录的 ID。' };
    if (key === 'dialogue') schema = { type: 'array', items: dialogueSchema };
    if (resource === 'assets' && key === 'dependencies') schema = dependenciesSchema;
    if (resource === 'assets' && key === 'imageDependencies') schema = dependencyImagesSchema;
    if (resource === 'assets' && key === 'variants') schema = { type: 'array', items: variantSchema };
    if (resource === 'assets' && key === 'prompt') schema.description = '场景、道具主形象的完整生图提示词，生图时必填；衍生形态另存 variants[].prompt，不回退叙事描述。角色默认按 appearance 和当前 costume/形态 description 生成，prompt 仅供自定义模式。';
    if (resource === 'episodes' && key === 'scenes') schema = { type: 'array', items: sceneSchema, description: '剧本页按此数组显示场次。每场 content 包含完整动作与对白；修改剧本时同步维护 scenes 与 script，保留已有场次 ID。' };
    if (resource === 'episodes' && key === 'script') schema.description = '整集完整文学剧本。仅修改 script 不会更新已有 scenes 的页面正文；须同时更新对应 scenes.content。';
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
    if (objectFields.has(key) && (!value || typeof value !== 'object' || Array.isArray(value))) throw new Error(`${key} 必须是对象`);
    if (!idFields.has(key) && !arrayFields.has(key) && !numericFields.has(key) && !objectFields.has(key) && key !== 'favorite' && typeof value !== 'string') throw new Error(`${key} 必须是文本`);
    if (key === 'favorite' && typeof value !== 'boolean') throw new Error('收藏状态无效');
    if (resource === 'assets' && key === 'dependencies' && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.assetId !== 'string' || !item.assetId.trim() || typeof item.purpose !== 'string' || !item.purpose.trim() || (item.variantId !== undefined && typeof item.variantId !== 'string') || Object.keys(item).some(key => !['assetId', 'variantId', 'purpose'].includes(key))) throw new Error(`assets.dependencies[${index}] 字段无效`);
      });
    }
    if (resource === 'assets' && key === 'variants' && Array.isArray(value)) {
      const ids = new Set<string>();
      value.forEach((variant, index) => {
        const path = `assets.variants[${index}]`;
        if (!variant || typeof variant !== 'object' || Array.isArray(variant) || typeof variant.id !== 'string' || !variant.id.trim() || typeof variant.name !== 'string' || ids.has(variant.id)) throw new Error(`${path} 形态编号或名称无效`);
        ids.add(variant.id);
        for (const field of Object.keys(variant)) {
          if (!Object.hasOwn(variantSchema.properties, field)) throw new Error(`${path}.${field} 不受支持`);
          if (field === 'imageDependencies') { if (!variant[field] || typeof variant[field] !== 'object' || Array.isArray(variant[field])) throw new Error(`${path}.${field} 类型无效`); continue; }
          if (field === 'history' ? !Array.isArray(variant[field]) || variant[field].some((url: unknown) => typeof url !== 'string') : typeof variant[field] !== 'string') throw new Error(`${path}.${field} 类型无效`);
        }
      });
    }
    if (resource === 'episodes' && key === 'scenes' && Array.isArray(value)) {
      value.forEach((scene, index) => {
        if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error(`episodes.scenes[${index}] 必须是场次对象`);
        for (const field of Object.keys(scene)) if (!Object.hasOwn(sceneSchema.properties, field)) {
          throw new Error(`episodes.scenes[${index}].${field} 不受支持；场次正文和对白须按发生顺序一起写入 content，不要另建 dialogue 字段。`);
        }
      });
    }
  }
  return values as Record<string, unknown>;
}
