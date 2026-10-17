import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTO_CONFIRM, shouldConfirmMcp, validateAutoConfirmSettings } from '../examples/agent-chat/server/approval-settings';

describe('project-wide confirmation policy', () => {
  it('defaults to asking for writes, but not reads', () => {
    expect(shouldConfirmMcp('read', DEFAULT_AUTO_CONFIRM)).toBe(false);
    expect(shouldConfirmMcp('write', DEFAULT_AUTO_CONFIRM)).toBe(true);
    expect(shouldConfirmMcp('dangerous', DEFAULT_AUTO_CONFIRM)).toBe(true);
  });
  it('allows ordinary MCP writes only when explicitly opted in', () => {
    const enabled = { ...DEFAULT_AUTO_CONFIRM, mcp: true };
    expect(shouldConfirmMcp('write', enabled)).toBe(false);
    expect(shouldConfirmMcp('dangerous', enabled)).toBe(true);
  });
  it('rejects partial, nonboolean, and unsupported settings', () => {
    expect(validateAutoConfirmSettings({ image: true, video: false, mcp: true })).toEqual({ image: true, video: false, mcp: true });
    expect(() => validateAutoConfirmSettings({ image: true, video: false })).toThrow();
    expect(() => validateAutoConfirmSettings({ image: 'true', video: false, mcp: false })).toThrow();
    expect(() => validateAutoConfirmSettings({ image: false, video: false, mcp: false, audio: true })).toThrow();
  });
});
