import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, FolderPlus, Pencil, Trash2, UploadCloud } from 'lucide-react';
import { StyleSelector, type StyleOption, type StyleCreateRequest } from '@darl/ui';
import { storageImage, styleOptionsFromCatalog, type StyleCatalog } from './workspace-styles';
import './projects.css';

type Project = {
  id: number; name: string; description?: string | null; aspect_ratio: string;
  style_catalog_id?: number | null;
  cover_asset?: { storage_key?: string | null; file_id?: string; thumbnail_url?: string; preview_url?: string } | null;
  style?: { name?: string; id?: number } | null;
  episode_count?: number;
};
type Draft = { name: string; description: string; aspect_ratio: string; style_catalog_id: string };
const blank: Draft = { name: '', description: '', aspect_ratio: '9:16', style_catalog_id: '' };
const ratios = ['9:16', '16:9', '4:3', '1:1', '3:4', '21:9'];

async function backend<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/workspace/${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.code && !['OK', 'CREATED'].includes(payload.code))) {
    const detail = payload.detail;
    throw new Error(payload.error || detail?.message || payload.message || `请求失败（${response.status}）`);
  }
  return payload.data as T;
}
const json = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const projectCover = (project: Project): string | undefined =>
  storageImage(project.cover_asset?.thumbnail_url) || storageImage(project.cover_asset?.storage_key);

