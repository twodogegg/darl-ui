// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { LocalStorage } from '../examples/agent-chat/server/storage';
import { FileStore } from '../examples/agent-chat/server/file-storage';
import { ProjectStore } from '../examples/agent-chat/server/project-store';
import { StudioStore, STUDIO_TOOLS } from '../examples/agent-chat/server/studio';
import { MediaJobStore } from '../examples/agent-chat/server/media-job-store';
import { assetDependenciesChanged } from '../examples/agent-chat/asset-dependencies';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { assetImageRequest, assetBatchPlan, generateAssetBatch, canBatchGenerate } from '../examples/agent-chat/client/studio/art';
let directory: string, store: StudioStore, files: FileStore, projectId: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'fusion-asset-'));
  const storage = new LocalStorage(directory); files = new FileStore(storage.path);
  const projects = new ProjectStore(storage.path, files);
  projectId = String(projects.create({ name: '融合资产', description: null, aspect_ratio: '9:16', style_catalog_id: 4 }).project_id);
  store = new StudioStore(projects);
  store.apply('seed', [
    { resource: 'assets', id: 'chloe', op: 'create', values: { projectId, name: 'Chloe', variants: [{ id: 'young', name: '19岁', image: '' }] } },
    { resource: 'assets', id: 'photo', op: 'create', values: { projectId, name: '旧照片', type: '道具', prompt: '只画旧照片正背面', dependencies: [{ assetId: 'chloe', variantId: 'young', purpose: '仅作为照片内人物的身份参考' }] } },
  ]);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const asset = (id: string) => store.snapshot().assets.find(item => item.id === id)!;
const update = (id: string, values: Record<string, unknown>) => store.apply(crypto.randomUUID(), [{ resource: 'assets', id, op: 'update', version: asset(id)._version, values }]);
const target = () => store.mediaTarget({ resource: 'assets', id: 'photo', field: 'image', version: asset('photo')._version }, 'image');
async function image(color: string) { const file = await files.put(await sharp({ create: { width: 2, height: 2, channels: 4, background: color } }).png().toBuffer(), 'image/png', 'test.png'); return file; }
it('persists a specific dependency, rejects bad schemas and blocks generation until that variant is ready', async () => {
  const schema = new AjvJsonSchemaValidator().getValidator(STUDIO_TOOLS[1].parameters);
  expect(schema({ requestId: 'bad', changes: [{ resource: 'assets', id: 'photo', op: 'update', version: 1, values: { dependencies: [{ assetId: 'chloe' }] } }] }).valid).toBe(false);
  expect(new StudioStore(store.projects).snapshot().assets.find(item => item.id === 'photo')?.dependencies).toEqual(asset('photo').dependencies);
  const file = await image('white');
  update('chloe', { image: `/api/files/${file.id}` });
  expect(() => target()).toThrow('19岁'); // A ready main image cannot substitute for a missing variant.
  update('chloe', { variants: [{ id: 'young', name: '19岁', image: `/api/files/${file.id}` }] });
  const prepared = store.prepareMedia({ prompt: '只画旧照片正背面', options: { studioTarget: target(), references: [`/api/files/${file.id}`] } }, 'image');
  expect(prepared.options.references).toEqual([`/api/files/${file.id}`]);
  expect(prepared.prompt).toContain('参考图 1：Chloe / 19岁');
  expect(prepared.prompt).toContain('仅作为照片内人物的身份参考');
  expect(prepared.options.aspectRatio).toBe('16:9');
});
it('rejects cycles, foreign projects, deleted variants and referenced asset deletion atomically', () => {
  expect(() => update('chloe', { dependencies: [{ assetId: 'photo', purpose: '参考' }] })).toThrow('循环');
  expect(() => update('photo', { dependencies: [{ assetId: 'photo', purpose: '参考' }] })).toThrow('循环');
  expect(() => update('chloe', { variants: [] })).toThrow('形态已不存在');
  expect(() => store.apply('delete', [{ resource: 'assets', id: 'chloe', op: 'delete', version: asset('chloe')._version }])).toThrow('依赖资产不存在');
  const other = String(store.projects.create({ name: '其他项目', description: null, aspect_ratio: '9:16', style_catalog_id: 4 }).project_id);
  store.apply('foreign', [{ resource: 'assets', id: 'foreign', op: 'create', values: { projectId: other, name: '他人' } }]);
  expect(() => update('photo', { dependencies: [{ assetId: 'foreign', purpose: '参考' }] })).toThrow('不属于当前项目');
  expect(asset('chloe').variants).toHaveLength(1);
});
it('records references for each result and prevents auto-selecting output when an upstream picture changes', async () => {
  const first = await image('white'), second = await image('black'), output = await image('red');
  update('chloe', { variants: [{ id: 'young', name: '19岁', image: `/api/files/${first.id}` }] });
  const originalTarget = target();
  update('chloe', { variants: [{ id: 'young', name: '19岁', image: `/api/files/${second.id}` }] });
  const jobs = new MediaJobStore(join(directory, 'data.sqlite'), files);
  const job = jobs.create({ modelId: 'gpt-image-2', type: 'image', prompt: 'test', options: { studioTarget: originalTarget }, providerId: 'test', upstreamModelId: 'test', baseUrl: 'http://localhost' });
  job.status = 'completed'; job.resultFileIds = [output.id]; store.attachMedia(job);
  expect(asset('photo').image).toBe('');
  const url = `/api/files/${output.id}`;
  expect(asset('photo').history).toEqual([url]);
  expect(asset('photo').imageDependencies).toMatchObject({ [url]: [{ image: `/api/files/${first.id}`, variantId: 'young' }] });
  expect(assetDependenciesChanged(asset('photo'), asset('photo'), store.snapshot().assets, url)).toBe(true);
  update('chloe', { variants: [{ id: 'young', name: '19岁', image: `/api/files/${first.id}` }] });
  expect(assetDependenciesChanged(asset('photo'), asset('photo'), store.snapshot().assets, url)).toBe(false);
});
it('does not reuse an old fusion main image as an identity reference during regeneration', () => {
  const photo = { ...asset('photo'), image: 'https://example.org/old-photo.png' };
  expect(assetImageRequest(photo).references).not.toContain(photo.image);
});

