import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestAgent = vi.fn(async () => {});
const notify = vi.fn();
const studioApi = vi.fn();

vi.mock('../examples/agent-chat/client/studio/store', () => ({
  studioApi: (...args: unknown[]) => studioApi(...args),
  useStore: () => ({
    data: { projects: [{ id: '1' }], episodes: [] },
    agents: [],
    models: [],
    agentSelection: '',
    setAgentSelection: vi.fn(),
    getModel: () => undefined,
    setModelSelections: vi.fn(),
    update: vi.fn(async (mutate: (draft: Record<string, unknown>) => void) => mutate({ projects: [{ id: '1' }] })),
    notify,
    reload: vi.fn(async () => {}),
    requestAgent,
    cancelAgent: vi.fn(),
  }),
}));

const { default: Home } = await import('../examples/agent-chat/client/studio/pages/Home');

const source = '第三十七章 突然出现的信\n\n她拆开信封，纸页发黄。';

async function openForm(name?: string) {
  studioApi.mockImplementation(async (path: string) => {
    if (path === 'workspace/styles') return { data: { official_items: [{ id: 4, name: '电影感', prompt: '电影感' }], items: [] } };
    if (path === 'workspace/projects') return { data: { project_id: 12 } };
    return { data: {} };
  });
  render(<MemoryRouter initialEntries={['/']}><Home /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('button', { name: /选择视觉风格/ })).toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: /选择视觉风格/ }));
  fireEvent.click(await screen.findByRole('button', { name: '预览电影感' }));
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
  fireEvent.change(screen.getByLabelText(/原始素材内容/), { target: { value: source } });
  fireEvent.change(screen.getByLabelText('计划集数'), { target: { value: '12' } });
  if (name !== undefined) fireEvent.change(screen.getByLabelText(/项目名称/), { target: { value: name } });
}

describe('首页新建项目名称', () => {
  beforeEach(() => {
    studioApi.mockReset();
    requestAgent.mockClear();
    notify.mockClear();
  });

  it('要求用户填写项目名称，未填写时不能提交', async () => {
    await openForm();
    expect(screen.getByLabelText(/项目名称/)).toBeRequired();
    expect(screen.getByRole('button', { name: /开始创作/ })).toBeDisabled();
  });

  it('使用用户填写的项目名称创建项目，不再取素材第一行', async () => {
    await openForm('她拆开的那封信');
    const submit = screen.getByRole('button', { name: /开始创作/ });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);
    await waitFor(() => expect(studioApi.mock.calls.some(([path]) => path === 'workspace/projects')).toBe(true));
    const created = studioApi.mock.calls.find(([path]) => path === 'workspace/projects');
    expect((created?.[1] as { name: string }).name).toBe('她拆开的那封信');
  });

  it('只填空格视为未填写，拦截提交并提示', async () => {
    await openForm('   ');
    expect(screen.getByRole('button', { name: /开始创作/ })).toBeDisabled();
    expect(studioApi.mock.calls.some(([path]) => path === 'workspace/projects')).toBe(false);
  });
});
