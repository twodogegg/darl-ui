import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlaygroundTheme } from '../playground/src/usePlaygroundTheme';

// Node 26's Web Storage globals are unavailable in this Vitest/jsdom version.
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
});
afterEach(() => {
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
  stored.clear();
  vi.unstubAllGlobals();
});

describe('playground theme', () => {
  it('uses the system appearance until a saved choice exists', () => {
    const { result } = renderHook(usePlaygroundTheme);
    expect(result.current.mode).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('darl-ui-theme')).toBeNull();
  });

  it('persists a manual choice and restores it on a fresh mount', () => {
    window.localStorage.setItem('darl-ui-theme', 'dark');
    const first = renderHook(usePlaygroundTheme);
    act(() => first.result.current.setMode('light'));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('darl-ui-theme')).toBe('light');
    first.unmount();
    const second = renderHook(usePlaygroundTheme);
    expect(second.result.current.mode).toBe('light');
  });

  it('switches themes even when browser storage is unavailable', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    const { result } = renderHook(usePlaygroundTheme);
    act(() => result.current.setMode('light'));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(result.current.mode).toBe('light');
  });

  it('restores the default semantic colors after clearing a brand override', () => {
    const { result } = renderHook(usePlaygroundTheme);
    act(() => result.current.setColor('#2563eb'));
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('#2563eb');
    act(() => result.current.setColor(''));
    expect(document.documentElement.style.getPropertyValue('--primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--primary-foreground')).toBe('');
  });
});
