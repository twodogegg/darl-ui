// @vitest-environment node
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { SkillLibrary } from '../examples/agent-chat/server/skill-library';
import { SkillRuntime } from '../examples/agent-chat/server/skill-runtime';

let directory: string;
let library: SkillLibrary;
let runtime: SkillRuntime;
const manifest = '---\nname: test-workflow\ndescription: Format a user supplied list\n---\n\nRead references/format.md and format the input.';
const context = (signal = new AbortController().signal) => ({ sessionId: 'test', runId: 'run', skills: library.list(), signal });
const run = (name: string, args: Record<string, unknown>, signal?: AbortSignal) => runtime.execute(`builtin_${name}`, args, context(signal));
beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'darl-skill-library-')));
  const storage = new LocalStorage(directory);
  library = new SkillLibrary(storage);
  await library.ready;
  runtime = new SkillRuntime(directory, new FileStore(storage.path), library);
});
afterEach(async () => { runtime.dispose(); await rm(directory, { recursive: true, force: true }); });

it('creates a complete website Skill, immediately loads it, persists it and requires an explicit version for updates', async () => {
  await run('write_file', { path: 'draft/SKILL.md', content: manifest });
  await run('write_file', { path: 'draft/references/format.md', content: 'Use numbered lines.' });
  await run('write_file', { path: 'draft/assets/binary.dat', content: 'AP8B', encoding: 'base64' });
  const created = await run('create_skill', { path: 'draft' }) as { skillId: string; version: string };
  expect(created).toMatchObject({ version: '1.0', resourceCount: 2 });
  const loaded = await run('load_skill', { skillId: created.skillId }) as { directory: string };
  expect(await readFile(join(loaded.directory, 'assets/binary.dat'))).toEqual(Buffer.from([0, 255, 1]));
  expect((await run('list_skills', {}) as { skills: unknown[] }).skills).toHaveLength(2);
  expect((await run('create_skill', { path: 'draft' }) as { skillId: string }).skillId).toBe(created.skillId);
  await run('write_file', { path: 'draft/references/format.md', content: 'Use bullets.' });
  await expect(run('create_skill', { path: 'draft' })).rejects.toThrow('同名');
  await expect(run('create_skill', { path: 'draft', skillId: created.skillId, expectedVersion: '0.0' })).rejects.toThrow('版本');
  expect(await run('create_skill', { path: 'draft', skillId: created.skillId, expectedVersion: '1.0' })).toMatchObject({ skillId: created.skillId, version: '1.1' });
  const reopened = new SkillLibrary(new LocalStorage(directory));
  await reopened.ready;
  expect(reopened.list().find(skill => skill.id === created.skillId)?.resources?.find(item => item.path === 'references/format.md')?.content).toBe('Use bullets.');
});

it('imports downloaded ZIPs using the website parser without executing scripts', async () => {
  const zip = zipSync({ 'example/SKILL.md': strToU8(manifest), 'example/scripts/test.sh': strToU8('#!/bin/sh\ntouch should-not-exist'), 'example/.git/config': strToU8('ignored') });
  await run('write_file', { path: 'download.zip', content: Buffer.from(zip).toString('base64'), encoding: 'base64' });
  expect(await run('create_skill', { path: 'download.zip' })).toMatchObject({ resourceCount: 1 });
  await expect(readFile(join(runtime.workspace('test'), 'should-not-exist'))).rejects.toThrow();
});

it('rejects invalid, escaping, symlinked, oversized and cancelled packages without adding a Skill', async () => {
  await run('write_file', { path: 'invalid/SKILL.md', content: '<html>not a Skill</html>' });
  await expect(run('create_skill', { path: 'invalid' })).rejects.toThrow('frontmatter');
  await expect(run('create_skill', { path: '../' })).rejects.toThrow('超出工作区');
  await run('write_file', { path: 'draft/SKILL.md', content: manifest });
  await symlink(join(directory, 'data.sqlite'), join(runtime.workspace('test'), 'draft/link'));
  await expect(run('create_skill', { path: 'draft' })).rejects.toThrow('符号链接');
  await rm(join(runtime.workspace('test'), 'draft/link'));
  await writeFile(join(runtime.workspace('test'), 'draft/large'), Buffer.alloc(2 * 1024 * 1024 + 1));
  await expect(run('create_skill', { path: 'draft' })).rejects.toThrow('超过');
  await rm(join(runtime.workspace('test'), 'draft/large'));
  await mkdir(join(runtime.workspace('test'), 'draft/second'));
  await writeFile(join(runtime.workspace('test'), 'draft/second/SKILL.md'), manifest);
  await expect(run('create_skill', { path: 'draft' })).rejects.toThrow('一次只能');
  const controller = new AbortController(); controller.abort();
  await expect(run('create_skill', { path: 'draft' }, controller.signal)).rejects.toThrow();
  expect(library.list().map(skill => skill.id)).toEqual(['builtin:skill-creator']);
});
