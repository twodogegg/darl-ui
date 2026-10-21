import { useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, FileText, FolderOpen, Plus, Search, Sparkles, Star, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { Button } from '../ui/Button';
import { Switch } from '../ui/FormControls';
import type { AgentSkill, AgentSkillResource } from './types';
import { importSkillPackage, newSkillDraft, nextSkillVersion, validateSkill } from './skill-package';
import { SkillFileTree, SkillMarkdown } from './SkillFiles';

type Filter = 'all' | 'favorite' | 'mine' | 'builtin';
type ImportConflict = { preview: AgentSkill; existing: AgentSkill };
const skillNameKey = (name: string) => name.trim().toLocaleLowerCase();

export function SkillManager({ open, skills, onClose, onSave, onDelete, onImport, onFavoriteChange, onCreateViaChat, createViaChatDisabled = false }: {
  open: boolean;
  skills: AgentSkill[];
  onClose: () => void;
  onCreateViaChat?: () => void | Promise<void>;
  createViaChatDisabled?: boolean;
  onSave: (skill: AgentSkill) => void | Promise<void>;
  onDelete: (skillId: string) => void | Promise<void>;
  onImport: (skill: AgentSkill) => void | Promise<void>;
  onFavoriteChange: (skillId: string, favorite: boolean) => void | Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AgentSkill>(newSkillDraft());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [resourcePath, setResourcePath] = useState<string | null>(null);
  const [fileMode, setFileMode] = useState<'preview' | 'edit'>('preview');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [importConflict, setImportConflict] = useState<ImportConflict | null>(null);
  const [importConflictError, setImportConflictError] = useState('');
  const [importConflictBusy, setImportConflictBusy] = useState(false);
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
    setFileMode(initial ? 'preview' : 'edit');
    setError('');
    setNotice('');
    setImportConflict(null);
    setImportConflictError('');
    setImportConflictBusy(false);
    // The manager is intentionally reset only when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const resources = draft.resources || [];
  const currentResource = resources.find((resource) => resource.path === resourcePath);
  const isBuiltin = selected?.scope === 'builtin';
  const filePath = currentResource?.path ?? 'SKILL.md';
  const fileContent = currentResource ? currentResource.content : draft.instructions || '';
  const isMarkdown = /\.(md|markdown)$/i.test(filePath);
  const isBinary = currentResource?.encoding === 'base64';
  const selectFile = (path: string) => {
    setResourcePath(path === 'SKILL.md' ? null : path);
    setFileMode(/\.(md|markdown)$/i.test(path) ? 'preview' : 'edit');
  };
  const select = (skill: AgentSkill) => {
    if (dirty && !window.confirm('当前 Skill 有未保存修改，是否放弃？')) return;
    setSelectedId(skill.id);
    setDraft({ ...skill, resources: skill.resources?.map((resource) => ({ ...resource })) });
    setResourcePath(null);
    setFileMode('preview');
    setError('');
    setNotice('');
  };
  const create = () => {
    if (dirty && !window.confirm('当前 Skill 有未保存修改，是否放弃？')) return;
    setSelectedId(null);
    setDraft(newSkillDraft());
    setResourcePath(null);
    setFileMode('edit');
    setError('');
    setNotice('');
  };
  const save = async () => {
    const { enabled: _enabled, ...withoutLegacyEnabled } = draft;
    const next: AgentSkill = { ...withoutLegacyEnabled, name: draft.name?.trim() || '', description: draft.description?.trim() || '', instructions: draft.instructions?.trim() || '', resources: resources.map((resource) => ({ ...resource, path: resource.path.trim() })), version: nextSkillVersion(draft.version), updatedAt: new Date().toISOString(), allowImplicitInvocation: draft.allowImplicitInvocation !== false, scope: draft.scope || 'custom' };
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
  const commitImport = async (preview: AgentSkill, existing?: AgentSkill) => {
    const imported: AgentSkill = existing
      ? { ...preview, id: existing.id, favorite: existing.favorite, scope: 'custom', updatedAt: new Date().toISOString() }
      : preview;
    if (existing) {
      setImportConflictBusy(true);
      setImportConflictError('');
    }
    try {
      await onImport(imported);
      setSelectedId(imported.id);
      setDraft(imported);
      setResourcePath(null);
      setImportConflict(null);
      setImportConflictError('');
      setNotice(existing ? `已覆盖“${imported.name}”。` : `已导入“${imported.name}”。`);
      setError('');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '导入 Skill 失败';
      if (existing) setImportConflictError(message);
      else setError(message);
    } finally {
      if (existing) setImportConflictBusy(false);
    }
  };
  const importFiles = async (files: File[]) => {
    if (!files.length) return;
    setError('');
    setImportConflictError('');
    try {
      const imported = await importSkillPackage(files);
      const key = skillNameKey(imported.name);
      const existing = skills.find((skill) => skillNameKey(skill.name) === key);
      if (existing) {
        setImportConflict({ preview: imported, existing });
        return;
      }
      await commitImport(imported);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入 Skill 失败');
    }
  };
  const cancelImport = () => {
    setImportConflict(null);
    setImportConflictError('');
    setNotice('已取消导入。');
    setError('');
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
    if (patch.path !== undefined) setResourcePath(patch.path);
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
          <div className="darl-agent-manager-actions"><Button variant="outline" size="sm" onClick={create}><Plus data-icon="inline-start" />新建</Button><Button variant="outline" size="sm" onClick={() => importInput.current?.click()}><Upload data-icon="inline-start" />导入</Button>{onCreateViaChat ? <Button variant="outline" size="sm" className="darl-agent-create-skill" disabled={createViaChatDisabled} onClick={() => { if (dirty && !window.confirm('当前 Skill 有未保存修改，是否放弃并通过对话创建？')) return; void Promise.resolve().then(onCreateViaChat).catch(reason => setError(reason instanceof Error ? reason.message : '无法开始创建 Skill')); }}><Sparkles data-icon="inline-start" />通过对话创建</Button> : <Button variant="outline" size="sm" onClick={() => importFolderInput.current?.click()}><FolderOpen data-icon="inline-start" />文件夹</Button>}<input ref={importInput} type="file" hidden multiple aria-label="导入 Skill 文件" accept=".md,.zip,text/markdown,application/zip" onChange={(event) => { void importFiles(Array.from(event.target.files || [])); event.currentTarget.value = ''; }} /><input ref={(node) => { importFolderInput.current = node; node?.setAttribute('webkitdirectory', ''); }} type="file" hidden multiple aria-label="导入 Skill 文件夹" onChange={(event) => { void importFiles(Array.from(event.target.files || [])); event.currentTarget.value = ''; }} /></div>
          <label className="darl-agent-manager-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 Skill" aria-label="搜索 Skill" /></label>
          <div className="darl-agent-manager-filters" role="tablist" aria-label="Skill 筛选">{([['all', '全部'], ['favorite', '收藏'], ['mine', '我的'], ['builtin', '内置']] as const).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)}>{label}</button>)}</div>
          <div className="darl-agent-skill-list">{visible.map((skill) => <div key={skill.id} className={`darl-agent-skill-list-row${skill.id === selectedId ? ' is-selected' : ''}`}><button type="button" className="darl-agent-skill-list-main" onClick={() => select(skill)}><span className="darl-agent-skill-list-icon"><Sparkles /></span><span><strong>{skill.name || '未命名 Skill'}</strong><small>{skill.description || '暂无描述'}</small><em>{skill.scope === 'builtin' ? '内置' : '我的'}{skill.version ? ` · v${skill.version}` : ''}</em></span></button><button type="button" className="darl-agent-skill-favorite" aria-label={skill.favorite ? `取消收藏 ${skill.name}` : `收藏 ${skill.name}`} aria-pressed={skill.favorite ? 'true' : 'false'} onClick={() => void toggleFavorite(skill)}><Star fill={skill.favorite ? 'currentColor' : 'none'} /></button>{skill.id === selectedId && <Check className="darl-agent-skill-selected-check" />}</div>)}{!visible.length && <p className="darl-agent-empty">没有匹配的 Skill</p>}</div>
        </aside>
        <section className="darl-agent-skill-editor">
          <div className="darl-agent-skill-editor-heading"><div><span className="darl-agent-manager-eyebrow">{selectedId ? 'EDIT SKILL' : 'NEW SKILL'}</span><h3>{draft.name || '新建 Skill'}</h3></div><div className="darl-agent-skill-editor-actions">{selected && !isBuiltin && <Button variant="ghost" size="sm" onClick={() => void remove()}><Trash2 data-icon="inline-start" />删除</Button>}</div></div>
          <div className="darl-agent-skill-form"><label><span>名称</span><input value={draft.name || ''} disabled={isBuiltin} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="例如：代码审查" /></label><label><span>描述</span><textarea value={draft.description || ''} disabled={isBuiltin} rows={2} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="说明什么时候使用这个 Skill" /></label><div className="darl-agent-skill-auto-invocation"><Switch aria-label="允许自动调用" checked={draft.allowImplicitInvocation !== false} onChange={(event) => setDraft({ ...draft, allowImplicitInvocation: event.target.checked })}>允许自动调用</Switch><small>关闭后，只有在聊天中手动 @ 引用时才会使用。</small></div></div>
          <div className="darl-agent-skill-files">
            <aside><div className="darl-agent-skill-files-heading"><strong>文件 <span>{resources.length + 1}</span></strong><Button variant="ghost" size="sm" disabled={isBuiltin} onClick={() => { let index = resources.length + 1; while (resources.some((resource) => resource.path === `references/resource-${index}.md`)) index += 1; const path = `references/resource-${index}.md`; setDraft({ ...draft, resources: [...resources, { path, content: '' }] }); setResourcePath(path); setFileMode('edit'); }}><Plus data-icon="inline-start" />资源</Button></div>
              <SkillFileTree key={draft.id} paths={['SKILL.md', ...resources.map((resource) => resource.path)]} selectedPath={filePath} onSelect={selectFile} />
            </aside>
            <div className="darl-agent-skill-file-editor">
              <div className="darl-agent-skill-file-title"><FileText />{currentResource && fileMode === 'edit' ? <input aria-label="资源路径" value={currentResource.path} disabled={isBuiltin} onChange={(event) => updateResource({ path: event.target.value })} /> : <strong title={filePath}>{filePath}</strong>}
                {!isBinary && <div className="darl-agent-skill-file-modes" role="group" aria-label="文件显示方式">{isMarkdown && <button type="button" aria-pressed={fileMode === 'preview'} onClick={() => setFileMode('preview')}>预览</button>}<button type="button" aria-pressed={fileMode === 'edit' || !isMarkdown} onClick={() => setFileMode('edit')}>{isBuiltin ? '源码' : '编辑'}</button></div>}
                {currentResource && !isBuiltin && <Button variant="ghost" size="icon" aria-label="删除资源" onClick={() => { setDraft({ ...draft, resources: resources.filter((resource) => resource !== currentResource) }); setResourcePath(null); }}><Trash2 /></Button>}
              </div>
              {isBinary ? <div className="darl-agent-skill-file-empty"><FileText /><strong>{filePath.split('/').pop()}</strong><span>二进制资源无法在此编辑</span></div> : isMarkdown && fileMode === 'preview' ? <div className="darl-agent-skill-file-preview" key={filePath}>{fileContent.trim() ? <SkillMarkdown content={fileContent} filePath={filePath} resources={resources} onSelect={selectFile} /> : <p className="darl-agent-empty">暂无内容{!isBuiltin && '，点击「编辑」开始编写。'}</p>}</div> : <textarea value={fileContent} readOnly={isBuiltin} spellCheck={false} onChange={(event) => currentResource ? updateResource({ content: event.target.value }) : setDraft({ ...draft, instructions: event.target.value })} aria-label={`${filePath} 内容`} placeholder="写下输入要求、执行流程和输出格式…" />}
            </div>
          </div>
          <div className="darl-agent-skill-manager-feedback" role="status">{error ? <span className="is-error">{error}</span> : notice || (dirty ? '有未保存的修改' : 'Skill 已保存')}</div>
          <footer className="darl-agent-skill-manager-footer"><span>{isBuiltin ? '内置 Skill 只能修改自动调用设置。' : '保存后会增加版本号。'}</span><div><Button variant="outline" onClick={close}>关闭</Button><Button disabled={!dirty} onClick={() => void save()}>保存修改</Button></div></footer>
        </section>
      </div>
      </DialogPrimitive.Content>
      <DialogPrimitive.Root open={Boolean(importConflict)} onOpenChange={(nextOpen) => { if (!nextOpen && !importConflictBusy) cancelImport(); }}>
        <DialogPrimitive.Overlay className="darl-agent-skill-conflict-overlay" />
        <DialogPrimitive.Content className="darl-agent-skill-conflict" role="alertdialog" aria-describedby="darl-agent-skill-conflict-description">
          <span className="darl-agent-skill-conflict-icon" aria-hidden="true"><TriangleAlert /></span>
          <DialogPrimitive.Title className="darl-agent-skill-conflict-title">已存在同名 Skill</DialogPrimitive.Title>
          <DialogPrimitive.Description id="darl-agent-skill-conflict-description" className="darl-agent-skill-conflict-text">
            {importConflict && <>名为“{importConflict.existing.name}”的 Skill 已存在。覆盖后原有描述、指令和资源将被替换，且无法恢复。</>}
          </DialogPrimitive.Description>
          {importConflictError && <p className="darl-agent-skill-conflict-error" role="alert">{importConflictError}</p>}
          <div className="darl-agent-skill-conflict-actions">
            <Button variant="outline" size="sm" disabled={importConflictBusy} onClick={cancelImport}>取消导入</Button>
            <Button variant="destructive" size="sm" disabled={importConflictBusy} onClick={() => { if (importConflict) void commitImport(importConflict.preview, importConflict.existing); }}>{importConflictBusy ? '覆盖中…' : '覆盖'}</Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Root>
  </DialogPrimitive.Root>;
}
