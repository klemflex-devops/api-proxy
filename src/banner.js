const BANNER_LINES = [
  '██████╗  ██████╗ ██╗     ███████╗ █████╗      █████╗ ██╗',
  '██╔══██╗██╔═══██╗██║     ╚══███╔╝██╔══██╗    ██╔══██╗██║',
  '██████╔╝██║   ██║██║       ███╔╝ ███████║    ███████║██║',
  '██╔═══╝ ██║   ██║██║      ███╔╝  ██╔══██║    ██╔══██║██║',
  '██║     ╚██████╔╝███████╗███████╗██║  ██║    ██║  ██║██║',
  '╚═╝      ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝',
];

const RESET = '\x1b[0m';
const TRUECOLOR = '\x1b[38;2;57;255;20m';
const ANSI256_BRIGHT_GREEN = '\x1b[38;5;82m';

function colorOpen() {
  if (process.env.NO_COLOR) return '';
  if (!process.stdout.isTTY) return '';
  const ct = (process.env.COLORTERM ?? '').toLowerCase();
  return ct === 'truecolor' || ct === '24bit' ? TRUECOLOR : ANSI256_BRIGHT_GREEN;
}

export function printBanner({ version, host, port, upstream }) {
  const open = colorOpen();
  const close = open ? RESET : '';
  for (const line of BANNER_LINES) {
    process.stdout.write(open + line + close + '\n');
  }
  process.stdout.write(
    `version: ${version}  |  listening on http://${host}:${port}  |  upstream: ${upstream}\n\n`,
  );
}
