// @vitest-environment node
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { createVoiceApi, defaultVoiceSettings, loadVoiceGuide, validateVoiceSettings, voiceCatalogParams, voiceSampleUrl, voiceGuideForTurn } from '../examples/agent-chat/server/voice';
import { LocalStorage } from '../examples/agent-chat/server/storage';

describe('voice host settings and validation', () => {
  it('uses existing sample audio and handles missing or invalid URLs', () => {
    expect(voiceSampleUrl([{ audio: 'https://platform.r2.fish.audio/task/sample.mp3' }])).toBe('https://platform.r2.fish.audio/task/sample.mp3');
    expect(voiceSampleUrl([])).toBeUndefined();
    expect(voiceSampleUrl(undefined)).toBeUndefined();
    expect(voiceSampleUrl([null, { audio: 'javascript:alert(1)' }, { audio: '/relative' }])).toBeUndefined();
    expect(voiceSampleUrl([{ audio: 123 }, { audio: 'https://example.com/sample.mp3' }])).toBe('https://example.com/sample.mp3');
  });

  it('keeps language and all tags when searching or paginating the catalog', () => {
    const params = voiceCatalogParams(new URLSearchParams('q= Alice &page=2&language=en&sort=task_count&tag=female&tag=young&tag=female'));
    expect(params.get('title')).toBe('Alice');
    expect(params.get('language')).toBe('en');
    expect(params.get('page_number')).toBe('2');
    expect(params.get('sort_by')).toBe('task_count');
    expect(params.getAll('tag')).toEqual(['female', 'young']);
    expect(voiceCatalogParams(new URLSearchParams()).get('language')).toBe('zh');
    expect(voiceCatalogParams(new URLSearchParams('language=')).has('language')).toBe(false);
    expect(() => voiceCatalogParams(new URLSearchParams('sort=unknown'))).toThrow();
    expect(() => voiceCatalogParams(new URLSearchParams('language=invalid'))).toThrow();
  });

  it('loads full guidance once per session/model/version, only committing completed turns', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-voice-guide-'));
    try {
      const storage = new LocalStorage(directory);
      const guide = loadVoiceGuide(join(process.cwd(), 'examples/agent-chat/prompts/system.md'));
      expect(guide.content).toContain('[emphasis]');
      expect(guide.content).toContain('不叠加互相冲突');
      const first = voiceGuideForTurn(storage, 'session:model', guide);
      expect(first.instructions).toBe(guide.content);
      // An interrupted request never calls markLoaded.
      expect(voiceGuideForTurn(storage, 'session:model', guide).instructions).toBe(guide.content);
      first.markLoaded();
      expect(voiceGuideForTurn(storage, 'session:model', guide).instructions).toBe(guide.summary);
      expect(voiceGuideForTurn(new LocalStorage(directory), 'session:model', guide).instructions).toBe(guide.summary);
      expect(voiceGuideForTurn(storage, 'new-session:model', guide).instructions).toBe(guide.content);
      expect(voiceGuideForTurn(storage, 'session:another-model', guide).instructions).toBe(guide.content);
      expect(voiceGuideForTurn(storage, 'session:model', { ...guide, version: 'updated' }).instructions).toBe(guide.content);
      expect(JSON.stringify(storage.getConfig('voiceGuide:session:model'))).not.toContain(guide.summary);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not silently route misspelled free models to a paid model', () => {
    expect(() => validateVoiceSettings({ ...defaultVoiceSettings, ttsModel: 's2.1-pro-fre' })).toThrow();
    expect(() => validateVoiceSettings({ ...defaultVoiceSettings, speed: NaN })).toThrow();
    expect(() => validateVoiceSettings({ ...defaultVoiceSettings, voiceId: '../invalid' })).toThrow();
  });

  it('persists preferences while never returning the stored key and rejects missing credentials', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-voice-'));
    const storage = new LocalStorage(directory);
    const handle = createVoiceApi(storage, {});
    const server = createServer((request, response) => { void handle(request, response); });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/voice/`;
    try {
      expect((await fetch(base + 'voices')).status).toBe(400);
      const initial = await (await fetch(base + 'settings')).json();
      expect(initial.hasApiKey).toBe(false);
      const body = { ...defaultVoiceSettings, enabled: true, voiceName: '我的音色', voiceId: 'a'.repeat(32), apiKey: 'credential-for-settings-validation' };
      const saved = await fetch(base + 'settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const publicValue = await saved.json();
      expect(publicValue).toMatchObject({ enabled: true, voiceName: '我的音色', hasApiKey: true });
      expect(JSON.stringify(publicValue)).not.toContain(body.apiKey);
      expect(await (await fetch(base + 'settings')).json()).toEqual(publicValue);
      const malformed = await fetch(base + 'settings', { method: 'POST', body: JSON.stringify({ ...body, ttsModel: 'typo' }) });
      expect(malformed.status).toBe(400);
      expect((await fetch(base + 'speech', { method: 'POST', body: JSON.stringify({ text: '' }) })).status).toBe(400);
      expect((await fetch(base + 'transcribe', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'invalid' })).status).toBe(400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    }
  });
});
