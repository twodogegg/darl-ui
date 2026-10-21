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

  it('reads OpenAI implicit invocation policy and defaults to allowed', async () => {
    const files = [
      file('---\nname: 自动整理\ndescription: 自动整理材料\n---\n\n执行整理。', 'demo/SKILL.md'),
      file('interface:\n  display_name: 自动整理\npolicy:\n  allow_implicit_invocation: false\n', 'demo/agents/openai.yaml', 'text/yaml'),
    ];
    Object.defineProperty(files[0], 'webkitRelativePath', { value: 'demo/SKILL.md' });
    Object.defineProperty(files[1], 'webkitRelativePath', { value: 'demo/agents/openai.yaml' });
    await expect(importSkillPackage(files)).resolves.toMatchObject({ name: '自动整理', allowImplicitInvocation: false });
    const defaultSkill = await importSkillPackage([file('---\nname: 默认\ndescription: 默认\n---\n\n执行。', 'default/SKILL.md')]);
    expect(defaultSkill.allowImplicitInvocation).toBe(true);
  });

  it('rejects a package without a manifest', async () => {
    await expect(importSkillPackage([file('内容', 'notes.md')])).rejects.toThrow('缺少 SKILL.md');
  });

  it('keeps root dependency files and binary resources in arbitrary directories', async () => {
    const skill = await importSkillPackage([
      file('---\nname: generic\ndescription: 通用工具\n---\n\n读取配套文件。', 'generic/SKILL.md'),
      file('{"type":"module"}', 'generic/package.json'),
      file('requests', 'generic/requirements.txt'),
      { name: 'generic/templates/data.bin', size: 3, arrayBuffer: async () => new Uint8Array([0, 255, 1]).buffer } as File,
    ]);
    expect(skill.resources).toEqual(expect.arrayContaining([
      { path: 'package.json', content: '{"type":"module"}' },
      { path: 'requirements.txt', content: 'requests' },
      { path: 'templates/data.bin', content: 'AP8B', encoding: 'base64' },
    ]));
  });
});
