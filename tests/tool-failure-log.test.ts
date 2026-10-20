// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFailureLog, redactMessage } from '../examples/agent-chat/server/failure-log';
import { mediaTaskResult } from '../examples/agent-chat/server/media-job-store';
import type { MediaJob } from '../examples/agent-chat/server/media-job-store';

const job = (patch: Partial<MediaJob>): MediaJob => ({
  id: 'a69427d4-e93b-47f0-986e-065a01e8d140', modelId: 'gpt-image-2', type: 'image',
  prompt: '雨夜街道', options: {}, providerId: 'darl', upstreamModelId: 'gpt-image-2',
  baseUrl: 'https://example.invalid/v1', status: 'queued', attempts: 1,
  createdAt: '2026-10-19T08:00:00.000Z', updatedAt: '2026-10-19T08:21:10.620Z', ...patch,
});

describe('media task result for the model and UI', () => {
  it('reports a failed job as a tool error instead of a successful read', () => {
    const result = mediaTaskResult(job({ status: 'uncertain', error: '渠道未返回 b64_json；URL 结果需要先经网关验收再开放' }));
    expect(result.failed).toBe(true);
    expect(result.code).toBe('MEDIA_TASK_UNCERTAIN');
    expect(JSON.parse(result.body)).toMatchObject({ isError: true, status: 'uncertain', error: '渠道未返回 b64_json；URL 结果需要先经网关验收再开放' });
  });

  it('keeps a completed job successful and exposes every stored result', () => {
    const result = mediaTaskResult(job({ status: 'completed', resultFileIds: ['file-a', 'file-b'] }));
    expect(result.failed).toBe(false);
    expect(JSON.parse(result.body)).toMatchObject({ status: 'completed', resultUrls: [
      '/api/media-generation/jobs/a69427d4-e93b-47f0-986e-065a01e8d140/file',
      '/api/media-generation/jobs/a69427d4-e93b-47f0-986e-065a01e8d140/file?index=1',
    ] });
    expect(JSON.parse(result.body).isError).toBeUndefined();
  });

  it('does not mark queued or running jobs as failures', () => {
    expect(mediaTaskResult(job({ status: 'queued' })).failed).toBe(false);
    expect(mediaTaskResult(job({ status: 'running' })).failed).toBe(false);
  });
});

describe('tool failure log', () => {
  it('writes one JSON line per failure and redacts credentials', () => {
    const directory = mkdtempSync(join(tmpdir(), 'failure-log-'));
    const echoed: string[] = [];
    try {
      const log = createFailureLog(directory, (line) => echoed.push(line));
      log({ requestId: 'req-1', runId: 'run-1', toolCallId: 'call-1', appName: '素材库', toolName: 'search', stage: 'mcp-tool', code: 'MCP_TOOL_FAILED', message: 'request ahk_private failed', secret: 'ahk_private' });
      log({ requestId: 'req-2', stage: 'mcp-tool', code: 'MCP_TOOL_FAILED', message: 'Authorization: Bearer sk-live-123456' });
      const lines = readFileSync(join(directory, 'failure.log'), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({ requestId: 'req-1', toolCallId: 'call-1', code: 'MCP_TOOL_FAILED', message: 'request [已隐藏] failed' });
      expect(lines.join('\n')).not.toContain('ahk_private');
      expect(lines.join('\n')).not.toContain('sk-live-123456');
      expect(echoed[0]).toContain('MCP_TOOL_FAILED');
      expect(echoed[0]).toContain('requestId=req-1');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it('echoes to stderr by default so the dev terminal shows the failure', () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      createFailureLog(mkdtempSync(join(tmpdir(), 'failure-log-echo-')))({ requestId: 'req-3', stage: 'mcp-tool', code: 'MCP_TOOL_FAILED', message: 'boom' });
      const line = write.mock.calls.map(([value]) => String(value)).join('');
      expect(line).toContain('[agent]');
      expect(line).toContain('MCP_TOOL_FAILED');
      expect(line).toContain('requestId=req-3');
      expect(line).toContain('boom');
    } finally { write.mockRestore(); }
  });

  it('never throws when the log directory cannot be created', () => {
    const log = createFailureLog('/dev/null/not-a-directory', () => {});
    expect(() => log({ stage: 'mcp-tool', code: 'MCP_TOOL_FAILED', message: 'x' })).not.toThrow();
    expect(redactMessage('sk-test-abc')).toBe('[已隐藏]');
  });
});
