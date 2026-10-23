import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileStore } from './file-storage';
import { createFrameSheet, extractVideoFrames } from '../../../scripts/video-frames.mjs';

export const REDRAW_LIMITS = { maxBytes: 50 * 1024 * 1024, maxDuration: 120, maxShots: 40 };
export type VideoInfo = { duration: number; width: number; height: number; fps: number; hasAudio: boolean };
export type SourceFrame = { fileId: string; time: number; url: string };
export type SourceSegment = { id: string; start: number; end: number; frames: SourceFrame[] };

/** No shell interpolation; only application-owned local files enter FFmpeg. */
export async function videoCommand(binary: 'ffmpeg' | 'ffprobe', args: string[], signal: AbortSignal) {
  signal.throwIfAborted();
  const child = spawn(binary, ['-hide_banner', ...args], { signal, stdio: ['ignore', 'pipe', 'pipe'], timeout: 180_000, killSignal: 'SIGKILL' });
  let output = '', errors = '';
  return new Promise<string>((resolve, reject) => {
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; if (output.length > 2_000_000) child.kill('SIGKILL'); });
    child.stderr.setEncoding('utf8').on('data', chunk => { errors = (errors + chunk).slice(-1_000_000); });
    child.on('error', error => reject(new Error(signal.aborted ? '已取消' : `${binary} 无法运行：${error.message}`)));
    child.on('close', code => code === 0 ? resolve(binary === 'ffprobe' ? output : errors) : reject(new Error(signal.aborted ? '已取消' : `${binary} 处理失败：${errors.slice(-800)}`)));
  });
}

