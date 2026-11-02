// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createWorkflowDebugLog, logWorkflowDebug, runWithWorkflowDebug, sanitizeWorkflowDebug, workflowDebugStream } from '../examples/agent-chat/server/workflow-debug';
import { expandWorkflowLogEntries } from '../examples/agent-chat/server/workflow-log.mjs';

it('combines stream fragments and preserves incomplete tool inputs', () => {
  const stream = workflowDebugStream();
  stream.add({ type: 'text-delta', id: 'text', delta: '完整' });
  stream.add({ type: 'text-delta', id: 'text', delta: '输出' });
  stream.add({ type: 'reasoning-delta', id: 'reasoning', delta: '第一段' });
  stream.add({ type: 'reasoning-delta', id: 'reasoning', delta: '第二段' });
  stream.add({ type: 'tool-input-delta', id: 'completed', delta: '{"ok":true}' });
  stream.add({ type: 'tool-call', toolCallId: 'completed' });
  stream.add({ type: 'tool-input-delta', id: 'partial', delta: '{"unfinished":' });
  expect(stream.result()).toEqual({ outputText: '完整输出', reasoningText: '第一段第二段', parts: [{ type: 'tool-call', toolCallId: 'completed' }], incompleteToolInputs: { partial: '{"unfinished":' } });
});

it('does not create a log when disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-debug-'));
  try {
    expect(createWorkflowDebugLog(root, false)).toBeUndefined();
    await expect(stat(join(root, 'workflow-debug'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('records complete text and task metadata while removing credentials and inline media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-debug-'));
  try {
    const write = createWorkflowDebugLog(root, true, () => ['private-provider-value'])!;
    const full = '剧本正文'.repeat(15000);
    await runWithWorkflowDebug({ write, jobId: 'job', projectId: 'project', episodeId: 'episode', kind: 'plan-storyboard', phase: () => '分析并编写' }, async () => {
      logWorkflowDebug('model.request', { input: { text: full, authorization: 'Bearer private-provider-value', url: 'https://example.test/video.mp4?x=1&token=secret-value', image: { type: 'image', data: 'inline-pixels' } } });
      logWorkflowDebug('model.response', { outputText: full });
    });
    const path = join(root, 'workflow-debug', 'project-project_plan-storyboard_job.jsonl');
    const lines = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ jobId: 'job', projectId: 'project', episodeId: 'episode', kind: 'plan-storyboard', phase: '分析并编写', event: 'model.request' });
    expect(lines[0].input.text).toBe(full);
    expect(lines[1].outputText).toBe(full);
    expect(JSON.stringify(lines)).not.toContain('private-provider-value');
    expect(JSON.stringify(lines)).not.toContain('secret-value');
    expect(JSON.stringify(lines)).not.toContain('inline-pixels');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const nested = sanitizeWorkflowDebug('{"api_key":"private-value","text":"preserved"}') as string;
    expect(nested).not.toContain('private-value');
    expect(nested).toContain('preserved');
    const signedUrl = sanitizeWorkflowDebug('https://example.test/?api_key=private-key&X-Amz-Security-Token=private-token&x=preserved') as string;
    expect(signedUrl).not.toContain('private-key');
    expect(signedUrl).not.toContain('private-token');
    expect(signedUrl).toContain('x=preserved');
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('keeps simultaneous tasks in separate files with all events for each task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-debug-'));
  try {
    const write = createWorkflowDebugLog(root, true)!;
    const context = (jobId: string) => ({ write, jobId, projectId: '46', kind: 'extract-assets', phase: () => '运行中' });
    await Promise.all(['first', 'second'].map(jobId => runWithWorkflowDebug(context(jobId), async () => {
      logWorkflowDebug('model.request', { input: jobId });
      await Promise.resolve();
      logWorkflowDebug('model.response', { outputText: jobId });
    })));
    for (const jobId of ['first', 'second']) {
      const path = join(root, 'workflow-debug', `project-46_extract-assets_${jobId}.jsonl`);
      const lines = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(lines.map(line => line.event)).toEqual(['model.request', 'model.response']);
      expect(lines.every(line => line.jobId === jobId)).toBe(true);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('stores only added messages and can reconstruct every text and video request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-debug-'));
  try {
    const write = createWorkflowDebugLog(root, true)!;
    const base = { jobId: 'job', projectId: '46', kind: 'extract-assets', event: 'model.request' };
    const prompt = [{ role: 'system', content: '完整规则' }, { role: 'user', content: '完整上下文'.repeat(1000) }];
    const added = { role: 'assistant', content: '上一轮输出' };
    const video = [{ role: 'user', content: '原片地址' }];
    const inputs = [
      { prompt, temperature: 0.5 },
      { prompt: [...prompt, added], temperature: 0.7 },
      { prompt: [...prompt, added, { role: 'tool', content: '结果' }], temperature: 0.7 },
      { messages: video, model: 'video' },
      { messages: [...video, added], model: 'video' },
      { prompt: [{ role: 'system', content: '其他上下文' }], temperature: 0 },
    ];
    inputs.forEach((input, index) => write({ ...base, callId: `call-${index}`, input }));
    const path = join(root, 'workflow-debug', 'project-46_extract-assets_job.jsonl');
    const saved = (await readFile(path, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(saved[1].inputRef).toEqual({ callId: 'call-0', field: 'prompt', prefixCount: 2 });
    expect(saved[1].input.prompt).toEqual([added]);
    expect(saved[2].inputRef).toEqual({ callId: 'call-1', field: 'prompt', prefixCount: 3 });
    expect(saved[4].inputRef).toEqual({ callId: 'call-3', field: 'messages', prefixCount: 1 });
    expect(saved[5].inputRef).toBeUndefined();
    expect(expandWorkflowLogEntries(saved).map((entry: { input: unknown }) => entry.input)).toEqual(inputs);
    expect(() => expandWorkflowLogEntries(saved.slice(1))).toThrow('引用无效或缺失');
  } finally { await rm(root, { recursive: true, force: true }); }
});
