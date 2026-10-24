import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentSkill } from '../../../src/components/agent-sidebar/types';
import { skillMarkdown, skillPathValid, validateSkill } from '../../../src/components/agent-sidebar/skill-package';
import { readSkillPackage, type SkillLibrary } from './skill-library';
import type { FileStore } from './file-storage';

type Risk = 'read' | 'write';
const string = { type: 'string', minLength: 1 };
const path = { ...string, description: '工作区内的相对路径，或本工具返回的工作区绝对路径' };
const integer = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
function tool(name: string, title: string, description: string, risk: Risk, properties: Record<string, unknown>, required: string[] = [], approval: 'workspace' | 'command' | 'library' = 'workspace') {
  return { name: `builtin_${name}`, title, description, risk, appId: 'builtin:runtime', appName: '内置 / Skill 与执行环境',
    approval, parameters: { type: 'object', properties, required, additionalProperties: false } };
}

export const RUNTIME_TOOLS = [
  tool('list_skills', '查看技能目录', '返回当前可用 Skill 的名称、描述和 ID，不加载完整指令。', 'read', {}),
  tool('create_skill', '创建 / 安装 Skill', '将生成或下载到工作区的单个 Skill 包安装到网站 Skills 库。path 可为包含 SKILL.md 的目录、单个 SKILL.md 或 ZIP。复用网站导入校验，不执行脚本；成功后所有 Agent 可发现。更新已有自定义技能时同时传 skillId 和 expectedVersion，禁止静默覆盖。', 'write', { path, skillId: string, expectedVersion: string }, ['path'], 'library'),
  tool('load_skill', '加载技能', '读取指定 Skill 的完整指令，并将整个技能包放入当前工作区。返回技能目录、文件清单和 SKILL.md；随后可读取资源或执行脚本。', 'read', { skillId: string }, ['skillId']),
  tool('list_files', '列出工作区文件', '列出指定工作区目录中的文件和文件夹，不递归。', 'read', { path }),
  tool('read_file', '读取工作区文件', '分页读取工作区文本文件；二进制文件可用 base64 编码读取。图片可使用 publish_file 取得可访问链接。', 'read', { path, offset: integer(0, 50_000_000), limit: integer(1, 32_000), encoding: { type: 'string', enum: ['utf8', 'base64'] } }, ['path']),
  tool('write_file', '写入工作区文件', '写入工作区文件，自动创建父目录。encoding 为 base64 时支持二进制文件。', 'write', { path, content: { type: 'string', maxLength: 2_800_000 }, encoding: { type: 'string', enum: ['utf8', 'base64'] } }, ['path', 'content']),
  tool('run_command', '运行命令', '在后端机器的当前工作区运行 Shell 命令，可调用已安装的 CLI、Node.js、Python 或安装依赖。返回真实输出、退出码或运行中的进程 ID。不是沙箱，命令拥有后端系统用户的权限；不继承后端 API 密钥。', 'write', { command: { ...string, maxLength: 16_000 }, cwd: path, timeoutMs: integer(100, 600_000), waitMs: integer(0, 10_000) }, ['command'], 'command'),
  tool('process_status', '查看命令状态与输出', '查询当前工作区进程。传 processId 可等待并分页读取输出；省略则列出进程。', 'read', { processId: string, offset: integer(0, 100_000_000), waitMs: integer(0, 10_000) }),
  tool('stop_process', '停止命令', '停止当前工作区的指定进程及其进程组。', 'write', { processId: string }, ['processId']),
  tool('publish_file', '交付工作区文件', '将已生成的文件保存到宿主文件服务，返回真实下载链接。HTML 等主动内容以附件下载，不在网站同源执行。', 'write', { path }, ['path']),
  tool('import_file', '读取聊天附件到工作区', '将宿主文件服务中已有的 fileId 复制到工作区，供脚本、CLI 使用。', 'write', { fileId: string, path }, ['fileId', 'path']),
] as const;

