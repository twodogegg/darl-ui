// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultModelConfiguration } from '../src/components/settings/model-config';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { createPromptOptimization } from '../examples/agent-chat/server/prompt-optimization';

describe('提示词优化上下文与配置', () => {
  it('使用真实目录和文件元数据，校验模式并持久化模型选择', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darl-optimization-'));
    try {
      const storage = new LocalStorage(directory);
      const files = new FileStore(storage.path);
      const api = createPromptOptimization(storage, files);
      const configuration = defaultModelConfiguration();
      const input = { optimization: 'general', modelId: 'gpt-image-2', prompt: '修改图片颜色', mode: 'reference-edit', options: { count: 1, resolution: '2K', aspectRatio: '16:9' }, generationCount: 2 };
      const file = await files.put(await readFile('examples/agent-chat/client/public/agent-default-avatar.png'), 'image/png', 'reference.png');
      const context = api.context({ ...input, model: { name: '错误的客户端名称' }, references: { images: [{ id: 'preview', fileId: file.id, url: '/api/files/preview' }] }, style: { id: 'mine', name: '短剧', description: '柔和逆光' } }, configuration);
      expect(context).toMatchObject({ model: { id: 'gpt-image-2', type: 'image' }, options: input.options, mode: input.mode, generationCount: 2, style: { name: '短剧', description: '柔和逆光' }, references: { images: [{ label: '<Picture 1>', fileId: file.id, name: 'reference.png', mimeType: 'image/png', size: file.size }] } });
      expect(() => api.context({ ...input, optimization: 'h3' }, configuration)).toThrow('只适用于 H3');
      expect(() => api.context({ ...input, mode: 'text-to-video' }, configuration)).toThrow('生成方式无效');
      expect(() => api.context({ ...input, prompt: '' }, configuration)).toThrow('请填写');
      expect(() => api.context({ ...input, references: { images: [{ fileId: 'missing' }] } }, configuration)).toThrow('不存在');
      const defaults = api.models(configuration);
      expect(defaults.general).toContain('deepseek-v4.1-flash');
      expect(() => api.saveModels({ general: 'missing', h3: defaults.h3 }, configuration)).toThrow('文本模型');
      api.saveModels(defaults, configuration);
      expect(createPromptOptimization(new LocalStorage(directory), files).models(configuration)).toEqual(defaults);
      storage.setConfig('optimization', '自定义规则');
      expect(api.prompts().optimization).toBe('自定义规则');
      expect(api.prompts().h3Optimization).toContain('integrated_multimodal_description');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
