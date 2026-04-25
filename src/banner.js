import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVG_PATH = resolve(__dirname, 'logo.svg');

const GREEN = '#B2F72A';
const GREEN_RGB = { r: 178, g: 247, b: 42 };
const WHITE_RGB = { r: 255, g: 255, b: 255 };

const BANNER_LINES = [
  '██████╗  ██████╗ ██╗     ███████╗ █████╗      █████╗ ██╗',
  '██╔══██╗██╔═══██╗██║     ╚══███╔╝██╔══██╗    ██╔══██╗██║',
  '██████╔╝██║   ██║██║       ███╔╝ ███████║    ███████║██║',
  '██╔═══╝ ██║   ██║██║      ███╔╝  ██╔══██║    ██╔══██║██║',
  '██║     ╚██████╔╝███████╗███████╗██║  ██║    ██║  ██║██║',
  '╚═╝      ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝',
];

function classifyPixel(r, g, b, a) {
  if (a < 50) return null;
  const dGreen = Math.abs(r - GREEN_RGB.r) + Math.abs(g - GREEN_RGB.g) + Math.abs(b - GREEN_RGB.b);
  const dWhite = Math.abs(r - WHITE_RGB.r) + Math.abs(g - WHITE_RGB.g) + Math.abs(b - WHITE_RGB.b);
  return dGreen <= dWhite ? 'green' : 'white';
}

function colorChar(char, fg, bg, chk) {
  let c = chk.hex(fg === 'green' ? GREEN : '#FFFFFF');
  if (bg) c = c.bgHex(bg === 'green' ? GREEN : '#FFFFFF');
  return c(char);
}

// Render at SCALE× resolution, then majority-vote downsample → eliminates antialiasing
const SCALE = 4;
const TARGET_H = 24; // target pixel rows (→ TARGET_H/2 = 12 char rows)

function classifyRegion(pixels, srcW, rowStart, colStart, blockH, blockW) {
  let green = 0;
  let white = 0;
  for (let r = rowStart; r < rowStart + blockH; r++) {
    for (let c = colStart; c < colStart + blockW; c++) {
      const i = (r * srcW + c) * 4;
      const a = pixels[i + 3];
      if (a < 128) continue;
      const d = classifyPixel(pixels[i], pixels[i + 1], pixels[i + 2], a);
      if (d === 'green') green++;
      else if (d === 'white') white++;
    }
  }
  const threshold = Math.ceil((blockH * blockW) / 2); // 50% majority → clean pixel art
  if (green >= threshold || white >= threshold) {
    return green >= white ? 'green' : 'white';
  }
  return null;
}

async function renderLogoLines(chk) {
  const { Resvg } = await import('@resvg/resvg-js');

  const svgRaw = readFileSync(SVG_PATH, 'utf8');
  const patched = svgRaw.replaceAll('#171717', '#FFFFFF');

  const renderH = TARGET_H * SCALE;
  const resvg = new Resvg(patched, { fitTo: { mode: 'height', value: renderH } });
  const rendered = resvg.render();
  const { pixels, width: srcW, height: srcH } = rendered;

  const colCount = Math.floor(srcW / SCALE);
  const charRows = Math.floor(srcH / (SCALE * 2)); // 2 pixel rows per character row
  const lines = [];

  for (let row = 0; row < charRows; row++) {
    let line = '';
    for (let col = 0; col < colCount; col++) {
      const topRowStart = row * 2 * SCALE;
      const botRowStart = topRowStart + SCALE;
      const colStart = col * SCALE;

      const top = classifyRegion(pixels, srcW, topRowStart, colStart, SCALE, SCALE);
      const bot = classifyRegion(pixels, srcW, botRowStart, colStart, SCALE, SCALE);

      if (!top && !bot) {
        line += ' ';
      } else if (top && bot && top === bot) {
        line += colorChar('█', top, null, chk);
      } else if (top && bot) {
        line += colorChar('▀', top, bot, chk);
      } else if (top) {
        line += colorChar('▀', top, null, chk);
      } else {
        line += colorChar('▄', bot, null, chk);
      }
    }
    lines.push(line);
  }

  return lines;
}

export async function printBanner({ version, host, port, upstream }) {
  const infoLine = `version: ${version}  |  listening on http://${host}:${port}  |  upstream: ${upstream}`;

  try {
    const { Chalk } = await import('chalk');
    const chk = new Chalk({ level: process.stdout.isTTY && !process.env.NO_COLOR ? 3 : 0 });

    if (!existsSync(SVG_PATH)) throw new Error('logo.svg not found');

    const lines = await renderLogoLines(chk);
    process.stdout.write('\n');
    for (const line of lines) process.stdout.write(line + '\n');
    process.stdout.write('\n' + chk.hex(GREEN)(infoLine) + '\n\n');
  } catch {
    const open = process.stdout.isTTY && !process.env.NO_COLOR ? '\x1b[38;2;178;247;42m' : '';
    const close = open ? '\x1b[0m' : '';
    for (const line of BANNER_LINES) process.stdout.write(open + line + close + '\n');
    process.stdout.write(open + infoLine + close + '\n\n');
  }
}
