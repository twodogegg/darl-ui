import { describe, expect, it } from 'vitest';
import { matchesAccept, validateFile, fileFingerprint } from '../src/components/file-uploader/validation';

describe('file validation', () => {
  const png = new File(['image'], 'screen.PNG', { type: 'image/png' });
  const pdf = new File(['content'], 'report.pdf', { type: 'application/pdf' });
  it('supports wildcard MIME type and case insensitive extension', () => {
    expect(matchesAccept(png, ['image/*'])).toBe(true);
    expect(matchesAccept(pdf, ['.PDF'])).toBe(true);
    expect(matchesAccept(pdf, ['image/*'])).toBe(false);
  });
  it('rejects unexpected type', () => {
    expect(validateFile(pdf, { accept: ['image/*'] })?.code).toBe('type');
  });
  it('enforces file size', () => {
    expect(validateFile(new File([new Uint8Array(1025)], 'big.txt'), { maxFileSizeMB: 0.0005 })?.code).toBe('size');
  });
  it('uses more than the file name for identity', () => {
    expect(fileFingerprint(png)).not.toBe(fileFingerprint(new File(['changed image'], 'screen.PNG', { type: 'image/png' })));
  });
});
