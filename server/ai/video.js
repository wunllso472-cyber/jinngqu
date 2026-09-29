// 用 ffmpeg 把若干帧拼成竖版短视频（每帧 1 秒，带轻微推镜）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

let ffmpegPath = process.env.FFMPEG_PATH || null;
if (!ffmpegPath) {
  try {
    ffmpegPath = (await import('ffmpeg-static')).default;
  } catch {
    ffmpegPath = null;
  }
}

export const hasFfmpeg = () => !!ffmpegPath && fs.existsSync(ffmpegPath);

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', (d) => {
      err = (err + d).slice(-4000);
    });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}: ${err.split('\n').slice(-4).join(' ')}`))));
  });
}

/**
 * 把人物图层（带透明通道的 PNG）叠加到模板样片上，保留原片音轨。
 * 人物高度约为画面高度的 heightRatio，底部居中。
 */
export async function overlayOnVideo(videoPath, personPng, { heightRatio = 0.55, maxSeconds = 60 } = {}) {
  if (!hasFfmpeg()) throw new Error('服务器未安装 ffmpeg，无法生成视频');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scenic-overlay-'));
  try {
    const png = path.join(dir, 'person.png');
    await fs.promises.writeFile(png, personPng);
    const out = path.join(dir, 'out.mp4');
    await runFfmpeg([
      '-y',
      '-i', videoPath,
      '-loop', '1',
      '-i', png,
      '-filter_complex',
      `[1:v][0:v]scale2ref=w=oh*mdar:h=ih*${heightRatio}[p][base];[base][p]overlay=x=(W-w)/2:y=H-h-H*0.04:shortest=1,format=yuv420p[v]`,
      '-map', '[v]',
      '-map', '0:a?',
      '-t', String(maxSeconds),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      out,
    ]);
    return await fs.promises.readFile(out);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * @param {Buffer[]} frames 同尺寸 JPEG 帧
 * @param {number} seconds 目标时长
 */
export async function framesToVideo(frames, seconds = 7) {
  if (!hasFfmpeg()) throw new Error('服务器未安装 ffmpeg，无法生成视频');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scenic-video-'));
  try {
    const list = [];
    for (let i = 0; i < seconds; i++) list.push(frames[i % frames.length]);
    await Promise.all(list.map((buf, i) => fs.promises.writeFile(path.join(dir, `f${String(i).padStart(3, '0')}.jpg`), buf)));
    const out = path.join(dir, 'out.mp4');
    const fps = 25;
    await runFfmpeg([
      '-y',
      '-framerate', '1',
      '-i', path.join(dir, 'f%03d.jpg'),
      '-vf', `scale=1080:1440,zoompan=z='1+0.0035*mod(on\\,${fps})':d=${fps}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=720x960:fps=${fps},format=yuv420p`,
      '-t', String(seconds),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23',
      '-movflags', '+faststart',
      out,
    ]);
    return await fs.promises.readFile(out);
  } finally {
    fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
