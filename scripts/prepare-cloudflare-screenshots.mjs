/**
 * Build public tutorial figures from the user's real Cloudflare captures.
 * Source pixels are clipped at 1:1; HTML/SVG annotations are rendered by Chromium.
 * Raw captures are read from the supplied temporary directory and never copied
 * to the repository. Opaque credential redactions are baked into final PNGs.
 *
 * Usage: node scripts/prepare-cloudflare-screenshots.mjs --source-dir /path/to/captures
 * Optional: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceArg = process.argv.indexOf('--source-dir');
const sourceDir = sourceArg >= 0 ? process.argv[sourceArg + 1] : process.env.CF_SOURCE_DIR || os.tmpdir();
const outDir = path.join(root, 'docs/tutorial-assets/cloudflare');
const captureIds = [
'a8a89a18-7c88-40bf-83d7-a7b1f6bbc0d5','6e616593-e909-4331-9f86-08cf78fe3607','e6e40858-3156-4dd2-abef-414dc994c607','1a57f3fb-62e7-44c4-a6d8-7f5daa2d752b','15c9fe46-1e1e-4ed7-9440-4a02eac94ed6','3712d564-62c3-4644-a3fd-cbd382cd415f','fe403d48-331c-46bb-b2e5-6f9204ea2aa9','0158c88d-1eb6-452a-83ff-2129dbc84aa2','33ee8fc7-f9b7-4215-b4ec-120fd3b66c3b','9aa8d79a-6bbc-4775-b01b-2bc891d2c01f','87e0dbc0-2bd7-40c1-8502-80be591e8477','62213538-c5d7-4314-9586-838c6b08ef16','b81d9aeb-db29-4c77-9b69-05e6add7808e','7cf95ff4-8495-4e32-a9db-d5d44f1afbe9','fa71cfb8-e9aa-4ff5-8bc8-6f8f6de8b3f3','69d19b05-3f78-42ad-955c-28658e597e0b','8802046c-5fd8-4084-b422-b32442870127','d91a56ea-8ff0-4309-a257-06479de795a1','c9fb68ce-92e2-478f-9eb0-c109f572f833','54178c52-82fa-40ac-a1cf-b2d5636102da','5226d3c3-a8ed-4cf4-bcc9-361ac0636f87','81c08c17-641f-4e89-90d1-1bcb25c26199','e7ea8ab7-c1b3-4fa7-be4b-bc995402da5e','8f7b9e8a-7c6c-49f6-81dc-f1e11888e939','09c83ea3-e0af-4e39-981a-16caa6136864','755ca92d-9b72-46da-be0a-314465af5474','ae8da89f-5ecd-4fb0-874c-238a76e1be30','b522a311-33e4-42bb-ac62-f3e5e8537f4b'];
// Coordinates below use the 2048px-wide reading reference, scaled to native pixels.
const a = (text, target, from) => ({ text, target, from });
const specs = [
{title:'先创建 KV 命名空间',caption:'打开「存储和数据库 → Workers KV」，再点击右上角 Create Instance。',crop:[15,60,1650,550],annotations:[a('进入 Workers KV',[33,465,164,26],[268,494]),a('点击 Create Instance',[1536,76,121,34],[1480,161])]},
{title:'给 KV 命名空间起名',caption:'命名空间名称可填写 brclio-edge-config。确认名称后点击「创建」。',crop:[863,47,322,211],annotations:[a('填写 brclio-edge-config',[894,165,260,34],[1075,134]),a('点击创建',[1131,220,44,31],[1065,235])]},
{title:'确认 KV 已创建',caption:'列表出现 brclio-edge-config 即表示命名空间已创建；下一步把它绑定到 Pages 项目。',crop:[587,153,1078,286],annotations:[a('记住这个名称，稍后绑定时选择它',[606,245,154,31],[839,314])]},
{title:'创建 Cloudflare 应用',caption:'进入「计算 → Workers 和 Pages」，点击右上角「创建应用程序」。',crop:[15,65,1444,385],annotations:[a('打开 Workers 和 Pages',[34,326,162,25],[260,349]),a('点击创建应用程序',[1360,77,91,35],[1297,152])]},
{title:'进入 Pages 创建入口',caption:'在创建页底部找到「想要部署 Pages? 开始使用」。本教程使用 Pages 项目。',crop:[790,184,466,348],annotations:[a('点击底部的「开始使用」，进入 Pages',[1043,498,46,25],[1165,511])]},
{title:'选择部署方式',caption:'手动部署选「拖放文件」；GitHub 自动更新选「导入现有 Git 存储库」。',crop:[890,190,479,168],annotations:[a('GitHub 同步：导入现有 Git 存储库',[1270,215,77,32],[1215,214]),a('手动上传：拖放文件',[1270,295,77,32],[1215,293])]},
{title:'命名 Pages 项目',caption:'填写一个可用的项目名称，然后点击「创建项目」。名称会影响默认 pages.dev 地址。',crop:[647,88,968,215],annotations:[a('填写你自己的项目名称',[681,218,847,36],[927,175]),a('点击创建项目',[1535,219,69,34],[1451,278])]},
{title:'上传 Pages 部署包',caption:'点击上传区域，或把 brclio-edge-pages.zip 拖入这里。请使用构建后的 Pages ZIP。',crop:[644,335,970,323],annotations:[a('将 Pages ZIP 拖到这里，或点击选择文件',[687,374,912,146],[917,559])]},
{title:'核对上传结果并部署',caption:'确认所有文件上传成功，列表包含 _worker.js 和 _routes.json，再点击「部署站点」。',crop:[647,340,966,493],annotations:[a('检查文件上传成功',[682,373,921,76],[889,350]),a('确认包含 _worker.js 与 _routes.json',[733,618,130,44],[979,650]),a('点击部署站点',[1535,789,71,35],[1436,806])]},
{title:'第一次部署完成',caption:'出现部署成功提示后，点击「继续处理项目」进入项目设置。接下来还要配置变量与 KV。',crop:[647,218,966,596],annotations:[a('这是本次部署生成的站点地址',[1044,250,160,27],[1288,282]),a('点击继续处理项目，配置变量和 KV',[1513,770,93,34],[1374,787])]},
{title:'打开项目设置',caption:'部署列表的绿色对勾表示该次部署完成。点击上方「设置」，配置生产环境。',crop:[218,50,1402,372],annotations:[a('点击设置',[359,54,41,34],[462,75]),a('绿色对勾表示部署完成',[1340,234,96,34],[1275,282])]},
{title:'选择生产环境并添加变量',caption:'先确认右上角为「生产」，再使用「变量和密钥」旁的「添加」设置 ADMIN 与 UUID。',crop:[688,97,1360,446],annotations:[a('确认正在配置生产环境',[1870,105,166,31],[1780,126]),a('点击这里添加 ADMIN 与 UUID',[1316,239,44,23],[1435,264])]},
{title:'设置管理员密码 ADMIN',caption:'截图演示使用「文本」；实际填写密码建议选择「密钥 / Secret」。变量名 ADMIN 必须大写，并设置自己的强密码。',crop:[815,49,418,496],redactions:[{rect:[849,340,350,58],reason:'管理员密码',replacement:'填写自己的强密码'}],annotations:[a('密码建议把类型改为密钥 / Secret',[847,188,354,31],[1107,151]),a('变量名为 ADMIN；值填写自己的强密码',[847,251,354,149],[1212,421]),a('保存后，还需要重新部署才会生效',[931,509,50,31],[1066,521])]},
{title:'设置自己的 UUID',caption:'新增变量 UUID，填入自己生成的 UUID。截图中的原始值已遮盖，不能直接照抄。',crop:[815,49,418,496],redactions:[{rect:[849,340,350,58],reason:'节点身份 UUID',replacement:'填写自己生成的 UUID'}],annotations:[a('变量名为大写 UUID',[847,251,354,33],[1152,311]),a('使用自己生成的 UUID',[847,337,354,64],[1210,420]),a('点击保存，之后重新部署',[931,509,50,31],[1066,521])]},
{title:'添加 KV 资源绑定',caption:'确认 ADMIN、UUID 两个变量已添加。找到「绑定」这一行，点击右侧「添加」。图中的两个值已遮盖。',crop:[691,64,688,238],redactions:[{rect:[1008,73,306,27],reason:'管理员密码',replacement:'已遮盖'},{rect:[1008,123,306,24],reason:'节点身份 UUID',replacement:'已遮盖'}],annotations:[a('确认已配置 ADMIN 与 UUID',[801,69,189,82],[868,178]),a('点击绑定旁的添加',[1316,197,45,25],[1252,234])]},
{title:'选择 KV 命名空间',caption:'在右侧「添加资源绑定」列表中，选择「KV 命名空间」。',crop:[1727,515,321,317],annotations:[a('选择 KV 命名空间',[1742,676,294,69],[1900,655])]},
{title:'绑定名必须是大写 KV',caption:'变量名称填写 KV，命名空间选择刚创建的 brclio-edge-config，再点击底部保存。上下两段保持原像素，仅省略中间空白。保存后需要重新部署才能生效。',crop:[1727,0,321,1082],segments:[[1727,0,321,257],[1727,985,321,97]],annotations:[a('变量名称必须是大写 KV',[1740,141,296,32],[1993,108]),a('选择你刚刚创建的命名空间',[1740,206,296,32],[1970,190]),a('点击保存，再重新部署让绑定生效',[1985,1040,53,31],[1905,1070])]},
{title:'添加自定义域名（可选）',caption:'在项目中打开「自定义域」，点击「设置自定义域」。也可以先使用项目的 pages.dev 地址。',crop:[218,50,1403,368],annotations:[a('切换到自定义域',[297,54,64,33],[445,81]),a('点击设置自定义域',[891,315,91,35],[1044,357])]},
{title:'输入自己的域名',caption:'填写你有管理权限的域名或子域名，再点击「继续」。图中域名仅是操作示例。',crop:[640,126,738,310],annotations:[a('填写你自己的域名或子域名',[671,291,675,36],[1000,270]),a('点击继续',[1296,365,51,38],[1217,385])]},
{title:'选择 DNS 配置方式',caption:'如果域名由其它 DNS 服务商或另一个账户管理，选择「我的 DNS 提供商」，按页面给出的记录配置。',crop:[643,167,731,504],annotations:[a('按当前 DNS 管理位置选择；此示例使用右侧方案',[1124,581,115,35],[1054,590])]},
{title:'记录 CNAME 的名称与目标',caption:'在你的 DNS 服务商中添加 CNAME：名称和目标以当前页面实际显示为准，完成后再点击「检查 DNS 记录」。',crop:[640,165,738,531],annotations:[a('复制名称与目标，填入你自己的 DNS 管理页',[748,338,477,36],[1263,310]),a('DNS 记录保存后，再点击检查',[747,461,102,36],[923,473])]},
{title:'DNS 检测中：继续等待验证',caption:'蓝色提示仅表示 Cloudflare 正在检查 DNS 记录，还不代表域名已经激活。返回自定义域列表确认最终状态。',crop:[640,165,738,538],annotations:[a('检测中不等于激活成功；等待最终状态',[750,463,474,39],[1276,463])]},
{title:'在 DNS 管理页添加 CNAME',caption:'这是示例记录：类型为 CNAME，名称和目标来自上一步。请替换成你自己的域名信息，并按照当前 Pages 指引配置。',crop:[568,76,912,515],annotations:[a('类型选 CNAME；名称填写 Pages 提示的主机名',[606,271,839,47],[900,241]),a('目标填写当前项目的 pages.dev 地址',[606,357,520,49],[993,452]),a('核对后保存',[604,497,120,49],[852,560])]},
{title:'重新部署，让新配置生效',caption:'变量和 KV 绑定保存后，需要重新部署。回到「部署」页，点击右上角「创建部署」。',crop:[640,49,1408,371],annotations:[a('点击右上角创建部署',[1952,54,88,31],[1861,116]),a('这里列出项目关联的域名，仍应检查域名状态',[707,163,240,26],[1023,183])]},
{title:'选择生产环境并重新上传',caption:'创建部署时选择「生产」，再次上传 Pages ZIP。上传完成后才保存并部署。',crop:[647,172,967,407],annotations:[a('选择生产环境',[662,234,51,22],[806,244]),a('再次上传 Pages ZIP 部署包',[654,323,949,150],[1225,508])]},
{title:'确认文件齐全，保存并部署',caption:'等待全部文件上传完成，核对 _worker.js 和 _routes.json，再点击「保存并部署」。',crop:[646,230,970,518],annotations:[a('确认所有文件均上传成功',[654,322,950,77],[932,286]),a('点击保存并部署',[1523,696,82,34],[1406,717])]},
{title:'部署进行中',caption:'按钮显示加载状态时，等待这次部署结束。不要把文件上传成功当作部署已经完成。',crop:[646,315,970,431],annotations:[a('按钮正在加载：等待部署结果',[1508,695,97,37],[1399,711])]},
{title:'重新部署完成，开始验证',caption:'出现成功页面后，打开自己的站点验证登录、配置读取与订阅功能。部署成功本身不等于所有功能都已验证。',crop:[646,67,970,262],annotations:[a('确认出现部署成功提示',[1060,112,132,48],[1252,161]),a('打开自己的站点继续验证',[1030,187,203,30],[911,227])]}
];

const require = createRequire(import.meta.url);
let playwright;
const moduleCandidates = [process.env.PLAYWRIGHT_MODULE, (() => {try{return require.resolve('playwright')}catch{return null}})(),path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')].filter(Boolean);
for (const candidate of moduleCandidates) {try {playwright = await import(pathToFileURL(candidate).href); break;}catch{}}
if (!playwright) throw new Error('Playwright is required. Set PLAYWRIGHT_MODULE to its installed index.mjs.');
await fs.mkdir(outDir,{recursive:true});
const browser = await playwright.chromium.launch({headless:true,channel:'chrome'});
const page = await browser.newPage({deviceScaleFactor:1});
const images=[];
const hash=(data)=>crypto.createHash('sha256').update(data).digest('hex');
const escape=(v)=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
try {
for (let i=0;i<specs.length;i++) {
const spec=specs[i];
const sourceFile=`codex-clipboard-${captureIds[i]}.png`;
const source=await fs.readFile(path.join(sourceDir,sourceFile));
const sourceWidth=source.readUInt32BE(16),sourceHeight=source.readUInt32BE(20);
const factor=sourceWidth/2048;
const scale=(nums)=>nums.map(v=>Math.round(v*factor));
const crop=scale(spec.crop);
crop[2]=Math.min(crop[2],sourceWidth-crop[0]);
crop[3]=Math.min(crop[3],sourceHeight-crop[1]);
const [cx,cy,width,cropHeight]=crop;
const segments=(spec.segments||[spec.crop]).map(scale).map(([x,y,w,h])=>[x,y,Math.min(w,sourceWidth-x),Math.min(h,sourceHeight-y)]);
const segmentGap=spec.segments?76:0;
const shotHeight=segments.reduce((sum,segment)=>sum+segment[3],0)+segmentGap*(segments.length-1);
const displayPoint=([x,y])=>{let offset=0;for(const [sx,sy,sw,sh] of segments){if(y>=sy&&y<=sy+sh)return[x-sx,y-sy+offset];offset+=sh+segmentGap;}throw new Error(`Annotation outside visible segments: ${i+1}, ${x}, ${y}`)};
if(cx<0||cy<0||cx+width>sourceWidth||cy+cropHeight>sourceHeight)throw new Error(`Invalid crop ${i+1}`);
const annotations=spec.annotations.map((entry,n)=>({number:n+1,text:entry.text,target:scale(entry.target),from:scale(entry.from)}));
const redactions=(spec.redactions||[]).map(entry=>({...entry,rect:scale(entry.rect),method:'opaque baked-in cover'}));
const compact=width<1200;
const font=compact?34:42;
const header=compact?130:156;
const legendHeight=annotations.reduce((sum,entry)=>sum+Math.max(70,Math.ceil(entry.text.length*font/(width-160))*font*1.5+20),38);
const height=Math.round(header+shotHeight+legendHeight);
await page.setViewportSize({width,height});
const legend=annotations.map(entry=>`<div class="hint"><b>${entry.number}</b><span>${escape(entry.text)}</span></div>`).join('');
let overlays='';
for(const entry of annotations){
const [x,y,w,h]=entry.target; const [left,top]=displayPoint([x,y]); const [fx,fy]=displayPoint(entry.from);
// Arrow ends at the nearest edge of the target box, never over target text.
const tx=Math.max(left,Math.min(left+w,fx)); const ty=Math.max(top,Math.min(top+h,fy));
const dx=tx-fx,dy=ty-fy,len=Math.max(1,Math.hypot(dx,dy)); const r=compact?25:31;
overlays+=`<rect x="${left-4}" y="${top-4}" width="${w+8}" height="${h+8}" rx="12" fill="none" stroke="#d84f32" stroke-width="6"/><path d="M ${fx+dx/len*r} ${fy+dy/len*r} L ${tx} ${ty}" stroke="#d84f32" stroke-width="7" fill="none" marker-end="url(#arrow)"/><circle cx="${fx}" cy="${fy}" r="${r}" fill="#d84f32" stroke="#fff" stroke-width="4"/><text x="${fx}" y="${fy+1}" text-anchor="middle" dominant-baseline="central" fill="white" font-size="${compact?34:40}" font-family="Arial" font-weight="700">${entry.number}</text>`;
}
await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:${width}px;background:#fbf7ef;color:#392e25;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}.head{height:${header}px;padding:24px 38px;border-bottom:2px solid #e9dfd1;display:flex;gap:25px;align-items:center}.number{font-size:30px;color:#a55138;letter-spacing:2px}.title{font-size:${compact?40:52}px;font-weight:650;line-height:1.3;margin:0}.shot{height:${shotHeight}px;position:relative;background:#fff;overflow:hidden}.shot canvas,.shot svg{display:block;position:absolute;inset:0;width:${width}px;height:${shotHeight}px}.legend{padding:20px 38px 18px;border-top:2px solid #e9dfd1}.hint{display:flex;gap:20px;font-size:${font}px;line-height:1.5;padding:8px 0;align-items:flex-start}.hint b{background:#d84f32;color:#fff;border-radius:50%;font-size:${font-5}px;min-width:${font+13}px;height:${font+13}px;display:flex;align-items:center;justify-content:center;line-height:1;margin-top:4px}.hint span{flex:1} </style><main><header class="head"><span class="number">${String(i+1).padStart(2,'0')}</span><h1 class="title">${escape(spec.title)}</h1></header><section class="shot"><canvas width="${width}" height="${shotHeight}"></canvas><svg viewBox="0 0 ${width} ${shotHeight}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow" markerWidth="26" markerHeight="24" refX="22" refY="12" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L22,12 L0,24 Z" fill="#d84f32"/></marker></defs>${overlays}</svg></section><footer class="legend">${legend}</footer></main>`);
await page.evaluate(async({data,crop,redactions,segments,segmentGap})=>{const image=new Image();image.src=data;await image.decode();const ctx=document.querySelector('canvas').getContext('2d');const[cx,cy,w,h]=crop;let offset=0;for(const [sx,sy,sw,sh] of segments){if(offset){ctx.fillStyle='#fbf7ef';ctx.fillRect(0,offset,w,segmentGap);ctx.fillStyle='#8a7868';ctx.font='28px "PingFang SC",sans-serif';ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText('⋯ 中间空白已省略 ⋯',w/2,offset+segmentGap/2);ctx.textAlign='left';offset+=segmentGap;}ctx.drawImage(image,sx,sy,sw,sh,0,offset,sw,sh);offset+=sh;}for(const item of redactions){const[x,y,rw,rh]=item.rect;ctx.fillStyle='#fff';ctx.fillRect(x-cx,y-cy,rw,rh);ctx.fillStyle='#6f6256';ctx.font=`${Math.max(22,Math.round(rh*0.38))}px "PingFang SC",sans-serif`;ctx.textBaseline='middle';ctx.fillText(item.replacement,x-cx+18,y-cy+rh/2);}},{data:`data:image/png;base64,${source.toString('base64')}`,crop,redactions,segments,segmentGap});
await page.evaluate(()=>document.fonts.ready);
const actualHeight=await page.locator('main').evaluate(el=>Math.ceil(el.getBoundingClientRect().height));
if(actualHeight!==height)await page.setViewportSize({width,height:actualHeight});
const name=`cf-${String(i+1).padStart(2,'0')}`,file=`cloudflare/${name}.png`;
const png=await page.locator('main').screenshot({path:path.join(outDir,`${name}.png`),type:'png'});
images.push({file,name,title:spec.title,caption:spec.caption,width,height:png.readUInt32BE(20),bytes:png.length,sha256:hash(png),sourceFile,sourceWidth,sourceHeight,sourceSha256:hash(source),crop,...(spec.segments?{segments,segmentGap}:{}),redactions,annotations});
console.log(`${name}: ${width} × ${images.at(-1).height}, ${Math.round(png.length/1024)} KiB`);
}
await fs.writeFile(path.join(root,'docs/tutorial-assets/cloudflare-captures.json'),JSON.stringify({description:'User-supplied Cloudflare UI captures. Native-pixel crops with HTML/SVG teaching overlays; credential redactions are opaque and baked into PNG outputs. No raw source captures are included.',coordinateSpace:'Source-native pixels; crop is [x,y,width,height], annotation targets and redactions use the same source coordinates.',images},null,2)+'\n');
} finally {await browser.close();}
