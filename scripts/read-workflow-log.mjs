import { readFile } from 'node:fs/promises';
import { expandWorkflowLogEntries } from '../examples/agent-chat/server/workflow-log.mjs';

const [path, option, callId, ...extra] = process.argv.slice(2);
if (!path || extra.length || (option && (option !== '--call' || !callId)) || (!option && callId)) {
  process.stderr.write('用法：node scripts/read-workflow-log.mjs <日志文件> [--call <模型调用 ID>]\n');
  process.exitCode = 1;
} else {
  try {
    const entries = (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    const expanded = expandWorkflowLogEntries(entries);
    if (callId) {
      const found = expanded.find(entry => entry.event === 'model.request' && entry.callId === callId);
      if (!found) throw new Error('未找到该模型调用');
      process.stdout.write(`${JSON.stringify(found, null, 2)}\n`);
    } else for (const entry of expanded) process.stdout.write(`${JSON.stringify(entry)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
