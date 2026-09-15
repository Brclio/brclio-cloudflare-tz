import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const directory of ['src','public/assets','scripts']) {
  for (const name of readdirSync(directory)) if (/\.(?:m?js)$/.test(name)) execFileSync(process.execPath,['--check',directory+'/'+name],{stdio:'inherit'});
}
