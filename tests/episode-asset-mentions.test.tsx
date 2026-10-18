import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EpisodeWorkspace } from '../examples/agent-chat/client/EpisodeWorkspace';

afterEach(() => vi.unstubAllGlobals());

const episode = {
  id: 1, projectId: 8, title: '第 01 集', script: '原稿',
  scriptRevision: 1, planRevision: 1, updatedAt: '2026-10-18',
};
const assets = [
  { id: '2bf9491b-65bb-4184-a993-5db7296ab691', name: '路明非', type: 'character' as const, shotNumbers: [1], description: '主角' },
  { id: 'f27372f6-9030-47ba-868c-d32f35deccd5', name: '卧室', type: 'scene' as const, shotNumbers: [1], description: '夜间' },
];
const plan = {
  episode,
  shots: [{ id: 'shot-1', framing: '中景', camera: '固定', cut: '—', scene: '<卧室>', visual: '<路明非>抬头', dialogue: '—', sound: '—', duration: 4 }],
  assets,
  totalSeconds: 4,
};

function renderWorkspace() {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const data = url.endsWith('/episodes') ? [episode]
      : url.endsWith('/episodes/1') ? plan
      : url.endsWith('/projects/8/assets') ? assets
      : url.includes('/analyze') ? { plan, scriptRevision: 1, totalSeconds: 4 }
      : null;
    if (data === null) throw new Error('Unexpected request: ' + url);
    return Promise.resolve({ ok: true, json: async () => ({ code: 'OK', data }) });
  }));
  render(<EpisodeWorkspace projectId={8} agents={[]} onEditAgent={() => {}} />);
}

describe('shot asset mentions', () => {
  it('suggests declared assets after @ and inserts a stable <name> reference', async () => {
    renderWorkspace();
    const visual = await screen.findByLabelText('镜头 1 画面');
    fireEvent.change(visual, { target: { value: '@路明非抬头，@', selectionStart: 8 } });
    const option = await screen.findByRole('option', { name: /卧室/ });
    fireEvent.mouseDown(option);
    await waitFor(() => expect(screen.getByLabelText('镜头 1 画面')).toHaveValue('@路明非抬头，@卧室 '));
  });

  it('rewrites stored references when an asset is renamed', async () => {
    renderWorkspace();
    await screen.findByLabelText('镜头 1 画面');
    fireEvent.click(screen.getByRole('tab', { name: /美术资产/ }));
    fireEvent.change(await screen.findByLabelText('资产 1 名称'), { target: { value: '路鸣泽' } });
    fireEvent.click(screen.getByRole('tab', { name: /分镜/ }));
    expect(await screen.findByLabelText('镜头 1 画面')).toHaveValue('@路鸣泽抬头');
    expect(screen.getByRole('button', { name: '@路鸣泽' })).toBeInTheDocument();
  });

  it('opens the project asset detail from a shot chip', async () => {
    renderWorkspace();
    const chip = await screen.findByRole('button', { name: '@路明非' });
    fireEvent.click(chip);
    expect(await screen.findByText('路明非 · 主形象与衍生状态')).toBeInTheDocument();
  });
});
