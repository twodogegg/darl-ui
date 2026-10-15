import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import type { AgentSkill, AgentToolCall } from '../../../src/index';
import { applicationCatalog, connectApplication, conversationApplications, loadApplications, toolRisk, ToolConfirmations } from './mcp';
import { generate, listModels, publicProvider, safeError, validateProvider, type ChatImage, type ChatMessage, type StoredProvider } from './models';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_LENGTH = 64 + 4 * Math.ceil(MAX_IMAGE_BYTES / 3);

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 80 * 1024 * 1024) throw new Error('请求内容超过 80MB');
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

type McpCallResult = { content: unknown[]; structuredContent?: unknown; isError: boolean };
type ImageInputFields = { assetId: string; dataUrl: string; fileName: string; displayName?: string };

export async function uploadAttachedImage(
  call: (args: Record<string, unknown>, signal: AbortSignal) => Promise<McpCallResult>,
  image: ChatImage,
  args: Record<string, unknown>,
  fields: ImageInputFields,
  signal: AbortSignal,
) {
  const bytes = Buffer.from(image.data, 'base64');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.mimeType)) throw new Error('素材文件兼容上传仅支持 PNG、JPEG、WebP');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || image.data.length + 32 > MAX_IMAGE_DATA_URL_LENGTH) throw new Error('图片附件为空或超过 50 MiB');
  const assetId = args[fields.assetId];
  if (typeof assetId !== 'string') throw new Error('图片上传能力缺少素材 ID');
  return call({ [fields.assetId]: assetId, [fields.dataUrl]: `data:${image.mimeType};base64,${image.data}`, [fields.fileName]: image.name, ...(fields.displayName && typeof args[fields.displayName] === 'string' ? { [fields.displayName]: args[fields.displayName] } : {}) }, signal);
}

function latestUserImages(messages: ChatMessage[]) {
  const message = [...messages].reverse().find((item) => item.role === 'user');
  return typeof message?.content === 'string' ? [] : (message?.content.filter((item): item is ChatImage => item.type === 'image') ?? []);
}

type McpToolDescriptor = { _meta?: Record<string, unknown> };

export function findAttachedImageForUpload(tool: McpToolDescriptor, args: Record<string, unknown>, images: ChatImage[]) {
  const metadata = tool._meta?.['darl-ui/image-input'];
  if (!metadata || typeof metadata !== 'object' || !('kind' in metadata) || !('fields' in metadata) || !metadata.fields || typeof metadata.fields !== 'object') return undefined;
  const fields = metadata.fields as Record<string, unknown>;
  if (metadata.kind !== 'data-url' || typeof fields.assetId !== 'string' || typeof fields.dataUrl !== 'string' || typeof fields.fileName !== 'string' || (fields.displayName !== undefined && typeof fields.displayName !== 'string')) return undefined;
  const mapped = { assetId: fields.assetId, dataUrl: fields.dataUrl, fileName: fields.fileName, ...(fields.displayName ? { displayName: fields.displayName } : {}) } satisfies ImageInputFields;
  if (typeof args[mapped.assetId] !== 'string' || args.file || args.file_id || args[mapped.dataUrl] !== undefined || args.data_base64 !== undefined || (args.action !== undefined && args.action !== 'start')) return undefined;
  return { image: images.find((image) => typeof args[mapped.fileName] !== 'string' || image.name === args[mapped.fileName]) ?? images[0], fields: mapped };
}

