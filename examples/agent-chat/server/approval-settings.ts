import type { AgentApprovalMode } from '../../../src/components/agent-sidebar/types';

export const DEFAULT_APPROVAL_MODE: AgentApprovalMode = 'auto';
export function validateApprovalSettings(value: unknown): { mode: AgentApprovalMode } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('审批设置无效');
  const entry = value as Record<string, unknown>;
  if (typeof entry.mode !== 'string' || !['ask', 'auto', 'full'].includes(entry.mode) || Object.keys(entry).some(key => key !== 'mode')) throw new Error('请选择有效的审批模式');
  return { mode: entry.mode as AgentApprovalMode };
}

/** Unknown operations stay interactive. This is an approval policy, not a shell sandbox. */
export function shouldConfirm(mode: AgentApprovalMode, risk: 'read' | 'write' | 'dangerous', lowRisk = false): boolean {
  if (mode === 'full' || risk === 'read') return false;
  return mode === 'ask' || risk === 'dangerous' || !lowRisk;
}

export function isLowRiskCommand(command: unknown): boolean {
  return typeof command === 'string' && command.split('&&').every(part => isLowRiskInvocation(part.trim()));
}

function isLowRiskInvocation(line: string): boolean {
  if (/^(?:pwd|(?:node|python|python3|git|npm|npx|pip|pip3) --version)$/.test(line)) return true;
  // Recognize a single ls invocation, including options and quoted paths, not a shell program.
  if (/[;&|<>$`\r\n\0\\(){}]/.test(line)) return false;
  return /^(?:ls|\/(?:usr\/)?bin\/ls)(?:[ \t]+(?:[^\s"'\\]+|"[^"]*"|'[^']*'))*$/.test(line);
}
