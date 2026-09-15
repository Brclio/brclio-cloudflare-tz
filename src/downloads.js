// Copyright (C) 2026 Brclio. GPL-2.0-only.
// A build-time source template reconstructs the exact deployed program without
// downloading a different version or embedding any runtime environment values.
import sourceTemplate from 'brclio:source';
import assets from 'brclio:assets';
import { zipSync, strToU8 } from 'fflate';

export function deployedSource() {
  const slot = JSON.stringify(['__BRCLIO', 'SOURCE_TEXT_SLOT__'].join('_'));
  return sourceTemplate.replace(slot, () => JSON.stringify(sourceTemplate));
}
export function deploymentDownload(path) {
  if (!['admin/download/worker.js','admin/download/pages.zip'].includes(path)) return null;
  const source = deployedSource();
  if (path.endsWith('worker.js')) return new Response(source, { headers: {
    'Content-Type':'text/javascript; charset=utf-8', 'Content-Disposition':'attachment; filename="_worker.js"'
  } });
  const files = {
    '_worker.js': strToU8(source),
    '_routes.json': strToU8(JSON.stringify({version:1,include:['/*'],exclude:[]})),
    'index.html': strToU8('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Brclio Edge</title><p>请访问 /admin。</p></html>'),
  };
  for (const name of ['LICENSE','THIRD_PARTY_NOTICES.md','NotoSerifSC-OFL.txt','qrcode-generator-MIT.txt']) {
    const asset=assets['/assets/licenses/'+name];
    if(asset)files[name.replace('.md','.txt')]=Uint8Array.from(atob(asset.data), c=>c.charCodeAt(0));
  }
  // Store entries uncompressed: the browser download is small enough, while
  // avoiding a CPU-heavy compression pass in a free-tier Worker request.
  return new Response(zipSync(files,{level:0}), {headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="brclio-edge-pages.zip"'}});
}
