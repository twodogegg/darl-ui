import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileUploader } from '../src/components/file-uploader/FileUploader';

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

describe('FileUploader', () => {
  it('selects multiple files and uploads only after manual start', async () => {
    const upload = vi.fn(async (_file: File, { onProgress }: { onProgress: (percent: number) => void }) => { onProgress(100); return { id: 'file-1' }; });
    const onSuccess = vi.fn();
    render(<FileUploader upload={upload} autoUpload={false} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')] } });
    expect(screen.getByText('a.txt')).toBeInTheDocument();
    expect(screen.getByText('b.txt')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('开始上传'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(2));
  });
  it('rejects invalid files but keeps valid ones', () => {
    const onReject = vi.fn();
    render(<FileUploader upload={async () => ({})} autoUpload={false} accept={['image/*']} onReject={onReject} />);
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [new File(['x'], 'good.png', { type: 'image/png' }), new File(['x'], 'wrong.txt', { type: 'text/plain' })] } });
    expect(screen.getByText('good.png')).toBeInTheDocument();
    expect(onReject).toHaveBeenCalledWith([expect.objectContaining({ code: 'type' })]);
  });
  it('ignores ordinary text paste', () => {
    const onReject = vi.fn();
    render(<FileUploader upload={async () => ({})} onReject={onReject} />);
    const area = screen.getByRole('button', { name: /文件上传区域/ });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'string' }] } });
    fireEvent(area, event);
    expect(event.defaultPrevented).toBe(false);
    expect(onReject).not.toHaveBeenCalled();
  });
  it('allows a failed file to be retried', async () => {
    const upload = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ ok: true });
    render(<FileUploader upload={upload} />);
    fireEvent.change(screen.getByLabelText('选择上传文件'), { target: { files: [new File(['x'], 'retry.txt')] } });
    await waitFor(() => expect(screen.getByText('上传失败')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '重试 retry.txt' }));
    await waitFor(() => expect(screen.getByText('上传完成')).toBeInTheDocument());
    expect(upload).toHaveBeenCalledTimes(2);
  });
});
