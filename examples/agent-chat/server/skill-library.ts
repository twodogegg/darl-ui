import { lstat, readFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { AgentSkill } from '../../../src/components/agent-sidebar/types';
import { importSkillPackage, nextSkillVersion, skillPathIgnored, validateSkill } from '../../../src/components/agent-sidebar/skill-package';
import { LocalStorage, type ClientState } from './storage';

/** Read a single package without following links or executing package code. */
export async function readSkillPackage(path: string, signal?: AbortSignal): Promise<AgentSkill> {
  const files: File[] = [];
  let bytes = 0;
  let entries = 0;
  const visit = async (absolute: string, relative: string, depth: number) => {
    signal?.throwIfAborted();
    if (skillPathIgnored(relative)) return;
    if (++entries > 500 || depth > 20) throw new Error('Skill 目录过大或层级过深');
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('Skill 不能包含符号链接');
    if (info.isDirectory()) {
      for (const entry of await readdir(absolute)) await visit(join(absolute, entry), relative ? `${relative}/${entry}` : entry, depth + 1);
      return;
    }
    const limit = depth === 0 && /\.zip$/i.test(absolute) ? 10 : 2;
    if (!info.isFile() || info.size > limit * 1024 * 1024) throw new Error(`Skill 文件无效或超过 ${limit} MiB：${relative}`);
    bytes += info.size;
    if (files.length >= 101 || bytes > 20 * 1024 * 1024) throw new Error('Skill 最多 101 个文件，总大小不超过 20 MiB');
    const content = await readFile(absolute);
    files.push(new File([new Uint8Array(content)], relative || basename(absolute)));
  };
  await visit(path, '', 0);
  signal?.throwIfAborted();
  return importSkillPackage(files);
}

/** Everything except the heavy package body, used by lists that never open a Skill. */
export function skillSummary(skill: AgentSkill): AgentSkill {
  return {
    id: skill.id, name: skill.name, description: skill.description, version: skill.version, slug: skill.slug,
    category: skill.category, allowImplicitInvocation: skill.allowImplicitInvocation, scope: skill.scope,
    favorite: skill.favorite, updatedAt: skill.updatedAt,
  };
}

/** Website-owned library, separate from chat autosaves. */
export class SkillLibrary {
  readonly ready: Promise<void>;
  private builtin!: AgentSkill;
  /** Parsing the stored JSON is ~20 ms for a multi-MB library; every save invalidates it. */
  private stored?: AgentSkill[];
  /** Builtin package plus its preferences; reused by full and summary reads. */
  private first?: AgentSkill;

  constructor(private storage: LocalStorage) {
    if (!storage.getConfig<AgentSkill[]>('skills')) {
      storage.setConfig('skills', storage.getConfig<ClientState>('clientState')?.skills || []);
    }
    this.ready = readSkillPackage(fileURLToPath(new URL('../skills/skill-creator', import.meta.url))).then(skill => {
      this.builtin = { ...skill, id: 'builtin:skill-creator', scope: 'builtin', allowImplicitInvocation: true };
    });
    // Requests await ready and report failures; avoid an unhandled rejection before the first request.
    void this.ready.catch(() => {});
  }

  list(): AgentSkill[] {
    if (!this.builtin) throw new Error('Skills 尚未初始化');
    this.first ||= { ...this.builtin, favorite: this.storage.getConfig<boolean>('skillCreatorFavorite') || false, ...this.storage.getConfig<Pick<AgentSkill, 'favorite' | 'allowImplicitInvocation' | 'version' | 'updatedAt'>>('skillCreatorPreferences') };
    return [this.first, ...this.storedSkills()];
  }
  /** Metadata-only view for pickers and dialogs; carries no instructions or resource bodies. */
  catalog(): AgentSkill[] {
    return this.list().map(skillSummary);
  }
  private storedSkills(): AgentSkill[] {
    return this.stored ||= this.storage.getConfig<AgentSkill[]>('skills') || [];
  }
  private writeStored(skills: AgentSkill[]) {
    this.storage.setConfig('skills', skills);
    this.stored = skills;
  }

  save(skill: AgentSkill) {
    if (!skill || typeof skill.id !== 'string' || !skill.id || typeof skill.name !== 'string') throw new Error('Skill 格式无效');
    if (skill.id === this.builtin.id) {
      const content = ({ favorite: _favorite, allowImplicitInvocation: _automatic, version: _version, updatedAt: _updatedAt, ...rest }: AgentSkill) => rest;
      if (!isDeepStrictEqual(content(skill), content(this.builtin))) throw new Error('内置 Skill 不能被覆盖，请另存为自定义 Skill');
      this.storage.setConfig('skillCreatorPreferences', { favorite: skill.favorite === true, allowImplicitInvocation: skill.allowImplicitInvocation !== false, version: skill.version || this.builtin.version, updatedAt: skill.updatedAt });
      this.first = undefined;
      return skill;
    }
    validateSkill(skill);
    const custom = this.list().slice(1);
    const key = (item: AgentSkill) => (item.slug || item.name).trim().toLocaleLowerCase();
    if (this.list().some(item => item.id !== skill.id && key(item) === key(skill))) throw new Error('同名 Skill 已存在，请编辑已有 Skill 或使用其他名称');
    const saved = { ...skill, scope: 'custom' as const, updatedAt: new Date().toISOString() };
    const next = [...custom.filter(item => item.id !== saved.id), saved];
    if (next.length > 199 || JSON.stringify(next).length > 80 * 1024 * 1024) throw new Error('Skills 库已达到容量限制');
    this.writeStored(next);
    return saved;
  }

  create(skill: AgentSkill, skillId?: string, expectedVersion?: string) {
    if (skillId) {
      const previous = this.list().find(item => item.id === skillId);
      if (!previous || previous.scope === 'builtin') throw new Error('要更新的自定义 Skill 不存在');
      if (!expectedVersion || expectedVersion !== (previous.version || '0.0')) throw new Error('Skill 版本已变化，请重新读取后更新');
      return this.save({ ...skill, id: previous.id, version: nextSkillVersion(previous.version), favorite: previous.favorite, allowImplicitInvocation: previous.allowImplicitInvocation });
    }
    if (expectedVersion) throw new Error('更新版本时必须指定 skillId');
    const existing = this.list().find(item => (item.slug || item.name).toLowerCase() === (skill.slug || skill.name).toLowerCase());
    if (existing) {
      const content = (item: AgentSkill) => JSON.stringify([item.slug, item.frontmatter, item.description, item.instructions, [...item.resources || []].sort((a, b) => a.path.localeCompare(b.path))]);
      if (content(existing) === content(skill)) return existing;
      throw new Error(`同名 Skill 已存在（${existing.id}，版本 ${existing.version}），请明确更新或换用其他名称`);
    }
    return this.save(skill);
  }

  delete(id: string) {
    if (id === this.builtin.id) throw new Error('默认创建技能不能删除');
    this.writeStored(this.storedSkills().filter(skill => skill.id !== id));
  }
}
