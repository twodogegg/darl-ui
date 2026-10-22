import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelManagementCard, defaultModelConfiguration } from '../src';

describe('ModelManagementCard image capabilities', () => {
  it('previews a catalog without saving it and adds only the selected model in the provider editor', async () => {
    const onFetchModels = vi.fn().mockResolvedValue([
      { id: 'minimax-h3-flash', name: 'H3', providerId: 'gateway', type: 'text', enabled: false },
      { id: 'grok-imagine-image-2.0', name: 'Grok Image', providerId: 'gateway', type: 'text', enabled: false },
    ]);
    const onProviderSave = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ModelManagementCard configuration={defaultModelConfiguration()} providers={[{ id: 'gateway', name: 'Gateway', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', hasApiKey: true, models: [] }]} onFetchModels={onFetchModels} onProviderSave={onProviderSave} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'API 供应商' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.queryByText('文本 API 协议')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '获取可用模型' }));
    const add = await screen.findByRole('button', { name: '添加模型 minimax-h3-flash' });
    expect(onSave).not.toHaveBeenCalled();
    expect(onProviderSave).not.toHaveBeenCalled();
    fireEvent.click(add);
    const editor = screen.getByRole('group', { name: '设置模型 minimax-h3-flash' });
    expect(within(editor).getByRole('combobox', { name: '模型类型' })).toHaveValue('video');
    expect(within(editor).getByRole('combobox', { name: '调用协议' })).toHaveValue('darl-h3-flash-unified');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: '编辑供应商' })).toBeInTheDocument();
    expect(onProviderSave).not.toHaveBeenCalled();
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }));
    fireEvent.click(screen.getByRole('button', { name: '添加模型 minimax-h3-flash' }));
    fireEvent.click(within(screen.getByRole('group', { name: '设置模型 minimax-h3-flash' })).getByRole('button', { name: '添加模型' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onProviderSave.mock.calls[0][0].models).toEqual([]);
    const next = onSave.mock.calls[0][0];
    expect(next.models).toHaveLength(8);
    expect(next.models.some((model: { id: string }) => model.id === 'grok-imagine-image-2.0')).toBe(false);
    const bindings = next.models.find((model: { id: string }) => model.id === 'minimax-h3-flash').bindings;
    expect(bindings.filter((binding: { enabled?: boolean }) => binding.enabled !== false)).toEqual([expect.objectContaining({ providerId: 'gateway', upstreamModelId: 'minimax-h3-flash', protocolKey: 'darl-h3-flash-unified' })]);
    expect(bindings.find((binding: { providerId: string }) => binding.providerId === 'darl').enabled).toBe(false);
  });
  it('saving provider details after a model lookup does not persist the preview', async () => {
    const onProviderSave = vi.fn().mockResolvedValue(undefined);
    const onSave = vi.fn();
    render(<ModelManagementCard configuration={defaultModelConfiguration()} providers={[{ id: 'gateway', name: 'Gateway', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', models: [] }]} onFetchModels={async () => [{ id: 'grok-imagine-image-2.0', name: 'Grok', type: 'text', providerId: 'gateway' }]} onProviderSave={onProviderSave} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'API 供应商' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '获取可用模型' }));
    await screen.findByRole('button', { name: '添加模型 grok-imagine-image-2.0' });
    fireEvent.click(screen.getByRole('button', { name: '保存供应商' }));
    await waitFor(() => expect(onProviderSave).toHaveBeenCalled());
    expect(onProviderSave.mock.calls[0][0].models).toEqual([]);
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    expect(screen.queryByText('grok-imagine-image-2.0')).not.toBeInTheDocument();
  });
  it('reactivates a saved media channel and disables the previous channel', async () => {
    const configuration = defaultModelConfiguration();
    const video = configuration.models.find(model => model.id === 'minimax-h3-flash')!;
    video.bindings.push({ ...video.bindings[0], id: 'gateway-video', providerId: 'gateway', enabled: false });
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ModelManagementCard configuration={configuration} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /MiniMax H3 Flash minimax-h3-flash/ }));
    fireEvent.click(screen.getAllByRole('button', { name: '编辑绑定 →' })[1]);
    const enabled = screen.getByRole('checkbox', { name: '启用此渠道' });
    expect(enabled).not.toBeChecked();
    fireEvent.click(enabled);
    fireEvent.click(screen.getByRole('button', { name: '保存绑定' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const bindings = onSave.mock.calls[0][0].models.find((model: { id: string }) => model.id === video.id).bindings;
    expect(bindings.filter((binding: { enabled?: boolean }) => binding.enabled !== false).map((binding: { id: string }) => binding.id)).toEqual(['gateway-video']);
  });
  it('requires explicit capabilities for unknown models and rejects a mapping to a different model type', async () => {
    const onSave = vi.fn();
    render(<ModelManagementCard configuration={defaultModelConfiguration()} providers={[{ id: 'gateway', name: 'Gateway', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', models: [] }]} onFetchModels={async () => [{ id: 'grok-imagine-image-2.0', name: 'Grok', type: 'text', providerId: 'gateway' }]} onProviderSave={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'API 供应商' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '获取可用模型' }));
    fireEvent.click(await screen.findByRole('button', { name: '添加模型 grok-imagine-image-2.0' }));
    const editor = screen.getByRole('group', { name: '设置模型 grok-imagine-image-2.0' });
    expect(within(editor).getByRole('combobox', { name: '模型类型' })).toHaveValue('');
    fireEvent.change(within(editor).getByRole('combobox', { name: '模型类型' }), { target: { value: 'image' } });
    expect(within(editor).getByRole('combobox', { name: '参数模板' })).toHaveValue('');
    fireEvent.change(within(editor).getByRole('combobox', { name: '参数模板' }), { target: { value: 'gpt-image-2' } });
    fireEvent.click(within(editor).getByText('模型 ID 映射'));
    fireEvent.change(within(editor).getByRole('textbox', { name: /^网站模型 ID/ }), { target: { value: 'gemini-4-argon' } });
    fireEvent.click(within(editor).getByRole('button', { name: '添加模型' }));
    expect(within(editor).getByRole('alert')).toHaveTextContent('网站模型 ID 已用于其他类型');
    expect(onSave).not.toHaveBeenCalled();
  });
  it('edits the existing provider mapping when another website model shares the upstream ID', () => {
    const configuration = defaultModelConfiguration();
    const image = configuration.models.find(model => model.id === 'gpt-image-2.5')!;
    image.bindings.push({ id: 'custom-image', providerId: 'gateway', upstreamModelId: 'gpt-image-2', protocolKey: 'openai-images', enabled: true });
    render(<ModelManagementCard configuration={configuration} providers={[{ id: 'gateway', name: 'Gateway', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', models: [] }]} />);
    fireEvent.click(screen.getByRole('button', { name: 'API 供应商' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '编辑模型 gpt-image-2' }));
    const editor = screen.getByRole('group', { name: '设置模型 gpt-image-2' });
    expect(within(editor).getByRole('textbox', { name: '显示名称' })).toHaveValue(image.displayName);
    fireEvent.click(within(editor).getByText('模型 ID 映射'));
    expect(within(editor).getByRole('textbox', { name: /^网站模型 ID/ })).toHaveValue(image.id);
  });
  it('shows every aspect ratio as a selectable card instead of a clipped text input', () => {
    render(<ModelManagementCard configuration={defaultModelConfiguration()} />);
    fireEvent.click(screen.getByRole('button', { name: /GPT Image 2 gpt-image-2 启用/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑绑定 →' }));

    fireEvent.click(screen.getByText('高级能力设置'));
    const group = screen.getByRole('group', { name: '支持画幅' });
    const ratios = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];
    expect(within(group).getAllByRole('button').map((button) => button.textContent?.replace('✓', ''))).toEqual(ratios);
    ratios.forEach((ratio) => expect(within(group).getByRole('button', { name: ratio })).toHaveAttribute('aria-pressed', 'true'));

    fireEvent.click(within(group).getByRole('button', { name: '1:1' }));
    expect(within(group).getByRole('button', { name: '1:1' })).toHaveAttribute('aria-pressed', 'false');
    const override = screen.getAllByRole('checkbox', { name: '覆盖' })[2];
    expect(override).toBeChecked();
  });
});
