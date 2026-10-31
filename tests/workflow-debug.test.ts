// @vitest-environment node
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createWorkflowDebugLog, logWorkflowDebug, runWithWorkflowDebug, sanitizeWorkflowDebug } from '../examples/agent-chat/server/workflow-debug';

it('does not create a log when disabled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-debug-'));
  try {
    expect(createWorkflowDebugLog(root, false)).toBeUndefined();
    await expect(stat(join(root, 'workflow-debug.jsonl'))).rejects.toMatchObject({ code: 'ENOENT' });
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
    const path = join(root, 'workflow-debug.jsonl');
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
