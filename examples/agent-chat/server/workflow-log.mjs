/** Compact repeated message prefixes, updating the reference only after the line is written. */
export function createWorkflowLogCompactor() {
  const previous = new Map();
  return {
    prepare(entry, key) {
      if (entry.event === 'job.finished') return { entry, commit: () => previous.delete(key) };
      const input = entry.input;
      const field = Array.isArray(input?.prompt) ? 'prompt' : Array.isArray(input?.messages) ? 'messages' : undefined;
      if (entry.event !== 'model.request' || typeof entry.callId !== 'string' || !field) return { entry, commit: () => {} };
      const messages = input[field];
      const base = previous.get(key);
      let count = 0;
      if (base?.field === field) {
        while (count < base.messages.length && count < messages.length && JSON.stringify(base.messages[count]) === JSON.stringify(messages[count])) count++;
      }
      const compact = count ? { ...entry, input: { ...input, [field]: messages.slice(count) }, inputRef: { callId: base.callId, field, prefixCount: count } } : entry;
      return { entry: compact, commit: () => previous.set(key, { callId: entry.callId, field, messages }) };
    },
  };
}

/** Restore full sanitized model requests, including older logs without references. */
export function expandWorkflowLogEntries(entries) {
  const requests = new Map();
  return entries.map(entry => {
    const ref = entry.inputRef;
    let expanded = entry;
    if (ref) {
      const base = requests.get(ref.callId);
      if (!base || !['prompt', 'messages'].includes(ref.field) || base.field !== ref.field || !Number.isInteger(ref.prefixCount) || ref.prefixCount < 1 || ref.prefixCount > base.messages.length || !Array.isArray(entry.input?.[ref.field])) throw new Error(`无法还原模型请求 ${entry.callId || ''}：引用无效或缺失`);
      const { inputRef: _ref, ...rest } = entry;
      expanded = { ...rest, input: { ...entry.input, [ref.field]: [...base.messages.slice(0, ref.prefixCount), ...entry.input[ref.field]] } };
    }
    if (expanded.event === 'model.request' && typeof expanded.callId === 'string') {
      const field = Array.isArray(expanded.input?.prompt) ? 'prompt' : Array.isArray(expanded.input?.messages) ? 'messages' : undefined;
      if (field) requests.set(expanded.callId, { field, messages: expanded.input[field] });
    }
    return expanded;
  });
}
