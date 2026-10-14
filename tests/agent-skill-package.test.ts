import { describe, expect, it } from 'vitest';
import { importSkillPackage, parseSkillMarkdown } from '../src';

describe('Agent Skill package', () => {
  const file = (content: string, name: string, type = 'text/markdown') => ({ name, type, size: new TextEncoder().encode(content).byteLength, arrayBuffer: async () => new TextEncoder().encode(content).buffer }) as unknown as File;
  it('parses SKILL.md frontmatter and instructions', () => {
    expect(parseSkillMarkdown('---\nname: 报告整理\ndescription: 整理材料\n---\n\n# 流程\n先分类。')).toEqual({ name: '报告整理', description: '整理材料', instructions: '# 流程\n先分类。' });
  });

  it('imports a markdown Skill with text resources', async () => {
    const files = [
      file('---\nname: 审查\ndescription: 检查代码\n---\n\n逐项检查。', 'demo/SKILL.md'),
      file('检查权限和数据安全。', 'demo/references/check.md'),
    ];
    Object.defineProperty(files[0], 'webkitRelativePath', { value: 'demo/SKILL.md' });
    Object.defineProperty(files[1], 'webkitRelativePath', { value: 'demo/references/check.md' });
    const skill = await importSkillPackage(files);
    expect(skill.name).toBe('审查');
    expect(skill.resources).toEqual([{ path: 'references/check.md', content: '检查权限和数据安全。' }]);
  });

  it('rejects a package without a manifest', async () => {
    await expect(importSkillPackage([file('内容', 'notes.md')])).rejects.toThrow('缺少 SKILL.md');
  });
});
