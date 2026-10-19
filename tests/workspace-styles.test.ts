import { describe, expect, it } from 'vitest';
import { storageImage, styleOptionsFromCatalog } from '../examples/agent-chat/client/workspace-styles';

describe('workspace style catalog', () => {
  it('keeps owned styles out of the market and maps uploaded images to the workspace API', () => {
    const options = styleOptionsFromCatalog({
      official_items: [
        { id: 1, name: '电影感', category: '真人风格', prompt: '自然肤色', image_url: '/media-workspace/scene-4.svg' },
      ],
      items: [
        { id: 16, name: '短剧感', category: '我的风格', prompt: '柔和逆光', image_url: '/storage/styles/16' },
      ],
    });
    expect(options.map((option) => [option.id, option.isOwned])).toEqual([['1', false], ['16', true]]);
    expect(options[1].image).toBe('/api/workspace/storage/styles/16');
    expect(options[0].image).toBe('/media-workspace/scene-4.svg');
  });

  it('refuses path traversal and unknown storage prefixes', () => {
    expect(storageImage('/storage/../secret.png')).toBeUndefined();
    expect(storageImage('https://example.com/a.png')).toBeUndefined();
    expect(storageImage(undefined)).toBeUndefined();
  });
});
