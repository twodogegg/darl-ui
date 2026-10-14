import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, FileText, FolderOpen, Pencil, Plus, Search, Sparkles, Star, Trash2, Upload, X } from 'lucide-react';
import { Button } from '../ui/Button';
import type { AgentSkill, AgentSkillResource } from './types';
import { importSkillPackage, newSkillDraft, nextSkillVersion, validateSkill } from './skill-package';

type Filter = 'all' | 'favorite' | 'mine' | 'builtin';

export function SkillManager({ open, skills, onClose, onSave, onDelete, onImport, onFavoriteChange, onUse }: {
  open: boolean;
  skills: AgentSkill[];
  onClose: () => void;
  onSave: (skill: AgentSkill) => void | Promise<void>;
  onDelete: (skillId: string) => void | Promise<void>;
  onImport: (skill: AgentSkill) => void | Promise<void>;
  onFavoriteChange: (skillId: string, favorite: boolean) => void | Promise<void>;
  onUse: (skill: AgentSkill) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentSkill>(newSkillDraft());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [resourcePath, setResourcePath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importPreview, setImportPreview] = useState<AgentSkill | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importFolderInput = useRef<HTMLInputElement>(null);

  const selected = skills.find((skill) => skill.id === selectedId);
  const dirty = selected
    ? JSON.stringify(selected) !== JSON.stringify(draft)
    : Boolean(draft.name?.trim() || draft.description?.trim() || draft.instructions?.trim() || draft.resources?.length);
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase();
    return skills.filter((skill) => {
      const mine = skill.scope !== 'builtin';
      if (filter === 'favorite' && !skill.favorite) return false;
      if (filter === 'mine' && !mine) return false;
      if (filter === 'builtin' && mine) return false;
      return !text || `${skill.name} ${skill.description || ''} ${skill.id}`.toLocaleLowerCase().includes(text);
    });
  }, [filter, query, skills]);

  useEffect(() => {
    if (!open) return;
    const initial = skills.find((skill) => skill.id === selectedId) || skills[0];
    setSelectedId(initial?.id || null);
    setDraft(initial ? { ...initial, resources: initial.resources?.map((resource) => ({ ...resource })) } : newSkillDraft());
    setResourcePath(null);
    setError('');
    setNotice('');
    // The manager is intentionally reset only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const resources = draft.resources || [];
  const currentResource = resources.find((resource) => resource.path === resourcePath);
  const isBuiltin = selected?.scope === 'builtin';
  const select = (skill: AgentSkill) => {
    if (dirty && !window.confirm('当前 Skill 有未保存修改，是否放弃？')) return;
    setSelectedId(skill.id);
    setDraft({ ...skill, resources: skill.resources?.map((resource) => ({ ...resource })) });
    setResourcePath(null);
    setError('');
    setNotice('');
  };
  const create = () => {
    if (dirty && !window.confirm('当前 Skill 有未保存修改，是否放弃？')) return;
    setSelectedId(null);
    setDraft(newSkillDraft());
    setResourcePath(null);
    setError('');
    setNotice('');
  };
  const save = async () => {
    const next: AgentSkill = { ...draft, name: draft.name?.trim() || '', description: draft.description?.trim() || '', instructions: draft.instructions?.trim() || '', resources: resources.map((resource) => ({ ...resource, path: resource.path.trim() })), version: nextSkillVersion(draft.version), updatedAt: new Date().toISOString(), enabled: draft.enabled !== false, scope: draft.scope || 'custom' };
    try {
      validateSkill(next);
      await onSave(next);
      setSelectedId(next.id);
      setDraft(next);
      setNotice('Skill 已保存。');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存 Skill 失败');
    }
  };
  const remove = async () => {
    if (!selected || !window.confirm(`确定删除“${selected.name}”？`)) return;
    try {
      await onDelete(selected.id);
      const next = skills.find((skill) => skill.id !== selected.id);
      setSelectedId(next?.id || null);
      setDraft(next ? { ...next, resources: next.resources?.map((resource) => ({ ...resource })) } : newSkillDraft());
      setNotice('Skill 已删除。');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除 Skill 失败');
    }
  };
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      const imported = await importSkillPackage(files);
      setImportPreview(imported);
      setNotice(`已读取“${imported.name}”，请确认导入。`);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入 Skill 失败');
    }
  };
  const confirmImport = async () => {
    if (!importPreview) return;
    const originalName = importPreview.name;
    let name = originalName;
    let suffix = 1;
    while (skills.some((skill) => skill.name.toLocaleLowerCase() === name.toLocaleLowerCase())) name = `${originalName}（导入 ${suffix++}）`;
    const imported = { ...importPreview, name };
    try {
      await onImport(imported);
      setSelectedId(imported.id);
      setDraft(imported);
      setResourcePath(null);
      setImportPreview(null);
      setNotice(`已导入“${imported.name}”。`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入 Skill 失败');
    }
  };
  const close = () => {
    if (dirty && !window.confirm('当前 Skill 有未保存修改，是否放弃？')) return;
    onClose();
  };
  const toggleFavorite = async (skill: AgentSkill) => {
    try {
      await onFavoriteChange(skill.id, !skill.favorite);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '收藏状态保存失败');
    }
  };
  const updateResource = (patch: Partial<AgentSkillResource>) => {
    if (!currentResource) return;
    if (patch.path) setResourcePath(patch.path);
    setDraft((current) => ({ ...current, resources: (current.resources || []).map((resource) => resource === currentResource ? { ...resource, ...patch } : resource) }));
  };

  return <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}>
      <DialogPrimitive.Overlay className="darl-agent-skill-manager" />
      <DialogPrimitive.Content className="darl-agent-skill-manager-card" aria-labelledby="darl-agent-skill-manager-title" aria-describedby="darl-agent-skill-manager-description">
      <header className="darl-agent-skill-manager-header">
        <div className="darl-agent-manager-title-wrap"><span className="darl-agent-manager-title-icon"><Sparkles /></span><div><span className="darl-agent-manager-eyebrow">SKILL LIBRARY</span><DialogPrimitive.Title asChild><h2 id="darl-agent-skill-manager-title">管理 Skill</h2></DialogPrimitive.Title><DialogPrimitive.Description asChild><p id="darl-agent-skill-manager-description">导入、编辑和选择可复用的 Agent 工作流程。</p></DialogPrimitive.Description></div></div>
        <Button variant="ghost" size="icon" aria-label="关闭 Skill 管理" onClick={close}><X /></Button>
      </header>
      <div className="darl-agent-skill-manager-body">
        <aside className="darl-agent-skill-list-pane">
          <div className="darl-agent-manager-actions"><Button variant="outline" size="sm" onClick={create}><Plus data-icon="inline-start" />新建</Button><Button variant="outline" size="sm" onClick={() => importInput.current?.click()}><Upload data-icon="inline-start" />导入</Button><Button variant="outline" size="sm" onClick={() => importFolderInput.current?.click()}><FolderOpen data-icon="inline-start" />文件夹</Button><input ref={importInput} type="file" hidden multiple accept=".md,.zip,text/markdown,application/zip" onChange={(event) => { void importFiles(Array.from(event.target.files || [])); event.currentTarget.value = ''; }} /><input ref={(node) => { importFolderInput.current = node; node?.setAttribute('webkitdirectory', ''); }} type="file" hidden multiple onChange={(event) => { void importFiles(Array.from(event.target.files || [])); event.currentTarget.value = ''; }} /></div>
          {importPreview && <div className="darl-agent-skill-import-preview"><strong>导入预览</strong><b>{importPreview.name}</b><span>{importPreview.description}</span><small>{importPreview.resources?.length || 0} 个资源 · v{importPreview.version}</small><div><Button size="sm" onClick={() => void confirmImport()}>确认导入</Button><Button size="sm" variant="ghost" onClick={() => setImportPreview(null)}>取消</Button></div></div>}
          <label className="darl-agent-manager-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Skill" aria-label="搜索 Skill" /></label>
          <div className="darl-agent-manager-filters" role="tablist" aria-label="Skill 筛选">{([['all', '全部'], ['favorite', '收藏'], ['mine', '我的'], ['builtin', '内置']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
          <div className="darl-agent-skill-list">{visible.map((skill) => <div key={skill.id} className={`darl-agent-skill-list-row${skill.id === selectedId ? ' is-selected' : ''}`}><button type="button" className="darl-agent-skill-list-main" onClick={() => select(skill)}><span className="darl-agent-skill-list-icon"><Sparkles /></span><span><strong>{skill.name || '未命名 Skill'}</strong><small>{skill.description || '暂无描述'}</small><em>{skill.scope === 'builtin' ? '内置' : '我的'}{skill.version ? ` · v${skill.version}` : ''}</em></span></button><button type="button" className="darl-agent-skill-favorite" aria-label={skill.favorite ? `取消收藏 ${skill.name}` : `收藏 ${skill.name}`} aria-pressed={skill.favorite ? 'true' : 'false'} onClick={() => void toggleFavorite(skill)}><Star fill={skill.favorite ? 'currentColor' : 'none'} /></button>{skill.id === selectedId && <Check className="darl-agent-skill-selected-check" />}</div>)}{!visible.length && <p className="darl-agent-empty">没有匹配的 Skill</p>}</div>
        </aside>
        <section className="darl-agent-skill-editor">
          <div className="darl-agent-skill-editor-heading"><div><span className="darl-agent-manager-eyebrow">{selectedId ? 'EDIT SKILL' : 'NEW SKILL'}</span><h3>{draft.name || '新建 Skill'}</h3></div><div className="darl-agent-skill-editor-actions">{selected && <Button variant="ghost" size="sm" onClick={() => onUse(draft)}><Pencil data-icon="inline-start" />引用</Button>}{selected && !isBuiltin && <Button variant="ghost" size="sm" onClick={() => void remove()}><Trash2 data-icon="inline-start" />删除</Button>}</div></div>
          <div className="darl-agent-skill-form"><label><span>名称</span><input value={draft.name || ''} disabled={isBuiltin} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：代码审查" /></label><label><span>描述</span><textarea value={draft.description || ''} disabled={isBuiltin} rows={2} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="说明什么时候使用这个 Skill" /></label><label className="darl-agent-skill-switch"><input type="checkbox" checked={draft.enabled !== false} disabled={isBuiltin} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span>启用这个 Skill</span></label></div>
          <div className="darl-agent-skill-files"><aside><div className="darl-agent-skill-files-heading"><strong>文件</strong><Button variant="ghost" size="sm" disabled={isBuiltin} onClick={() => { const path = `references/resource-${resources.length + 1}.md`; setDraft({ ...draft, resources: [...resources, { path, content: '' }] }); setResourcePath(path); }}><Plus data-icon="inline-start" />资源</Button></div><button type="button" className={!resourcePath ? 'is-selected' : ''} onClick={() => setResourcePath(null)}><FileText />SKILL.md</button>{resources.map((resource) => <button type="button" key={resource.path} className={resource.path === resourcePath ? 'is-selected' : ''} onClick={() => setResourcePath(resource.path)}><FolderOpen />{resource.path}</button>)}</aside><div className="darl-agent-skill-file-editor">{currentResource ? <><div className="darl-agent-skill-file-title"><input value={currentResource.path} disabled={isBuiltin} onChange={(event) => updateResource({ path: event.target.value })} /><Button variant="ghost" size="icon" disabled={isBuiltin} aria-label="删除资源" onClick={() => { setDraft({ ...draft, resources: resources.filter((resource) => resource !== currentResource) }); setResourcePath(null); }}><Trash2 /></Button></div><textarea value={currentResource.encoding === 'base64' ? '二进制资源无法在此编辑' : currentResource.content} disabled={isBuiltin || currentResource.encoding === 'base64'} onChange={(event) => updateResource({ content: event.target.value })} aria-label={`${currentResource.path} 内容`} /> </> : <><div className="darl-agent-skill-file-title"><strong>SKILL.md</strong><span>Markdown 指令</span></div><textarea value={draft.instructions || ''} disabled={isBuiltin} onChange={(event) => setDraft({ ...draft, instructions: event.target.value })} aria-label="SKILL.md 内容" placeholder="写下输入要求、执行流程和输出格式…" /></>}</div></div>
          <div className="darl-agent-skill-manager-feedback" role="status">{error ? <span className="is-error">{error}</span> : notice || (dirty ? '有未保存的修改' : 'Skill 已保存')}</div>
          <footer className="darl-agent-skill-manager-footer"><span>{isBuiltin ? '内置 Skill 不能直接修改。' : '保存后会增加版本号。'}</span><div><Button variant="outline" onClick={close}>关闭</Button><Button disabled={isBuiltin || !dirty} onClick={() => void save()}>保存修改</Button></div></footer>
        </section>
      </div>
      </DialogPrimitive.Content>
  </DialogPrimitive.Root>;
}
