import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EpisodeWorkspace } from '../examples/agent-chat/client/EpisodeWorkspace';

afterEach(() => vi.unstubAllGlobals());

describe('episode Agent prompt navigation', () => {
  it('preselects the built-in Agent and opens its existing editor through the host callback', async () => {
    const episode = {
      id: 1, projectId: 8, title: '第 01 集', script: '原剧本',
      scriptRevision: 1, planRevision: null, updatedAt: '2026-10-18',
    };
    const response = (data: unknown) => Promise.resolve({
      ok: true, json: async () => ({ code: 'OK', data }),
    });
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/projects/8/episodes')) return response([episode]);
      if (url.endsWith('/episodes/1')) return response({ episode, shots: [], assets: [], totalSeconds: 0 });
      if (url.endsWith('/projects/8/assets')) return response([]);
      throw new Error('Unexpected request: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);
    const onEditAgent = vi.fn();
    render(<EpisodeWorkspace projectId={8} agents={[
      { id: 'default', name: '网站助手', builtIn: true, isDefault: true, enabled: true,
        instructions: '网站系统提示词', providerId: 'darl', modelId: 'deepseek-v4.1-flash' },
    ]} onEditAgent={onEditAgent} />);

    const button = await screen.findByRole('button', { name: '编辑拆镜 Agent' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(screen.getByRole('combobox', { name: '执行智能拆镜的专业 Agent' })).toHaveValue('default');
    fireEvent.click(button);
    expect(onEditAgent).toHaveBeenCalledExactlyOnceWith('default');
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining('/analyze'), expect.anything());
  });

  it('does not navigate when no Agent is available', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.endsWith('/projects/8/episodes')) return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 1, projectId: 8, title: '第 01 集', script: '', scriptRevision: 0, planRevision: null, updatedAt: '' }] }) });
      if (url.endsWith('/episodes/1')) return Promise.resolve({ ok: true, json: async () => ({ data: { episode: { id: 1, projectId: 8, title: '第 01 集', script: '', scriptRevision: 0, planRevision: null, updatedAt: '' }, shots: [], assets: [], totalSeconds: 0 } }) });
      if (url.endsWith('/projects/8/assets')) return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      throw new Error('Unexpected fetch request');
    }));
    const onEditAgent = vi.fn();
    render(<EpisodeWorkspace projectId={8} agents={[]} onEditAgent={onEditAgent} />);
    const button = await screen.findByRole('button', { name: '编辑拆镜 Agent' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onEditAgent).not.toHaveBeenCalled();
  });
});
