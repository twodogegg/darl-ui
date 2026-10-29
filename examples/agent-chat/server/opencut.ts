import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StudioStore } from './studio';
import type { FileStore } from './file-storage';
import { isLocalOrLanAddress } from './local-access';
import { probeVideo, withVideoFiles } from './video-processing';

const ticks = (seconds: number) => Math.round(seconds * 120000);
type Media = { media_id: string; name: string; type: 'video'; url: string; mime_type: string; size: number; duration: number; width: number; height: number; file_id: string };

export class OpenCutProjects {
  constructor(private studio: StudioStore, private files: FileStore) {
    studio.projects.db.exec('CREATE TABLE IF NOT EXISTS opencut_projects (episode_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, project_json TEXT NOT NULL, media_json TEXT NOT NULL)');
  }
  async media(id: string) { return this.files.getBytes(id); }
  async saveFilm(id: string, bytes: Buffer) {
    const data = this.studio.snapshot(), episode = data.episodes.find(item => item.id === id);
    if (!episode || !data.projects.some(item => item.id === episode.projectId)) throw new Error('剧集不存在');
    const file = await this.files.put(bytes, 'video/mp4', `第${episode.number}集剪辑成片.mp4`);
    const filmId = randomUUID();
    this.studio.apply(randomUUID(), [{ resource: 'films', id: filmId, op: 'create', values: { projectId: episode.projectId, episodeId: id, title: `第${episode.number}集剪辑成片`, url: this.files.originalUrl(file)! } }]);
    return { id: filmId };
  }
  async read(id: string) {
    const data = this.studio.snapshot(), episode = data.episodes.find(item => item.id === id);
    if (!episode) throw new Error('剧集不存在');
    const project = data.projects.find(item => item.id === episode.projectId);
    if (!project) throw new Error('项目不存在');
    const row = this.studio.projects.db.prepare('SELECT revision, project_json, media_json FROM opencut_projects WHERE episode_id=?').get(id) as { revision: number; project_json: string; media_json: string } | undefined;
    const media: Media[] = row ? JSON.parse(row.media_json) : [];
    for (const clip of data.clips.filter(item => item.episodeId === id && item.currentVideo)) {
      const file = this.files.fromUrl(clip.currentVideo);
      if (!file || media.some(item => item.file_id === file.id)) continue;
      const info = await withVideoFiles(this.files, [file.id], async ([path]) => probeVideo(path, new AbortController().signal));
      media.push({ media_id: `file-${file.id}`, file_id: file.id, name: String(clip.title), type: 'video', url: `/api/opencut/media/${file.id}`, mime_type: file.mimeType, size: file.size, duration: info.duration, width: info.width, height: info.height });
    }
    if (row) return { project: JSON.parse(row.project_json), revision: row.revision, media, media_bindings: media, is_initialized: true };
    const now = new Date().toISOString(), sceneId = randomUUID(); let start = 0;
    const elements = media.map(item => { const duration = ticks(item.duration); const result = { id: randomUUID(), type: 'video', mediaId: item.media_id, name: item.name, duration, startTime: start, trimStart: 0, trimEnd: 0, sourceDuration: duration, isSourceAudioEnabled: true, hidden: false, params: { 'transform.positionX': 0, 'transform.positionY': 0, 'transform.scaleX': 1, 'transform.scaleY': 1, 'transform.rotate': 0, opacity: 1, blendMode: 'normal' } }; start += duration; return result; });
    const ratio = String(project.ratio || '9:16').split(':').map(Number), scale = 1080 / Math.max(...ratio);
    return { project: { metadata: { id: `episode-${id}`, name: `第${episode.number}集剪辑工程`, duration: start, createdAt: now, updatedAt: now, legacyAudioMigrated: true, timebase: 'ticks', timelineViewStateVersion: 1, sourceDurationVersion: 2 }, scenes: [{ id: sceneId, name: '主时间线', isMain: true, tracks: { overlay: [], main: { id: randomUUID(), name: '主视频轨道', type: 'video', elements, muted: false, hidden: false }, audio: [] }, bookmarks: [], createdAt: now, updatedAt: now }], currentSceneId: sceneId, settings: { fps: { numerator: 30, denominator: 1 }, canvasSize: { width: Math.round(ratio[0] * scale / 2) * 2, height: Math.round(ratio[1] * scale / 2) * 2 }, canvasSizeMode: 'preset', lastCustomCanvasSize: null, originalCanvasSize: null, background: { type: 'color', color: '#000000' } }, version: 31, timelineViewState: { zoomLevel: 1, scrollLeft: 0, playheadTime: 0 } }, revision: 0, media, media_bindings: media, is_initialized: false };
  }
  save(id: string, body: { expected_revision: number; project: Record<string, unknown>; media_bindings: Media[] }) {
    if (!this.studio.snapshot().episodes.some(item => item.id === id)) throw new Error('剧集不存在');
    const json = JSON.stringify(body.project), media = JSON.stringify(body.media_bindings);
    if (!body.project?.metadata || !Array.isArray(body.project.scenes) || Buffer.byteLength(json) > 5_000_000 || !Array.isArray(body.media_bindings) || body.media_bindings.length > 1000) throw new Error('剪辑工程数据无效');
    for (const item of body.media_bindings) {
      const file = this.files.get(item.file_id);
      if (!file || item.media_id !== `file-${file.id}` || item.url !== `/api/opencut/media/${file.id}`) throw new Error('剪辑素材引用无效');
    }
    if (!Number.isSafeInteger(body.expected_revision) || body.expected_revision < 0) throw new Error('工程版本无效');
    const db = this.studio.projects.db;
    const result = body.expected_revision === 0
      ? db.prepare('INSERT OR IGNORE INTO opencut_projects VALUES (?,1,?,?)').run(id, json, media)
      : db.prepare('UPDATE opencut_projects SET revision=revision+1,project_json=?,media_json=? WHERE episode_id=? AND revision=?').run(json, media, id, body.expected_revision);
    if (!result.changes) throw new Error('剪辑工程已被其他页面更新，请刷新后重试');
    return { revision: body.expected_revision + 1 };
  }
}
export async function handleOpenCut(req: IncomingMessage, res: ServerResponse, service: OpenCutProjects) {
  const url = new URL(req.url || '/', 'http://localhost');
  const film = /^\/api\/opencut\/episodes\/([\w:.-]+)\/film$/.exec(url.pathname);
  if (film) {
    if (!isLocalOrLanAddress(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return true; }
    if (req.method !== 'POST' || req.headers['content-type'] !== 'video/mp4') { res.writeHead(415); res.end(); return true; }
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) { const value = Buffer.from(chunk); size += value.length; if (size > 500 * 1024 * 1024) throw new Error('成片不能超过 500MB'); chunks.push(value); }
      const result = await service.saveFilm(film[1], Buffer.concat(chunks));
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(422, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : '成片保存失败' })); }
    return true;
  }
  const media = /^\/api\/opencut\/media\/([a-f0-9-]+)$/.exec(url.pathname);
  if (media) {
    if (!isLocalOrLanAddress(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return true; }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return true; }
    const file = await service.media(media[1]);
    if (!file) { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': file.file.mimeType, 'Content-Length': file.bytes.length, 'Cache-Control': 'private, max-age=3600' }); res.end(file.bytes); return true;
  }
  const match = /^\/api\/opencut\/episodes\/([\w:.-]+)$/.exec(new URL(req.url || '/', 'http://localhost').pathname);
  if (!match) return false;
  const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  if (!isLocalOrLanAddress(req.socket.remoteAddress)) { send(403, { detail: { message: '仅允许本机或局域网' } }); return true; }
  try {
    if (req.method === 'GET') send(200, { data: await service.read(match[1]) });
    else if (req.method === 'PUT') { let body = ''; for await (const chunk of req) { body += chunk.toString(); if (Buffer.byteLength(body) > 6_000_000) throw new Error('工程超过大小限制'); } send(200, { data: service.save(match[1], JSON.parse(body)) }); }
    else send(405, { detail: { message: '不支持的操作' } });
  } catch (error) { send(422, { detail: { message: error instanceof Error ? error.message : '剪辑工程操作失败' } }); }
  return true;
}
