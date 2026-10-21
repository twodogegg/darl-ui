// @vitest-environment node
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { SkillRuntime } from '../examples/agent-chat/server/skill-runtime';
import type { AgentSkill } from '../src';

describe('generic local Skill runtime', () => {
  let directory: string;
  let runtime: SkillRuntime;
  let files: FileStore;
  const skills: AgentSkill[] = [{ id: 'example', name: '任意处理流程', description: '将文本转成报告', instructions: '读取 references/rules.md，再运行 scripts/report.mjs。', resources: [
    { path: 'references/rules.md', content: '输出实际输入内容。' },
    { path: 'package.json', content: '{"type":"module"}' },
    { path: 'scripts/report.mjs', content: "import fs from 'node:fs'; fs.writeFileSync('report.html', '<h1>' + fs.readFileSync('input.txt', 'utf8') + '</h1>'); console.log('rendered');" },
    { path: 'templates/data.bin', content: 'AP8B', encoding: 'base64' },
    { path: 'scripts/check', content: '#!/bin/sh\nprintf executable' },
  ] }];
  const context = (sessionId = 'one', signal = new AbortController().signal, agentId?: string) => ({ sessionId, runId: 'run', skills, signal, agentId });
  const execute = async (name: string, args: Record<string, unknown> = {}, ctx = context()) => runtime.execute(`builtin_${name}`, args, ctx) as Promise<Record<string, any>>;
  const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
  const node = quote(process.execPath);

  beforeEach(async () => {
    directory = await realpath(await mkdtemp(join(tmpdir(), 'darl-skill-runtime-')));
    const storage = new LocalStorage(directory);
    files = new FileStore(storage.path);
    runtime = new SkillRuntime(directory, files);
  });
  afterEach(async () => { runtime.dispose(); await rm(directory, { recursive: true, force: true }); });

  it('discovers metadata, loads arbitrary package resources, executes a real script and publishes the result', async () => {
    const instructions = await runtime.instructions(skills, ['example'], runtime.workspace('one'));
    expect(instructions).toContain('explicitlyRequested');
    expect(instructions).not.toContain(skills[0].instructions);
    const loaded = await execute('load_skill', { skillId: 'example' });
    expect(loaded.manifest).toContain(skills[0].instructions);
    expect(await readFile(join(loaded.directory, 'templates/data.bin'))).toEqual(Buffer.from([0, 255, 1]));
    await execute('write_file', { path: 'input.txt', content: '实际输入' });
    const result = await execute('run_command', { command: `${node} ${quote(join(loaded.directory, 'scripts/report.mjs'))}`, waitMs: 1000 });
    expect(result).toMatchObject({ status: 'exited', exitCode: 0, isError: false });
    expect(result.output).toContain('rendered');
    expect((await execute('run_command', { command: quote(join(loaded.directory, 'scripts/check')), waitMs: 1000 })).output).toBe('executable');
    const published = await execute('publish_file', { path: 'report.html' });
    expect(published.url).toMatch(/^\/api\/files\/.+\?download=1$/);
    expect((await files.getBytes(published.fileId))?.bytes.toString()).toBe('<h1>实际输入</h1>');
  });

  it('supports file pagination, binary writes, attachments and empty directories', async () => {
    expect((await execute('list_files')).entries).toEqual([]);
    await execute('write_file', { path: 'data.txt', content: 'abcdef' });
    expect(await execute('read_file', { path: 'data.txt', offset: 2, limit: 2 })).toMatchObject({ content: 'cd', nextOffset: 4, truncated: true });
    await execute('write_file', { path: 'binary/data.bin', content: 'AP8B', encoding: 'base64' });
    expect((await execute('read_file', { path: 'binary/data.bin', encoding: 'base64' })).content).toBe('AP8B');
    const file = await files.put(Buffer.from('attachment'), 'text/plain', 'source.txt');
    await execute('import_file', { path: 'inputs/source.txt', fileId: file.id });
    expect((await execute('read_file', { path: 'inputs/source.txt' })).content).toBe('attachment');
    await expect(execute('import_file', { path: 'inputs/missing.txt', fileId: 'missing' })).rejects.toThrow('附件不存在');
    await expect(execute('write_file', { path: 'bad.bin', content: '!!!!', encoding: 'base64' })).rejects.toThrow('base64');
  });

  it('returns actual exit errors and missing dependencies without fabricating success', async () => {
    const result = await execute('run_command', { command: `${node} -e 'process.stderr.write("failure");process.exit(7)'`, waitMs: 1000 });
    expect(result).toMatchObject({ status: 'exited', exitCode: 7, isError: true });
    expect(result.output).toContain('failure');
    const missing = await execute('run_command', { command: 'darl_nonexistent_cli_246813579', waitMs: 1000 });
    expect(missing.isError).toBe(true);
    expect(missing.exitCode).not.toBe(0);
  });

  it('does not forward backend secrets and bounds captured command output', async () => {
    process.env.DARL_RUNTIME_TEST_SECRET = 'private-runtime-test';
    try {
      const env = await execute('run_command', { command: `${node} -e 'console.log(process.env.DARL_RUNTIME_TEST_SECRET)'`, waitMs: 1000 });
      expect(env.output).toBe('undefined\n');
      const noisy = await execute('run_command', { command: `${node} -e 'process.stdout.write("x".repeat(1100000))'`, waitMs: 1000 });
      expect(noisy).toMatchObject({ exitCode: 0, truncated: true });
      expect(noisy.output.length).toBeLessThanOrEqual(32_000);
    } finally { delete process.env.DARL_RUNTIME_TEST_SECRET; }
  });

  it('tracks long processes, reads remaining output, and separates sessions and child agents', async () => {
    const result = await execute('run_command', { command: `${node} -e 'console.log("first");setTimeout(()=>console.log("second"),250)'`, waitMs: 0 });
    expect(result.status).toBe('running');
    const finished = await execute('process_status', { processId: result.processId, waitMs: 2000 });
    expect(finished).toMatchObject({ status: 'exited', exitCode: 0 });
    expect(finished.output).toContain('second');
    expect((await execute('process_status', { processId: result.processId, offset: finished.nextOffset })).output).toBe('');
    await expect(execute('process_status', { processId: result.processId }, context('two'))).rejects.toThrow('进程不存在');
    await expect(execute('process_status', { processId: result.processId }, context('one', undefined, 'child'))).rejects.toThrow('进程不存在');
  });

  it('cancels process groups and enforces command timeouts', async () => {
    const controller = new AbortController();
    const result = await execute('run_command', { command: `${node} -e 'setInterval(()=>{},1000)'`, waitMs: 0 }, context('one', controller.signal));
    controller.abort();
    expect((await execute('process_status', { processId: result.processId, waitMs: 500 })).status).toBe('cancelled');
    const timed = await execute('run_command', { command: `${node} -e 'setInterval(()=>{},1000)'`, timeoutMs: 100, waitMs: 1000 });
    expect(timed).toMatchObject({ status: 'timed_out', isError: true });
    const stopped = await execute('run_command', { command: `${node} -e 'setInterval(()=>{},1000)'`, waitMs: 0 });
    expect((await execute('stop_process', { processId: stopped.processId })).status).toBe('cancelled');
  });

  it('preserves background work after a successful turn and cleans it on failed turns', async () => {
    const controller = new AbortController();
    const result = await execute('run_command', { command: `${node} -e 'setTimeout(()=>console.log("complete"),200)'`, waitMs: 0 }, context('one', controller.signal));
    runtime.finishRun('run', true);
    controller.abort();
    expect((await execute('process_status', { processId: result.processId, waitMs: 1500 })).status).toBe('exited');
    const failed = await execute('run_command', { command: `${node} -e 'setInterval(()=>{},1000)'`, waitMs: 0 });
    runtime.finishRun('run', false);
    expect((await execute('process_status', { processId: failed.processId })).status).toBe('cancelled');
  });

  it('rejects traversal, symlinks and unknown skills; keeps workspaces persistent', async () => {
    await expect(execute('write_file', { path: '../outside.txt', content: 'bad' })).rejects.toThrow('超出工作区');
    await execute('list_files');
    await mkdir(join(directory, 'external'));
    await writeFile(join(directory, 'external', 'secret.txt'), 'private');
    await symlink(join(directory, 'external'), join(runtime.workspace('one'), 'link'));
    await expect(execute('read_file', { path: 'link/secret.txt' })).rejects.toThrow('符号链接');
    await expect(execute('write_file', { path: 'link/new.txt', content: 'bad' })).rejects.toThrow('符号链接');
    await expect(execute('load_skill', { skillId: 'missing' })).rejects.toThrow('不存在');
    await expect(execute('load_skill', { skillId: 'example' }, { ...context(), skills: [{ ...skills[0], resources: [{ path: '../escape.txt', content: 'bad' }] }] })).rejects.toThrow('安全');
    await execute('write_file', { path: 'persistent.txt', content: 'saved' });
    const restarted = new SkillRuntime(directory, files);
    expect(await restarted.execute('builtin_read_file', { path: 'persistent.txt' }, context())).toMatchObject({ content: 'saved' });
    await expect(execute('read_file', { path: 'persistent.txt' }, context('two'))).rejects.toThrow();
  });
});
