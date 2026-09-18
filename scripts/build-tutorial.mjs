// Copyright (C) 2026 Brclio. GPL-2.0-only.
// Build both offline guides. Source screenshots and annotated teaching images
// have separate manifests; only reviewed, redacted Cloudflare images are embedded.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file, encoding) => readFile(path.join(root, file), encoding);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const escapeHTML = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const [css, js, captures, cloudflareCaptures, githubCaptures, font, brand, license] = await Promise.all([
  read('docs/tutorial-src/styles.css', 'utf8'),
  read('docs/tutorial-src/app.js', 'utf8'), read('docs/tutorial-assets/local-captures.json', 'utf8'),
  read('docs/tutorial-assets/cloudflare-captures.json', 'utf8'),
  read('docs/tutorial-assets/github-captures.json', 'utf8'),
  read('docs/tutorial-assets/noto-serif-sc-tutorial.woff2'), read('public/assets/brand.svg'),
  read('licenses/NotoSerifSC-OFL.txt', 'utf8')
]);
const manifest = JSON.parse(captures);
const cloudflare = JSON.parse(cloudflareCaptures);
const github = JSON.parse(githubCaptures);
const annotatedCaptures = [...cloudflare.images, ...github.images];
const names = {login:'管理员登录',overview:'管理概览',subscriptions:'订阅管理',nodes:'节点配置',routing:'路由与代理','manual-speedtest':'测速与优选',settings:'可选用量与通知配置','settings-backup':'备份与恢复主配置','settings-download':'下载当前部署程序'};
const images = new Map();
for (const entry of [...manifest.images, ...annotatedCaptures]) {
  const name = path.basename(entry.file, '.png');
  const bytes = await read(`docs/tutorial-assets/${entry.file}`);
  if (hash(bytes) !== entry.sha256) throw new Error(`Screenshot hash changed: ${name}`);
  if (bytes.toString('hex',0,8) !== '89504e470d0a1a0a' || bytes.readUInt32BE(16) !== entry.width || bytes.readUInt32BE(20) !== entry.height) throw new Error(`Invalid PNG dimensions: ${name}`);
  images.set(name, { ...entry, annotated: /^(cf|git)-/.test(name), data: `data:image/png;base64,${bytes.toString('base64')}` });
}
const imageName = name => images.get(name)?.title || names[name] || name;
const imageHTML = (name, hero = false) => {
  const entry = images.get(name);
  if (!entry) throw new Error(`Missing screenshot: ${name}`);
  return `<img src="${entry.data}" width="${entry.width}" height="${entry.height}" alt="${escapeHTML(imageName(name))}" data-image-kind="${entry.annotated ? 'annotated' : 'original'}" decoding="async"${hero ? ' fetchpriority="high"' : ' loading="lazy"'}>`;
};
const builds = [];
for (const guide of [
  {source:'docs/tutorial-src/index.html', output:'docs/tutorial.html', manifest:'docs/tutorial-assets/build-manifest.json'},
  {source:'docs/tutorial-src/github.html', output:'docs/github-deploy.html', manifest:'docs/tutorial-assets/github-build-manifest.json'}
]) {
const source = await read(guide.source, 'utf8');
const used = new Set();
let figureCount = 0;
let html = source.replace(/@@FIGURE:([\w-]+):([^@]+)@@/g, (_match,name,caption) => {
  const entry = images.get(name);
  if (!entry) throw new Error(`Missing screenshot: ${name}`);
  used.add(name);
  figureCount++;
  return `<figure class="image-figure${entry.annotated ? ' annotated-figure' : ''}${entry.annotated && entry.width / entry.height < 1.3 ? ' compact-figure' : ''}"><button type="button" class="image-open" data-image="${name}" aria-label="放大查看${escapeHTML(imageName(name))}">${imageHTML(name)}</button><figcaption><span><b>图 ${String(figureCount).padStart(2,'0')}</b>${escapeHTML(caption)}</span><span class="caption-size">${entry.width} × ${entry.height} · ${entry.annotated ? '高清标注图' : '原始 PNG'}</span></figcaption></figure>`;
});
html = html.replace(/@@IMAGE:([\w-]+)@@/g, (_match,name) => { used.add(name); return imageHTML(name,true); })
  .replaceAll('@@IMAGE_COUNT@@',String(used.size))
  .replace('@@BRAND@@',`data:image/svg+xml;base64,${brand.toString('base64')}`)
  .replace('@@CSS@@',() => css.replace('__TUTORIAL_FONT__',`data:font/woff2;base64,${font.toString('base64')}`))
  .replace('@@JS@@',() => js).replace('@@FONT_LICENSE@@',() => escapeHTML(license));
const embeddedScript = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (embeddedScript !== js) throw new Error('Embedded script differs from source');
new Script(embeddedScript, { filename: 'tutorial-inline.js' });
if (/@@[A-Z_]+(?::[^@]*)?@@|__TUTORIAL_FONT__/.test(html)) throw new Error('Unresolved tutorial placeholders');
if (/\b(?:src|href)=["'](?:https?:)?\/\//i.test(html.replace(/<a\b[^>]*>/gi,''))) throw new Error('External runtime resource in standalone tutorial');
await writeFile(path.join(root,guide.output),html);
await writeFile(path.join(root,guide.manifest),JSON.stringify({
  schemaVersion:2, output:guide.output, bytes:Buffer.byteLength(html), sha256:hash(html),
  fontSha256:hash(font), figures:figureCount, uniqueImages:used.size,
  originalImages:manifest.images.filter(entry => used.has(path.basename(entry.file,'.png'))).map(({file,width,height,bytes,sha256}) => ({file,width,height,bytes,sha256})),
  annotatedImages:annotatedCaptures.filter(entry => used.has(path.basename(entry.file,'.png'))).map(({file,width,height,bytes,sha256}) => ({file,width,height,bytes,sha256})),
  sourceFiles:[guide.source,'docs/tutorial-src/styles.css','docs/tutorial-src/app.js','scripts/build-tutorial.mjs'],
  selfContained:true, screenshotProcessing:`Local application PNGs unchanged. User Cloudflare screenshots cropped at native scale, credentials removed and instructional annotations added before embedding. See cloudflare-captures.json.${[...used].some(name => name.startsWith('git-')) ? ' Git integration captures: github-captures.json.' : ''}`
},null,2)+'\n');
builds.push(`${guide.output}: ${figureCount} figures, ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MiB`);
}
process.stdout.write(`${builds.join('\n')}\nAll embedded PNG hashes and dimensions verified.\n`);