export function ProjectsPage({ onBack }: { onBack: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editing, setEditing] = useState<Project | null>(null);
  const [detail, setDetail] = useState<Project | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const [editingStyle, setEditingStyle] = useState<StyleOption | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const fetchStyles = async () => {
    const catalog = await backend<StyleCatalog>('styles');
    const next = styleOptionsFromCatalog(catalog);
    setStyles(next);
    return next;
  };
  const createStyle = async (input: StyleCreateRequest) => {
    const data = new FormData();
    data.set('name', input.name);
    data.set('prompt', input.description);
    if (input.referenceImage) data.set('reference_image', input.referenceImage);
    const created = await backend<{ id: number }>('styles', { method: 'POST', body: data });
    await fetchStyles();
    setEditingStyle(null);
    update('style_catalog_id', String(created.id));
  };
  const editStyle = (style: StyleOption) => { setEditingStyle(style); setStyleOpen(true); };
  const updateStyle = async (style: StyleOption, input: StyleCreateRequest) => {
    const data = new FormData();
    data.set('name', input.name);
    data.set('prompt', input.description);
    if (input.referenceImage) data.set('reference_image', input.referenceImage);
    await backend(`styles/${encodeURIComponent(style.id)}`, { method: 'PATCH', body: data });
    await fetchStyles();
    setEditingStyle(null);
  };
  const load = async () => {
    setLoading(true);
    try {
      const [items] = await Promise.all([
        backend<{ items: Project[] }>('projects'),
        fetchStyles(),
      ]);
      setProjects(items.items || []);
      setError('');
    } catch (failure) { setError((failure as Error).message); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const startCreate = () => {
    setEditing(null); setDraft(blank); setCoverFile(null); setError(''); setNotice(''); setFormOpen(true);
  };
  const startEdit = (item: Project) => {
    setEditing(item);
    setDraft({ name: item.name, description: item.description || '',
      aspect_ratio: item.aspect_ratio || '9:16', style_catalog_id: item.style_catalog_id ? String(item.style_catalog_id) : '' });
    setCoverFile(null); setError(''); setNotice(''); setFormOpen(true);
  };
  const update = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const uploadCover = async (projectId: number, file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)
      throw new Error('封面只支持 PNG、JPG、WebP，最大 10MB');
    const form = new FormData();
    form.append('image', file);
    const cover = await backend<{ file_id: string }>(`projects/${projectId}/covers/upload`, { method: 'POST', body: form });
    await backend(`projects/${projectId}/covers/files/${cover.file_id}/select`, { method: 'POST' });
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name || !draft.style_catalog_id) { setError('请填写项目标题并选择视觉风格'); return; }
    setBusy(true); setError(''); setNotice('');
    let projectId: number | undefined;
    try {
      if (editing) {
        await backend(`projects/${editing.id}`, json('PATCH', {
          name, description: draft.description.trim() || null,
          style_catalog_id: Number(draft.style_catalog_id), aspect_ratio: draft.aspect_ratio,
        }));
        projectId = editing.id;
      } else {
        const created = await backend<{ project_id: number }>('projects', json('POST', {
          name, description: draft.description.trim() || null,
          style_catalog_id: Number(draft.style_catalog_id), aspect_ratio: draft.aspect_ratio,
        }));
        projectId = created.project_id;
      }
      if (coverFile) await uploadCover(projectId, coverFile);
      setFormOpen(false);
      await load();
      if (detail?.id === projectId) {
        setDetail(await backend<Project>(`projects/${projectId}`));
      }
      setNotice(editing ? '项目已更新' : '项目已创建');
    } catch (failure) {
      setError((failure as Error).message + (projectId && !editing ? '。项目可能已经创建，请先返回列表检查，避免重复创建。' : ''));
      await load();
    } finally { setBusy(false); }
  };
  const archive = async (project: Project) => {
    if (!window.confirm(`确定归档项目“${project.name}”吗？项目将不再出现在列表中。`)) return;
    setBusy(true); setError('');
    try {
      await backend(`projects/${project.id}`, { method: 'DELETE' });
      setDetail(null); await load(); setNotice('项目已归档');
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };

  return <main className="workspace-projects">
    <div className="workspace-projects-heading">
      <div><button type="button" className="workspace-link" onClick={onBack}><ArrowLeft size={16} />返回</button>
        <h1>{detail ? detail.name : '我的项目'}</h1>
        <p>{detail ? '项目基本信息；剧集与剧本将在下一阶段加入。' : '创建项目，逐步建立你的影视创作工作空间。'}</p></div>
      {!detail && <button type="button" className="workspace-primary" onClick={startCreate}><FolderPlus size={17} />创建项目</button>}
    </div>
    {error && <p role="alert" className="workspace-error">{error}</p>}
    {notice && <p role="status" className="workspace-notice">{notice}</p>}
    {loading ? <p>正在加载项目…</p> : detail ? <section className="workspace-project-card workspace-detail">
      {projectCover(detail) && <img className="workspace-cover" src={storageImage(detail.cover_asset?.preview_url) || storageImage(detail.cover_asset?.file_id && `/api/files/${detail.cover_asset.file_id}`)} alt={`${detail.name}封面`} />}
      <div className="workspace-project-meta">
        <p>{detail.description || '暂无简介'}</p>
        <p>画面比例：{detail.aspect_ratio}</p>
        <p>视觉风格：{styles.find((s) => s.id === String(detail.style_catalog_id))?.name || detail.style?.name || '未设置'}</p>
        <p>剧集：{detail.episode_count ?? 0} 集（逐集管理后续接入）</p>
        <div className="workspace-project-actions">
          <button type="button" onClick={() => startEdit(detail)}><Pencil size={15} />编辑项目</button>
          <button type="button" disabled={busy} onClick={() => void archive(detail)}><Trash2 size={15} />归档项目</button>
          <button type="button" onClick={() => setDetail(null)}>返回列表</button>
        </div>
      </div>
    </section> : projects.length ? <div className="workspace-project-grid">
      {projects.map((item) => <article className="workspace-project-card" key={item.id}>
        <button className="workspace-card-open" type="button" onClick={() => void backend<Project>(`projects/${item.id}`).then(setDetail).catch((failure) => setError(failure.message))}>
          {projectCover(item) ? <img className="workspace-card-image" src={projectCover(item)} alt="" loading="lazy" /> : <div className="workspace-card-placeholder">未上传封面</div>}
          <h2>{item.name}</h2><p>{item.description || '暂无简介'}</p>
          <small>{item.aspect_ratio} · {styles.find((s) => s.id === String(item.style_catalog_id))?.name || '风格待加载'}</small>
        </button><div className="workspace-project-actions">
          <button type="button" onClick={() => startEdit(item)}>编辑</button>
          <button type="button" disabled={busy} onClick={() => void archive(item)}>归档</button>
        </div>
      </article>)}
    </div> : <div className="workspace-empty">还没有项目。点击“创建项目”开始。</div>}
    {formOpen && <div className="workspace-modal-backdrop" role="presentation">
      <section className="workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-form-title">
        <h2 id="workspace-form-title">{editing ? '编辑项目' : '创建项目'}</h2>
        <form onSubmit={(event) => void save(event)}>
          <label>项目标题 *<input required maxLength={30} value={draft.name} onChange={(e) => update('name', e.target.value)} placeholder="请输入标题" /></label>
          <label>项目简介（可选）<textarea rows={3} value={draft.description} onChange={(e) => update('description', e.target.value)} placeholder="可以留空" /></label>
          <label>视觉风格 *<button type="button" className="workspace-style-picker" onClick={() => setStyleOpen(true)}>{styles.find((s) => s.id === draft.style_catalog_id)?.name || '选择视觉风格'}</button></label>
          <label>画面比例 *<select value={draft.aspect_ratio} onChange={(e) => update('aspect_ratio', e.target.value)}>{ratios.map((ratio) => <option value={ratio} key={ratio}>{ratio}</option>)}</select></label>
          <label>项目封面（可选，仅手动上传）<span className="workspace-file-label"><UploadCloud size={16} />{coverFile?.name || '选择图片（PNG/JPG/WebP，最大10MB）'}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setCoverFile(e.target.files?.[0] || null)} />
          </label>
          {error && <p className="workspace-error" role="alert">{error}</p>}
          <div className="workspace-form-actions">
            <button type="button" onClick={() => { setFormOpen(false); setError(''); }} disabled={busy}>取消</button>
            <button type="submit" className="workspace-primary" disabled={busy || !draft.name.trim() || !draft.style_catalog_id}>{busy ? '正在保存…' : '保存项目'}</button>
          </div>
        </form>
      </section>
    </div>}
    <StyleSelector styles={styles} open={styleOpen} onOpenChange={(open) => { setStyleOpen(open); if (!open) setEditingStyle(null); }} value={draft.style_catalog_id || null}
      editingStyle={editingStyle} onEdit={editStyle} onUpdate={updateStyle}
      onChange={(style) => update('style_catalog_id', style?.id || '')} onCreate={createStyle} />
  </main>;
}
