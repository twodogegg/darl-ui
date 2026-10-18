import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type ShotDraft = {
  id: string; framing: string; camera: string; cut: string; scene: string;
  visual: string; dialogue: string; sound: string; duration: number;
};
export type AssetDraft = { name: string; type: 'character' | 'scene' | 'prop'; shotNumbers: number[]; description?: string };
export type BreakdownDraft = { shots: ShotDraft[]; assets: AssetDraft[] };
export type EpisodeRecord = {
  id: number; projectId: number; title: string; script: string; scriptRevision: number;
  planRevision: number | null; updatedAt: string;
};
type DBRow = Record<string, unknown>;
const assetTypes = new Set(['character', 'scene', 'prop']);
const markerPattern = /<([^<>\n]{1,80})>/gu;
const text = (v: unknown, max = 15000) => typeof v === 'string' && v.length <= max ? v.trim() : null;

export function assetMentions(value: string): string[] {
  return [...new Set([...value.matchAll(markerPattern)].map((m) => m[1].trim()).filter(Boolean))];
}

export function validateBreakdown(input: unknown): BreakdownDraft {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('分镜结果必须是 JSON 对象');
  const data = input as Record<string, unknown>;
  if (!Array.isArray(data.shots) || !data.shots.length || data.shots.length > 300) throw new Error('分镜须包含 1–300 个镜头');
  if (!Array.isArray(data.assets) || data.assets.length > 200) throw new Error('美术资产数量无效');
  const shotIds = new Set<string>();
  const shots = data.shots.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('第 ' + (index + 1) + ' 镜格式无效');
    const shot = item as Record<string, unknown>;
    const values = ['framing','camera','cut','scene','visual','dialogue','sound'] as const;
    const clean: Record<string, string> = {};
    for (const key of values) {
      const value = text(shot[key], key === 'visual' ? 15000 : 5000);
      if (value === null || (['scene','visual'].includes(key) && !value)) throw new Error('第 ' + (index + 1) + ' 镜 ' + key + ' 无效');
      clean[key] = value || '—';
    }
    const duration = shot.duration;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || duration > 600)
      throw new Error('第 ' + (index + 1) + ' 镜时长应在 0–600 秒之间');
    const id = typeof shot.id === 'string' && /^[0-9a-f-]{36}$/i.test(shot.id) ? shot.id : randomUUID();
    if (shotIds.has(id)) throw new Error('重复的镜头 ID');
    shotIds.add(id);
    return { id, framing:clean.framing, camera:clean.camera, cut:index === 0 ? '—' : clean.cut,
      scene:clean.scene, visual:clean.visual, dialogue:clean.dialogue, sound:clean.sound, duration };
  });
  const names = new Map<string, AssetDraft>();
  for (const item of data.assets) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('资产条目格式无效');
    const asset = item as Record<string, unknown>;
    const name = text(asset.name, 80);
    if (!name || /[<>\n]/u.test(name) || !assetTypes.has(String(asset.type))) throw new Error('资产名称或类型无效');
    if (!Array.isArray(asset.shotNumbers) || !asset.shotNumbers.length || asset.shotNumbers.some((n) => !Number.isInteger(n) || n < 1 || n > shots.length))
      throw new Error('资产所关联的镜头序号无效');
    const key = String(asset.type) + ':' + name;
    const existing = names.get(key);
    const numbers = [...new Set(asset.shotNumbers as number[])].sort((a,b) => a-b);
    if (existing) existing.shotNumbers = [...new Set([...existing.shotNumbers,...numbers])].sort((a,b)=>a-b);
    else names.set(key,{name, type:asset.type as AssetDraft['type'],shotNumbers:numbers, description:text(asset.description,5000)||''});
  }
  // An asset mentioned in a shot must be present in the structured requirements.
  const all = [...names.values()];
  for (const [index,shot] of shots.entries()) {
    for (const name of assetMentions(shot.visual + '\n' + shot.scene)) {
      const hit = all.find((a) => a.name === name);
      if (!hit) throw new Error('镜头 ' + (index + 1) + ' 引用了未声明的资产：' + name);
      if (!hit.shotNumbers.includes(index+1)) hit.shotNumbers.push(index+1);
    }
  }
  return {shots,assets:all.map((a)=>({...a,shotNumbers:a.shotNumbers.sort((a,b)=>a-b)}))};
}

export function parseAgentBreakdown(output: string): BreakdownDraft {
  const trimmed = output.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let value: unknown;
  try { value = JSON.parse(fenced ? fenced[1] : trimmed); }
  catch { throw new Error('Agent 没有返回有效 JSON；请调整 Agent 指令后重新分析'); }
  return validateBreakdown(value);
}

