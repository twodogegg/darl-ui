import type { ChatImage, FunctionTool } from './models';
import type { MediaRuntime, MediaOptions } from './media-runtime';

export const mediaToolDefinitions: FunctionTool[] = [
  { name: 'media_generate_image',
    description: '为用户创建真正的 GPT Image 2 图片生成任务。最近一条用户消息附带的图片将作为参考图进行编辑。成功后只返回本地任务编号，后台继续生成；不得声称图已生成。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      prompt: { type: 'string', minLength: 1 }, projectId: { type: 'integer', minimum: 1 },
      size: { type: 'string', description: '例如 1024x1024 或 1536x1024（不能填写 1K/2K）' },
      quality: { type: 'string', enum: ['auto','low','medium','high'] },
      count: { type: 'integer', minimum: 1, maximum: 10 },
    }, required: ['prompt'] } },
  { name: 'media_generate_video',
    description: '创建 MiniMax H3 Flash 异步视频任务。文生视频可以提交；参考图片需要 Darl 网关实际确认统一 /v1/files 合同。返回任务编号不代表生成完成。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      prompt: { type: 'string', minLength: 1 }, projectId: { type: 'integer', minimum: 1 },
      seconds: { type: 'integer', minimum: 4, maximum: 15 },
      resolution: { type: 'string', enum: ['480', '768'] },
      aspectRatio: { type: 'string', enum: ['16:9', '9:16'] },
    }, required: ['prompt'] } },
  { name: 'media_get_task',
    description: '只读：根据本地生成任务编号，查询真实图片或视频任务状态、失败原因和结果地址。不要假设 queued/running 已成功。',
    parameters: { type: 'object', additionalProperties: false, properties: {
      taskId: { type: 'string', minLength: 10 },
    }, required: ['taskId'] } },
];

const imageSizes: Record<string, Record<string, string>> = {
  '1K': { '1:1': '1024x1024', '3:4': '768x1024', '4:3': '1024x768', '16:9': '1280x720', '9:16': '720x1280' },
  '2K': { '1:1': '2048x2048', '3:4': '1536x2048', '4:3': '2048x1536', '16:9': '2048x1152', '9:16': '1152x2048' },
  '4K': { '1:1': '2880x2880', '3:4': '2448x3264', '4:3': '3264x2448', '16:9': '3840x2160', '9:16': '2160x3840' },
};
interface MediaDefaults {
  image: { resolution: string; aspectRatio: string };
  video: { resolution: string; aspectRatio: string };
}

export function runMediaTool(
  runtime: MediaRuntime, name: string, raw: Record<string, unknown>, images: ChatImage[], defaults?: MediaDefaults,
): object {
  if (name === 'media_get_task') {
    if (typeof raw.taskId !== 'string') throw new Error('任务编号无效');
    const result = runtime.get(raw.taskId);
    if (!result) throw new Error('任务不存在');
    return result;
  }
  if (typeof raw.prompt !== 'string') throw new Error('提示词必须是文本');
  const projectId = raw.projectId === undefined ? undefined : Number(raw.projectId);
  if (raw.projectId !== undefined && (!Number.isSafeInteger(projectId) || Number(projectId) <= 0)) throw new Error('项目编号无效');
  if (name === 'media_generate_image') {
    const opts: MediaOptions = { size: imageSizes[defaults?.image.resolution || '2K']?.[defaults?.image.aspectRatio || '16:9'] || '1024x1024' };
    if (raw.size !== undefined) opts.size = String(raw.size);
    if (raw.quality !== undefined) opts.quality = raw.quality as MediaOptions['quality'];
    if (raw.count !== undefined) opts.count = Number(raw.count);
    return runtime.enqueue('image', { prompt: raw.prompt, projectId, options: opts }, images);
  }
  if (name === 'media_generate_video') {
    const opts: MediaOptions = { resolution: defaults?.video.resolution === '480P' ? '480' : '768', aspectRatio: defaults?.video.aspectRatio === '9:16' ? '9:16' : '16:9' };
    if (raw.seconds !== undefined) opts.seconds = Number(raw.seconds);
    if (raw.resolution !== undefined) opts.resolution = raw.resolution as MediaOptions['resolution'];
    if (raw.aspectRatio !== undefined) opts.aspectRatio = raw.aspectRatio as MediaOptions['aspectRatio'];
    return runtime.enqueue('video', { prompt: raw.prompt, projectId, options: opts }, images);
  }
  throw new Error('未知生成工具');
}
