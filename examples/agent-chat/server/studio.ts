import promptCatalog from '../prompts/studio-prompt-catalog.json';
import redrawPrompts from '../prompts/video-redraw.json';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { emptyStudioData, studioChangeSchema, studioDefaults, studioFields, studioRequiredOnCreate, studioResource, studioValueSchema, validateStudioValues, type StudioChange, type StudioData, type StudioRecord, type StudioResource } from '../studio-schema';
import { ProjectStore } from './project-store';
import { isLocalOrLanAddress } from './local-access';
import { failure } from './errors';

export class StudioConflict extends Error {}
const recordId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[\w:.-]{1,160}$/.test(value)) throw new Error('记录编号无效');
  return value;
};
const finitePositive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0;
/** Shared business service for UI and Agent. One batch is one SQLite transaction. */
export class StudioStore {
  private get db() { return this.projects.db; }
  constructor(readonly projects: ProjectStore) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS studio_records (resource TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(resource,id));
      CREATE TABLE IF NOT EXISTS studio_versions (resource TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(resource,id));
      CREATE TABLE IF NOT EXISTS studio_batches (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    // Remove obsolete rollback snapshots while preserving request fingerprints/results for safe retries.
    const batchColumns = this.db.prepare('PRAGMA table_info(studio_batches)').all() as Array<{ name: string }>;
    for (const column of ['inverse', 'entry_source']) if (batchColumns.some(item => item.name === column)) this.db.exec(`ALTER TABLE studio_batches DROP COLUMN ${column}`);
    const insert = this.db.prepare("INSERT OR IGNORE INTO studio_records(resource,id,data,version,position) VALUES('prompts',?,?,1,?)");
    const current = this.db.prepare("SELECT data,version FROM studio_records WHERE resource='prompts' AND id=?");
    const update = this.db.prepare("UPDATE studio_records SET data=?,version=? WHERE resource='prompts' AND id=?");
    const catalog = [...promptCatalog, ...Object.entries(redrawPrompts).map(([key, defaultText], index) => ({ id: `4-${index}`, action: `redraw-${key}`, group: 4, name: { analysis: '视频拉片与改编', asset: '转绘资产', clip: '转绘镜头' }[key] || key, mode: 'default', text: '', defaultText }))];
    catalog.forEach(({ id, action: _, ...values }, index) => {
      insert.run(id, JSON.stringify(values), index);
      const saved = current.get(id) as { data: string; version: number } | undefined;
      const existing = JSON.parse(saved!.data) as Record<string, unknown>;
      if (existing.mode !== 'default') return;
      const next = { group: values.group, name: values.name, mode: existing.mode, text: existing.text, defaultText: values.defaultText };
      if (JSON.stringify(existing) !== JSON.stringify(next)) update.run(JSON.stringify(next), saved!.version + 1, id);
    });
  }
  snapshot(): StudioData {
    const data = emptyStudioData();
    for (const row of this.db.prepare('SELECT * FROM studio_records ORDER BY position,rowid').all() as Array<{ resource: StudioResource; id: string; data: string; version: number; position: number }>) {
      data[row.resource].push({ ...JSON.parse(row.data), id: row.id, _version: row.version, _position: row.position });
    }
    const extras = new Map(data.projects.map(project => [project.id, project]));
    data.projects = this.projects.list().map(project => ({ ...structuredClone(studioDefaults.projects), ...extras.get(String(project.id)), id: String(project.id), _version: extras.get(String(project.id))?._version || 1,
      title: project.name, summary: project.description || '', ratio: project.aspect_ratio, style_catalog_id: project.style_catalog_id,
      cover: project.cover_asset?.storage_key || '', updated: Date.parse(String(project.updated_at)) || 0 }));
    const projectIds = new Set(data.projects.map(project => project.id));
    const episodeIds = new Set(data.episodes.filter(item => projectIds.has(String(item.projectId))).map(item => item.id));
    for (const key of ['episodes', 'assets', 'films', 'history'] as const) data[key] = data[key].filter(item => projectIds.has(String(item.projectId)));
    for (const key of ['shots', 'clips'] as const) data[key] = data[key].filter(item => episodeIds.has(String(item.episodeId)));
    return data;
  }
  query(input: Record<string, unknown>) {
    if (input.resource === 'styles') return { resource: 'styles', ...this.projects.styles() };
    const resource = studioResource(input.resource);
    if (input.describe === true) return { resource, fields: ['id', '_version', '_position', ...studioFields[resource].split(' ')], defaults: studioDefaults[resource] || {}, requiredOnCreate: studioRequiredOnCreate[resource] || [], valuesSchema: studioValueSchema(resource), versionField: '_version', operations: ['create', 'update', 'delete'], batchSemantics: 'atomic', maxBatch: 500, structures: { scenes: ['id', 'location', 'setting:内/外/内外', 'time', 'suggestedDuration:秒或空字符串', 'content:完整场次正文，动作、人物名和台词按发生顺序交错，保留Markdown；场次不支持独立dialogue字段'], dialogue: ['id', 'type:角色/旁白', 'assetId:角色类型必填，须引用当前项目的真实角色资产；旁白可省略', 'speaker', 'description', 'text'], outline: ['core', 'story', 'keep', 'remove', 'merge', 'risks', 'episodes', 'roles:[{id,name,position,relationships,arc}]', 'scenes:[{id,name,purpose}]', 'props:[{id,name,purpose,involvement}]'], variants: ['id', 'name', 'description', 'image', 'history:图片URL数组'] } };
    const data = this.snapshot();
    let items = data[resource];
    if (input.projectId !== undefined) {
      const projectId = recordId(input.projectId);
      const episodes = new Set(data.episodes.filter(item => item.projectId === projectId).map(item => item.id));
      items = items.filter(item => resource === 'projects' ? item.id === projectId : item.projectId === projectId || episodes.has(String(item.episodeId)));
    }
    if (input.episodeId !== undefined) items = items.filter(item => resource === 'episodes' ? item.id === input.episodeId : item.episodeId === input.episodeId || (Array.isArray(item.episodeIds) && item.episodeIds.includes(input.episodeId)));
    if (input.sceneId !== undefined) {
      const sceneId = recordId(input.sceneId);
      items = items.filter(item => item.sceneId === sceneId || (resource === 'episodes' && (item.scenes as Array<{ id: string }>).some(scene => scene.id === sceneId)));
    }
    if (input.ids !== undefined) {
      if (!Array.isArray(input.ids) || input.ids.length > 500) throw new Error('查询编号列表无效');
      const ids = new Set(input.ids.map(recordId)); items = items.filter(item => ids.has(item.id));
    }
    const offset = Number(input.cursor || 0), limit = Number(input.limit || 100);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new Error('分页范围无效');
    const allowedFields = ['id', '_version', '_position', ...studioFields[resource].split(' ')];
    if (input.fields !== undefined && (!Array.isArray(input.fields) || input.fields.some(key => typeof key !== 'string' || !allowedFields.includes(key)))) {
      const invalid = Array.isArray(input.fields) ? input.fields.filter(key => !allowedFields.includes(key)) : input.fields;
      throw failure('tool-validation', 'STUDIO_FIELD_INVALID', `查询字段无效：${resource}.fields=${JSON.stringify(invalid)}。可用字段：${allowedFields.join(', ')}`, false);
    }
    const page = items.slice(offset, offset + limit).map(item => input.fields ? Object.fromEntries(['id', '_version', ...input.fields as string[]].map(key => [key, item[key]])) : item);
    return { resource, items: page, total: items.length, nextCursor: offset + limit < items.length ? String(offset + limit) : null };
  }
  apply(requestId: string, changes: StudioChange[]) {
    recordId(requestId);
    if (!Array.isArray(changes) || !changes.length || changes.length > 500) throw new Error('每批需要 1–500 项修改');
    const fingerprint = createHash('sha256').update(JSON.stringify(changes)).digest('hex');
    const previous = this.db.prepare('SELECT fingerprint,result FROM studio_batches WHERE id=?').get(requestId) as { fingerprint: string; result: string } | undefined;
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new StudioConflict('请求编号已用于其他内容');
      return JSON.parse(previous.result) as { requestId: string; changed: Array<{ resource: StudioResource; id: string; version: number; op: string }> };
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const original = this.snapshot(), data = structuredClone(original);
      const changed: Array<{ resource: StudioResource; id: string; version: number; op: string }> = [];
      const seen = new Set<string>(), aliases = new Map<string,string>();
      for (const change of changes) {
        const resource = studioResource(change.resource); let id = recordId(change.id); const key = `${resource}:${id}`;
        if (seen.has(key)) throw new Error('同一批次不能重复修改同一记录');
        seen.add(key);
        if (!['create', 'update', 'delete'].includes(change.op)) throw new Error('不支持的操作');
        const collection = data[resource], before = collection.find(item => item.id === id);
        if (change.op === 'create' ? Boolean(before) : !before) throw new StudioConflict(`记录 ${key} 已存在或已删除，请重新读取`);
        if (before && change.version !== before._version) throw new StudioConflict(`记录 ${key} 已发生变化，请重新读取`);
        if (change.position !== undefined && (typeof change.position !== 'number' || !Number.isFinite(change.position))) throw new Error('排序位置无效');
        if (change.op === 'delete') collection.splice(collection.indexOf(before!), 1);
        else {
          const values = validateStudioValues(resource, change.values);
          if (change.op === 'create') for (const field of studioRequiredOnCreate[resource] || []) {
            if (values[field] === undefined || values[field] === '') throw failure('tool-validation', 'STUDIO_FIELD_REQUIRED', `${resource}[${id}].${field} 必填；创建前请读取该资源的 describe 与关联记录。`, false);
          }
          if (resource === 'projects' && change.op === 'create') {
            const created = this.projects.create(ProjectStore.validate({ name: values.title, description: values.summary, aspect_ratio: values.ratio, style_catalog_id: values.style_catalog_id }));
            aliases.set(id, String(created.project_id)); id = String(created.project_id);
          }
          const after = { ...structuredClone(studioDefaults[resource] || {}), ...before, ...values, id, _version: before?._version || 0, _position: change.position ?? before?._position ?? collection.reduce((max, item) => Math.max(max, item._position ?? 0), -1) + 1 } as StudioRecord;
          if (before) collection[collection.indexOf(before)] = after; else collection.push(after);
        }
      }
      for (const resource of Object.keys(data) as StudioResource[]) for (const item of data[resource]) if (aliases.has(String(item.projectId))) item.projectId = aliases.get(String(item.projectId));
      // Deleting shots releases their clip associations; durations always derive from current shots.
      for (const clip of data.clips) {
        clip.shotIds = (clip.shotIds as string[]).filter(id => data.shots.some(shot => shot.id === id));
        clip.duration = Math.round((clip.shotIds as string[]).reduce((sum, id) => sum + Number(data.shots.find(shot => shot.id === id)!.duration), 0) * 100) / 100;
      }
      this.validate(data);
      for (const resource of Object.keys(data) as StudioResource[]) {
        const old = new Map(original[resource].map(item => [item.id, item]));
        for (const before of original[resource]) if (!data[resource].some(item => item.id === before.id)) {
          this.db.prepare('DELETE FROM studio_records WHERE resource=? AND id=?').run(resource, before.id);
          if (resource === 'projects') this.projects.archive(Number(before.id));
          this.db.prepare('INSERT INTO studio_versions(resource,id,version) VALUES(?,?,?) ON CONFLICT(resource,id) DO UPDATE SET version=excluded.version').run(resource,before.id,before._version+1);
          changed.push({ resource, id: before.id, version: before._version + 1, op: 'delete' });
        }
        for (const after of data[resource]) {
          const before = old.get(after.id);
          if (before && JSON.stringify(before) === JSON.stringify(after)) continue;
          const sequence = this.db.prepare('SELECT version FROM studio_versions WHERE resource=? AND id=?').get(resource,after.id) as { version: number } | undefined;
          after._version = Math.max(before?._version || 0, sequence?.version || 0) + 1;
          if (resource === 'projects') {
            const canonical = this.projects.get(Number(after.id));
            if (!canonical) throw new Error('项目不存在');
            if (after.cover !== (canonical.cover_asset?.storage_key || '')) throw new Error('项目封面请使用现有上传与选用接口');
            this.projects.update(Number(after.id), ProjectStore.validate({ name: after.title, description: after.summary, aspect_ratio: after.ratio, style_catalog_id: after.style_catalog_id }));
          }
          const { id, _version, _position, ...values } = after;
          this.db.prepare('INSERT INTO studio_records(resource,id,data,version,position) VALUES(?,?,?,?,?) ON CONFLICT(resource,id) DO UPDATE SET data=excluded.data,version=excluded.version,position=excluded.position').run(resource, id, JSON.stringify(values), _version, _position || 0);
          this.db.prepare('INSERT INTO studio_versions(resource,id,version) VALUES(?,?,?) ON CONFLICT(resource,id) DO UPDATE SET version=excluded.version').run(resource,id,_version);
          changed.push({ resource, id, version: _version, op: before ? 'update' : 'create' });
        }
      }
      const result = { requestId, changed };
      this.db.prepare('INSERT INTO studio_batches(id,fingerprint,result) VALUES(?,?,?)').run(requestId, fingerprint, JSON.stringify(result));
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  mediaTarget(value: unknown, type: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('生成目标无效');
    const target = value as Record<string, unknown>, resource = studioResource(target.resource);
    if (!['assets', 'clips'].includes(resource)) throw new Error('生成目标必须是资产或片段');
    const item = this.snapshot()[resource].find(item => item.id === target.id);
    if (!item || item._version !== target.version) throw new StudioConflict('生成目标已变化，请重新读取');
    const fields = type === 'video' ? resource === 'clips' ? ['videos'] : [] : resource === 'assets' ? ['image'] : ['image', 'storyboardImage', 'blockingImage'];
    if (!fields.includes(String(target.field))) throw new Error('生成类型与目标字段不匹配');
    if (resource === 'clips') {
      const state = this.snapshot(), episode = state.episodes.find(episode => episode.id === item.episodeId);
      const project = state.projects.find(project => project.id === episode?.projectId);
      if (project?.creationMode === 'video-redraw') {
        const assets = state.assets.filter(asset => (item.assetIds as string[]).includes(asset.id));
        if (!assets.length) throw new Error('视频转绘片段须关联原片提取的目标资产');
        const missing = assets.filter(asset => !asset.image);
        if (missing.length) throw new Error(`请先准备目标资产图片：${missing.map(asset => asset.name).join('、')}`);
      }
    }
    if (target.variantId && !(item.variants as Array<{ id: string }> | undefined)?.some(variant => variant.id === target.variantId)) throw new Error('资产形态不存在');
    return { resource, id: item.id, version: item._version, field: target.field, ...(target.variantId ? { variantId: target.variantId } : {}) };
  }
  attachMedia(job: import('./media-job-store').MediaJob) {
    const target = job.options.studioTarget as Record<string, unknown> | undefined;
    const requestId = `media-${job.id}`;
    if (!target || job.status !== 'completed' || !job.resultFileIds?.length || this.db.prepare('SELECT id FROM studio_batches WHERE id=?').get(requestId)) return;
    const resource = studioResource(target.resource), item = this.snapshot()[resource].find(item => item.id === target.id);
    if (!item) return; // Removed targets never get resurrected by a late result.
    if (job.resultFileIds.some(id => !this.projects.files.get(id)?.mimeType.startsWith(`${job.type}/`))) throw new Error('生成结果文件类型与任务不一致');
    const urls = job.resultFileIds.map(id => `/api/files/${id}`);
    const values: Record<string, unknown> = {}, current = item._version === target.version;
    if (target.variantId) {
      values.variants = (item.variants as Array<Record<string, unknown>>).map(variant => variant.id === target.variantId ? { ...variant, history: [...urls, ...(variant.history as string[] || [])], ...(current ? { image: urls[0] } : {}) } : variant);
    } else {
      const history = target.field === 'videos' ? 'videos' : target.field === 'image' && resource === 'assets' ? 'history' : `${String(target.field).replace(/Image$/, '')}History`;
      values[history] = [...urls, ...(item[history] as string[] || [])];
      if (current) values[target.field === 'videos' ? 'currentVideo' : String(target.field)] = urls[0];
    }
    this.apply(requestId, [{ resource, id: item.id, op: 'update', version: item._version, values }]);
  }
  private validate(data: StudioData) {
    const byId = (resource: StudioResource, id: unknown) => data[resource].find(item => item.id === id);
    const required = (resource: StudioResource, id: unknown, path: string) => {
      if (typeof id !== 'string' || !id.trim()) throw failure('tool-validation', 'STUDIO_FIELD_REQUIRED', `${path} 必填，须引用真实的 ${resource} 记录 ID。`, false);
      const item = byId(resource, id);
      if (!item) throw failure('tool-validation', 'STUDIO_REFERENCE_INVALID', `${path}：引用的 ${resource} 记录 ${id} 不存在，请先查询或在同批创建关联记录。`, false);
      return item;
    };
    const urls: unknown[] = [];
    for (const resource of Object.keys(data) as StudioResource[]) for (const item of data[resource]) {
      const path = `${resource}[${item.id}]`;
      if (['episodes', 'assets', 'films', 'history'].includes(resource)) required('projects', item.projectId, `${path}.projectId`);
      if (['shots', 'clips'].includes(resource)) {
        const episode = required('episodes', item.episodeId, `${path}.episodeId`);
        if (!(episode.scenes as Array<{ id: string }>).some(scene => scene.id === item.sceneId)) throw new Error('分镜或片段引用了不存在的场次');
      }
      if (resource === 'projects') {
        if (item.creationMode && !['script', 'video-redraw'].includes(String(item.creationMode))) throw new Error('项目创作模式无效');
        if (item.creationMode === 'video-redraw') {
          if (!['japan', 'western'].includes(String(item.targetRegion)) || !['ja', 'en'].includes(String(item.targetLanguage))) throw new Error('目标地区或语言无效');
          const source = item.sourceVideo as Record<string, unknown>;
          if (source.fileId && this.projects.files.get(String(source.fileId))?.mimeType !== 'video/mp4') throw new Error('原片须引用已上传的 MP4');
          if (source.duration !== undefined && !finitePositive(source.duration)) throw new Error('原片时长无效');
          if (source.segments !== undefined) {
            if (!Array.isArray(source.segments) || source.segments.length > 80) throw new Error('原片镜头列表无效');
            const ids = new Set<string>();
            for (const segment of source.segments as Array<Record<string, unknown>>) {
              const id = recordId(segment.id);
              if (ids.has(id) || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || Number(segment.start) < 0 || Number(segment.end) <= Number(segment.start)
                || Number(segment.end) > Number(source.duration) || !Array.isArray(segment.frames) || segment.frames.length > 12) throw new Error('原片镜头区间或参考帧无效');
              ids.add(id);
              for (const frame of segment.frames as Array<Record<string, unknown>>) if (this.projects.files.get(String(frame.fileId))?.mimeType !== 'image/jpeg'
                || frame.url !== `/api/files/${frame.fileId}` || !Number.isFinite(frame.time) || Number(frame.time) < Number(segment.start) || Number(frame.time) > Number(segment.end)) throw new Error('原片参考帧无效');
            }
          }
        }
        if (item.planned !== null && (!Number.isInteger(item.planned) || Number(item.planned) < 1 || Number(item.planned) > 100)) throw new Error('计划集数应为1–100或留空');
        if (!['忠实', '抽核', '借壳'].includes(String(item.adaptation))) throw new Error('改编幅度无效');
        if (![item.durationMin,item.durationMax].every(value => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 60) || Number(item.durationMin) > Number(item.durationMax)) throw new Error('单集时长范围无效');
      }
      if (['films','history'].includes(resource) && item.episodeId && required('episodes',item.episodeId, `${path}.episodeId`).projectId !== item.projectId) throw new Error('关联剧集不属于当前项目');
      if (resource === 'library' && item.folderId) required('folders',item.folderId, `${path}.folderId`);
      if (resource === 'prompts' && !['default','replace'].includes(String(item.mode))) throw new Error('提示词模式无效');
      if (resource === 'episodes') {
        if (!Number.isInteger(item.number) || Number(item.number) < 1 || !finitePositive(item.duration)) throw new Error('剧集编号或目标时长无效');
        if (!Array.isArray(item.scenes)) throw new Error('场次必须是数组');
        const ids = new Set<string>();
        for (const scene of item.scenes as Array<Record<string, unknown>>) {
          const id = recordId(scene.id);
          if (ids.has(id) || typeof scene.content !== 'string' || typeof scene.location !== 'string' || !['内', '外', '内外'].includes(String(scene.setting)) || typeof scene.time !== 'string') throw new Error('场次字段或编号无效');
          if (scene.suggestedDuration !== '' && scene.suggestedDuration != null && !finitePositive(Number(scene.suggestedDuration))) throw new Error('场次建议时长无效');
          ids.add(id);
        }
        if (data.episodes.some(other => other.id !== item.id && other.projectId === item.projectId && other.number === item.number)) throw new Error('同一项目的剧集编号重复');
      }
      if (resource === 'shots') {
        if (!finitePositive(item.duration) || !Array.isArray(item.dialogue)) throw new Error('镜头时长或对白无效');
        const episode = required('episodes', item.episodeId, `${path}.episodeId`);
        if (item.assetIds !== undefined) {
          if (!Array.isArray(item.assetIds) || new Set(item.assetIds).size !== item.assetIds.length) throw new Error('镜头资产关联无效');
          for (const id of item.assetIds as string[]) if (required('assets', id, `${path}.assetIds`).projectId !== episode.projectId) throw new Error('镜头资产不属于当前项目');
        }
        for (const [index, line] of (item.dialogue as Array<Record<string, unknown>>).entries()) {
          if (!['角色', '旁白'].includes(String(line.type)) || typeof line.text !== 'string') throw new Error('对白类型或文本无效');
          if (line.type === '角色') { const asset = required('assets', line.assetId, `${path}.dialogue[${index}].assetId`); if (asset.type !== '角色' || asset.projectId !== episode.projectId) throw new Error(`${path}.dialogue[${index}].assetId：对白角色不属于当前项目`); }
        }
      }
      if (resource === 'assets') {
        if (!String(item.name || '').trim() || !['角色', '场景', '道具'].includes(String(item.type))) throw new Error('资产名称或类型无效');
        for (const id of item.episodeIds as string[]) if (required('episodes', id, `${path}.episodeIds`).projectId !== item.projectId) throw new Error('资产关联剧集不属于当前项目');
        if (item.voiceId) required('voices', item.voiceId, `${path}.voiceId`);
        if (data.assets.some(other => other.id !== item.id && other.projectId === item.projectId && other.type === item.type && String(other.name).trim() === String(item.name).trim())) throw new Error('同类型同名资产已存在，请复用已有记录');
      }
      if (resource === 'assets' || resource === 'shots') {
        const owner = byId('projects', resource === 'assets' ? item.projectId : byId('episodes', item.episodeId)?.projectId);
        if (owner?.creationMode === 'video-redraw' && item.source === undefined) throw new Error('转绘资产和镜头须提供原片来源，请先截帧补入或应用拉片草稿');
      }
      if ((resource === 'assets' || resource === 'shots') && item.source !== undefined) {
        const source = item.source as Record<string, unknown>;
        const project = required('projects', resource === 'assets' ? item.projectId : required('episodes', item.episodeId, path).projectId, path);
        const video = project.sourceVideo as Record<string, unknown>;
        if (!source || !Number.isFinite(video.duration) || source.fileId !== video.fileId || !Number.isFinite(source.start) || !Number.isFinite(source.end)
          || Number(source.start) < 0 || Number(source.end) <= Number(source.start) || Number(source.end) > Number(video.duration) + 0.001) throw new Error('原片来源区间无效');
        if (!Array.isArray(source.frames) || source.frames.length > 12) throw new Error('原片参考帧无效');
        for (const frame of source.frames as Array<Record<string, unknown>>) {
          if (!Number.isFinite(frame.time) || Number(frame.time) < Number(source.start) || Number(frame.time) > Number(source.end)
            || this.projects.files.get(String(frame.fileId))?.mimeType !== 'image/jpeg' || frame.url !== `/api/files/${frame.fileId}`) throw new Error('原片参考帧或时间无效');
        }
        if (source.confirmed !== undefined && typeof source.confirmed !== 'boolean') throw new Error('来源确认状态无效');
        for (const key of ['description', 'name', 'dialogue', 'notes']) if (source[key] !== undefined && typeof source[key] !== 'string') throw new Error('来源描述须为文本');
      }
      if (resource === 'clips') {
        const episode = required('episodes', item.episodeId, `${path}.episodeId`);
        if (!Array.isArray(item.shotIds) || new Set(item.shotIds).size !== item.shotIds.length) throw new Error('片段镜头列表无效');
        for (const id of item.shotIds as string[]) {
          const shot = required('shots', id, `${path}.shotIds`);
          if (shot.episodeId !== item.episodeId || shot.sceneId !== item.sceneId) throw new Error('视频片段只能组合本场镜头');
          if (data.clips.some(other => other.id !== item.id && (other.shotIds as string[]).includes(id))) throw new Error('分镜已被其他片段使用');
        }
        for (const id of item.assetIds as string[]) if (required('assets', id, `${path}.assetIds`).projectId !== episode.projectId) throw new Error('片段资产不属于当前项目');
        const duration = (item.shotIds as string[]).reduce((sum, id) => sum + Number(required('shots', id, `${path}.shotIds`).duration), 0);
        if (Math.abs(Number(item.duration) - duration) > 0.011) throw new Error('片段时长必须等于关联镜头时长之和');
      }
      const collect = (value: unknown) => { if (typeof value === 'string' && (/^(?:data:|javascript:)/i.test(value))) throw new Error('媒体请先上传到文件服务'); if (value && typeof value === 'object') Object.values(value).forEach(collect); };
      // Only media-bearing fields are URLs; script text may legitimately contain arbitrary text.
      for (const key of ['image', 'imageHistory', 'history', 'storyboardImage', 'storyboardHistory', 'blockingImage', 'blockingHistory', 'videos', 'currentVideo', 'url', 'firstFrame', 'lastFrame', 'variants', 'references', 'source', 'sourceVideo']) if (resource !== 'history' && item[key] !== undefined) urls.push(item[key]);
      urls.splice(0).forEach(collect);
    }
  }
}

export const STUDIO_TOOLS = [
  { name: 'builtin_read_studio', title: '查询短剧创作数据', description: '按项目/剧集/场次批量读取大纲、剧本场次、资产、分镜、片段。先用 describe=true 获取该资源现有字段、默认值与编辑规则。返回真实 ID、_version、total 和 nextCursor；分页未读完不代表全部内容。', risk: 'read' as const, appId: 'builtin:studio', appName: '短剧工作台', approval: 'workspace' as const, parameters: { type: 'object', properties: { resource: { type: 'string', enum: [...Object.keys(studioFields), 'styles'] }, describe: { type: 'boolean' }, projectId: { type: 'string' }, episodeId: { type: 'string' }, sceneId: { type: 'string' }, ids: { type: 'array', items: { type: 'string' }, maxItems: 500 }, fields: { type: 'array', items: { type: 'string' } }, cursor: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 500 } }, required: ['resource'], additionalProperties: false } },
  { name: 'builtin_edit_studio', title: '批量修改短剧内容', description: '按读取到的字段白名单提交一组原子编辑，最多500项。修改/删除传最新 _version 作为 version；values 只含改变字段。资源字段、类型、创建必填项与默认值先通过查询工具 describe 获取。分镜角色对白必须引用当前项目真实角色资产；可把新资产与分镜放同批创建。剧本页显示 episodes.scenes[].content，须包含完整动作与台词并同步 script，不支持 scenes[].dialogue。创建项目的 id 为临时标识，返回实际编号；同批新剧集可用临时 projectId 关联。position 可调整记录排序。requestId 为唯一请求标识，重试沿用。关联变化放同批，失败整批回滚。生成任务用已有媒体工具。', risk: 'write' as const, appId: 'builtin:studio', appName: '短剧工作台', approval: 'workspace' as const, parameters: { type: 'object', properties: { requestId: { type: 'string' }, changes: { type: 'array', minItems: 1, maxItems: 500, items: studioChangeSchema } }, required: ['requestId', 'changes'], additionalProperties: false } },
] as const;

export async function handleStudioRequest(req: IncomingMessage, res: ServerResponse, store: StudioStore): Promise<boolean> {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (!path.startsWith('/api/studio/')) return false;
  const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  if (!isLocalOrLanAddress(req.socket.remoteAddress)) { send(403, { error: '工作台仅允许本机或局域网访问' }); return true; }
  try {
    if (path === '/api/studio/state' && req.method === 'GET') { send(200, store.snapshot()); return true; }
    let text = '';
    for await (const part of req) { text += part.toString(); if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('请求超过16MB'); }
    const body = text ? JSON.parse(text) : {};
    if (path === '/api/studio/query' && req.method === 'POST') send(200, store.query(body));
    else if (path === '/api/studio/changes' && req.method === 'POST') {
      if (Object.keys(body).some(key => !['requestId', 'changes'].includes(key))) throw new Error('修改请求仅支持 requestId 和 changes');
      send(200, store.apply(body.requestId, body.changes));
    }
    else send(404, { error: '工作台接口不存在' });
  } catch (error) { send(error instanceof StudioConflict ? 409 : 422, { error: error instanceof Error ? error.message : '操作失败', atomic: true }); }
  return true;
}
