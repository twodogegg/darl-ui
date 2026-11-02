// @vitest-environment node
import { expect, it } from 'vitest';
import { validateNovelOutline, validateNovelOutlineAdjustment } from '../examples/agent-chat/server/novel-outline';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore } from '../examples/agent-chat/server/studio';
import { VideoRedraw } from '../examples/agent-chat/server/video-redraw';

const outline = { core: '生存与选择', story: '主人公面对灾难并作出选择。', keep: '', remove: '', merge: '', risks: '', episodes: '第一集：灾难发生。', roles: [{ name: '主角', position: '幸存者', relationships: '', arc: '' }], scenes: [], props: [] };

it('accepts a complete outline and assigns real IDs to table rows', () => {
  const result = validateNovelOutline(outline);
  expect(result.core).toBe(outline.core);
  expect(result.roles).toEqual([expect.objectContaining({ id: expect.any(String), name: '主角' })]);
  expect(outline.roles[0]).not.toHaveProperty('id');
});

it('rejects incomplete or invalid outlines rather than silently saving them', () => {
  expect(() => validateNovelOutline({ ...outline, story: '' })).toThrow('故事内核');
  expect(() => validateNovelOutline({ ...outline, roles: [{ name: '', position: '', relationships: '', arc: '' }] })).toThrow('roles');
  expect(() => validateNovelOutline({ ...outline, scenes: null })).toThrow('scenes');
});

it('merges only the requested fields and retains unchanged table row IDs', () => {
  const current = { ...outline, roles: [{ ...outline.roles[0], id: 'role-1' }] };
  const result = validateNovelOutlineAdjustment({ changes: { risks: '补充风险' } }, current);
  expect(result.risks).toBe('补充风险');
  expect(result.story).toBe(current.story);
  expect(result.roles).toEqual(current.roles);
  expect(() => validateNovelOutlineAdjustment({ changes: {} }, current)).toThrow('修改字段');
  expect(() => validateNovelOutlineAdjustment({ changes: { unexpected: 'x' } }, current)).toThrow('修改字段');
});

it('rejects blank or oversized modification feedback before creating a task', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'outline-feedback-'));
  const storage = new LocalStorage(directory);
  const files = new FileStore(storage.path);
  const projects = new ProjectStore(storage.path, files);
  projects.create({ name: '大纲', description: null, aspect_ratio: '9:16', style_catalog_id: 4 });
  const studio = new StudioStore(projects);
  const service = new VideoRedraw(studio, {});
  try {
    const project = studio.snapshot().projects[0];
    const input = { projectId: project.id, version: project._version, requestId: crypto.randomUUID(), autoApply: true };
    expect(() => service.startOutline({ ...input, requirements: '  ' })).toThrow('修改意见');
    expect(() => service.startOutline({ ...input, requirements: '字'.repeat(2001) })).toThrow('修改意见');
    expect(service.readOutline(project.id).job).toBeNull();
  } finally { service.dispose(); await rm(directory, { recursive: true, force: true }); }
});
