import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

// Standalone packages resolve their own dependencies; existing global Skills can reuse the caller's.
let sharp;
try { sharp = createRequire(import.meta.url)('sharp'); }
catch { sharp = createRequire(resolve(process.cwd(), 'package.json'))('sharp'); }
const execute = promisify(execFile);
export const FRAMES_PER_SHEET = 12;
export const REDRAW_LIMITS = { maxBytes: 50 * 1024 * 1024, maxDuration: 120, maxShots: 40 };

export async function probeVideoFile(input, signal) {
  const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input], { signal, timeout: 180_000, maxBuffer: 2_000_000 });
  const info = JSON.parse(stdout), video = info.streams?.find(stream => stream.codec_type === 'video');
  const duration = Number(info.format?.duration || video?.duration), [n, d] = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
  if (!video || !Number.isFinite(duration) || duration <= 0 || !video.width || !video.height) throw new Error('无法读取视频时长或画面');
  return { duration, width: video.width, height: video.height, fps: d ? n / d : 0, hasAudio: info.streams.some(stream => stream.codec_type === 'audio') };
}

/** Shared website / standalone preparation: cuts, one-second samples and short-shot evidence. */
export async function prepareVideoFrames(input, outputDirectory, signal) {
  if ((await stat(input)).size > REDRAW_LIMITS.maxBytes) throw new Error('原视频不能超过 50 MB');
  const info = await probeVideoFile(input, signal);
  if (info.duration > REDRAW_LIMITS.maxDuration) throw new Error('第一版原视频最长 120 秒');
  const { stderr } = await execute('ffmpeg', ['-hide_banner', '-i', input, '-an', '-vf', 'scdet=threshold=10', '-f', 'null', '-'], { signal, timeout: 180_000, maxBuffer: 2_000_000 });
  const candidates = [...stderr.matchAll(/lavfi\.scd\.time:\s*([\d.]+)/g)].map(match => Number(match[1]));
  const points = [0];
  for (const time of candidates) if (time - points.at(-1) >= 0.15 && info.duration - time >= 0.15) points.push(time);
  points.push(info.duration);
  if (points.length - 1 > REDRAW_LIMITS.maxShots) throw new Error('检测到超过 40 个镜头，请先裁剪原视频');
  const intervals = points.slice(0, -1).map((start, index) => ({ start, end: points[index + 1] }));
  const frameInterval = 1 / (info.fps || 24);
  const times = Array.from({ length: Math.floor(Math.max(0, info.duration - frameInterval)) + 1 }, (_, second) => second);
  for (const segment of intervals) {
    if (!times.some(time => time >= segment.start && time < segment.end)) times.push(Math.max(segment.start, Math.min((segment.start + segment.end) / 2, segment.end - frameInterval)));
  }
  const extracted = await extractVideoFrames(input, outputDirectory, [...new Set(times)].sort((a, b) => a - b), signal);
  const segments = intervals.map(({ start, end }) => {
    const frames = extracted.filter(frame => frame.time >= start && frame.time < end);
    if (!frames.length) throw new Error(`原片 ${start.toFixed(2)}–${end.toFixed(2)} 秒镜头没有可用参考帧`);
    return { id: randomUUID(), start, end, frames };
  });
  return { ...info, segments };
}

/** Decode once, selecting the first actual frame at or after each requested time.
 * @param {string} input
 * @param {string} outputDirectory
 * @param {number[]} times
 * @param {AbortSignal} signal
 */
export async function extractVideoFrames(input, outputDirectory, times, signal) {
  signal.throwIfAborted();
  if (!Array.isArray(times) || !times.length || times.length > 160 || times.some(time => !Number.isFinite(time) || time < 0)) throw new Error('抽帧时间须为 1–160 个非负秒数');
  await mkdir(outputDirectory, { recursive: true });
  const root = await mkdtemp(join(outputDirectory, 'frames-'));
  const ordered = [...new Set(times)].sort((a, b) => a - b);
  const select = ordered.map(time => `gte(t,${time})*if(isnan(prev_pts),1,lt(prev_pts*TB,${time}))`).join('+');
  let stderr;
  try {
    ({ stderr } = await execute('ffmpeg', ['-hide_banner', '-y', '-i', input, '-an',
      '-vf', `setpts=PTS-STARTPTS,select='${select}',scale=720:720:force_original_aspect_ratio=decrease,showinfo`,
      '-fps_mode', 'vfr', '-q:v', '3', join(root, 'frame-%03d.jpg')],
    { signal, timeout: 180_000, killSignal: 'SIGKILL', maxBuffer: 2_000_000 }));
  } catch (error) {
    signal.throwIfAborted();
    if (error && typeof error === 'object' && 'stderr' in error && String(error.stderr).includes('No filtered frames for output stream')) {
      throw new Error('无法提取指定时间的画面，请核对原片区间');
    }
    throw error;
  }
  signal.throwIfAborted();
  const actual = [...stderr.matchAll(/\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:([\d.e+-]+)/g)].map((match, index) => ({
    time: Number(match[1]), path: join(root, `frame-${String(index + 1).padStart(3, '0')}.jpg`),
  }));
  return times.map(time => {
    const frame = actual.find(frame => frame.time + 0.00001 >= time);
    if (!frame) throw new Error(`无法提取 ${time.toFixed(3)} 秒的画面，请核对原片区间`);
    return frame;
  });
}

