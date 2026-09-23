#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { normalizePlatformSource } from './platform-sources.mjs';

function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

const inputPath = option('--input');
const outputPath = option('--output');
if (!inputPath) {
  console.error('Usage: node platform-sources-cli.mjs --input <local.json> [--output <local.json>]');
  process.exitCode = 2;
} else {
  try {
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const requests = Array.isArray(input) ? input : Array.isArray(input.rows)
      ? input.rows.map(row => ({ clientId: input.clientId, platform: input.platform,
        queryConfigId: input.queryConfigId, observedAt: input.observedAt, row }))
      : [input];
    const normalized = await Promise.all(requests.map(normalizePlatformSource));
    const rendered = `${JSON.stringify(normalized, null, 2)}\n`;
    if (outputPath) await writeFile(outputPath, rendered, { encoding: 'utf8', flag: 'wx' });
    else process.stdout.write(rendered);
  } catch (error) {
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    process.exitCode = 1;
  }
}
