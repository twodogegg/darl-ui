import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const REDRAW_LIMITS = { maxBytes: 300 * 1024 * 1024, maxDuration: 300, maxShots: 160 };

export async function probeVideoFile(input, signal) {
  const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input], { signal, timeout: 180_000, maxBuffer: 2_000_000 });
  const info = JSON.parse(stdout), video = info.streams?.find(stream => stream.codec_type === 'video');
  const duration = Number(info.format?.duration || video?.duration), [n, d] = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) throw new Error('无法读取视频时长或画面');
  return { duration, width: video.width, height: video.height, fps: d ? n / d : 0, hasAudio: info.streams.some(stream => stream.codec_type === 'audio') };
}