/**
 * @param {{ image: Buffer, segmentId: string, frameIndex: number, time: number }[]} frames
 * @param {AbortSignal} signal
 * @param {string[]} [segmentOrder]
 */
export async function createFrameSheet(frames, signal, segmentOrder) {
  signal.throwIfAborted();
  if (!frames.length || frames.length > FRAMES_PER_SHEET) throw new Error('每张拼图须包含 1–12 帧');
  const first = await sharp(frames[0].image).metadata();
  const portrait = (first.height || 0) > (first.width || 0);
  const cellWidth = portrait ? 270 : 480, imageHeight = portrait ? 480 : 270, labelHeight = 26;
  const columns = Math.min(3, frames.length), rows = Math.ceil(frames.length / columns);
  const width = cellWidth * columns, height = (imageHeight + labelHeight) * rows;
  const segmentIds = segmentOrder || [...new Set(frames.map(frame => frame.segmentId))];
  const mapping = frames.map((frame, index) => ({
    label: `S${segmentIds.indexOf(frame.segmentId) + 1}-F${frame.frameIndex}`,
    segmentId: frame.segmentId, frameIndex: frame.frameIndex, time: frame.time,
    row: Math.floor(index / columns), column: index % columns,
  }));
  const tiles = await Promise.all(frames.map(async (frame, index) => {
    const { label, row, column } = mapping[index];
    const image = await sharp(frame.image).resize(cellWidth, imageHeight, { fit: 'contain', background: '#111111' }).jpeg({ quality: 85 }).toBuffer();
    const caption = Buffer.from(`<svg width="${cellWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#111"/><text x="10" y="19" fill="white" font-family="sans-serif" font-size="17">${label} | ${frame.time.toFixed(3)}s</text></svg>`);
    return [
      { input: image, left: column * cellWidth, top: row * (imageHeight + labelHeight) },
      { input: caption, left: column * cellWidth, top: row * (imageHeight + labelHeight) + imageHeight },
    ];
  }));
  signal.throwIfAborted();
  const bytes = await sharp({ create: { width, height, channels: 3, background: '#111111' } })
    .composite(tiles.flat()).jpeg({ quality: 85 }).toBuffer();
  signal.throwIfAborted();
  return { bytes, width, height, frames: mapping };
}

// Standalone local use: node scripts/video-frames.mjs input.mp4 output-dir '[0.6,2.5,4.4]'
export async function runVideoFramesCli() {
  try {
    const [input, output, times] = process.argv.slice(2);
    if (!input || !output || !times) throw new Error('用法：node scripts/video-frames.mjs input.mp4 output-dir \'[0.6,2.5,4.4]\'');
    const signal = AbortSignal.timeout(180_000);
    const extracted = await extractVideoFrames(resolve(input), resolve(output), JSON.parse(times), signal);
    const sheets = [];
    for (let index = 0; index < extracted.length; index += FRAMES_PER_SHEET) {
      const frames = await Promise.all(extracted.slice(index, index + FRAMES_PER_SHEET).map(async (frame, offset) => ({
        image: await readFile(frame.path), segmentId: `sample-${Math.floor((index + offset) / 3) + 1}`, frameIndex: (index + offset) % 3, time: frame.time,
      })));
      const sheet = await createFrameSheet(frames, signal);
      const path = resolve(output, `sheet-${sheets.length + 1}.jpg`);
      await writeFile(path, sheet.bytes);
      sheets.push({ path, width: sheet.width, height: sheet.height, frames: sheet.frames });
    }
    await writeFile(resolve(output, 'frames.json'), JSON.stringify({ extracted, sheets }, null, 2));
    console.log(JSON.stringify({ frames: extracted.length, sheets }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runVideoFramesCli();