export async function probeVideo(path: string, signal: AbortSignal): Promise<VideoInfo> {
  const info = JSON.parse(await videoCommand('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], signal));
  const video = info.streams?.find((stream: { codec_type: string }) => stream.codec_type === 'video');
  const duration = Number(info.format?.duration || video?.duration), [n, d] = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) throw new Error('无法读取视频时长或画面');
  return { duration, width: video.width, height: video.height, fps: d ? n / d : 0, hasAudio: info.streams.some((stream: { codec_type: string }) => stream.codec_type === 'audio') };
}

export async function withVideoFiles<T>(files: FileStore, fileIds: string[], fn: (paths: string[], root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), 'darl-video-'));
  try {
    const paths = [];
    for (const [index, id] of fileIds.entries()) {
      const file = files.get(id);
      if (!file || file.mimeType !== 'video/mp4' || file.size > 200 * 1024 * 1024) throw new Error('视频文件不存在、类型错误或过大');
      const value = await files.getBytes(id);
      if (!value) throw new Error('视频文件读取失败');
      const path = join(root, `${index}.mp4`);
      await writeFile(path, value.bytes); paths.push(path);
    }
    return await fn(paths, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function extractFrame(files: FileStore, path: string, root: string, time: number, signal: AbortSignal): Promise<SourceFrame> {
  const [frame] = await extractVideoFrames(path, root, [time], signal);
  const file = await files.put(await readFile(frame.path), 'image/jpeg', `原片参考-${frame.time.toFixed(3)}.jpg`);
  return { fileId: file.id, time: frame.time, url: `/api/files/${file.id}` };
}

/** Sheets are request-local; original frame file IDs remain the source evidence. */
export async function analysisFrameSheet(files: FileStore, segments: SourceSegment[], signal: AbortSignal) {
  const frames = [];
  for (const segment of segments) for (const [frameIndex, frame] of segment.frames.entries()) {
    signal.throwIfAborted();
    const file = await files.getBytes(frame.fileId);
    if (!file) throw new Error('原片参考帧已丢失，请重新抽帧');
    frames.push({ image: file.bytes, segmentId: segment.id, frameIndex, time: frame.time });
  }
  return createFrameSheet(frames, signal);
}

export async function prepareVideo(files: FileStore, fileId: string, signal: AbortSignal, onSegment: (segment: SourceSegment) => void) {
  const file = files.get(fileId);
  if (!file || file.size > REDRAW_LIMITS.maxBytes) throw new Error('原视频不能超过 50 MB');
  return withVideoFiles(files, [fileId], async ([path], root) => {
    const info = await probeVideo(path, signal);
    if (info.duration > REDRAW_LIMITS.maxDuration) throw new Error('第一版原视频最长 120 秒');
    const log = await videoCommand('ffmpeg', ['-i', path, '-an', '-vf', 'scdet=threshold=10', '-f', 'null', '-'], signal);
    const candidates = [...log.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map(match => Number(match[1]));
    const points = [0];
    for (const time of candidates) if (time - points.at(-1)! >= 0.15 && info.duration - time >= 0.15) points.push(time);
    points.push(info.duration);
    if (points.length - 1 > REDRAW_LIMITS.maxShots) throw new Error('检测到超过 40 个镜头，请先裁剪原视频');
    const times = points.slice(0, -1).flatMap((start, index) => [0.12, 0.5, 0.88].map(fraction =>
      Math.max(start, Math.min(start + (points[index + 1] - start) * fraction, points[index + 1] - 1 / (info.fps || 24)))));
    const extracted = await extractVideoFrames(path, root, times, signal);
    const segments: SourceSegment[] = [];
    for (let index = 0; index < points.length - 1; index++) {
      signal.throwIfAborted();
      const start = points[index], end = points[index + 1], frames: SourceFrame[] = [];
      for (const frame of extracted.slice(index * 3, index * 3 + 3)) {
        const file = await files.put(await readFile(frame.path), 'image/jpeg', `原片参考-${frame.time.toFixed(3)}.jpg`);
        frames.push({ fileId: file.id, time: frame.time, url: `/api/files/${file.id}` });
      }
      const segment = { id: crypto.randomUUID(), start, end, frames };
      segments.push(segment); onSegment(segment);
    }
    return { ...info, fileId, url: `/api/files/${fileId}`, segments };
  });
}

export async function composeVideo(files: FileStore, selections: Array<{ fileId: string; start: number; end?: number }>, ratio: string, signal: AbortSignal) {
  if (!selections.length || selections.length > 80) throw new Error('请选择 1–80 个片段');
  return withVideoFiles(files, selections.map(item => item.fileId), async (paths, root) => {
    const [w, h] = ratio.split(':').map(Number);
    const width = w >= h ? 854 : 480, height = w >= h ? 480 : 854;
    const segments = [];
    for (const [index, path] of paths.entries()) {
      const info = await probeVideo(path, signal), selection = selections[index], end = selection.end ?? info.duration;
      if (!Number.isFinite(selection.start) || !Number.isFinite(end) || selection.start < 0 || end <= selection.start || end > info.duration + 0.05) throw new Error(`片段 ${index + 1} 裁剪范围超过实际时长 ${info.duration.toFixed(2)} 秒`);
      const output = join(root, `part-${index}.mp4`), duration = end - selection.start;
      const audio = info.hasAudio ? [] : ['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo'];
      await videoCommand('ffmpeg', ['-y', '-ss', String(selection.start), '-i', path, ...audio, '-t', String(duration), '-map', '0:v:0', '-map', info.hasAudio ? '0:a:0' : '1:a:0',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=24`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-shortest', output], signal);
      segments.push(`file 'part-${index}.mp4'`);
    }
    await writeFile(join(root, 'parts.txt'), segments.join('\n'));
    const output = join(root, 'film.mp4');
    await videoCommand('ffmpeg', ['-y', '-f', 'concat', '-safe', '1', '-i', join(root, 'parts.txt'), '-c', 'copy', '-movflags', '+faststart', output], signal);
    const info = await probeVideo(output, signal);
    const file = await files.put(await readFile(output), 'video/mp4', '视频转绘成片.mp4');
    return { fileId: file.id, url: `/api/files/${file.id}`, ...info };
  });
}
