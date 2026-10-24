import { describe, expect, it } from 'vitest';
import { defaultModelConfiguration, effectiveCapabilities, resolveCapabilities, toAgentModels, toMediaModels, upgradeModelConfiguration, validateModelConfiguration } from '../src/components/settings/model-config';

describe('model configuration', () => {
  it('keeps zero and false overrides and replaces arrays', () => {
    const configuration = defaultModelConfiguration();
    const model = configuration.models.find((item) => item.id === 'minimax-h3-flash')!;
    const binding = { ...model.bindings[0], capabilityOverrides: { maxReferenceVideos: 0, generateAudio: false, resolutions: ['768P'] } };
    const resolved = effectiveCapabilities(configuration, model, binding)!;
    expect(resolved).toMatchObject({ maxReferenceVideos: 0, generateAudio: false, resolutions: ['768P'] });
  });

  it('rejects mismatched templates and unknown protocols', () => {
    const configuration = defaultModelConfiguration();
    const model = configuration.models[0];
    model.capabilityTemplateId = 'gpt-image-2';
    model.bindings[0].protocolKey = 'unknown-protocol';
    const errors = validateModelConfiguration(configuration);
    expect(errors.map((error) => error.message)).toEqual(expect.arrayContaining(['能力模板类型与模型不一致', '协议未安装或尚未由宿主注册']));
  });

  it('rejects defaults that fall outside a binding effective capability', () => {
    const configuration = defaultModelConfiguration();
    const model = configuration.models.find((item) => item.id === 'minimax-h3-flash')!;
    model.bindings[0].capabilityOverrides = { resolutions: ['1080P'] };
    const errors = validateModelConfiguration(configuration);
    expect(errors.map((error) => error.message)).toContain('默认分辨率必须属于最终有效能力');
  });

  it('never exposes a close-thinking option for text models', () => {
    const configuration = defaultModelConfiguration();
    const model = configuration.models.find((item) => item.id === 'deepseek-v4.1-flash')!;
    model.bindings[0].capabilityOverrides = { reasoningEfforts: ['none', 'high'] };
    expect(validateModelConfiguration(configuration).map((error) => error.message)).toContain('文本模型必须提供思考等级，且不能包含 none');
  });

  it('only exposes executable text bindings to AgentSidebar models', () => {
    const configuration = defaultModelConfiguration();
    const models = toAgentModels(configuration, [{ id: 'darl', name: 'Darl', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', models: [] }]);
    expect(models.map((model) => model.logicalModelId)).toEqual(expect.arrayContaining(['deepseek-v4.1-flash', 'gpt-6.1-sol', 'gemini-4-argon', 'gpt-6-astra']));
    expect(models.every((model) => model.id.startsWith('darl/'))).toBe(true);
  });

  it('passes the configured default reasoning effort to AgentSidebar models', () => {
    const configuration = defaultModelConfiguration();
    const models = toAgentModels(configuration, [{ id: 'darl', name: 'Darl', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', models: [] }]);
    const deepseek = models.find((model) => model.logicalModelId === 'deepseek-v4.1-flash')!;
    expect(deepseek.reasoningEfforts).toEqual(['low', 'high', 'max']);
    expect(deepseek.defaultReasoningEffort).toBe('high');
    const gpt = models.find((model) => model.logicalModelId === 'gpt-6.1-sol')!;
    expect(gpt.defaultReasoningEffort).toBe('medium');
  });

  it('keeps binding-level default reasoning overrides in the runtime model', () => {
    const configuration = defaultModelConfiguration();
    const model = configuration.models.find((item) => item.id === 'deepseek-v4.1-flash')!;
    model.bindings[0].capabilityOverrides = { defaultReasoningEffort: 'max' };
    const runtime = toAgentModels(configuration, [{ id: 'darl', name: 'Darl', baseUrl: 'https://example.test/v1', protocol: 'openai-completions', models: [] }]).find((item) => item.logicalModelId === 'deepseek-v4.1-flash')!;
    expect(runtime.defaultReasoningEffort).toBe('max');
  });

  it('exposes both H3 video models with the documented capabilities', () => {
    const configuration = defaultModelConfiguration();
    const models = toMediaModels(configuration);
    const flash = models.find((model) => model.id === 'minimax-h3-flash');
    const standard = models.find((model) => model.id === 'minimax-h3-standard');
    expect(flash).toMatchObject({
      type: 'video', bindingId: 'h3-darl', providerId: 'darl', protocolKey: 'darl-h3-flash-unified',
      capabilities: { images: 9, videos: 3, audios: 3, generationModes: ['text-to-video', 'first-last-frame', 'reference'], resolutions: ['480P', '768P', '1080P'], aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], firstLastFrame: true, durations: { min: 4, max: 15 } },
    });
    expect(standard).toMatchObject({
      type: 'video', bindingId: 'h3-standard-darl', upstreamModelId: 'minimax-h3-standard', protocolKey: 'darl-h3-flash-unified',
      capabilities: { resolutions: ['480P', '768P'], aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], firstLastFrame: true, images: 9, videos: 3, audios: 3 },
    });
    expect(validateModelConfiguration(configuration)).toEqual([]);
  });

  it('migrates a persisted H3 configuration onto the new size and ratio contract', () => {
    const configuration = defaultModelConfiguration();
    const template = configuration.templates.find((item) => item.id === 'h3-flash')!;
    template.capabilities = { ...template.capabilities, resolutions: ['480', '768'], aspectRatios: ['16:9', '9:16'], firstLastFrame: 'unverified' };
    template.defaults = { resolution: '480', aspectRatio: '16:9', duration: 10 };
    configuration.templates = configuration.templates.filter((item) => item.id !== 'h3-standard');
    configuration.models = configuration.models.filter((model) => model.id !== 'minimax-h3-standard');
    const upgraded = upgradeModelConfiguration(configuration);
    const upgradedTemplate = upgraded.templates.find((item) => item.id === 'h3-flash')!;
    expect(upgradedTemplate.capabilities).toMatchObject({ resolutions: ['480P', '768P', '1080P'], aspectRatios: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'], firstLastFrame: 'supported' });
    expect(upgradedTemplate.defaults).toEqual({ resolution: '480P', aspectRatio: '16:9', duration: 10 });
    expect(upgraded.models.find((model) => model.id === 'minimax-h3-standard')).toMatchObject({ capabilityTemplateId: 'h3-standard', bindings: [{ protocolKey: 'darl-h3-flash-unified', upstreamModelId: 'minimax-h3-standard' }] });
    expect(validateModelConfiguration(upgraded)).toEqual([]);
  });

  it('rejects 1080P on the Standard template', () => {
    const configuration = defaultModelConfiguration();
    const model = configuration.models.find((item) => item.id === 'minimax-h3-standard')!;
    model.bindings[0].capabilityOverrides = { resolutions: ['480P', '1080P'] };
    expect(validateModelConfiguration(configuration).map((error) => error.message)).toContain('H3 Standard 只支持 480P 或 768P');
  });

  it('exposes only the product image options for the first batch', () => {
    const configuration = defaultModelConfiguration();
    const models = toMediaModels(configuration);
    expect(models.filter((model) => model.type === 'image').map((model) => model.id)).toEqual(['gpt-image-2', 'gpt-image-2.5', 'gemini-3-pro-image-preview']);
    const gpt = models.find((model) => model.id === 'gpt-image-2')!;
    expect(gpt.capabilities).toMatchObject({
      images: 16,
      resolutions: ['1K', '2K', '4K'],
      aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'],
    });
    expect(gpt.capabilities.maxOutputs).toBeUndefined();
    const gemini = models.find((model) => model.id === 'gemini-3-pro-image-preview')!;
    expect(gemini.capabilities).toMatchObject({ images: 14, resolutions: ['1K', '2K', '4K'] });
    const gpt25 = models.find((model) => model.id === 'gpt-image-2.5')!;
    expect(gpt25.capabilities).toEqual(gpt.capabilities);
    expect(gpt25.defaults).toEqual(gpt.defaults);
    expect(configuration.models.find((model) => model.id === 'gpt-image-2.5')!.bindings[0].upstreamModelId).toBe('gpt-image-2.5-sunburst');
  });

  it('upgrades persisted image options and adds new built-in models', () => {
    const configuration = defaultModelConfiguration();
    const template = configuration.templates.find((item) => item.id === 'gpt-image-2')!;
    template.capabilities = {
      supportsTextToImage: true, supportsReferenceEdit: true, maxReferenceImages: 16, maxOutputs: 10,
      sizes: ['auto', '1024x1024'], aspectRatios: ['1:1'], qualities: ['auto'], formats: ['png'], transparentBackground: true,
    } as unknown as typeof template.capabilities;
    template.defaults = { size: 'auto', quality: 'auto', count: 1 };
    configuration.models = configuration.models.filter((model) => !['gpt-image-2.5', 'gemini-3-pro-image-preview'].includes(model.id));
    configuration.protocols = configuration.protocols.filter((protocol) => protocol.key !== 'gemini-generate-content');
    const upgraded = upgradeModelConfiguration(configuration);
    const capabilities = upgraded.templates.find((item) => item.id === 'gpt-image-2')!.capabilities as Record<string, unknown>;
    expect(capabilities).toMatchObject({ resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9'] });
    expect(capabilities.sizes).toBeUndefined();
    expect(capabilities.maxOutputs).toBeUndefined();
    expect(upgraded.models.map((model) => model.id)).toEqual(expect.arrayContaining(['gpt-image-2.5', 'gemini-3-pro-image-preview']));
    expect(upgraded.protocols.map((protocol) => protocol.key)).toContain('gemini-generate-content');
    expect(validateModelConfiguration(upgraded)).toEqual([]);
  });

  it('does not mutate the template when resolving overrides', () => {
    const configuration = defaultModelConfiguration();
    const template = configuration.templates.find((item) => item.id === 'h3-flash')!;
    const resolved = resolveCapabilities(template, { resolutions: ['1080P'] });
    expect((resolved as { resolutions: string[] }).resolutions).toEqual(['1080P']);
    expect((template.capabilities as { resolutions: string[] }).resolutions).toEqual(['480P', '768P', '1080P']);
  });
});