export function createApi(directory: string, env: Record<string, string>, promptFile: string) {
  const file = resolve(directory, 'providers.json');
  let queue: Promise<void> = Promise.resolve();
  const confirmations = new ToolConfirmations();
  const validatePrompt = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > 100_000) throw new Error('系统提示词不能为空，且不能超过 100000 个字符');
    return value;
  };
  const loadPrompt = async () => validatePrompt(await readFile(promptFile, 'utf8'));

  const initial: StoredProvider[] = [{ id: 'darl', name: 'Darl', baseUrl: env.AGENT_CHAT_BASE_URL || 'https://api.darl.cn/v1', protocol: 'openai-completions', apiKey: env.AGENT_CHAT_API_KEY || '', status: 'unknown', models: [{ id: env.AGENT_CHAT_MODEL || 'deepseek-v4.1-flash', name: env.AGENT_CHAT_MODEL || 'deepseek-v4.1-flash', providerId: 'darl', type: 'text', enabled: true }] }];
  const load = async (): Promise<StoredProvider[]> => {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return initial; throw error; }
  };
  const update = (mutate: (providers: StoredProvider[]) => StoredProvider[]) => {
    const job = queue.then(async () => {
      const providers = mutate(await load());
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(`${file}.tmp`, JSON.stringify(providers), { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    queue = job.catch(() => {});
    return job;
  };
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith('/api/')) return next();
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    // Local development example: never expose a credential-management endpoint on the LAN.
    const allowed = new Set(['localhost:5197', '127.0.0.1:5197', '[::1]:5197']);
    if (!allowed.has(request.headers.host || '') || (request.headers.origin && !['http://localhost:5197', 'http://127.0.0.1:5197', 'http://[::1]:5197'].includes(request.headers.origin))) return send(403, { error: '仅允许本机同源访问' });
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
    let secret = '';
    const connections: Awaited<ReturnType<typeof connectApplication>>[] = [];
    try {
      await queue;
      const providers = await load();
      const path = request.url.split('?')[0];
      if (path === '/api/agent-settings' && request.method === 'GET') return send(200, { systemPrompt: await loadPrompt() });
      if (path === '/api/agent-settings' && request.method === 'POST') {
        const { systemPrompt: value } = await readBody(request);
        const systemPrompt = validatePrompt(value);
        const job = queue.then(async () => {
          await writeFile(`${promptFile}.tmp`, systemPrompt, { mode: 0o600 });
          await rename(`${promptFile}.tmp`, promptFile);
        });
        queue = job.catch(() => {});
        await job;
        return send(200, { systemPrompt });
      }
      if (path === '/api/applications' && request.method === 'GET') return send(200, await applicationCatalog(directory, signal));
      const confirmation = path.match(/^\/api\/tool-confirmations\/([\w-]+)$/);
      if (confirmation && request.method === 'POST') {
        const { approved } = await readBody(request);
        if (typeof approved !== 'boolean') throw new Error('请明确确认或拒绝工具调用');
        confirmations.decide(confirmation[1], approved);
        return send(200, { ok: true });
      }
      if (path === '/api/providers' && request.method === 'GET') return send(200, providers.map(publicProvider));
      if (path === '/api/providers' && request.method === 'POST') {
        const { provider: value, apiKey } = await readBody(request);
        const provider = validateProvider(value);
        if (apiKey !== undefined && (typeof apiKey !== 'string' || apiKey.length > 1000)) throw new Error('API Key 格式无效');
        await update((current) => {
          const stored = current.find((item) => item.id === provider.id);
          const next = { ...provider, apiKey: apiKey?.trim() || stored?.apiKey || '' };
          return stored ? current.map((item) => item.id === provider.id ? next : item) : [...current, next];
        });
        return send(200, (await load()).map(publicProvider));
      }
      const route = path.match(/^\/api\/providers\/([\w-]+)(?:\/(models|test))?$/);
      if (route) {
        const provider = providers.find((item) => item.id === route[1]);
        if (!provider) return send(404, { error: '提供方不存在' });
        secret = provider.apiKey;
        if (!route[2] && request.method === 'DELETE') {
          await update((current) => current.filter((item) => item.id !== provider.id));
          return send(200, (await load()).map(publicProvider));
        }
        if (route[2] === 'models' && request.method === 'POST') return send(200, await listModels(provider, signal));
        if (route[2] === 'test' && request.method === 'POST') {
          const model = provider.models.find((item) => item.enabled !== false && item.type === 'text');
          if (!model) throw new Error('请先保存至少一个已启用的文本模型');
          try {
            for await (const _delta of generate(provider, model, [{ role: 'user', content: '请只回复 OK。' }], await loadPrompt(), undefined, signal)) { /* Validate the complete real stream. */ }
            await update((current) => current.map((item) => item.id === provider.id ? { ...item, status: 'connected' } : item));
          } catch (error) {
            await update((current) => current.map((item) => item.id === provider.id ? { ...item, status: 'error' } : item));
            throw error;
          }
          return send(200, (await load()).map(publicProvider));
        }
      }
      if (path === '/api/chat' && request.method === 'POST') {
        const body = await readBody(request);
        const provider = providers.find((item) => item.id === body.providerId);
        if (!provider) throw new Error('请选择已保存的模型提供方');
        secret = provider.apiKey;
        const model = provider.models.find((item) => item.id === body.modelId && item.type === 'text' && item.enabled !== false);
        if (!model) throw new Error('请选择已启用的文本模型');
        if (body.effort && !model.reasoningEfforts?.includes(body.effort)) throw new Error('模型不支持此推理强度');
        if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 200) throw new Error('对话消息数量无效');
        const messages: ChatMessage[] = body.messages.map((message: ChatMessage) => {
          if (!message || !['user', 'assistant'].includes(message.role)) throw new Error('消息格式无效');
          if (typeof message.content === 'string') {
            if (message.content.length > 100_000) throw new Error('消息格式无效');
            return { role: message.role, content: message.content };
          }
          if (!Array.isArray(message.content) || message.content.length > 20) throw new Error('图片消息格式无效');
          const content = message.content.map((item) => {
            if (item?.type === 'text' && typeof item.text === 'string' && item.text.length <= 100_000) return { type: 'text' as const, text: item.text };
            if (item?.type === 'image' && typeof item.name === 'string' && typeof item.mimeType === 'string' && /^image\/(png|jpe?g|webp|gif)$/i.test(item.mimeType) && typeof item.data === 'string' && item.data.startsWith('data:')) {
              const [, encoded = ''] = item.data.split(',', 2);
              const data = encoded.replace(/\s/g, '');
              if (!data || data.length > MAX_IMAGE_DATA_URL_LENGTH || Buffer.from(data, 'base64').length > MAX_IMAGE_BYTES || Buffer.from(data, 'base64').toString('base64') !== data) throw new Error('图片附件过大或不是规范 Base64，请压缩后重试');
              return { type: 'image' as const, name: item.name.slice(0, 200), mimeType: item.mimeType, data, size: item.size } satisfies ChatImage;
            }
            throw new Error('图片消息格式无效');
          });
          if (!content.some((item) => item.type === 'image')) throw new Error('图片消息不能为空');
          return { role: message.role, content };
        });
        if (messages.some((message) => Array.isArray(message.content) && message.content.some((item) => item.type === 'image')) && model.capabilities?.vision === false) {
          throw new Error('当前模型未启用视觉输入，请在模型设置中开启 vision 或选择支持图片的模型');
        }
        if (!Array.isArray(body.skills) || body.skills.length > 30) throw new Error('Skills 格式无效');
        const instructions = [await loadPrompt(), ...body.skills.map((skill: AgentSkill) => {
          if (typeof skill?.name !== 'string' || typeof skill.instructions !== 'string' || skill.instructions.length > 100_000) throw new Error('Skill 指令格式无效');
          return `技能：${skill.name}\n${skill.instructions}`;
        })].join('\n\n');
        const applicationIds = body.applicationIds ?? [];
        if (!Array.isArray(applicationIds) || applicationIds.length > 20 || applicationIds.some((id: unknown) => typeof id !== 'string')) throw new Error('应用列表无效');
        const configs = await loadApplications(directory);
        const selectedApps = conversationApplications(configs, applicationIds, messages);
        const attachedImages = latestUserImages(messages);
        for (const app of selectedApps) connections.push(await connectApplication(app, signal));
        const functions = connections.flatMap((connection, appIndex) => connection.tools.map((tool, index) => ({ name: `mcp_${appIndex}_${index}`, connection, tool })));
        if (functions.length > 128) throw new Error('所选应用合计超过 128 个工具，请减少应用数量');
        const emitTool = (call: AgentToolCall) => {
          if (!signal.aborted) response.write(`${JSON.stringify({ type: 'tool', call: { ...call, input: call.status === 'confirmation' ? call.input : undefined } })}\n`);
        };
        const emitImages = (value: unknown) => {
          if (!Array.isArray(value)) return;
          value.forEach((item, index) => {
            if (!item || typeof item !== 'object' || (item as { type?: unknown }).type !== 'image') return;
            const image = item as { data?: unknown; mimeType?: unknown };
            if (typeof image.data !== 'string' || image.data.length > 12_000_000 || typeof image.mimeType !== 'string' || !/^image\/(png|jpe?g|webp|gif)$/i.test(image.mimeType)) return;
            response.write(`${JSON.stringify({ type: 'image', image: { name: `工具图片-${index + 1}`, type: image.mimeType, url: `data:${image.mimeType};base64,${image.data}` } })}\n`);
          });
        };
        const execution = functions.length ? {
          tools: functions.map(({ name, connection, tool }) => ({ name, description: `${connection.app.name} / ${tool.title || tool.name} (${tool.name}): ${tool.description || ''}`, parameters: tool.inputSchema })),
          execute: async (request: { name: string; arguments: string }, toolSignal = signal) => {
            const callSignal = AbortSignal.any([signal, toolSignal]);
            const selected = functions.find((item) => item.name === request.name);
            if (!selected) throw new Error('模型请求了未授权的工具');
            const { connection, tool } = selected;
            const call: AgentToolCall = { id: crypto.randomUUID(), appId: connection.app.id, appName: connection.app.name, toolName: tool.name, toolTitle: tool.title || tool.annotations?.title, input: request.arguments, status: 'pending' };
            try {
              const args = JSON.parse(request.arguments || '{}');
              if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('工具参数必须为 JSON 对象');
              call.input = args;
              if (toolRisk(connection.app, tool) !== 'read') {
                call.status = 'confirmation';
                const decision = confirmations.wait(call.id, callSignal);
                emitTool(call);
                if (!await decision) throw new Error('用户拒绝了本次工具调用，不要再次尝试相同操作');
              }
              callSignal.throwIfAborted();
              call.status = 'running';
              emitTool(call);
              const attachedUpload = findAttachedImageForUpload(tool, args, attachedImages);
              const result = attachedUpload
                ? await uploadAttachedImage((stepArgs, stepSignal) => connection.call(tool.name, stepArgs, stepSignal), attachedUpload.image, args, attachedUpload.fields, callSignal)
                : await connection.call(tool.name, args, callSignal);
              callSignal.throwIfAborted();
              call.status = result.isError ? 'error' : 'success';
              if (result.isError) {
                const details = result.content.flatMap((block) => block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? [block.text] : []);
                call.error = safeError(new Error(details[0] || 'MCP 工具调用失败'), connection.app.apiKey);
              }
              emitImages(result.content);
              emitTool(call);
              return JSON.stringify(result);
            } catch (error) {
              call.status = 'error';
              call.error = safeError(error, connection.app.apiKey);
              emitTool(call);
              if (callSignal.aborted) throw error;
              return JSON.stringify({ isError: true, error: call.error });
            }
          },
        } : undefined;
        response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.flushHeaders();
        for await (const text of generate(provider, model, messages, instructions, body.effort, signal, execution)) {
          if (!response.write(`${JSON.stringify({ type: 'text', text })}\n`)) await new Promise<void>((done) => {
            const resume = () => { response.off('drain', resume); response.off('close', resume); done(); };
            response.once('drain', resume);
            response.once('close', resume);
          });
          if (signal.aborted) break;
        }
        if (!signal.aborted) response.end(`${JSON.stringify({ type: 'done' })}\n`);
        return;
      }
      send(404, { error: '接口不存在' });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = signal.aborted ? '模型请求超时，请重试' : safeError(error, secret);
      if (response.headersSent) response.end(`${JSON.stringify({ type: 'error', error: message })}\n`);
      else send(400, { error: message });
    } finally {
      controller.abort();
      await Promise.allSettled(connections.map((connection) => connection.close()));
    }
  };
}
