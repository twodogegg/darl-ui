import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ModelManagementCard, defaultModelConfiguration } from '../src';

describe('ModelManagementCard image capabilities', () => {
  it('shows every aspect ratio as a selectable card instead of a clipped text input', () => {
    render(<ModelManagementCard configuration={defaultModelConfiguration()} />);
    fireEvent.click(screen.getByRole('button', { name: /GPT Image 2 gpt-image-2 启用/ }));
    fireEvent.click(screen.getByRole('button', { name: '编辑绑定 →' }));

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