type Job = {
  id: string; scope: string; runId: string; command: string; cwd: string;
  status: 'running' | 'exited' | 'cancelled' | 'timed_out' | 'failed';
  child: ChildProcess; output: string; base: number; exitCode: number | null;
  timer: ReturnType<typeof setTimeout>; killTimer?: ReturnType<typeof setTimeout>;
  detach: () => void; done: Promise<void>;
};
const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 24);
const MAX_OUTPUT = 1_000_000;
const MAX_FILE = 50 * 1024 * 1024;
const PROMPT_FILE = fileURLToPath(new URL('../prompts/skill-runtime.md', import.meta.url));
const mimeTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf', '.zip': 'application/zip', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.txt': 'text/plain', '.md': 'text/plain', '.json': 'text/plain', '.csv': 'text/plain' };

function textArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error(`${key} 必须是非空字符串`);
  return value;
}
function numberArg(args: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = args[key] ?? fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 超出允许范围 ${min}–${max}`);
  return value;
}
function decode(content: string, encoding: unknown) {
  if (encoding !== undefined && encoding !== 'utf8' && encoding !== 'base64') throw new Error('encoding 仅支持 utf8 和 base64');
  const bytes = Buffer.from(content, encoding === 'base64' ? 'base64' : 'utf8');
  if (encoding === 'base64' && bytes.toString('base64') !== content) throw new Error('base64 格式无效');
  return bytes;
}

/** Local single-user runtime. Paths are checked for file tools; shell access is NOT an OS sandbox. */
export class SkillRuntime {
  private jobs = new Map<string, Job>();
  constructor(private directory: string, private files: FileStore, private library?: SkillLibrary) { this.directory = realpathSync(directory); }

  workspace(sessionId: string, agentId = 'main') { return resolve(this.directory, 'workspaces', hash(sessionId), hash(agentId)); }

  async instructions(skills: AgentSkill[], explicitIds: string[], workspace: string) {
    const prompt = await readFile(PROMPT_FILE, 'utf8');
    return `${prompt}\n\n${JSON.stringify({ workspace, platform: process.platform, skills: skills.map(({ id, name, description }) => ({ id, name, description: description || '', explicitlyRequested: explicitIds.includes(id) })) })}`;
  }

  private async safePath(root: string, input: string) {
    if (!input || input.includes('\0')) throw new Error('文件路径无效');
    await mkdir(root, { recursive: true, mode: 0o700 });
    const target = resolve(root, input);
    const local = relative(root, target);
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`)) throw new Error(`文件路径超出工作区：仅允许 ${root} 内的路径。请使用加载 Skill 后返回的 directory 或工作区相对路径；网站数据请通过对应业务工具查询和编辑。`);
    // Reject symlink traversal, including links created by a command or an imported package.
    let current = root;
    if (await realpath(root) !== resolve(root)) throw new Error('工作区不能经过符号链接');
    for (const part of local.split(sep).filter(Boolean)) {
      current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('文件路径不能经过符号链接'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return target;
  }

  private append(job: Job, text: string) {
    job.output += text;
    if (job.output.length > MAX_OUTPUT) {
      const dropped = job.output.length - MAX_OUTPUT;
      job.output = job.output.slice(dropped); job.base += dropped;
    }
  }
  private stop(job: Job, status: 'cancelled' | 'timed_out') {
    if (job.status !== 'running') return;
    job.status = status;
    const kill = (signal: NodeJS.Signals) => {
      try { if (process.platform !== 'win32' && job.child.pid) process.kill(-job.child.pid, signal); else job.child.kill(signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') this.append(job, `\n${String(error)}`); }
    };
    kill('SIGTERM');
    job.killTimer = setTimeout(() => kill('SIGKILL'), 500);
    job.killTimer.unref();
  }
  private async snapshot(job: Job, offset = 0, waitMs = 0) {
    if (waitMs && job.status === 'running') await new Promise<void>((done) => {
      const timer = setTimeout(done, waitMs);
      void job.done.then(() => { clearTimeout(timer); done(); });
    });
    const start = Math.max(offset, job.base);
    const output = job.output.slice(start - job.base, start - job.base + 32_000);
    return { processId: job.id, command: job.command, cwd: job.cwd, status: job.status, exitCode: job.exitCode, output, nextOffset: start + output.length, truncated: offset < job.base, isError: job.status === 'failed' || job.status === 'timed_out' || job.status === 'cancelled' || (job.status === 'exited' && job.exitCode !== 0) };
  }

  async execute(name: string, args: Record<string, unknown>, context: { sessionId: string; agentId?: string; runId: string; skills: AgentSkill[]; signal: AbortSignal }) {
    const { skills, signal } = context;
    signal.throwIfAborted();
    const root = this.workspace(context.sessionId, context.agentId);
    const scope = root;
    const definition = RUNTIME_TOOLS.find((item) => item.name === name);
    if (!definition) throw new Error('执行工具不存在');
    const props = definition.parameters.properties;
    if (Object.keys(args).some((key) => !Object.hasOwn(props, key))) throw new Error('工具包含未知参数');
    if (name === 'builtin_list_skills') return { skills: skills.map(({ id, name, description, version = '0.0' }) => ({ id, name, description, version })), workspace: root };
    if (name === 'builtin_load_skill') {
      const skill = skills.find((item) => item.id === textArg(args, 'skillId'));
      if (!skill) throw new Error('Skill 不存在或未授权');
      validateSkill({ ...skill, description: skill.description || skill.name });
      const entries = [{ path: 'SKILL.md', content: skillMarkdown({ ...skill, description: skill.description || skill.name }) }, ...(skill.resources || [])];
      // Content-addressed packages avoid overwriting files underneath an active process after edits.
      const packagePath = `skills/${hash(skill.id)}-${hash(JSON.stringify(entries))}`;
      for (const entry of entries) {
        if (!skillPathValid(entry.path)) throw new Error('Skill 包含不安全的资源路径');
        const target = await this.safePath(root, `${packagePath}/${entry.path}`);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await writeFile(target, decode(entry.content, 'encoding' in entry ? entry.encoding : undefined), { mode: 0o600 });
        if (!('encoding' in entry && entry.encoding) && (entry.content.startsWith('#!') || /\.(?:sh|bash)$/.test(entry.path))) await chmod(target, 0o700);
      }
      return { skillId: skill.id, directory: join(root, packagePath), manifest: entries[0].content, files: entries.map(({ path }) => path) };
    }
    if (name === 'builtin_process_status' || name === 'builtin_stop_process') {
      if (name === 'builtin_process_status' && args.processId === undefined) return { processes: [...this.jobs.values()].filter((job) => job.scope === scope).map(({ id, command, status, exitCode }) => ({ processId: id, command, status, exitCode })) };
      const job = this.jobs.get(textArg(args, 'processId'));
      if (!job || job.scope !== scope) throw new Error('进程不存在，或已随服务重启结束');
      if (name === 'builtin_stop_process') this.stop(job, 'cancelled');
      return this.snapshot(job, numberArg(args, 'offset', 0, 0, 100_000_000), numberArg(args, 'waitMs', 0, 0, 10_000));
    }
    if (name === 'builtin_run_command') {
      const command = textArg(args, 'command');
      if (command.length > 16_000) throw new Error('命令超过 16000 字符');
      const cwd = await this.safePath(root, args.cwd === undefined ? '.' : textArg(args, 'cwd'));
      if (!(await stat(cwd)).isDirectory()) throw new Error('cwd 不是目录');
      const timeoutMs = numberArg(args, 'timeoutMs', 120_000, 100, 600_000);
      const waitMs = numberArg(args, 'waitMs', 1000, 0, 10_000);
      if ([...this.jobs.values()].filter((job) => job.status === 'running').length >= 16) throw new Error('运行中的命令已达到 16 个，请先停止或等待');
      // Never forward application/provider secrets from the backend environment.
      const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'TEMP', 'SystemRoot', 'USERPROFILE'].flatMap((key) => process.env[key] ? [[key, process.env[key]!]] : []));
      const child = spawn(command, { cwd, env, shell: process.platform === 'win32' ? true : '/bin/sh', detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let complete!: () => void;
      const done = new Promise<void>((resolve) => { complete = resolve; });
      const job: Job = { id: randomUUID(), scope, runId: context.runId, command, cwd, status: 'running', child, output: '', base: 0, exitCode: null,
        timer: setTimeout(() => this.stop(job, 'timed_out'), timeoutMs), detach: () => signal.removeEventListener('abort', abort), done };
      const abort = () => this.stop(job, 'cancelled');
      this.jobs.set(job.id, job);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      child.stdout!.setEncoding('utf8').on('data', (data: string) => this.append(job, data));
      child.stderr!.setEncoding('utf8').on('data', (data: string) => this.append(job, data));
      child.on('error', (error) => { job.status = 'failed'; this.append(job, error.message); });
      child.on('close', (code) => {
        job.exitCode = code;
        if (job.status === 'running') job.status = 'exited';
        clearTimeout(job.timer); job.detach(); complete();
        // Bound retained process logs without evicting live processes.
        for (const [id, old] of this.jobs) if (this.jobs.size > 200 && old.status !== 'running') this.jobs.delete(id);
      });
      return this.snapshot(job, 0, waitMs);
    }
    const target = await this.safePath(root, args.path === undefined && name === 'builtin_list_files' ? '.' : textArg(args, 'path'));
    if (name === 'builtin_create_skill') {
      if (!this.library) throw new Error('宿主未配置 Skills 库');
      const skill = await readSkillPackage(target, signal);
      signal.throwIfAborted();
      const saved = this.library.create(skill, args.skillId === undefined ? undefined : textArg(args, 'skillId'), args.expectedVersion === undefined ? undefined : textArg(args, 'expectedVersion'));
      return { skillId: saved.id, name: saved.name, version: saved.version, resourceCount: saved.resources?.length || 0 };
    }
    if (name === 'builtin_list_files') {
      const entries = await readdir(target, { withFileTypes: true });
      return { path: target, entries: entries.slice(0, 1000).map((entry) => ({ name: entry.name, type: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 1000 };
    }
    if (name === 'builtin_write_file' || name === 'builtin_import_file') {
      let bytes: Buffer;
      if (name === 'builtin_import_file') {
        const fileId = textArg(args, 'fileId');
        if (!this.files.get(fileId) || this.files.get(fileId)!.size > MAX_FILE) throw new Error('附件不存在或超过 50 MiB');
        const file = await this.files.getBytes(fileId);
        if (!file) throw new Error('附件不存在');
        bytes = file.bytes;
      } else {
        if (typeof args.content !== 'string') throw new Error('content 必须是字符串');
        bytes = decode(args.content, args.encoding);
        if (bytes.length > 2 * 1024 * 1024) throw new Error('单次写入不能超过 2 MiB');
      }
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      signal.throwIfAborted();
      await writeFile(target, bytes, { mode: 0o600 });
      return { path: target, size: bytes.length };
    }
    const info = await stat(target);
    if (!info.isFile() || info.size > MAX_FILE) throw new Error('请选择不超过 50 MiB 的文件');
    const bytes = await readFile(target);
    if (name === 'builtin_publish_file') {
      const file = await this.files.put(bytes, mimeTypes[extname(target).toLowerCase()] || 'application/octet-stream', basename(target));
      return { name: basename(target), fileId: file.id, url: `/api/files/${file.id}?download=1`, size: file.size, mimeType: file.mimeType };
    }
    const encoding = args.encoding ?? 'utf8';
    if (encoding !== 'utf8' && encoding !== 'base64') throw new Error('encoding 仅支持 utf8 和 base64');
    const content = encoding === 'base64' ? bytes.toString('base64') : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const offset = numberArg(args, 'offset', 0, 0, 50_000_000);
    const limit = numberArg(args, 'limit', 16_000, 1, 32_000);
    return { path: target, encoding, content: content.slice(offset, offset + limit), nextOffset: Math.min(offset + limit, content.length), totalLength: content.length, truncated: offset + limit < content.length };
  }

  finishRun(runId: string, success: boolean) {
    for (const job of this.jobs.values()) if (job.runId === runId) { job.detach(); if (!success) this.stop(job, 'cancelled'); }
  }
  dispose() { for (const job of this.jobs.values()) this.stop(job, 'cancelled'); }
}
