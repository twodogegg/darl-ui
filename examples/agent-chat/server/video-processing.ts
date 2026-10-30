import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileStore } from './file-storage';
import { probeVideoFile, REDRAW_LIMITS } from '../../../scripts/video-frames.mjs';

export { REDRAW_LIMITS };
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
  return probeVideoFile(path, signal);
}

export async function withVideoFiles<T>(files: FileStore, fileIds: string[], fn: (paths: string[], root: string) => Promise<T>) {
  const root = await mkdtemp(join(tmpdir(), 'darl-video-'));
  try {
    const paths = [];
    for (const [index, id] of fileIds.entries()) {
      const file = files.get(id);
      if (!file || file.mimeType !== 'video/mp4' || file.size > REDRAW_LIMITS.maxBytes) throw new Error('视频文件不存在、类型错误或过大');
      const value = await files.getBytes(id);
      if (!value) throw new Error('视频文件读取失败');
      const path = join(root, `${index}.mp4`);
      await writeFile(path, value.bytes); paths.push(path);
    }
    return await fn(paths, root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

export async function detectVideoCuts(files: FileStore, fileId: string, signal: AbortSignal) {
  return withVideoFiles(files, [fileId], async ([path], root) => {
    const info = await probeVideo(path, signal);
    if (info.duration > REDRAW_LIMITS.maxDuration) throw new Error('原视频不能超过 300 秒');
    await promisify(execFile)('scenedetect', ['-i', path, '-o', root, 'detect-adaptive', 'list-scenes', '--filename', 'shots.csv', '--skip-cuts', '--quiet'], { signal, timeout: 180_000, maxBuffer: 2_000_000 });
    const rows = (await readFile(join(root, 'shots.csv'), 'utf8')).trim().split(/\r?\n/).slice(1);
    if (!rows.length || rows.length > 200) throw new Error('自动检测的镜头数量超出支持范围');
    const segments = rows.map((row, index) => {
      const columns = row.split(','), start = Number(columns[3]), end = Number(columns[6]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > info.duration + 0.05) throw new Error('自动检测的镜头时间无效');
      return { id: `S${index + 1}`, start, end: Math.min(end, info.duration), frames: [] };
    });
    return { ...info, segments };
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
    return { fileId: file.id, url: files.originalUrl(file)!, ...info };
  });
}
