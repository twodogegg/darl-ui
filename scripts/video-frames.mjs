import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runVideoFramesCli } from '../examples/agent-chat/skills/video-redraw/scripts/video-frames.mjs';

export { createFrameSheet, extractVideoFrames, FRAMES_PER_SHEET } from '../examples/agent-chat/skills/video-redraw/scripts/video-frames.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await runVideoFramesCli();