export class EpisodeStore {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys=ON');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES workspace_projects(id),
        title TEXT NOT NULL, script TEXT NOT NULL DEFAULT '',
        script_revision INTEGER NOT NULL DEFAULT 0, plan_revision INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS workspace_episodes_project_idx ON workspace_episodes(project_id,id);
      CREATE TABLE IF NOT EXISTS workspace_shots (
        id TEXT PRIMARY KEY, episode_id INTEGER NOT NULL REFERENCES workspace_episodes(id),
        position INTEGER NOT NULL, framing TEXT NOT NULL, camera TEXT NOT NULL, cut TEXT NOT NULL,
        scene TEXT NOT NULL, visual TEXT NOT NULL, dialogue TEXT NOT NULL, sound TEXT NOT NULL,
        duration REAL NOT NULL CHECK(duration > 0)
      );
      CREATE INDEX IF NOT EXISTS workspace_shots_episode_idx ON workspace_shots(episode_id,position);
      CREATE TABLE IF NOT EXISTS workspace_assets (
        id TEXT PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES workspace_projects(id),
        type TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id,type,name)
      );
      CREATE TABLE IF NOT EXISTS workspace_asset_states (
        id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES workspace_assets(id) ON DELETE CASCADE,
        name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', is_main INTEGER NOT NULL DEFAULT 0,
        source_note TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(asset_id,name)
      );
      CREATE TABLE IF NOT EXISTS workspace_shot_assets (
        shot_id TEXT NOT NULL REFERENCES workspace_shots(id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES workspace_assets(id),
        PRIMARY KEY(shot_id,asset_id)
      );
    `);
    const columns=this.db.prepare('PRAGMA table_info(workspace_assets)').all() as DBRow[];
    if(!columns.some(col=>col.name==='description')) this.db.exec("ALTER TABLE workspace_assets ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  private projectExists(projectId: number): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM workspace_projects WHERE id=? AND status='active'").get(projectId));
  }
  episodes(projectId: number) {
    if (!this.projectExists(projectId)) return null;
    return (this.db.prepare('SELECT * FROM workspace_episodes WHERE project_id=? ORDER BY id').all(projectId) as DBRow[])
      .map((row)=>this.episodeView(row));
  }
  private episodeView(row: DBRow): EpisodeRecord {
    return {id:Number(row.id),projectId:Number(row.project_id),title:String(row.title),script:String(row.script),
      scriptRevision:Number(row.script_revision),planRevision:row.plan_revision===null?null:Number(row.plan_revision),
      updatedAt:String(row.updated_at)};
  }
  get(episodeId: number): EpisodeRecord | null {
    const row = this.db.prepare("SELECT e.* FROM workspace_episodes e JOIN workspace_projects p ON p.id=e.project_id WHERE e.id=? AND p.status='active'").get(episodeId) as DBRow | undefined;
    return row ? this.episodeView(row):null;
  }
  create(projectId: number, title: unknown) {
    const name=text(title,100);
    if (!name) throw new Error('请填写剧集名称（最多 100 字）');
    if (!this.projectExists(projectId)) return null;
    const result=this.db.prepare('INSERT INTO workspace_episodes (project_id,title) VALUES (?,?)').run(projectId,name);
    return this.get(Number(result.lastInsertRowid));
  }
  saveScript(episodeId: number, script: unknown, expectedRevision: unknown) {
    const existing = this.get(episodeId);
    if (!existing) return null;
    if (typeof script !== 'string' || script.length > 200_000) throw new Error('剧本必须是文本，最多 20 万字符');
    const source = script; // Preserve every byte of the user's supplied screenplay text.
    if (expectedRevision!==existing.scriptRevision) throw new Error('剧本已在其他位置更新，请刷新后重试');
    this.db.prepare("UPDATE workspace_episodes SET script=?, script_revision=script_revision+1, updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(source,episodeId);
    return this.get(episodeId);
  }
  shots(episodeId: number): ShotDraft[] {
    return (this.db.prepare('SELECT * FROM workspace_shots WHERE episode_id=? ORDER BY position').all(episodeId) as DBRow[])
      .map((s)=>({id:String(s.id),framing:String(s.framing),camera:String(s.camera),cut:String(s.cut),
        scene:String(s.scene),visual:String(s.visual),dialogue:String(s.dialogue),sound:String(s.sound),duration:Number(s.duration)}));
  }
  assets(projectId: number) {
    if (!this.projectExists(projectId)) return null;
    return (this.db.prepare('SELECT * FROM workspace_assets WHERE project_id=? ORDER BY type,name').all(projectId) as DBRow[])
      .map((a)=>({id:String(a.id),name:String(a.name),type:String(a.type),description:String(a.description||'')}));
  }
  plan(episodeId: number) {
    const episode=this.get(episodeId);
    if (!episode) return null;
    const shots=this.shots(episodeId);
    const raw=this.db.prepare(`SELECT sa.shot_id,sa.asset_id,a.name,a.type,a.description FROM workspace_shot_assets sa
      JOIN workspace_shots s ON s.id=sa.shot_id JOIN workspace_assets a ON a.id=sa.asset_id WHERE s.episode_id=?`).all(episodeId) as DBRow[];
    const assets=new Map<string,AssetDraft>();
    raw.forEach((row)=>{
      const key=String(row.asset_id);
      if (!assets.has(key)) assets.set(key,{name:String(row.name),type:row.type as AssetDraft['type'],shotNumbers:[],description:String(row.description||'')});
      const position=shots.findIndex((shot)=>shot.id===row.shot_id)+1;
      if (position>0) assets.get(key)!.shotNumbers.push(position);
    });
    return {episode, shots, assets:[...assets.values()], totalSeconds:shots.reduce((n,s)=>n+s.duration,0)};
  }
  assetStates(projectId:number,assetId:string) {
    if(!this.projectExists(projectId))return null;
    const asset=this.db.prepare('SELECT id FROM workspace_assets WHERE id=? AND project_id=?').get(assetId,projectId);
    if(!asset)return null;
    return this.db.prepare('SELECT * FROM workspace_asset_states WHERE asset_id=? ORDER BY is_main DESC,position,name').all(assetId);
  }
  saveAssetDescription(projectId:number,assetId:string,description:unknown) {
    if(!this.projectExists(projectId))return null;
    if(typeof description!=='string'||description.length>5000)throw new Error('资产描述最多 5000 字');
    const updated=this.db.prepare('UPDATE workspace_assets SET description=? WHERE id=? AND project_id=?').run(description,assetId,projectId);
    return updated.changes ? this.assets(projectId)?.find(asset=>asset.id===assetId) : null;
  }
  saveAssetState(projectId:number,assetId:string,input:unknown) {
    if(!this.projectExists(projectId))return null;
    const asset=this.db.prepare('SELECT id,type FROM workspace_assets WHERE id=? AND project_id=?').get(assetId,projectId) as DBRow|undefined;
    if(!asset)return null;
    if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('状态格式无效');
    const value=input as Record<string,unknown>;
    const name=text(value.name,80),description=text(value.description,5000);
    if(!name||description===null)throw new Error('请填写状态名称和描述');
    const existing=this.assetStates(projectId,assetId) as DBRow[];
    if(existing.length>=30)throw new Error('状态数量达到上限');
    if(asset.type==='prop'&&existing.length>=1)throw new Error('道具默认仅有一个主要形象；额外状态需在后续有明确剧本依据时开启');
    const isMain=existing.length===0?1:0;
    const id=randomUUID();
    this.db.prepare('INSERT INTO workspace_asset_states(id,asset_id,name,description,is_main,position) VALUES(?,?,?,?,?,?)').run(id,assetId,name,description,isMain,existing.length);
    return {id,assetId,name,description,isMain:Boolean(isMain)};
  }
  savePlan(episodeId:number, scriptRevision:unknown, input:unknown) {
    const draft=validateBreakdown(input);
    const episode=this.get(episodeId);
    if(!episode)return null;
    if(scriptRevision!==episode.scriptRevision)throw new Error('剧本在分析后已更新，请确认新剧本并重新拆镜');
    const existingIds=new Set(this.shots(episodeId).map(s=>s.id));
    for (const shot of draft.shots) {
      // Reject someone else's shot ID rather than quietly assigning it to this episode.
      if (!existingIds.has(shot.id) && this.db.prepare('SELECT 1 FROM workspace_shots WHERE id=?').get(shot.id))
        throw new Error('镜头 ID 已被其他剧集使用');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM workspace_shot_assets WHERE shot_id IN (SELECT id FROM workspace_shots WHERE episode_id=?)').run(episodeId);
      this.db.prepare('DELETE FROM workspace_shots WHERE episode_id=?').run(episodeId);
      const insertShot=this.db.prepare('INSERT INTO workspace_shots (id,episode_id,position,framing,camera,cut,scene,visual,dialogue,sound,duration) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      draft.shots.forEach((s,i)=>insertShot.run(s.id,episodeId,i+1,s.framing,s.camera,s.cut,s.scene,s.visual,s.dialogue,s.sound,s.duration));
      const insertAsset=this.db.prepare('INSERT OR IGNORE INTO workspace_assets (id,project_id,type,name,description) VALUES (?,?,?,?,?)');
      const findAsset=this.db.prepare('SELECT id FROM workspace_assets WHERE project_id=? AND type=? AND name=?');
      const link=this.db.prepare('INSERT OR IGNORE INTO workspace_shot_assets (shot_id,asset_id) VALUES (?,?)');
      draft.assets.forEach((a)=>{
        insertAsset.run(randomUUID(),episode.projectId,a.type,a.name,a.description||'');
        const row=findAsset.get(episode.projectId,a.type,a.name) as {id:string};
        a.shotNumbers.forEach((number)=>link.run(draft.shots[number-1].id,row.id));
      });
      this.db.prepare('UPDATE workspace_episodes SET plan_revision=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(episode.scriptRevision,episodeId);
      this.db.exec('COMMIT');
    }catch(err){this.db.exec('ROLLBACK');throw err;}
    return this.plan(episodeId);
  }
}
