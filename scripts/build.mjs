// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { build } from 'esbuild';
import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const assets = {};
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.png': 'image/png' };
async function collect(dir) {
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collect(full);
    else if (mime[path.extname(full)]) {
      const file = await readFile(full);
      assets['/' + path.relative(path.join(root, 'public'), full).split(path.sep).join('/')] = { type: mime[path.extname(full)], data: file.toString('base64') };
    }
  }
}
await collect(path.join(root, 'public'));
for (const required of ['/admin.html', '/login.html', '/setup.html', '/assets/app.css', '/assets/app.js', '/assets/login.js', '/assets/brand.svg']) {
  if (!assets[required]) throw new Error(`Missing required panel asset: ${required}`);
}
for (const name of ['LICENSE', 'licenses/NotoSerifSC-OFL.txt', 'licenses/qrcode-generator-MIT.txt', 'licenses/fflate-MIT.txt', 'THIRD_PARTY_NOTICES.md']) {
  assets['/assets/licenses/' + path.basename(name)] = { type: 'text/plain; charset=utf-8', data: (await readFile(path.join(root, name))).toString('base64') };
}
await mkdir(path.join(root, 'dist/pages'), { recursive: true });
await build({
  entryPoints: [path.join(root, 'src/worker.js')], outfile: path.join(root, 'dist/_worker.js'), bundle: true,
  format: 'esm', platform: 'neutral', target: 'es2022', minify: false, legalComments: 'inline', external: ['cloudflare:sockets'],
  plugins: [{ name: 'local-panel-assets', setup(b) {
    b.onResolve({ filter: /^brclio:assets$/ }, () => ({ path: 'assets', namespace: 'brclio' }));
    b.onLoad({ filter: /.*/, namespace: 'brclio' }, () => ({ contents: `export default ${JSON.stringify(assets)}`, loader: 'js' }));
    b.onResolve({ filter: /^brclio:source$/ }, () => ({ path: 'source', namespace: 'brclio-source' }));
    b.onLoad({ filter: /.*/, namespace: 'brclio-source' }, () => ({ contents: 'export default "__BRCLIO_SOURCE_TEXT_SLOT__";', loader: 'js' }));
  } }],
  banner: { js: '/* Brclio Edge 1.0.0 | Modified 2026-09-15 by Brclio | Based on cmliu/edgetunnel 448a83ced00a43c1d892d5ecbed86a26ea9eeaff | GPL-2.0-only. See LICENSE and THIRD_PARTY_NOTICES.md. */' }
});
// Keep the exact deployed source available to the authenticated download API.
// A single source-template slot avoids any network dependency or stale binary.
const sourcePath=path.join(root,'dist/_worker.js');
const sourceTemplate=await readFile(sourcePath,'utf8');
const sourceSlot=JSON.stringify('__BRCLIO_SOURCE_TEXT_SLOT__');
if(sourceTemplate.split(sourceSlot).length!==2)throw Error('Source template slot must occur exactly once');
await writeFile(sourcePath,sourceTemplate.replace(sourceSlot,()=>JSON.stringify(sourceTemplate)));
await copyFile(path.join(root, 'dist/_worker.js'), path.join(root, 'dist/pages/_worker.js'));
// Pages requires an asset directory; the worker serves the actual local UI.
await writeFile(path.join(root, 'dist/pages/index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Brclio Edge</title><p>请访问 /admin；若看到此页面，请检查 _worker.js 是否上传到根目录。</p></html>\n');
await writeFile(path.join(root, 'dist/pages/_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }, null, 2));
await copyFile(path.join(root, 'LICENSE'), path.join(root, 'dist/pages/LICENSE.txt'));
await copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(root, 'dist/pages/THIRD_PARTY_NOTICES.txt'));
await copyFile(path.join(root, 'licenses/NotoSerifSC-OFL.txt'), path.join(root, 'dist/pages/NotoSerifSC-OFL.txt'));
await copyFile(path.join(root, 'licenses/qrcode-generator-MIT.txt'), path.join(root, 'dist/pages/qrcode-generator-MIT.txt'));
await copyFile(path.join(root, 'licenses/fflate-MIT.txt'), path.join(root, 'dist/pages/fflate-MIT.txt'));
const zipFiles = {};
for (const name of ['_worker.js', 'index.html', '_routes.json', 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'NotoSerifSC-OFL.txt', 'qrcode-generator-MIT.txt', 'fflate-MIT.txt']) {
  zipFiles[name] = [new Uint8Array(await readFile(path.join(root, 'dist/pages', name))), { mtime: new Date('2026-09-15T00:00:00Z') }];
}
await writeFile(path.join(root, 'dist/brclio-edge-pages.zip'), zipSync(zipFiles, { level: 9 }));
const worker = await readFile(path.join(root, 'dist/_worker.js'));
await writeFile(path.join(root, 'dist/build-manifest.json'), JSON.stringify({ version: '1.0.0', upstream: '448a83ced00a43c1d892d5ecbed86a26ea9eeaff', assets: Object.keys(assets), workerBytes: worker.length, sha256: createHash('sha256').update(worker).digest('hex') }, null, 2) + '\n');
console.log(`Built standalone Worker (${(worker.length / 1024).toFixed(0)} KiB), ${Object.keys(assets).length} local assets, and dist/brclio-edge-pages.zip`);
