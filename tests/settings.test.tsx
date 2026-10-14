import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ModelSettingsCard, SettingsPage, type ModelProvider } from '../src';

const providers: ModelProvider[] = [{ id: 'gateway', name: 'Gateway', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', models: [
  { id: 'chat', name: 'Chat', providerId: 'gateway', type: 'text', reasoningEfforts: ['低', '高'] },
  { id: 'image', name: 'Image', providerId: 'gateway', type: 'image' },
] }];

describe('SettingsPage and ModelSettingsCard', () => {
  it('filters model catalog by text, image, video and audio type', () => {
    render(<ModelSettingsCard providers={providers} />);
    fireEvent.click(screen.getByRole('tab', { name: '图片' }));
    expect(screen.getByRole('button', { name: /Image image · 图片/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Chat chat · 文本/ })).toBeNull();
    expect(screen.getByRole('combobox', { name: '模型类型' })).toHaveValue('image');
  });

  it('saves model provider changes through host callback', async () => {
    const onProviderSave = vi.fn().mockResolvedValue(undefined);
    render(<ModelSettingsCard providers={providers} onProviderSave={onProviderSave} />);
    fireEvent.change(screen.getAllByRole('textbox', { name: '显示名称' })[0], { target: { value: 'Updated Gateway' } });
    fireEvent.click(screen.getByRole('button', { name: '保存提供方' }));
    await vi.waitFor(() => expect(onProviderSave).toHaveBeenCalledWith(expect.objectContaining({ name: 'Updated Gateway' })));
  });

  it('renders navigable settings sections', () => {
    const onSectionChange = vi.fn();
    render(<SettingsPage onSectionChange={onSectionChange}><p>模型内容</p></SettingsPage>);
    fireEvent.click(screen.getByRole('button', { name: 'Skills' }));
    expect(onSectionChange).toHaveBeenCalledWith('skills');
  });
  it('keeps the catalog unchanged after a failed model save and permits retry', async () => {
    const onProviderSave = vi.fn().mockRejectedValue(new Error('网络连接失败'));
    render(<ModelSettingsCard providers={providers} onProviderSave={onProviderSave} />);
    fireEvent.change(screen.getAllByRole('textbox', { name: '显示名称' })[1], { target: { value: 'Renamed Chat' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await screen.findByText('网络连接失败');
    expect(screen.getByRole('button', { name: /Chat chat · 文本/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Renamed Chat chat · 文本/ })).toBeNull();
    onProviderSave.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await screen.findByText('模型已保存。');
    expect(screen.getByRole('button', { name: /Renamed Chat chat · 文本/ })).toBeInTheDocument();
  });

  it('renames an existing model without duplicating it and preserves comma input', async () => {
    const onProviderSave = vi.fn().mockResolvedValue(undefined);
    render(<ModelSettingsCard providers={providers} onProviderSave={onProviderSave} />);
    fireEvent.change(screen.getByRole('textbox', { name: '模型 ID' }), { target: { value: 'renamed' } });
    const input = screen.getByRole('textbox', { name: '推理强度' });
    fireEvent.change(input, { target: { value: 'low,' } });
    expect(input).toHaveValue('low,');
    fireEvent.change(input, { target: { value: 'low, high' } });
    fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
    await screen.findByText('模型已保存。');
    expect(onProviderSave.mock.calls[0][0].models).toHaveLength(2);
    expect(onProviderSave.mock.calls[0][0].models[0]).toMatchObject({ id: 'renamed', reasoningEfforts: ['low', 'high'] });
  });

});
