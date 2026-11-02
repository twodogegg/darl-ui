import { unzipSync } from 'fflate';
import { parseDocument, stringify } from 'yaml';
import type { AgentSkill, AgentSkillResource } from './types';

const MAX_EXPANDED = 20 * 1024 * 1024;
const MAX_FILE = 2 * 1024 * 1024;
export const skillPathIgnored = (path: string) => path.split('/').some((part) => ['__MACOSX', '.skillhub', '.DS_Store', '.git', 'node_modules'].includes(part));
const newId = () => crypto.randomUUID();

/**
 * Metadata-only view of a Skill. Lists and pickers never need instructions or resource bodies;
 * projecting them away keeps saved snapshots comparable regardless of whether the body was loaded.
 */
export function skillSummary(skill: AgentSkill): AgentSkill {
  return {
    id: skill.id, name: skill.name, description: skill.description, version: skill.version, slug: skill.slug,
    category: skill.category, allowImplicitInvocation: skill.allowImplicitInvocation, scope: skill.scope,
    favorite: skill.favorite, updatedAt: skill.updatedAt,
  };
}


export function skillPathValid(path: string) {
  return !!path && !/[\\:\u0000-\u001f]/.test(path) && path.split('/').every((part) => !!part && part !== '.' && part !== '..');
}
function assertPath(path: string) {
  if (!skillPathValid(path)) throw new Error(`请使用安全的相对路径：${path}`);
}
function text(bytes: Uint8Array, label: string) {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (value.includes('\u0000')) throw new Error();
    return value;
  } catch { throw new Error(`${label} 不是有效的 UTF-8 文本`); }
}
function yaml(source: string) {
  const doc = parseDocument(source, { uniqueKeys: true });
  if (doc.errors.length) throw new Error(`YAML 格式错误：${doc.errors[0].message}`);
  const value: unknown = doc.toJS({ maxAliasCount: 0 });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('SKILL.md 元信息必须是对象');
  return doc;
}
export function parseSkillMarkdown(markdown: string, _fallbackName?: string) {
  const match = /^\uFEFF?---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter');
  const doc = yaml(match[1]);
  const name: unknown = doc.get('name');
  const description: unknown = doc.get('description');
  const instructions = markdown.slice(match[0].length).trim();
  if (typeof name !== 'string' || !name.trim()) throw new Error('SKILL.md 的 name 不能为空');
  if (typeof description !== 'string' || !description.trim()) throw new Error('SKILL.md 的 description 不能为空');
  if (!instructions) throw new Error('SKILL.md frontmatter 后缺少指令正文');
  return { name: name.trim(), description: description.trim(), instructions };
}
export function validateSkill(skill: AgentSkill) {
  if (!skill.name.trim() || !skill.description?.trim() || !skill.instructions?.trim()) throw new Error('请填写名称、描述和指令正文');
  if (skill.name.length > 100) throw new Error('名称不能超过 100 个字符');
  const paths = new Set<string>();
  let total = new TextEncoder().encode(skill.instructions).byteLength;
  if (total > MAX_FILE) throw new Error('指令正文不能超过 2 MB');
  if ((skill.resources?.length || 0) > 100) throw new Error('最多允许 100 个资源文件');
  for (const resource of skill.resources || []) {
    assertPath(resource.path);
    if (resource.path.toLowerCase() === 'skill.md') throw new Error('资源不能覆盖 SKILL.md');
    const key = resource.path.toLowerCase();
    if (paths.has(key)) throw new Error(`资源路径重复：${resource.path}`);
    paths.add(key);
    const size = resource.encoding === 'base64' ? atob(resource.content).length : new TextEncoder().encode(resource.content).byteLength;
    if (size > MAX_FILE) throw new Error(`资源 ${resource.path} 超过 2 MB`);
    total += size;
  }
  for (const path of paths) {
    const parts = path.split('/');
    parts.pop();
    while (parts.length) {
      if (paths.has(parts.join('/'))) throw new Error('文件路径与文件夹冲突');
      parts.pop();
    }
  }
  if (total > MAX_EXPANDED) throw new Error('Skill 总大小不能超过 20 MB');
}