it('plans missing dependencies once and excludes already completed assets even when selected', async () => {
  let all = store.snapshot().assets;
  const photo = asset('photo');
  expect([...assetBatchPlan([photo], all).keys()]).toEqual(['photo', 'chloe']);
  const file = await image('white');
  update('chloe', { image: `/api/files/${file.id}`, variants: [{ id: 'young', name: '19岁', image: `/api/files/${file.id}` }] });
  all = store.snapshot().assets;
  expect([...assetBatchPlan([photo], all).keys()]).toEqual(['photo']);
  expect([...assetBatchPlan([photo, asset('chloe')], all).keys()]).toEqual(['photo']);
});

it('batch fill submits nothing for completed main and variant images, including completed fusion assets', async () => {
  const file = await image('white'), url = `/api/files/${file.id}`;
  update('chloe', { image: url, variants: [{ id: 'young', name: '19岁', image: url }] });
  update('photo', { image: url });
  const assets = store.snapshot().assets;
  expect(assets.every(item => !canBatchGenerate(item, []))).toBe(true);
  let calls = 0;
  const result = await generateAssetBatch(assets, {
    jobs: [], view: '', customPrompt: '', styleId: undefined, reload: async () => store.snapshot(), signal: new AbortController().signal,
    generateMedia: async () => { calls++; throw new Error('已有图片不应发起任何生成请求'); },
    readJob: async () => { throw new Error('不应读取生成任务'); },
  });
  expect(calls).toBe(0);
  expect(result).toEqual({ submitted: [], failed: [] });
  expect(store.snapshot().assets.map(item => item.image)).toEqual([url, url]);
});
it('batch fill retains an existing main image and submits only its missing variant', async () => {
  const file = await image('white'), url = `/api/files/${file.id}`;
  update('chloe', { image: url, appearance: '年轻的 Chloe，白色背景' });
  const targets: Array<{ id: string; variantId?: string }> = [];
  const result = await generateAssetBatch([asset('chloe')], {
    jobs: [], view: '', customPrompt: '', styleId: undefined, reload: async () => store.snapshot(), signal: new AbortController().signal,
    generateMedia: async (request: { target: { id: string; variantId?: string } }) => { targets.push(request.target); throw new Error('参数已验证，本单元测试不调用模型'); },
    readJob: async () => { throw new Error('无任务可读取'); },
  });
  expect(targets).toEqual([expect.objectContaining({ id: 'chloe', variantId: 'young' })]);
  expect(result.failed).toHaveLength(1);
  expect(asset('chloe').image).toBe(url);
});
