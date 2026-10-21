import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** One failed tool or media operation. Secrets are stripped before the entry is persisted. */
export interface FailureLogEntry {
  requestId?: string;
  runId?: string;
  parentRunId?: string;
  agentId?: string | null;
  toolCallId?: string;
  appId?: string;
  appName?: string;
  toolName?: string;
  attempt?: number;
  stage: string;
  code: string;
  message: string;
  command?: string;
  processId?: string;
  exitCode?: number | null;
  durationMs?: number;
  secret?: string;
}

const CREDENTIAL = /(?:sk|ahk)_[\w-]+|sk-[\w-]+/g;

/** Keep diagnostics readable without leaking a provider key. */
export function redactMessage(value: string, secret = '') {
  const withoutSecret = secret ? value.split(secret).join('[已隐藏]') : value;
  return withoutSecret.replace(CREDENTIAL, '[已隐藏]').slice(0, 2000);
}

/**
 * Tool failures used to exist only in the browser stream. This writes the same
 * failure to stderr and to an append-only log so it can be inspected afterwards.
 */
export function createFailureLog(directory: string, echo: (line: string) => void = (line) => process.stderr.write(line)) {
  let ready = false;
  return (entry: FailureLogEntry) => {
    const { secret = '', ...rest } = entry;
    const record = {
      timestamp: new Date().toISOString(),
      ...rest,
      message: redactMessage(rest.message, secret),
      ...(rest.command !== undefined ? { command: redactMessage(rest.command, secret) } : {}),
    };
    const target = [record.appName, record.toolName].filter(Boolean).join('/');
    echo(`[agent] ${record.timestamp} ${record.stage} ${record.code}${target ? ` ${target}` : ''} — ${record.message}${record.requestId ? ` (requestId=${record.requestId})` : ''}\n`);
    if (!ready) {
      try { mkdirSync(directory, { recursive: true, mode: 0o700 }); ready = true; }
      catch { return; }
    }
    try { appendFileSync(join(directory, 'failure.log'), `${JSON.stringify(record)}\n`, { mode: 0o600 }); }
    catch { /* A diagnostic log must never fail the request. */ }
  };
}
