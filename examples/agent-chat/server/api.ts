import { OpenCutProjects, handleOpenCut } from './opencut';
import { createVoiceApi } from './voice';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defaultModelConfiguration, effectiveCapabilities, enabledBindings, upgradeModelConfiguration, validateModelConfiguration, type ModelConfiguration } from '../../../src/components/settings/model-config';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { applicationCatalog, connectApplication, createMcpOAuthProvider, loadApplications, saveApplications, MCP_OAUTH_CALLBACK_PATH, McpConnectionManager, toolRisk } from './mcp';
import { generate, listModels, publicProvider, safeError, validateProvider, type StoredProvider } from './models';
import { AgentFailure, createAgentError } from './errors';
import { LocalStorage } from './storage';
import { handleWorkspaceProjectRequest } from './projects';
import { ProjectStore } from './project-store';
import { createMediaJobsApi } from './media-jobs-api';
import { createFailureLog } from './failure-log';
import { FileStore } from './file-storage';
import { StorageSettings, fileOptions, storageConfigFromEnv, validateStorageConfig } from './storage-config';
import { isLocalOrLanAddress } from './local-access';
import { StudioStore, STUDIO_TOOLS, executeStudioTool, handleStudioRequest } from './studio';
import { RUNTIME_TOOLS, SkillRuntime } from './skill-runtime';
import { SkillLibrary } from './skill-library';
import { sendRevalidatedJson } from './http-cache';
import { RequestRecordStore, requestRecordsApi, requestRecordScope } from './request-records';
import { createWorkflowDebugLog } from './workflow-debug';
import { createPromptOptimization, type OptimizationPromptKey } from './prompt-optimization';
import { parseBatchPromptResults, promptAdjustmentContext, validatePromptTiming } from './prompt-adjustment';
import { Output } from 'ai';
import { RequestTimeout } from './request-timeout';
import { VideoRedraw, REDRAW_TOOLS, handleRedrawRequest } from './video-redraw';
import { loadWorkflowAgents, validateWorkflowAgents, workflowModelOptions } from './workflow-agents';
import { VideoEditing, handleVideoEditingRequest } from './video-editing';

/** Resolve the model selected in the current chat against an enabled text binding. */
export function resolveTextModel(providers: StoredProvider[], configuration: ModelConfiguration, providerId: string, modelId: string) {
  const provider = providers.find((item) => item.id === providerId);
  if (!provider) return undefined;
  const configured = configuration.models.filter((item) => item.enabled !== false && item.type === 'text')
    .flatMap((item) => enabledBindings(configuration, item)
      .filter((binding) => binding.providerId === providerId && binding.upstreamModelId === modelId)
      .map((binding) => ({ item, binding })))[0];
  if (!configured) return undefined;
  const effective = effectiveCapabilities(configuration, configured.item, configured.binding);
  const text = effective && 'reasoningEfforts' in effective ? effective : undefined;
  const directory = provider.models.find((item) => item.id === modelId && item.type === 'text');
  return {
    provider: { ...provider, protocol: configured.binding.protocolKey as StoredProvider['protocol'] },
    model: {
      ...directory,
      id: modelId, name: configured.item.displayName, type: 'text' as const, providerId, enabled: true,
      reasoningEfforts: text?.reasoningEfforts.filter((effort) => effort !== 'none') ?? [],
      capabilities: { ...directory?.capabilities, tools: text?.tools, contextWindow: text?.contextWindow },
    },
  };
}

const uploadMimeType = (type: string) => type === 'image/jpg' ? 'image/jpeg' : /^(?:image\/(?:png|jpeg|webp|gif)|video\/mp4|audio\/(?:mpeg|wav)|application\/(?:pdf|zip|octet-stream)|text\/plain)$/.test(type) ? type : 'application/octet-stream';

/**
 * Builtin tools live here, not inside the chat request handler, so the Tools
 * settings page can render the exact schema the model receives.
 */
