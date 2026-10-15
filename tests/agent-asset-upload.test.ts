// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { findAttachedImageForUpload, uploadAttachedImage } from '../examples/agent-chat/server/api';

const image = { type: 'image' as const, name: '1.png', mimeType: 'image/png', data: Buffer.from('test-image').toString('base64') };

describe('MCP asset file upload bridge', () => {
  it('bridges the legacy start call to the attached image data URL', () => {
    const tool = { _meta: { 'darl-ui/image-input': { kind: 'data-url', fields: { assetId: 'asset_id', dataUrl: 'data_url', fileName: 'file_name', displayName: 'display_name' } } } };
    expect(findAttachedImageForUpload(tool, { asset_id: 'asset-1', action: 'start', idempotency_key: 'upload-1' }, [image])?.image).toBe(image);
    expect(findAttachedImageForUpload(tool, { asset_id: 'asset-1', action: 'chunk', data_base64: image.data }, [image])).toBeUndefined();
    expect(findAttachedImageForUpload({}, { asset_id: 'asset-1', action: 'start' }, [image])).toBeUndefined();
  });

  it('passes a local image as a bounded data URL compatibility payload', async () => {
    const calls: Record<string, unknown>[] = [];
    const result = await uploadAttachedImage(async (args) => { calls.push(args); return { content: [], isError: false }; }, image, { asset_id: 'asset-1' }, { assetId: 'asset_id', dataUrl: 'data_url', fileName: 'file_name' }, new AbortController().signal);
    expect(result.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ asset_id: 'asset-1', file_name: '1.png', data_url: `data:image/png;base64,${image.data}` });
  });

  it('returns the upstream error without retrying a rejected data URL request', async () => {
    const calls: Record<string, unknown>[] = [];
    const result = await uploadAttachedImage(async (args) => {
      calls.push(args);
      return { content: [], isError: true };
    }, image, { asset_id: 'asset-1' }, { assetId: 'asset_id', dataUrl: 'data_url', fileName: 'file_name' }, new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(1);
  });
});
