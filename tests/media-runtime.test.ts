// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { MediaRuntime } from '../examples/agent-chat/server/media-runtime';
import { defaultModelConfiguration } from '../src/components/settings/model-config';
import type { StoredProvider } from '../examples/agent-chat/server/models';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64');
const roots: string[] = [];
const runtimes: MediaRuntime[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  runtimes.forEach((r) => r.stop());
  runtimes.length = 0;
  roots.forEach((root) => rmSync(root, { recursive: true, force: true }));
  roots.length = 0;
});
function setup(concurrency = 1) {
  const root = mkdtempSync(join(tmpdir(), 'darl-media-'));
  roots.push(root);
  const storage = new LocalStorage(root);
  const config = defaultModelConfiguration();
  for (const model of config.models) if (model.type === 'image' || model.type === 'video') model.bindings[0].maxConcurrency = concurrency;
  const providers = (): StoredProvider[] => [{ id: 'darl', name: 'Darl', baseUrl: 'https://api.example.test/v1', protocol: 'openai-completions',
    apiKey: 'test-token', models: [] }];
  const make = () => {
    const runtime = new MediaRuntime({ dbPath: storage.path, directory: root, config: () => config, providers });
    runtimes.push(runtime);
    return runtime;
  };
  return { make, config, dbPath: storage.path };
}
async function until(predicate: () => boolean, timeout = 6000) {
  const expires = Date.now() + timeout;
  while (!predicate() && Date.now() < expires) await new Promise((resolve) => setTimeout(resolve, 30));
  expect(predicate()).toBe(true);
}
describe('durable media generation queue', () => {
  it('honors per-model concurrency, queues jobs, saves images and survives reinitialization', async () => {
    const { make } = setup(1);
    const media = make();
    media.setSettings({ submitConcurrency: 300, pollConcurrency: 20, pollSeconds: 1 });
    const releases: Array<() => void> = [];
    const fetchMock = vi.fn(async () => {
      await new Promise<void>((resolve) => releases.push(resolve));
      return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    media.start();
    const first = media.enqueue('image', { prompt: '猫', options: { size: '1024x1024' } });
    const second = media.enqueue('image', { prompt: '狗', options: { size: '1024x1024' } });
    expect(first.status).toBe('running');
    expect(media.get(second.id)?.status).toBe('queued');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releases.shift()?.();
    await until(() => media.get(first.id)?.status === 'completed' && fetchMock.mock.calls.length === 2);
    releases.shift()?.();
    await until(() => media.get(second.id)?.status === 'completed');
    const restored = make();
    expect(restored.get(first.id)?.results).toHaveLength(1);
    expect(restored.result(first.id, 0)?.data).toEqual(png);
  });

  it('resumes a submitted H3 task by remote ID without creating a second paid video', async () => {
    const { make } = setup(100);
    const responses: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL | Request, options?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/videos') && options?.method === 'POST') {
        responses.push('submit');
        return Response.json({ id: 'task_video_remote', status: 'queued' });
      }
      if (url.endsWith('/videos/task_video_remote')) {
        responses.push('poll');
        return Response.json({ id: 'task_video_remote', status: 'completed', video_url: '/v1/videos/task_video_remote/content' });
      }
      if (url.endsWith('/videos/task_video_remote/content')) {
        responses.push('download');
        return new Response(Buffer.from('fake-mp4-bytes'), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
      }
      throw new Error('Unexpected URL: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = make();
    first.start();
    const task = first.enqueue('video', { prompt: '镜头向前移动', options: { resolution: '768', seconds: 10 } });
    await until(() => Boolean(first.get(task.id)?.remoteTaskId));
    first.stop();
    const restored = make();
    restored.start();
    await until(() => restored.get(task.id)?.status === 'completed');
    expect(responses.filter((value) => value === 'submit')).toHaveLength(1);
    expect(restored.result(task.id, 0)?.mime).toBe('video/mp4');
  });

  it('never retries an uncertain paid request after server restart', async () => {
    const { make, dbPath } = setup(2);
    const first = make();
    const stalled = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', stalled);
    first.start();
    const task = first.enqueue('image', { prompt: '电影风格', options: { size: '1024x1024' } });
    expect(first.get(task.id)?.status).toBe('running');
    first.stop();
    const db = new DatabaseSync(dbPath);
    db.prepare('UPDATE generation_jobs SET lease_until=0 WHERE id=?').run(task.id);
    db.close();
    const restarted = make();
    restarted.start();
    expect(restarted.get(task.id)).toMatchObject({ status: 'failed', phase: 'unknown-submission' });
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid queue limits instead of silently forcing an arbitrary low cap', () => {
    const { make } = setup();
    const runtime = make();
    expect(runtime.setSettings({ submitConcurrency: 500, pollConcurrency: 120, pollSeconds: 5 }).submitConcurrency).toBe(500);
    expect(() => runtime.setSettings({ submitConcurrency: 0, pollConcurrency: 1, pollSeconds: 1 })).toThrow();
  });
});
