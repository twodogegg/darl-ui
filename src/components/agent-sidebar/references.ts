// References have a stable identifier; their visible label stays inside the sentence.
export const referencePattern = /\[([^\]]+)\]\((app|skill|agent|node):([^\s)]+)\)/g;
function decodeId(value: string) { try { return decodeURIComponent(value); } catch { return value; } }
export function referenceIds(value: string, kind: 'app' | 'skill' | 'agent' | 'node') {
  return [...new Set(Array.from(value.matchAll(referencePattern)).filter((match) => match[2] === kind).map((match) => decodeId(match[3])))];
}
