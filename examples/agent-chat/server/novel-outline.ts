import { randomUUID } from 'node:crypto';

/** The generated outline remains a draft until the user explicitly saves it. */
export function validateNovelOutline(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('大纲整理结果无效');
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of ['core', 'story', 'keep', 'remove', 'merge', 'risks', 'episodes']) {
    if (typeof input[key] !== 'string' || input[key].length > 100000) throw new Error(`大纲字段 ${key} 无效`);
    output[key] = input[key];
  }
  if (!String(output.core).trim() || !String(output.story).trim()) throw new Error('故事内核和完整故事主线不能为空');
  for (const [key, fields] of Object.entries({ roles: ['name', 'position', 'relationships', 'arc'], scenes: ['name', 'purpose'], props: ['name', 'purpose', 'involvement'] })) {
    if (!Array.isArray(input[key]) || (input[key] as unknown[]).length > 500) throw new Error(`大纲列表 ${key} 无效`);
    output[key] = (input[key] as unknown[]).map((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${key} 第 ${index + 1} 项无效`);
      const record = item as Record<string, unknown>;
      if (fields.some(field => typeof record[field] !== 'string' || String(record[field]).length > 16000) || !String(record.name).trim()) throw new Error(`${key} 第 ${index + 1} 项内容无效`);
      return Object.fromEntries([['id', randomUUID()], ...fields.map(field => [field, record[field]])]);
    });
  }
  return output;
}

/** Keep untouched page fields and row IDs when an adjustment only changes part of an outline. */
export function validateNovelOutlineAdjustment(value: unknown, current: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !current || typeof current !== 'object' || Array.isArray(current)) throw new Error('大纲修改结果无效');
  const changes = (value as Record<string, unknown>).changes;
  const keys = ['core', 'story', 'keep', 'remove', 'merge', 'risks', 'episodes', 'roles', 'scenes', 'props'];
  if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length || Object.keys(changes).some(key => !keys.includes(key))) throw new Error('大纲修改字段无效');
  const original = current as Record<string, unknown>, patch = changes as Record<string, unknown>;
  const validated = validateNovelOutline({ ...original, ...patch });
  for (const key of ['roles', 'scenes', 'props']) if (!(key in patch)) validated[key] = original[key];
  return validated;
}
