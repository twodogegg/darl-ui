import { describe, expect, it } from 'vitest';
import { DEFAULT_APPROVAL_MODE, shouldConfirm, validateApprovalSettings, isLowRiskCommand } from '../examples/agent-chat/server/approval-settings';

describe('project-wide approval policy', () => {
  it('defaults to automatic approval of known low-risk writes', () => {
    expect(DEFAULT_APPROVAL_MODE).toBe('auto');
    expect(shouldConfirm('auto', 'read')).toBe(false);
    expect(shouldConfirm('auto', 'write', true)).toBe(false);
    expect(shouldConfirm('auto', 'write')).toBe(true);
    expect(shouldConfirm('auto', 'dangerous', true)).toBe(true);
  });
  it('asks for all writes in ask mode, including known low-risk writes', () => {
    expect(shouldConfirm('ask', 'read')).toBe(false);
    expect(shouldConfirm('ask', 'write', true)).toBe(true);
    expect(shouldConfirm('ask', 'dangerous')).toBe(true);
  });
  it('does not prompt even for unknown or dangerous operations in full mode', () => {
    expect(shouldConfirm('full', 'write')).toBe(false);
    expect(shouldConfirm('full', 'dangerous')).toBe(false);
  });
  it('only recognizes standalone read commands, without shell composition', () => {
    for (const command of ['pwd', 'node --version', 'python3 --version', 'git --version']) expect(isLowRiskCommand(command)).toBe(true);
    for (const command of ['pwd; rm file', 'pwd > file', 'pwd\nrm file', 'node -e "process.exit()"', 'python script.py', '$(pwd)', 'git push', 'curl https://example.com', undefined]) expect(isLowRiskCommand(command)).toBe(false);
  });
  it('automatically approves ls options and paths, while rejecting shell composition', () => {
    for (const command of ['ls', 'ls -la', 'ls -lah ./skills', 'ls -- /tmp', 'ls "folder with spaces"', "ls -l 'folder with spaces'", '/bin/ls -la', '/usr/bin/ls -R .', 'pwd && ls -la', 'ls && node --version']) {
      expect(isLowRiskCommand(command), command).toBe(true);
      expect(shouldConfirm('auto', 'write', isLowRiskCommand(command)), command).toBe(false);
      expect(shouldConfirm('ask', 'write', isLowRiskCommand(command)), command).toBe(true);
    }
    for (const command of ['ls > output.txt', 'ls; rm file', 'ls && rm file', 'ls | sh', 'ls $(touch file)', 'ls `touch file`', 'ls\ntouch file', "ls 'unterminated", 'ls \\; touch file', '/tmp/ls', 'lsfoo', 'ls &&', '&& ls', 'ls & pwd', 'ls || pwd', 'ls "a && b"']) expect(isLowRiskCommand(command), command).toBe(false);
  });
  it('rejects malformed and unexpected settings instead of enabling full access', () => {
    for (const mode of ['ask', 'auto', 'full']) expect(validateApprovalSettings({ mode })).toEqual({ mode });
    for (const value of [null, [], {}, { mode: ['full'] }, { mode: true }, { mode: 'never' }, { mode: 'full', extra: true }]) expect(() => validateApprovalSettings(value)).toThrow();
  });
});