type Entry = { path: string; bytes: Uint8Array };
async function readEntries(files: File[]): Promise<Entry[]> {
  if (!files.length) throw new Error('没有选择 Skill 文件');
  let total = 0;
  const paths = new Set<string>();
  const check = (path: string, size: number) => {
    assertPath(path);
    const key = path.toLowerCase();
    if (paths.has(key)) throw new Error(`文件路径重复：${path}`);
    paths.add(key);
    if (paths.size > 101) throw new Error('最多允许 100 个资源文件和一个 SKILL.md');
    if (size > MAX_FILE) throw new Error(`文件 ${path} 超过 2 MB`);
    total += size;
    if (total > MAX_EXPANDED) throw new Error('Skill 总大小不能超过 20 MB');
  };
  const first = files[0];
  if (files.length === 1 && /\.zip$/i.test(first.name)) {
    if (first.size > 10 * 1024 * 1024) throw new Error('Skill ZIP 不能超过 10 MB');
    const entries = unzipSync(new Uint8Array(await first.arrayBuffer()), { filter(entry) {
      if (skillPathIgnored(entry.name) || entry.name.endsWith('/')) return false;
      check(entry.name, entry.originalSize);
      return true;
    } });
    return Object.entries(entries).map(([path, bytes]) => ({ path, bytes }));
  }
  const entries: Entry[] = [];
  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    if (skillPathIgnored(path)) continue;
    check(path, file.size);
    entries.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return entries;
}
export async function importSkillPackage(files: File[]): Promise<AgentSkill> {
  const entries = await readEntries(files);
  const manifests = entries.filter((entry) => /(^|\/)SKILL\.md$/i.test(entry.path));
  if (!manifests.length) throw new Error('Skill 包缺少 SKILL.md');
  if (manifests.length !== 1) throw new Error('一次只能导入一个 Skill，包内必须只有一个 SKILL.md');
  const manifest = manifests[0];
  const base = manifest.path.slice(0, -'SKILL.md'.length);
  const markdown = text(manifest.bytes, 'SKILL.md');
  const parsed = parseSkillMarkdown(markdown);
  const resources: AgentSkillResource[] = [];
  for (const entry of entries) {
    if (entry === manifest) continue;
    const path = entry.path.slice(base.length);
    if (!entry.path.startsWith(base)) throw new Error(`文件不在 Skill 目录内：${entry.path}`);
    try { resources.push({ path, content: text(entry.bytes, path) }); }
    catch (error) {
      let binary = '';
      for (const byte of entry.bytes) binary += String.fromCharCode(byte);
      resources.push({ path, content: btoa(binary), encoding: 'base64' });
    }
  }
  const skill: AgentSkill = { id: newId(), ...parsed, slug: parsed.name, frontmatter: markdown.match(/^\uFEFF?---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---/)?.[1], resources, category: '通用', allowImplicitInvocation: true, scope: 'custom', version: '1.0' };
  const presentation = resources.find((item) => item.path === 'agents/openai.yaml' && !item.encoding);
  if (presentation) {
    const doc = yaml(presentation.content);
    const displayName: unknown = doc.getIn(['interface', 'display_name']);
    if (typeof displayName === 'string' && displayName.trim()) skill.name = displayName.trim();
    const allowImplicitInvocation: unknown = doc.getIn(['policy', 'allow_implicit_invocation']);
    if (allowImplicitInvocation !== undefined && typeof allowImplicitInvocation !== 'boolean') throw new Error('agents/openai.yaml 的 allow_implicit_invocation 必须是布尔值');
    if (typeof allowImplicitInvocation === 'boolean') skill.allowImplicitInvocation = allowImplicitInvocation;
  }
  validateSkill(skill);
  return skill;
}
export function skillMarkdown(skill: Pick<AgentSkill, 'name' | 'slug' | 'frontmatter' | 'description' | 'instructions'>) {
  const doc = skill.frontmatter ? yaml(skill.frontmatter) : yaml(stringify({ name: skill.slug || skill.name, description: skill.description || '' }));
  doc.set('name', skill.slug || skill.name);
  doc.set('description', skill.description || '');
  return `---\n${doc.toString().trimEnd()}\n---\n\n${(skill.instructions || '').trim()}\n`;
}
export function newSkillDraft(): AgentSkill {
  return { id: newId(), name: '', description: '', instructions: '', resources: [], category: '通用', allowImplicitInvocation: true, scope: 'custom', version: '0.0' };
}
export function nextSkillVersion(version = '0.0') {
  if (!/^\d+(\.\d+)*$/.test(version)) return `${version}.1`;
  const parts = version.split('.');
  parts[parts.length - 1] = String(Number(parts.at(-1)) + 1);
  return parts.join('.');
}
