import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export interface DarlTheme { mode?: ThemeMode; primaryColor?: string; radius?: number }
interface ContextValue { theme: DarlTheme; resolvedMode: 'light' | 'dark' }
const ThemeContext = createContext<ContextValue | undefined>(undefined);

export function readableForeground(hex: string): string {
  const value = hex.replace('#', '');
  if (!/^(?:[\da-f]{3}|[\da-f]{6})$/i.test(value)) return '#ffffff';
  const full = value.length === 3 ? value.split('').map((x) => x + x).join('') : value;
  const [r, g, b] = [0, 2, 4].map((n) => parseInt(full.slice(n, n + 2), 16) / 255);
  const lum = [r, g, b].map((x) => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  return (0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2]) > 0.38 ? '#141414' : '#ffffff';
}
export interface DarlUIProviderProps { theme?: DarlTheme; children: ReactNode; className?: string }
export function DarlUIProvider({ theme = {}, children, className = '' }: DarlUIProviderProps) {
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const resolvedMode = theme.mode === 'dark' || (theme.mode !== 'light' && systemDark) ? 'dark' : 'light';
  const styles = {
    ...(theme.primaryColor ? { '--darl-primary': theme.primaryColor, '--darl-primary-foreground': readableForeground(theme.primaryColor) } : {}),
    ...(theme.radius !== undefined ? { '--darl-radius': `${theme.radius}px` } : {})
  } as CSSProperties;
  const value = useMemo(() => ({ theme, resolvedMode }), [theme.mode, theme.primaryColor, theme.radius, resolvedMode]);
  return <ThemeContext.Provider value={value}><div className={`darl-ui-root ${className}`} data-darl-theme={resolvedMode} style={styles}>{children}</div></ThemeContext.Provider>;
}
export function useDarlTheme(): ContextValue | undefined { return useContext(ThemeContext); }
