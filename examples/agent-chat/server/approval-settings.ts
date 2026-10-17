/** Project-wide default-off automatic approval toggles. */
export interface AutoConfirmSettings { image: boolean; video: boolean; mcp: boolean }
export const DEFAULT_AUTO_CONFIRM: AutoConfirmSettings = { image: false, video: false, mcp: false };
export function validateAutoConfirmSettings(value: unknown): AutoConfirmSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('二次确认设置无效');
  const entry = value as Record<string, unknown>;
  if (['image', 'video', 'mcp'].some(key => typeof entry[key] !== 'boolean') || Object.keys(entry).some(key => !['image', 'video', 'mcp'].includes(key))) throw new Error('二次确认设置必须包含图片、视频和 MCP 的布尔值');
  return { image: entry.image as boolean, video: entry.video as boolean, mcp: entry.mcp as boolean };
}
export function shouldConfirmMcp(risk: 'read'|'write'|'dangerous', config: AutoConfirmSettings): boolean {
  return risk === 'dangerous' || (risk === 'write' && !config.mcp);
}
