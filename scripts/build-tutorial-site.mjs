// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Publish only the standalone guides, preserving their relative links and bytes.
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist/tutorial');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const [source, destination] of [
  ['docs/tutorial.html', 'index.html'],
  ['docs/tutorial.html', 'tutorial.html'],
  ['docs/github-deploy.html', 'github-deploy.html'],
  ['LICENSE', 'LICENSE.txt'],
]) {
  await copyFile(path.join(root, source), path.join(output, destination));
}
await writeFile(path.join(output, '.nojekyll'), '');
process.stdout.write('Tutorial site ready: dist/tutorial/ (index.html, tutorial.html, github-deploy.html)\n');