export const MEDIA_TOOLS = [
  { name: 'builtin_generate_media', description: '向后台提交一条图片或视频生成任务。图片支持 gpt-image-2、gpt-image-2.5、gemini-3-pro-image-preview（可用参考图编辑），视频支持 minimax-h3-flash、minimax-h3-standard。调用前必须明确用户的生成意图，提交遵循项目审批模式。返回任务 ID，不等待媒体完成。', parameters: { type: 'object', properties: {
    modelId: { type: 'string', enum: ['gpt-image-2', 'gpt-image-2.5', 'gemini-3-pro-image-preview', 'minimax-h3-flash', 'minimax-h3-standard'] },
    requestId: { type: 'string', description: '可选唯一请求编号，同一生成请求重试时沿用。' },
    prompt: { type: 'string', minLength: 1, maxLength: 16000, description: '图片描述或编辑指令。改编用户提供的图片时，描述要改什么，不需要复述原图内容。' },
    options: { type: 'object', properties: {
      aspectRatio: { type: 'string', enum: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9', 'adaptive'], description: '画幅：图片支持 1:1、2:3、3:2、3:4、4:3、9:16、16:9；视频另外支持 21:9 和 adaptive（adaptive 需要图片或视频参考）。' },
      resolution: { type: 'string', enum: ['1K', '2K', '4K', '480P', '768P', '1080P'], description: '清晰度档位：图片为 1K/2K/4K，视频为 480P/768P/1080P（H3 Standard 不支持 1080P）。' },
      references: { type: 'array', maxItems: 16, items: { type: 'string' }, description: '必填场景：当用户提供了图片 URL 或要求改编已有图片（改风格、换背景、换配色、保持人物/物体一致性）时，必须把该 URL 放进这个数组。不填则视为纯文生图，原图会被忽略。支持站内 /api/files/ URL、公网 HTTP(S) URL 或 data: URL。图片编辑及视频图片参考可用，数量以模型能力为准，Gemini 最多 14 张。' },
      duration: { type: 'integer', minimum: 4, maximum: 15, description: '视频时长（秒），仅视频' },
      referenceVideos: { type: 'array', maxItems: 3, items: { type: 'string' }, description: 'H3 视频参考，支持站内 /api/files/ URL 或公网 HTTP(S) URL，数量以模型能力为准。' },
      referenceAudios: { type: 'array', maxItems: 3, items: { type: 'string' }, description: 'H3 音频或音色试听参考，支持站内 /api/files/ URL 或公网 HTTP(S) URL；须搭配图片或视频参考。' },
      studioTarget: { type: 'object', description: '可选：完成后由后台自动关联真实结果；先读取目标最新版本。片段（clips）支持自己的 image、storyboardImage、blockingImage 和 videos。融合资产必须传此目标，后台检查 dependencies 并自动加入当前依赖图片与用途说明；依赖未出图会拒绝生成。', properties: { resource: { type: 'string', enum: ['assets','clips'] }, id: { type: 'string' }, version: { type: 'integer', minimum: 1 }, field: { type: 'string', enum: ['image','storyboardImage','blockingImage','videos'] }, variantId: { type: 'string' } }, required: ['resource','id','version','field'], additionalProperties: false },
    }, additionalProperties: false } },
  required: ['modelId','prompt'], additionalProperties: false } },
  { name: 'builtin_get_media_task', description: '按后台生成任务 ID 查询图片或视频的真实状态与结果（含结果 URL、供应商原始返回）。不会触发新的付费生成。', parameters: { type: 'object', properties: { taskId: { type: 'string', minLength: 36, maxLength: 36 } }, required: ['taskId'], additionalProperties: false } },
] as const;
type DefaultMediaSelection = {
  image: { modelId: string; resolution: '1K' | '2K' | '4K'; aspectRatio: '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '9:16' | '16:9' };
  video: { modelId: 'minimax-h3-flash' | 'minimax-h3-standard'; resolution: '480P' | '768P' | '1080P'; aspectRatio: 'adaptive' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16' };
};
const IMAGE_MODEL_IDS = ['gpt-image-2', 'gpt-image-2.5', 'gemini-3-pro-image-preview'];
const IMAGE_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'];
const defaultMediaSelection: DefaultMediaSelection = {
  image: { modelId: 'gpt-image-2', resolution: '2K', aspectRatio: '16:9' },
  video: { modelId: 'minimax-h3-flash', resolution: '480P', aspectRatio: '16:9' },
};

function validateDefaultMediaSelection(value: unknown): DefaultMediaSelection {
  if (!value || typeof value !== 'object') throw new Error('默认媒体模型配置无效');
  const input = value as Record<string, unknown>;
  const image = input.image;
  const video = input.video;
  if (!image || typeof image !== 'object' || !video || typeof video !== 'object') throw new Error('默认媒体模型配置不完整');
  const imageChoice = image as Record<string, unknown>;
  const videoChoice = video as Record<string, unknown>;
  const imageResolutions = ['1K', '2K', '4K'];
  if (!IMAGE_MODEL_IDS.includes(String(imageChoice.modelId)) || !imageResolutions.includes(String(imageChoice.resolution)) || !IMAGE_ASPECT_RATIOS.includes(String(imageChoice.aspectRatio))) throw new Error('默认图片模型参数不受支持');
  const videoModels: Record<string, string[]> = { 'minimax-h3-flash': ['480P', '768P', '1080P'], 'minimax-h3-standard': ['480P', '768P'] };
  if (!videoModels[String(videoChoice.modelId)]?.includes(String(videoChoice.resolution)) || !['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(String(videoChoice.aspectRatio))) throw new Error('默认视频模型参数不受支持');
  return {
    image: { modelId: String(imageChoice.modelId), resolution: imageChoice.resolution as DefaultMediaSelection['image']['resolution'], aspectRatio: imageChoice.aspectRatio as DefaultMediaSelection['image']['aspectRatio'] },
    video: {
      modelId: String(videoChoice.modelId) as DefaultMediaSelection['video']['modelId'],
      resolution: videoChoice.resolution as DefaultMediaSelection['video']['resolution'],
      aspectRatio: videoChoice.aspectRatio as DefaultMediaSelection['video']['aspectRatio'],
    },
  };
}

async function connectApplicationWithRetry(app: Parameters<typeof connectApplication>[0], signal: AbortSignal) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await connectApplication(app, signal); }
    catch (error) {
      lastError = error;
      if (attempt === 2 || !isRetryableMcpError(error)) break;
      await retryPause(signal, attempt + 1);
    }
  }
  throw lastError;
}

async function retryPause(signal: AbortSignal, attempt: number) {
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { if (timer) clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const finish = () => { signal.removeEventListener('abort', abort); resolve(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    timer = setTimeout(finish, 150 * attempt);
  });
}

function errorStatus(reason: unknown) {
  const value = reason && typeof reason === 'object' ? reason as { status?: unknown; statusCode?: unknown } : {};
  const status = value.status ?? value.statusCode;
  return typeof status === 'number' ? status : typeof status === 'string' && /^\d{3}$/.test(status) ? Number(status) : undefined;
}

export function isRetryableMcpError(reason: unknown) {
  if (reason instanceof Error && ['AbortError', 'CanceledError'].includes(reason.name)) return false;
  if (reason instanceof Error && reason.name === 'TimeoutError') return true;
  const status = errorStatus(reason) ?? (reason instanceof Error ? errorStatus(reason.cause) : undefined);
  if (status !== undefined) return status >= 500 && status <= 599;
  const message = reason instanceof Error ? `${reason.message} ${reason.cause instanceof Error ? reason.cause.message : ''}` : String(reason || '');
  return /(?:network error|failed to fetch|fetch failed|econnreset|etimedout|enotfound|socket hang up|timeout|timed out|temporar(?:y|ily)|\b5\d{2}\b)/i.test(message);
}

function formatH3ReferencePrompt(value: string) {
  let text = value.replace(/```(?:text|markdown)?/gi, '').replace(/```/g, '').trim();
  text = text.replace(/\s+(subject_definitions|summary|retention_analysis|detailed_description|overall_soundscape|non_diegetic_music)\s*:/gi, '\n\n$1:');
  text = text.replace(/\s+-\s+(?=<(?:Subject|Picture|Video|Audio)\s+\d+>)/g, '\n- ');
  text = text.replace(/\s+(?=\[Shot\s+\d+\])/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

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

export function createApi(directory: string, env: Record<string, string>, promptFile: string) {
  const storage = new LocalStorage(directory, env.AGENT_CHAT_DB_PATH?.trim() || 'data.sqlite');
  const logFailure = createFailureLog(join(directory, 'logs'));
  const fileConfig = validateStorageConfig(storage.getConfig<unknown>('storageConfiguration') || storageConfigFromEnv(env, storage.path));
  const files = new FileStore(storage.path, fileOptions(fileConfig));
  const optimization = createPromptOptimization(storage, files);
  const requestRecords = new RequestRecordStore(storage, files, () => [env.AGENT_CHAT_API_KEY || '', env.VIDEO_ANALYSIS_API_KEY || '', env.FISH_API_KEY || '', ...((storage.getConfig<StoredProvider[]>('providers') || []).map(provider => provider.apiKey)), storage.getConfig<{ apiKey?: string }>('voiceConfiguration')?.apiKey || '']);
  const voiceApi = createVoiceApi(storage, env, requestRecords);
  const skillLibrary = new SkillLibrary(storage);
  const runtime = new SkillRuntime(directory, files, skillLibrary);
  const storageSettings = new StorageSettings(storage, files, fileConfig);
  const projectStore = new ProjectStore(storage.path, files);
  const studio = new StudioStore(projectStore);
  const workflowDebug = createWorkflowDebugLog(join(directory, 'logs'), /^(1|true|yes|on)$/i.test(env.VIDEO_REDRAW_DEBUG?.trim() || ''), () => [
    env.AGENT_CHAT_API_KEY || '', env.VIDEO_ANALYSIS_API_KEY || '', env.FISH_API_KEY || '', env.COS_SECRET_ID || '', env.COS_SECRET_KEY || '',
    ...((storage.getConfig<StoredProvider[]>('providers') || []).map(provider => provider.apiKey)),
    storage.getConfig<{ apiKey?: string }>('voiceConfiguration')?.apiKey || '',
    storage.getConfig<{ secretId?: string; secretKey?: string }>('storageConfiguration')?.secretId || '',
    storage.getConfig<{ secretId?: string; secretKey?: string }>('storageConfiguration')?.secretKey || '',
  ]);
  const videoRedraw: VideoRedraw = new VideoRedraw(studio, {
    debugLog: workflowDebug,
    workflowAgent: kind => loadWorkflowAgents(storage).find(agent => agent.kind === kind)!,
    workflowSkills: ids => ids.map(id => {
      const skill = skillLibrary.list().find(item => item.id === id);
      if (!skill) throw new Error(`工作流 Skill 不存在：${id}`);
      return skill;
    }),
    workflowTools: () => [...RUNTIME_TOOLS, ...STUDIO_TOOLS, ...REDRAW_TOOLS].filter(tool => tool.risk === 'read' && !('waitForCompletion' in tool)).map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    executeWorkflowTool: async (name, args, context): Promise<unknown> => {
      const definition = [...RUNTIME_TOOLS, ...STUDIO_TOOLS, ...REDRAW_TOOLS].find(tool => tool.name === name);
      if (!definition || definition.risk !== 'read' || 'waitForCompletion' in definition) throw new Error('工作流工具不存在或不允许后台执行');
      if (RUNTIME_TOOLS.some(tool => tool.name === name)) return runtime.execute(name, args, context);
      if (STUDIO_TOOLS.some(tool => tool.name === name)) return executeStudioTool(studio, name, args, { source: 'workflow' });
      return videoRedraw.read(args);
    },
    analysisCredentials: () => env.VIDEO_ANALYSIS_BASE_URL && env.VIDEO_ANALYSIS_API_KEY ? { baseUrl: env.VIDEO_ANALYSIS_BASE_URL, apiKey: env.VIDEO_ANALYSIS_API_KEY, videoUrlFormat: env.VIDEO_ANALYSIS_VIDEO_URL_FORMAT || 'object' } : undefined,
    videoDurations: () => {
      const modelId = validateDefaultMediaSelection(storage.getConfig<unknown>('defaultMediaModels') || defaultMediaSelection).video.modelId;
      const configuration = storage.getConfig<ModelConfiguration>('modelConfiguration') || defaultModelConfiguration();
      const model = configuration.models.find(item => item.id === modelId && item.type === 'video' && item.enabled !== false);
      const binding = model && enabledBindings(configuration, model)[0];
      const capabilities = model && binding && effectiveCapabilities(configuration, model, binding);
      const durations = capabilities && 'durations' in capabilities ? capabilities.durations : undefined;
      const seconds = Array.isArray(durations) ? durations : durations ? Array.from({ length: Math.max(0, Math.min(15, Math.floor(durations.max)) - Math.max(1, Math.ceil(durations.min)) + 1) }, (_, index) => Math.max(1, Math.ceil(durations.min)) + index) : [];
      return { modelId, seconds: [...new Set(seconds.filter(value => Number.isInteger(value) && value > 0 && value <= 15))].sort((a, b) => a - b) };
    },
    model: modelId => {
      const configuration = storage.getConfig<ModelConfiguration>('modelConfiguration') || defaultModelConfiguration();
      const logical = configuration.models.find(item => item.id === modelId && item.type === 'text' && item.enabled !== false);
      const binding = logical && enabledBindings(configuration, logical)[0];
      const selected = binding && resolveTextModel(storage.getConfig<StoredProvider[]>('providers') || [], configuration, binding.providerId, binding.upstreamModelId);
      if (!selected?.provider.apiKey) throw new Error(`请在模型设置中配置并启用 ${modelId} 及其提供方凭证`);
      return selected;
    },
  });
  const videoEditing = new VideoEditing(files);
  const openCut = new OpenCutProjects(studio, files);
  const publicBaseUrl = env.AGENT_CHAT_PUBLIC_BASE_URL || (env.AGENT_CHAT_PUBLIC_HOST ? `${String(env.AGENT_CHAT_PUBLIC_HOST).startsWith('http') ? env.AGENT_CHAT_PUBLIC_HOST : `https://${env.AGENT_CHAT_PUBLIC_HOST}`}` : undefined);
  const mediaJobs = createMediaJobsApi(storage.path, () => storage.getConfig<ModelConfiguration>('modelConfiguration') || defaultModelConfiguration(), () => storage.getConfig<StoredProvider[]>('providers') || [], files, { target: (value, type) => studio.mediaTarget(value, type), targetCurrent: (target, type) => studio.mediaTargetCurrent(target, type), prepare: (input, type) => studio.prepareMedia(input, type), completed: job => studio.attachMedia(job), publicBaseUrl, imageDownloadProxy: env.IMAGE_DOWNLOAD_PROXY?.trim() }, requestRecords);
  if (!storage.getConfig<boolean>('requestRecordsInitialized')) {
    for (const job of mediaJobs.store.list()) {
      const provider = storage.getConfig<StoredProvider[]>('providers')?.find(item => item.id === job.providerId);
      requestRecords.syncMedia(job, { providerName: provider?.name, secret: provider?.apiKey, modelName: storage.getConfig<ModelConfiguration>('modelConfiguration')?.models.find(item => item.id === job.modelId)?.displayName });
    }
    storage.setConfig('requestRecordsInitialized', true);
    requestRecords.cleanup();
  }
  const connectionManager = new McpConnectionManager(connectApplicationWithRetry);
  const pendingMcpOAuth = new Map<string, { appId: string; app: Awaited<ReturnType<typeof loadApplications>>[number]; provider: ReturnType<typeof createMcpOAuthProvider> }>();
  const validatePrompt = (value: unknown): string => {
    if (typeof value !== 'string' || !value.trim()) throw new Error('系统提示词不能为空');
    return value;
  };

  const initial: StoredProvider[] = [{ id: 'darl', name: 'Darl', baseUrl: env.AGENT_CHAT_BASE_URL || 'https://api.darl.cn/v1', protocol: 'openai-completions', apiKey: env.AGENT_CHAT_API_KEY || '', status: 'unknown', models: [{ id: env.AGENT_CHAT_MODEL || 'deepseek-v4.1-flash', name: env.AGENT_CHAT_MODEL || 'deepseek-v4.1-flash', providerId: 'darl', type: 'text', enabled: true }] }];
  if (!storage.getConfig<StoredProvider[]>('providers')) storage.setConfig('providers', initial);
  const storedConfiguration = storage.getConfig<ModelConfiguration>('modelConfiguration');
  if (!storedConfiguration) storage.setConfig('modelConfiguration', defaultModelConfiguration());
  else {
    const upgraded = upgradeModelConfiguration(storedConfiguration);
    if (JSON.stringify(upgraded) !== JSON.stringify(storedConfiguration)) storage.setConfig('modelConfiguration', upgraded);
  }
  const storedMediaDefaults = storage.getConfig<DefaultMediaSelection>('defaultMediaModels');
  if (!storedMediaDefaults) storage.setConfig('defaultMediaModels', defaultMediaSelection);
  else if (['minimax-h3-flash', 'minimax-h3-standard'].includes(storedMediaDefaults.video?.modelId) && ['480', '768'].includes(String(storedMediaDefaults.video?.resolution))) {
    storage.setConfig('defaultMediaModels', { ...storedMediaDefaults, video: { ...storedMediaDefaults.video, resolution: `${storedMediaDefaults.video.resolution}P` } });
  }
  const voicePromptFile = join(promptFile, '..', 'voice.md');
  const readPromptFile = (file: string) => readFileSync(file, 'utf8').trim();
  const readPromptFileIfExists = (file: string) => { try { return readPromptFile(file); } catch { return ''; } };
  if (!storage.getConfig<string>('systemPrompt')) {
    storage.setConfig('systemPrompt', validatePrompt(readFileSync(promptFile, 'utf8')));
  }
  const initialVoicePrompt = readPromptFileIfExists(voicePromptFile);
  if (!storage.getConfig<string>('voicePrompt') && initialVoicePrompt) {
    storage.setConfig('voicePrompt', initialVoicePrompt);
  }
  const loadPrompt = async () => validatePrompt(storage.getConfig<string>('systemPrompt'));
  const loadVoicePrompt = () => (storage.getConfig<string>('voicePrompt') || readPromptFileIfExists(voicePromptFile)).trim();
  const promptDefaults = () => ({ system: readPromptFile(promptFile), voice: readPromptFileIfExists(voicePromptFile), ...optimization.defaults() });
  const publicPrompts = async () => ({ system: await loadPrompt(), voice: loadVoicePrompt(), ...optimization.prompts(), defaults: promptDefaults() });
  const load = async (): Promise<StoredProvider[]> => storage.getConfig<StoredProvider[]>('providers') || initial;
  const loadModelConfiguration = async (): Promise<ModelConfiguration> => {
    const value = storage.getConfig<ModelConfiguration>('modelConfiguration') || defaultModelConfiguration();
    if (validateModelConfiguration(value).length) throw new Error('模型配置已损坏，请重新保存模型配置');
    return value;
  };
  const loadDefaultMediaSelection = (): DefaultMediaSelection => validateDefaultMediaSelection(storage.getConfig<unknown>('defaultMediaModels') || defaultMediaSelection);
  const update = async (mutate: (providers: StoredProvider[]) => StoredProvider[]) => storage.setConfig('providers', mutate(await load()));
  const middleware = async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith('/api/')) return next();
    const send = (status: number, data: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    // 本示例服务端持有真实模型密钥，已按需求开放局域网访问：按当前固定服务端口做同源校验，
    // 同一局域网的任何设备都能消耗凭据，请勿在不可信网络中运行。
    // AGENT_CHAT_ALLOWED_HOSTS 可额外放行反代/隧道域名（例如 Cloudflare Tunnel 暴露的 hostname）。
    const allowedHosts = new Set((env.AGENT_CHAT_ALLOWED_HOSTS || '').split(',').map((item) => item.trim()).filter(Boolean));
    // 本服务既可能跑在 dev 端口，也可能跑在 preview（打包产物）端口，两者都算同源。
    const localPorts = new Set([env.AGENT_CHAT_PORT || '5197', env.AGENT_CHAT_PREVIEW_PORT || '5199']);
    const portOf = (value: string) => value.match(/:(\d+)$/)?.[1];
    const host = request.headers.host || '';
    const origin = request.headers.origin;
    let originHost: string | undefined;
    try { originHost = origin ? new URL(origin).host : undefined; } catch { return send(403, { error: '请求来源无效' }); }
    const hostPort = portOf(host);
    const hostAllowed = (hostPort !== undefined && localPorts.has(hostPort)) || allowedHosts.has(host);
    if (!hostAllowed || (originHost && originHost !== host)) return send(403, { error: '仅允许本服务端口同源访问' });
    if (await requestRecordsApi(requestRecords, request, response)) return;
    if (await voiceApi(request, response)) return;
    if (request.url.split('?')[0] === '/api/files' && request.method === 'POST') {
      if (!isLocalOrLanAddress(request.socket.remoteAddress)) return send(403, { error: '上传仅允许本机或同一局域网' });
      const type = request.headers['content-type'] || '';
      if (!type.startsWith('multipart/form-data;')) return send(415, { error: '请使用表单上传' });
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > 320 * 1024 * 1024) return send(413, { error: '上传内容超过 320MB' });
        chunks.push(bytes);
      }
      const form = await new Request('http://localhost/upload', { method: 'POST', headers: { 'Content-Type': type }, body: Uint8Array.from(Buffer.concat(chunks)).buffer as ArrayBuffer }).formData();
      const file = form.get('file');
      if (!file || typeof file === 'string') return send(422, { error: '请选择文件' });
      if (file.size <= 0) return send(422, { error: '文件为空' });
      const bytes = Buffer.from(await file.arrayBuffer());
      const saved = await files.put(bytes, uploadMimeType(file.type), file.name);
      return send(201, { fileId: saved.id, url: files.originalUrl(saved), thumbnailUrl: files.thumbnailUrl(saved, 320), mimeType: saved.mimeType, size: saved.size });
    }
    const filePath = request.url.split('?')[0].match(/^\/api\/files\/([a-f0-9-]+)$/);
    if (filePath && request.method === 'GET') {
      const width = Number(new URL(request.url, 'http://localhost').searchParams.get('width') || 0) || undefined;
      const fileRecord = files.get(filePath[1]);
      if (!fileRecord) return send(404, { error: '文件不存在' });
      const markdownPreview = new URL(request.url, 'http://localhost').searchParams.get('preview') === 'markdown';
      if (markdownPreview && (!/\.md(?:own)?$/i.test(fileRecord.name || '') || fileRecord.size > 5 * 1024 * 1024)) return send(422, { error: '只能预览不超过 5MB 的 Markdown 文件' });
      if (width && ![160, 320, 640, 1024].includes(width)) return send(422, { error: '仅支持 160、320、640 或 1024 像素缩略图' });
      if (fileRecord.backend === 'cos' && !markdownPreview && new URL(request.url, 'http://localhost').searchParams.get('download') !== '1') {
        response.writeHead(302, { Location: (width ? files.thumbnailUrl(fileRecord, width as 160 | 320 | 640 | 1024) : files.originalUrl(fileRecord))!, 'Cache-Control': 'private,no-cache' });
        response.end(); return;
      }
      const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
      if (range && fileRecord.mimeType === 'video/mp4') {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), fileRecord.size - 1) : fileRecord.size - 1;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= fileRecord.size) {
          response.writeHead(416, { 'Content-Range': `bytes */${fileRecord.size}` }); response.end(); return;
        }
        const part = await files.getRange(filePath[1], start, end);
        if (!part) return send(404, { error: '文件不存在' });
        response.writeHead(206, { 'Content-Type': fileRecord.mimeType, 'Content-Length': part.bytes.length, 'Content-Range': `bytes ${start}-${end}/${fileRecord.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' });
        response.end(part.bytes); return;
      }
      let output: Awaited<ReturnType<FileStore['output']>>;
      try { output = await files.output(filePath[1], width); }
      catch (error) { return send(422, { error: error instanceof Error ? error.message : '文件读取失败' }); }
      const file = output;
      if (!file) return send(404, { error: '文件不存在' });
      const download = new URL(request.url, 'http://localhost').searchParams.get('download') === '1';
      response.writeHead(200, { 'Content-Type': markdownPreview ? 'text/plain; charset=utf-8' : file.mimeType, 'Content-Length': file.bytes.length, 'Cache-Control': width ? 'public, max-age=31536000, immutable' : 'private, max-age=3600', 'Accept-Ranges': file.mimeType === 'video/mp4' ? 'bytes' : 'none', 'X-Content-Type-Options': 'nosniff', ...(download ? { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileRecord.name || 'download')}`, 'Content-Security-Policy': "sandbox; default-src 'none'" } : {}) });
      response.end(file.bytes);
      return;
    }
    if (await handleWorkspaceProjectRequest(request, response, projectStore)) return;
    if (await handleVideoEditingRequest(request, response, videoEditing)) return;
    if (await handleOpenCut(request, response, openCut)) return;
    if (await handleRedrawRequest(request, response, videoRedraw)) return;
    if (await handleStudioRequest(request, response, studio)) return;
    if (await mediaJobs.handle(request, response)) return;
    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const requestId = requestRecordScope.getStore()!.requestId;
    const timeout = new RequestTimeout();
    const timeoutSignal = timeout.signal;
    const signal = AbortSignal.any([controller.signal, timeoutSignal]);
    let secret = '';
    try {
      await skillLibrary.ready;
      const providers = await load();
      const modelConfiguration = await loadModelConfiguration();
      const path = request.url.split('?')[0];
      if (path === '/api/workflow-agents/tools' && request.method === 'GET') return send(200, [...RUNTIME_TOOLS, ...STUDIO_TOOLS, ...REDRAW_TOOLS].filter(tool => tool.risk === 'read' && !('waitForCompletion' in tool)).map(tool => ({ name: tool.name, title: tool.title, risk: tool.risk })));
      if (path === '/api/workflow-agents/models' && request.method === 'GET') return send(200, workflowModelOptions(modelConfiguration, providers, env.VIDEO_ANALYSIS_BASE_URL));
      if (path === '/api/workflow-agents' && request.method === 'GET') return send(200, loadWorkflowAgents(storage));
      if (path === '/api/workflow-agents' && request.method === 'POST') {
        const next = validateWorkflowAgents(await readBody(request));
        const available = new Set([...RUNTIME_TOOLS, ...STUDIO_TOOLS, ...REDRAW_TOOLS].filter(tool => tool.risk === 'read' && !('waitForCompletion' in tool)).map(tool => tool.name));
        for (const agent of next) {
          for (const name of agent.toolNames) if (!available.has(name)) throw new Error(`工作流工具不可用：${name}`);
          for (const id of agent.skillIds) if (!skillLibrary.list().some(skill => skill.id === id)) throw new Error(`工作流 Skill 不存在：${id}`);
        }
        storage.setConfig('workflowAgents', next);
        return send(200, next);
      }
      if (path === '/api/tools' && request.method === 'GET') return send(200, [...MEDIA_TOOLS.filter(tool => tool.name !== 'builtin_generate_media'), ...RUNTIME_TOOLS, ...STUDIO_TOOLS, ...REDRAW_TOOLS].map((tool) => ({ ...tool, inputSchema: tool.parameters, parameters: undefined })));
      // 列表和目录都只返回可复用的快照：目录是列表的元数据投影，ETag 让重复打开复用 304。
      if (path === '/api/skills' && request.method === 'GET') return sendRevalidatedJson(request, response, new URL(request.url, 'http://localhost').searchParams.has('summary') ? skillLibrary.catalog() : skillLibrary.list());
      // 单个 Skill 的完整包体（含指令与资源）；列表与目录只带元数据。
      const singleSkill = path.match(/^\/api\/skills\/([^/]+)$/);
      if (singleSkill && request.method === 'GET') {
        const id = decodeURIComponent(singleSkill[1]);
        const found = skillLibrary.list().find(skill => skill.id === id);
        return found ? send(200, found) : send(404, { error: 'Skill 不存在或已删除' });
      }
      if (path === '/api/skills' && request.method === 'POST') {
        const { skill } = await readBody(request);
        skillLibrary.save(skill);
        return send(200, new URL(request.url, 'http://localhost').searchParams.has('summary') ? skillLibrary.catalog() : skillLibrary.list());
      }
      if (path.startsWith('/api/skills/') && request.method === 'DELETE') {
        skillLibrary.delete(decodeURIComponent(path.slice('/api/skills/'.length)));
        return send(200, new URL(request.url, 'http://localhost').searchParams.has('summary') ? skillLibrary.catalog() : skillLibrary.list());
      }
      if (path === '/api/media-tasks' && request.method === 'GET') return send(200, storage.getMediaTasks<unknown>());
      if (path === '/api/media-tasks' && request.method === 'POST') {
        const body = await readBody(request);
        if (!Array.isArray(body?.tasks)) throw new Error('媒体任务格式无效');
        storage.setMediaTasks(body.tasks);
        return send(200, storage.getMediaTasks<unknown>());
      }
      // 提示词统一读写；普通与 H3 优化规则也保存在现有配置中。
      if (path === '/api/prompts' && request.method === 'GET') return send(200, await publicPrompts());
      if (path === '/api/prompts' && request.method === 'POST') {
        const body = await readBody(request);
        for (const key of ['system', 'voice', 'optimization', 'h3Optimization']) {
          if (body[key] !== undefined && (typeof body[key] !== 'string' || !body[key].trim())) throw new Error('提示词不能为空');
        }
        if (body.system !== undefined) {
          const system = typeof body.system === 'string' ? body.system.trim() : '';
          if (!system) throw new Error('系统提示词不能为空');
          storage.setConfig('systemPrompt', system);
        }
        if (body.voice !== undefined) {
          const voice = typeof body.voice === 'string' ? body.voice.trim() : '';
          if (!voice) throw new Error('语音提示词不能为空');
          storage.setConfig('voicePrompt', voice);
        }
        for (const key of ['optimization', 'h3Optimization'] as OptimizationPromptKey[]) {
          if (typeof body[key] === 'string') storage.setConfig(key, body[key].trim());
        }
        return send(200, await publicPrompts());
      }
      if (path === '/api/prompt-optimization/settings' && request.method === 'GET') return send(200, optimization.models(modelConfiguration, providers));
      if (path === '/api/prompt-optimization/settings' && request.method === 'POST') {
        return send(200, optimization.saveModels(await readBody(request), modelConfiguration, providers));
      }
      if (path === '/api/prompt-adjustment' && request.method === 'POST') {
        const body = await readBody(request);
        const batch = Array.isArray(body.clipIds);
        const ids = batch ? body.clipIds : [body.clipId];
        if (!ids.length || ids.length > 200 || ids.some((id: unknown) => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) throw new Error('请选择不重复的片段，最多 200 个');
        const inputs = ids.map((clipId: string) => {
          try { return { clipId, input: promptAdjustmentContext(studio, videoRedraw, { ...body, clipId }) }; }
          catch (error) { return { clipId, error: safeError(error) }; }
        });
        if (!batch && inputs[0].error) throw new Error(inputs[0].error);
        const valid = inputs.filter((item: { input?: unknown }) => item.input);
        if (!valid.length) return send(200, { results: inputs });
        const first = valid[0].input!;
        if (body.field === 'prompt') {
          timeout.extend(600_000);
          const items = valid.map(({ input }: { input: typeof first }) => ({ clip: input.context.clip, shots: input.context.shots }));
          const result = await videoRedraw.adjustVideoPrompts(body.projectId, body.episodeId, items, body.requirements.trim(), signal);
          const output = parseBatchPromptResults(result) as Array<{ clipId?: unknown; prompt?: unknown; error?: unknown }>;
          const results = inputs.map((item: { clipId: string; error?: string; input?: typeof first }) => {
            if (!item.input) return { clipId: item.clipId, error: item.error };
            try {
              const matches = output.filter(value => value?.clipId === item.clipId);
              if (matches.length !== 1) throw new Error(matches.length ? '模型重复返回该片段' : '模型没有返回该片段的结果');
              const value = matches[0];
              if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 16000) throw new Error(typeof value.error === 'string' && value.error.trim() ? value.error : '调整结果为空或超过 16000 字符');
              validatePromptTiming(value.prompt, 'prompt', item.input.context.clip.duration);
              item.input.assertCurrent();
              return { clipId: item.clipId, prompt: value.prompt.trim(), before: item.input.before, version: item.input.version };
            } catch (error) { return { clipId: item.clipId, error: safeError(error) }; }
          });
          if (batch) return send(200, { results });
          if (results[0].error) throw new Error(results[0].error);
          return send(200, results[0]);
        }
        const selectedId = optimization.models(modelConfiguration, providers).general;
        const split = selectedId.indexOf('/');
        const selected = split > 0 ? resolveTextModel(providers, modelConfiguration, selectedId.slice(0, split), decodeURIComponent(selectedId.slice(split + 1))) : undefined;
        if (!selected) throw new Error('请在设置 → 模型中配置提示词优化模型');
        secret = selected.provider.apiKey;
        const instructions = readFileSync(new URL('../prompts/redraw-prompt-adjustment.md', import.meta.url), 'utf8').trim();
        const context = batch ? { ...first.context, clip: undefined, shots: undefined, batch: true, items: valid.map(({ input }: { input: typeof first }) => ({ clip: input.context.clip, shots: input.context.shots })) } : first.context;
        let result = '', failure = '';
        if (batch) timeout.extend(600_000);
        try { for await (const delta of generate(selected.provider, selected.model, [{ role: 'user', content: JSON.stringify(context) }], instructions, undefined, signal, undefined, batch ? Output.json() : undefined, timeout.touch)) result += delta; }
        catch (error) { signal.throwIfAborted(); if (!batch) throw error; failure = safeError(error, selected.provider.apiKey); }
        signal.throwIfAborted();
        if (!batch) {
          if (!result.trim() || result.length > 16000) throw new Error('调整结果为空或超过 16000 字符，请重试');
          validatePromptTiming(result, first.context.field, first.context.clip.duration);
          first.assertCurrent();
          return send(200, { prompt: result.trim(), before: first.before, version: first.version });
        }
        const output = parseBatchPromptResults(result) as Array<{ clipId?: unknown; prompt?: unknown; error?: unknown }>;
        return send(200, { results: inputs.map((item: { clipId: string; error?: string; input?: typeof first }) => {
          if (!item.input) return { clipId: item.clipId, error: item.error };
          const matches = output.filter(value => value?.clipId === item.clipId);
          try {
            if (matches.length !== 1) throw new Error(matches.length ? '模型重复返回该片段' : failure || '模型没有返回该片段的结果');
            const value = matches[0];
            if (typeof value.prompt !== 'string' || !value.prompt.trim() || value.prompt.length > 16000) throw new Error(typeof value.error === 'string' && value.error.trim() ? value.error : '调整结果为空或超过 16000 字符');
            validatePromptTiming(value.prompt, item.input.context.field, item.input.context.clip.duration);
            item.input.assertCurrent();
            return { clipId: item.clipId, prompt: value.prompt.trim(), before: item.input.before, version: item.input.version };
          } catch (error) { return { clipId: item.clipId, error: safeError(error) }; }
        }) });
      }
      if (path === '/api/prompt-optimization' && request.method === 'POST') {
        const body = await readBody(request);
        const context = optimization.context(body, modelConfiguration);
        const selectedId = optimization.models(modelConfiguration, providers)[body.optimization === 'h3' ? 'h3' : 'general'];
        const split = selectedId.indexOf('/');
        const selected = split > 0 ? resolveTextModel(providers, modelConfiguration, selectedId.slice(0, split), decodeURIComponent(selectedId.slice(split + 1))) : undefined;
        if (!selected) throw new Error('请在设置 → 模型中配置提示词优化模型');
        secret = selected.provider.apiKey;
        const instructions = optimization.prompts()[body.optimization === 'h3' ? 'h3Optimization' : 'optimization'];
        if (!instructions.trim()) throw new Error('请先配置优化提示词');
        let prompt = '';
        const messages = await optimization.messages(body, context);
        for await (const delta of generate(selected.provider, selected.model, messages, instructions, undefined, signal, undefined, undefined, timeout.touch)) prompt += delta;
        if (!prompt.trim() || prompt.length > 16000) throw new Error('优化结果为空或超过 16000 字符，请调整优化提示词后重试');
        const formatted = body.optimization === 'h3' && context.mode === 'reference' ? formatH3ReferencePrompt(prompt) : prompt.trim();
        return send(200, { prompt: formatted });
      }
      if (path === MCP_OAUTH_CALLBACK_PATH && request.method === 'GET') {
        const callback = new URL(request.url, 'http://localhost');
        const state = callback.searchParams.get('state');
        const code = callback.searchParams.get('code');
        const oauthError = callback.searchParams.get('error');
        const pending = state ? pendingMcpOAuth.get(state) : undefined;
        const finish = (ok: boolean, message: string) => {
          const safeMessage = message.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(`<!doctype html><meta charset="utf-8"><title>MCP OAuth</title><p>${safeMessage}</p><script>window.opener?.postMessage(${JSON.stringify({ type: 'mcp-oauth-complete', appId: pending?.appId, ok })}, '*'); window.close();</script>`);
        };
        if (!pending || !state) return finish(false, '授权会话已过期，请回到设置重新授权。');
        pendingMcpOAuth.delete(state);
        if (oauthError || !code) return finish(false, `Notion 授权未完成：${oauthError || '缺少授权码'}`);
        try {
          const result = await auth(pending.provider, { serverUrl: pending.app.url, authorizationCode: code });
          if (result !== 'AUTHORIZED') throw new Error('OAuth 授权未完成');
          await connectionManager.invalidateAll();
          finish(true, '授权成功，可以关闭此窗口。');
        } catch (error) {
          finish(false, `授权失败：${safeError(error, pending.app.apiKey)}`);
        }
        return;
      }
      if (path === '/api/applications' && request.method === 'POST') {
        const body = await readBody(request) as { id?: unknown; name?: unknown; url?: unknown; apiKey?: unknown };
        if (typeof body.id !== 'string' || typeof body.name !== 'string' || typeof body.url !== 'string') throw new Error('请填写应用 ID、名称和 MCP 地址');
        if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw new Error('密钥格式无效');
        const configs = await loadApplications(directory);
        if (configs.some((app) => app.id === body.id)) throw new Error('应用 ID 已存在');
        await saveApplications(directory, [...configs, { id: body.id, name: body.name.trim(), url: body.url, ...(body.apiKey ? { apiKey: body.apiKey } : {}) }]);
        await connectionManager.invalidateAll();
        return send(200, await applicationCatalog(directory, signal));
      }
      const applicationConfigRoute = path.match(/^\/api\/applications\/([\w-]+)$/);
      const applicationOAuthRoute = path.match(/^\/api\/applications\/([\w-]+)\/oauth\/start$/);
      if (applicationOAuthRoute && request.method === 'POST') {
        const configs = await loadApplications(directory);
        const app = configs.find((item) => item.id === applicationOAuthRoute[1]);
        if (!app) return send(404, { error: '应用不存在' });
        let authorizationUrl = '';
        const persist = async (oauth: NonNullable<typeof app.oauth>) => {
          const latest = await loadApplications(directory);
          await saveApplications(directory, latest.map((item) => item.id === app.id ? { ...item, oauth } : item));
        };
        const provider = createMcpOAuthProvider(app, (url) => { authorizationUrl = url.toString(); }, persist);
        const result = await auth(provider, { serverUrl: app.url });
        if (result === 'AUTHORIZED') {
          await connectionManager.invalidateAll();
          return send(200, { authorized: true });
        }
        if (!authorizationUrl) throw new Error('MCP OAuth 未返回授权地址');
        const state = new URL(authorizationUrl).searchParams.get('state');
        if (!state) throw new Error('MCP OAuth 授权地址缺少 state');
        pendingMcpOAuth.set(state, { appId: app.id, app, provider });
        return send(200, { authorized: false, authorizationUrl });
      }
      if (applicationConfigRoute && request.method === 'PUT') {
        const body = await readBody(request) as { name?: unknown; url?: unknown; apiKey?: unknown };
        if (typeof body.name !== 'string' || typeof body.url !== 'string') throw new Error('请填写名称和 MCP 地址');
        if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw new Error('密钥格式无效');
        const apiKey = typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : undefined;
        const configs = await loadApplications(directory);
        if (!configs.some((app) => app.id === applicationConfigRoute[1])) return send(404, { error: '应用不存在' });
        await saveApplications(directory, configs.map((app) => app.id !== applicationConfigRoute[1] ? app : {
          ...app, name: body.name as string, url: body.url as string,
          ...(apiKey ? { apiKey } : {}),
        }));
        await connectionManager.invalidateAll();
        return send(200, await applicationCatalog(directory, signal));
      }
      if (applicationConfigRoute && request.method === 'DELETE') {
        const configs = await loadApplications(directory);
        if (!configs.some((app) => app.id === applicationConfigRoute[1])) return send(404, { error: '应用不存在' });
        await saveApplications(directory, configs.filter((app) => app.id !== applicationConfigRoute[1]));
        await connectionManager.invalidateAll();
        return send(200, await applicationCatalog(directory, signal));
      }
      if (path === '/api/applications' && request.method === 'GET') {
        if (new URL(request.url, 'http://localhost').searchParams.get('refresh') === '1') await connectionManager.invalidateAll();
        return send(200, await applicationCatalog(directory, signal));
      }
      const applicationToolsRoute = path.match(/^\/api\/applications\/([\w-]+)\/tools$/);
      if (applicationToolsRoute && request.method === 'GET') {
        const userId = typeof request.headers['x-darl-user-id'] === 'string' ? request.headers['x-darl-user-id'].trim() : 'local';
        const scopeKey = `catalog:${userId}`;
        const configs = await loadApplications(directory);
        await connectionManager.reconcile(scopeKey, configs);
        const app = configs.find((item) => item.id === applicationToolsRoute[1]);
        if (!app) return send(404, { error: '应用不存在' });
        const url = new URL(request.url, 'http://localhost');
        if (url.searchParams.get('refresh') === '1') await connectionManager.invalidate(scopeKey, app.id);
        try {
          const connection = await connectionManager.get(scopeKey, app, signal);
          return send(200, { id: app.id, name: app.name, url: app.url, status: 'connected', description: `${connection.tools.length} 个 MCP 工具`, tools: connection.tools.map((tool) => ({ name: tool.name, title: tool.title || tool.annotations?.title, description: tool.description, risk: toolRisk(app, tool), inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations })) });
        } catch (error) {
          return send(200, { id: app.id, name: app.name, url: app.url, status: 'disconnected', description: safeError(error, app.apiKey), tools: [] });
        }
      }
      if (path === '/api/providers' && request.method === 'GET') return send(200, providers.map(publicProvider));
      if (path === '/api/default-models' && request.method === 'GET') return send(200, loadDefaultMediaSelection());
      if (path === '/api/default-models' && request.method === 'POST') {
        const selection = validateDefaultMediaSelection((await readBody(request))?.selection);
        storage.setConfig('defaultMediaModels', selection);
        return send(200, selection);
      }
      const storageRequest = path === '/api/storage' || path === '/api/storage/test';
      if (storageRequest && request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::1') return send(403, { error: '存储配置只允许本机访问' });
      if (path === '/api/storage' && request.method === 'GET') return send(200, storageSettings.public());
      if (path === '/api/storage/test' && request.method === 'POST') {
        await storageSettings.test((await readBody(request))?.configuration);
        return send(200, { ok: true });
      }
      if (path === '/api/storage' && request.method === 'POST') {
        return send(200, await storageSettings.save((await readBody(request))?.configuration));
      }
      if (path === '/api/model-config' && request.method === 'GET') return send(200, await loadModelConfiguration());
      if (path === '/api/model-config' && request.method === 'POST') {
        const incoming = (await readBody(request))?.configuration;
        const errors = validateModelConfiguration(incoming as ModelConfiguration);
        if (errors.length) throw new Error(errors[0].message);
        const next = upgradeModelConfiguration(incoming as ModelConfiguration);
        storage.setConfig('modelConfiguration', next);
        return send(200, next);
      }
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
      if (path === '/api/providers/models' && request.method === 'POST') {
        const body = await readBody(request);
        const provider = validateProvider(body.provider);
        const stored = providers.find(item => item.id === provider.id);
        const apiKey = typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : stored?.apiKey || '';
        secret = apiKey;
        return send(200, await listModels({ ...provider, apiKey }, signal));
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
          try {
            await listModels(provider, signal);
            await update((current) => current.map((item) => item.id === provider.id ? { ...item, status: 'connected' } : item));
          } catch (error) {
            await update((current) => current.map((item) => item.id === provider.id ? { ...item, status: 'error' } : item));
            throw error;
          }
          return send(200, (await load()).map(publicProvider));
        }
      }
      send(404, { error: '接口不存在' });
    } catch (error) {
      if (controller.signal.aborted && !timeoutSignal.aborted) return;
      const stage = error instanceof AgentFailure ? error.stage : timeoutSignal.aborted ? 'timeout' : response.headersSent ? 'model' : 'validation';
      const info = createAgentError(stage, timeoutSignal.aborted ? timeoutSignal.reason : error, { requestId, key: secret, ...(timeoutSignal.aborted ? { message: timeoutSignal.reason.message, suggestion: '继续对话前先查询已保存内容，避免重复提交已完成的修改。' } : {}), ...(error instanceof AgentFailure && !timeoutSignal.aborted ? { code: error.code, retryable: error.retryable, suggestion: error.suggestion } : {}) });
      logFailure({ requestId, stage: info.stage, code: info.code, message: error instanceof Error ? `${error.message}${error.cause instanceof Error ? ` / ${error.cause.message}` : ''}` : String(error), secret });
      if (response.headersSent) response.end(`${JSON.stringify({ type: 'error', error: info })}\n`);
      else send(400, { error: info });
    } finally {
      timeout.dispose();
      controller.abort();
    }
  };
  const scopedMiddleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => requestRecordScope.run({ store: requestRecords, requestId: crypto.randomUUID() }, () => middleware(request, response, next));
  return Object.assign(scopedMiddleware, { dispose: () => { videoRedraw.dispose(); mediaJobs.runner.stop(); requestRecords.close(); return runtime.dispose(); } });
}
