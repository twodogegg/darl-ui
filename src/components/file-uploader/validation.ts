import type { RejectCode, RejectedFile } from './types';
export function fileFingerprint(f: File): string { return `${f.name}\u0000${f.size}\u0000${f.type}\u0000${f.lastModified}`; }
export function matchesAccept(file: File, accepts: string[]): boolean {
  if (!accepts.length || accepts.includes('*/*')) return true;
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return accepts.some((raw) => {
    const rule = raw.trim().toLowerCase();
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}
export function rejectReason(file: File, code: RejectCode, options: { accept?: string[]; maxFileSizeMB?: number }): RejectedFile {
  const reasons: Record<RejectCode, string> = {
    type: `不支持此文件格式：${file.name}`,
    size: `文件超过 ${options.maxFileSizeMB} MB：${file.name}`,
    count: `文件数量超过限制：${file.name}`,
    duplicate: `已添加相同文件：${file.name}`
  };
  return { file, code, reason: reasons[code] };
}
export function validateFile(file: File, options: { accept?: string[]; maxFileSizeMB?: number }): RejectedFile | null {
  if (options.accept?.length && !matchesAccept(file, options.accept)) return rejectReason(file, 'type', options);
  if (options.maxFileSizeMB !== undefined && file.size > options.maxFileSizeMB * 1024 * 1024) return rejectReason(file, 'size', options);
  return null;
}
