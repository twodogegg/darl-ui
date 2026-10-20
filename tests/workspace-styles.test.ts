import { describe, expect, it } from 'vitest';
import { storageImage, styleOptionsFromCatalog } from '../examples/agent-chat/client/workspace-styles';

describe('workspace style catalog', () => {
  it('keeps owned styles out of the market and maps uploaded images to the workspace API', () => {
    const options = styleOptionsFromCatalog({
      official_items: [
        { id: 1, name: '电影感', category: '真人风格', prompt: '自然肤色', image_url: '/media-workspace/scene-4.svg' },
      ],
      items: [
        { id: 16, name: '短剧感', category: '我的风格', prompt: '柔和逆光', image_url: '/api/files/123e4567-e89b-12d3-a456-426614174000' },
      ],
    });
    expect(options.map((option) => [option.id, option.isOwned])).toEqual([['1', false], ['16', true]]);
    expect(options[1].image).toBe('/api/files/123e4567-e89b-12d3-a456-426614174000');
    expect(options[0].image).toBe('/media-workspace/scene-4.svg');
  });

  it('refuses retired storage paths and path traversal', () => {
    expect(storageImage('/storage/../secret.png')).toBeUndefined();
    expect(storageImage('/storage/styles/16')).toBeUndefined();
    expect(storageImage('/api/workspace/storage/styles/16')).toBeUndefined();
    expect(storageImage('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(storageImage(undefined)).toBeUndefined();
  });
});
