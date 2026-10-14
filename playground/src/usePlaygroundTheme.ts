import { useLayoutEffect, useState } from 'react';
import { readableForeground } from '../../src/theme/DarlUIProvider';

export type Mode = 'light' | 'dark';

function initialMode(): Mode {
  try {
    const saved = window.localStorage.getItem('darl-ui-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* Theme switching remains available without browser storage. */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function usePlaygroundTheme() {
  const [mode, updateMode] = useState<Mode>(initialMode);
  const [color, setColor] = useState('');
  const setMode = (next: Mode) => {
    updateMode(next);
    try { window.localStorage.setItem('darl-ui-theme', next); } catch { /* Storage may be disabled. */ }
  };

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0a0a0a' : '#ffffff');
  }, [mode]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (color) {
      root.style.setProperty('--primary', color);
      root.style.setProperty('--primary-foreground', readableForeground(color));
    } else {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--primary-foreground');
    }
  }, [color]);

  return { mode, setMode, color, setColor };
}
