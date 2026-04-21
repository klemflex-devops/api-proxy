import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runFirstRunWizard(targetPath) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `No config.json found and stdin is not a TTY. ` +
      `Create a config.json at ${targetPath}, or point POLZA_PROXY_CONFIG at one.`,
    );
  }

  process.stdout.write('\n');
  process.stdout.write('No config.json found — starting first-run setup.\n');
  process.stdout.write('\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const apiKey = (await ask(rl, 'Polza API key (press Enter to skip): ')).trim();
    const portRaw = (await ask(rl, 'Port [8787]: ')).trim();
    const port = portRaw.length ? Number(portRaw) : 8787;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port "${portRaw}" — must be an integer between 1 and 65535.`);
    }

    const config = {
      port,
      host: '127.0.0.1',
      polzaApiKey: apiKey,
      inject: {
        provider: {
          order: ['OpenAI', 'Anthropic'],
          allow_fallbacks: true,
        },
      },
    };

    writeFileSync(targetPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

    process.stdout.write('\n');
    process.stdout.write(`Config saved to ${targetPath}. Edit it to customize further.\n`);
    process.stdout.write('\n');

    return config;
  } finally {
    rl.close();
  }
}
