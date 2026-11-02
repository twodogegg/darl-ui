// @vitest-environment node
import { expect, it } from 'vitest';
import { validateWorkflowFields } from '../examples/agent-chat/server/workflow-fields';
import type { StudioRecord } from '../examples/agent-chat/studio-schema';

const character = { name: '张奕', type: '角色', description: '主角', appearance: '成年男性', costume: '普通衣服', voiceDescription: '待确认', prompt: '人物提示词', variants: [] };

it('identifies missing fields per asset and allows explicit unknown or inapplicable character details', () => {
  expect(() => validateWorkflowFields('script-assets', { assets: [{ ...character, appearance: '' }] })).toThrow('资产 张奕 的外貌或结构 (appearance)');
  expect(() => validateWorkflowFields('script-assets', { assets: [{ ...character, appearance: '待确认' }] })).toThrow('只有待确认标记');
  expect(() => validateWorkflowFields('script-assets', { assets: [{ ...character, costume: '' }] })).toThrow('服饰 (costume)');
  expect(() => validateWorkflowFields('script-assets', { assets: [character, { name: '房间', type: '场景', description: '住所', appearance: '有窗房间', prompt: '房间', variants: [] }] })).not.toThrow();
  expect(() => validateWorkflowFields('script-assets', { assets: [{ ...character, variants: [{ name: '雨中', description: '', prompt: '湿衣' }] }] })).toThrow('衍生状态 雨中 的描述');
});

it('uses existing saved fields for redraw updates without inventing missing details', () => {
  const prior = { ...character, id: 'person', _version: 1 } as StudioRecord;
  const item = { key: 'person', existingId: 'person', name: '张奕', type: '角色', variants: [] };
  expect(() => validateWorkflowFields('extract-assets', { assets: [item] }, [prior])).not.toThrow();
  expect(() => validateWorkflowFields('extract-assets', { assets: [item] }, [{ ...prior, voiceDescription: '' }])).toThrow('声音描述');
});

it('pinpoints incomplete analysis, script and storyboard fields while preserving optional content', () => {
  expect(() => validateWorkflowFields('analyze', { shots: [{ sceneKey: 's', description: '', dialogue: [] }] })).toThrow('第 1 镜的画面描述');
  expect(() => validateWorkflowFields('analyze', { shots: [{ sceneKey: 's', description: '走进房间', dialogue: [] }] })).not.toThrow();
  expect(() => validateWorkflowFields('novel-script', { scenes: [{ location: '房间', setting: '内', time: '夜', content: '' }] })).toThrow('第 1 场的正文');
  expect(() => validateWorkflowFields('script-storyboard', { clips: [{ sceneId: 's', title: '片段', duration: 5, prompt: '视频', storyboardPrompt: '' }] }, [], '分镜图')).toThrow('分镜图提示词');
  expect(() => validateWorkflowFields('script-storyboard', { clips: [{ sceneId: 's', title: '片段', duration: 5, prompt: '视频' }] }, [], '参考生成')).not.toThrow();
  expect(() => validateWorkflowFields('video-prompts', { clips: [{ sceneId: 's', title: '片段', duration: 5, prompt: '视频' }] })).not.toThrow();
});
