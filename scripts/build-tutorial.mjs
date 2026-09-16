// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Embed untouched source PNGs and local assets into one offline-readable HTML.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file, encoding) => readFile(path.join(root, file), encoding);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escapeHTML = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const [source, css, js, captures, font, brand, license] = await Promise.all([
  read('docs/tutorial-src/index.html', 'utf8'), read('docs/tutorial-src/styles.css', 'utf8'),
  read('docs/tutorial-src/app.js', 'utf8'), read('docs/tutorial-assets/local-captures.json', 'utf8'),
  read('docs/tutorial-assets/noto-serif-sc-tutorial.woff2'), read('public/assets/brand.svg'),
  read('licenses/NotoSerifSC-OFL.txt', 'utf8')
]);
const manifest = JSON.parse(captures);
const names = {login:'管理员登录',overview:'管理概览',subscriptions:'订阅管理',nodes:'节点配置',routing:'路由与代理','manual-speedtest':'测速与优选',settings:'可选用量与通知配置','settings-backup':'备份与恢复主配置','settings-download':'下载当前部署程序'};
const images = new Map();
for (const entry of manifest.images) {
  const name = path.basename(entry.file, '.png');
  const bytes = await read(`docs/tutorial-assets/${entry.file}`);
  if (hash(bytes) !== entry.sha256) throw new Error(`Original image hash changed: ${name}`);
  if (bytes.toString('hex',0,8) !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== entry.width || bytes.readUInt32BE(20) !== entry.height) throw new Error(`Invalid PNG dimensions: ${name}`);
  images.set(name, { ...entry, data: `data:image/png;base64,${bytes.toString('base64')}` });
}
const imageHTML = (name, hero = false) => {
  const entry = images.get(name);
  if (!entry) throw new Error(`Missing screenshot: ${name}`);
  return `<img src="${entry.data}" width="${entry.width}" height="${entry.height}" alt="${escapeHTML(names[name] || name)}" decoding="async"${hero ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
};
let figureCount = 0;
let html = source.replace(/@@FIGURE:([\w-]+):([^@]+)@@/g, (_match,name,caption) => {
  const entry = images.get(name);
  if (!entry) throw new Error(`Missing screenshot: ${name}`);
  figureCount++;
  return `<figure class="image-figure"><button type="button" class="image-open" data-image="${name}" aria-label="查看${escapeHTML(names[name] || name)}原图">${imageHTML(name)}</button><figcaption><span><b>图 ${String(figureCount).padStart(2,'0')}</b>${escapeHTML(caption)}</span><span class="caption-size">${entry.width} × ${entry.height} · 原始 PNG</span></figcaption></figure>`;
});
html = html.replace(/@@IMAGE:([\w-]+)@@/g, (_match,name) => imageHTML(name,true))
  .replaceAll('@@IMAGE_COUNT@@',String(images.size))
  .replace('@@BRAND@@',`data:image/svg+xml;base64,${brand.toString('base64')}`)
  .replace('@@CSS@@',() => css.replace('__TUTORIAL_FONT__',`data:font/woff2;base64,${font.toString('base64')}`))
  .replace('@@JS@@',() => js).replace('@@FONT_LICENSE@@',() => escapeHTML(license));
const embeddedScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (embeddedScript !== js) throw new Error('Embedded script differs from source');
new Script(embeddedScript, { filename: 'tutorial-inline.js' });
if (/@@[A-Z_]+(?::[^@]*)?@@|__TUTORIAL_FONT__/.test(html)) throw new Error('Unresolved tutorial placeholders');
if (/\b(?:src|href)=["'](?:https?:)?\/\//i.test(html.replace(/<a\b[^>]*>/gi,''))) throw new Error('External runtime resource in standalone tutorial');
await writeFile(path.join(root,'docs/tutorial.html'),html);
await writeFile(path.join(root,'docs/tutorial-assets/build-manifest.json'),JSON.stringify({
  schemaVersion:1, output:'docs/tutorial.html', bytes:Buffer.byteLength(html), sha256:hash(html),
  fontSha256:hash(font), figures:figureCount, originalImages:manifest.images.map(({file,width,height,bytes,sha256}) => ({file,width,height,bytes,sha256})),
  sourceFiles:['docs/tutorial-src/index.html','docs/tutorial-src/styles.css','docs/tutorial-src/app.js','scripts/build-tutorial.mjs'],
  selfContained:true, screenshotProcessing:'None; original PNG bytes embedded as base64.'
},null,2)+'\n');
process.stdout.write(`Tutorial built: ${figureCount} figures, ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MiB; original PNG hashes verified.\n`);
