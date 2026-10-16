import { describe, expect, it } from 'vitest';
import { defaultModelConfiguration, effectiveCapabilities, resolveCapabilities, toAgentModels, toMediaModels, validateModelConfiguration } from '../src/components/settings/model-config';

describe('model configuration', () => {
  it('keeps zero and false overrides and replaces arrays', () => {
    const configuration = defaultModelConfiguration();
    const model = configuration.models.find((item) => item.id === 'minimax-h3-flash')!;
    const binding = { ...model.bindings[0], capabilityOverrides: { maxReferenceVideos: 0, generateAudio: false, resolutions: ['480'] } };
    const resolved = effectiveCapabilities(configuration, model, binding)!;
    expect(resolved).toMatchObject({ maxReferenceVideos: 0, generateAudio: false, resolutions: ['480'] });
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
    model.bindings[0].capabilityOverrides = { resolutions: ['480'] };
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

  it('maps H3 media capabilities without enabling unverified frame generation', () => {
    const configuration = defaultModelConfiguration();
    const models = toMediaModels(configuration, true);
    const h3 = models.find((model) => model.id === 'minimax-h3-flash');
    expect(h3).toMatchObject({ type: 'video', bindingId: 'h3-darl', providerId: 'darl', protocolKey: 'darl-h3-flash-unified', capabilities: { images: 9, videos: 3, audios: 3, generationModes: ['text-to-video', 'first-last-frame', 'reference'], resolutions: ['480', '768'], aspectRatios: ['16:9', '9:16'], firstLastFrame: false } });
  });

  it('does not mutate the template when resolving overrides', () => {
    const configuration = defaultModelConfiguration();
    const template = configuration.templates.find((item) => item.id === 'h3-flash')!;
    const resolved = resolveCapabilities(template, { resolutions: ['480'] });
    expect((resolved as { resolutions: string[] }).resolutions).toEqual(['480']);
    expect((template.capabilities as { resolutions: string[] }).resolutions).toEqual(['480', '768']);
  });
});
