import { unzipSync } from 'fflate';
import type { AgentSkill, AgentSkillResource } from './types';

const MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const MAX_RESOURCES = 100;
const MAX_RESOURCE_BYTES = 2 * 1024 * 1024;
const RESOURCE_ROOTS = ['references/', 'scripts/', 'assets/', 'agents/'];

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `skill-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function decodeText(bytes: Uint8Array, label: string) {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (value.includes('\u0000')) throw new Error('binary content');
    return value;
  } catch {
    throw new Error(`${label} 不是有效的 UTF-8 文本`);
  }
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safePath(path: string) {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\\') || normalized.split('/').some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error(`技能包包含不安全的路径：${path}`);
  }
  return normalized;
}

function parseScalar(value: string) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

export function parseSkillMarkdown(markdown: string, fallbackName = '未命名 Skill') {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error('SKILL.md 缺少 YAML frontmatter');
  const fields = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const field = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (field) fields.set(field[1], parseScalar(field[2]));
  }
  const name = fields.get('name')?.trim() || fallbackName.trim();
  const description = fields.get('description')?.trim() || '';
  const instructions = markdown.slice(match[0].length).trim();
  if (!name) throw new Error('Skill 名称不能为空');
  if (!description) throw new Error('SKILL.md 的 description 不能为空');
  if (!instructions) throw new Error('SKILL.md frontmatter 后缺少指令正文');
  return { name, description, instructions };
}

type PackageEntry = { path: string; bytes: Uint8Array };

async function entriesFromFiles(files: File[]) {
  if (!files.length) throw new Error('没有选择 Skill 文件');
  const first = files[0];
  if (files.length === 1 && (first.name.toLowerCase().endsWith('.zip') || first.type === 'application/zip')) {
    if (first.size > MAX_PACKAGE_BYTES) throw new Error('Skill ZIP 不能超过 10 MB');
    const unzipped = unzipSync(new Uint8Array(await first.arrayBuffer()));
    const entries: PackageEntry[] = [];
    let expanded = 0;
    for (const [rawPath, bytes] of Object.entries(unzipped)) {
      if (rawPath.endsWith('/')) continue;
      const path = safePath(rawPath);
      if (path.split('/').some((part) => part === '__MACOSX' || part === '.skillhub')) continue;
      expanded += bytes.byteLength;
      if (expanded > MAX_EXPANDED_BYTES) throw new Error('Skill 解压后的内容不能超过 20 MB');
      entries.push({ path, bytes });
    }
    return entries;
  }
  const entries: PackageEntry[] = [];
  for (const file of files) {
    if (file.size > MAX_RESOURCE_BYTES) throw new Error(`文件 ${file.name} 超过 2 MB`);
    const rawPath = file.webkitRelativePath || file.name;
    entries.push({ path: safePath(rawPath), bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  return entries;
}

export async function importSkillPackage(files: File[]): Promise<AgentSkill> {
  const entries = await entriesFromFiles(files);
  const manifest = entries.find((entry) => /(^|\/)SKILL\.md$/i.test(entry.path));
  if (!manifest) throw new Error('Skill 包缺少 SKILL.md');
  const manifestParts = manifest.path.split('/');
  const base = manifestParts.length > 1 ? manifestParts.slice(0, -1).join('/') + '/' : '';
  const markdown = decodeText(manifest.bytes, 'SKILL.md');
  const parsed = parseSkillMarkdown(markdown, manifestParts.at(-2) || '导入的 Skill');
  const resources: AgentSkillResource[] = [];
  for (const entry of entries) {
    if (entry.path === manifest.path) continue;
    if (!entry.path.startsWith(base)) continue;
    const path = entry.path.slice(base.length);
    if (!RESOURCE_ROOTS.some((root) => path.startsWith(root))) continue;
    if (resources.length >= MAX_RESOURCES) throw new Error('Skill 最多允许 100 个资源文件');
    if (entry.bytes.byteLength > MAX_RESOURCE_BYTES) throw new Error(`资源 ${path} 超过 2 MB`);
    if (path.startsWith('assets/')) {
      try {
        resources.push({ path, content: decodeText(entry.bytes, `资源 ${path}`) });
      } catch {
        resources.push({ path, content: encodeBase64(entry.bytes), encoding: 'base64' });
      }
    } else {
      resources.push({ path, content: decodeText(entry.bytes, `资源 ${path}`) });
    }
  }
  return {
    id: makeId(),
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
    resources,
    category: '通用',
    enabled: true,
    scope: 'custom',
    version: '1.0',
    updatedAt: new Date().toISOString(),
  };
}

export function skillMarkdown(skill: Pick<AgentSkill, 'name' | 'description' | 'instructions'>) {
  return `---\nname: ${skill.name}\ndescription: ${skill.description}\n---\n\n${(skill.instructions || '').trim()}\n`;
}

export function newSkillDraft(): AgentSkill {
  return { id: makeId(), name: '', description: '', instructions: '', resources: [], category: '通用', enabled: true, scope: 'custom', version: '0.1' };
}
