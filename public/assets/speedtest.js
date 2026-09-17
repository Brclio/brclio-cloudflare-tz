/* Copyright (C) 2026 Brclio. GPL-2.0-only. Independently authored manual probes. */
(function (scope) {
  'use strict';
  const TLS_PORTS = [443, 2053, 2083, 2087, 2096, 8443];
  function ipNumber(text) {
    const value = text.replace(/^\[|\]$/g, '');
    if (/^\d+(\.\d+){3}$/.test(value)) {
      const parts = value.split('.').map(Number);
      if (parts.some(x => x < 0 || x > 255)) throw Error('IPv4 地址无效');
      return { bits: 32, value: parts.reduce((n, x) => (n << 8n) + BigInt(x), 0n) };
    }
    if (!value.includes(':') || !/^[a-f\d:]+$/i.test(value) || value.split('::').length > 2) throw Error('IP 地址无效');
    const sides = value.split('::'), left = sides[0] ? sides[0].split(':') : [], right = sides[1] ? sides[1].split(':') : [];
    const groups = sides.length === 2 ? [...left, ...Array(Math.max(0, 8-left.length-right.length)).fill('0'), ...right] : left;
    if (groups.length !== 8 || (sides.length === 2 && left.length+right.length >= 8) || groups.some(x => !/^[a-f\d]{1,4}$/i.test(x))) throw Error('IPv6 地址无效');
    return { bits: 128, value: groups.reduce((n,x) => (n << 16n)+BigInt(parseInt(x,16)), 0n) };
  }
  function numberIP(value, bits) {
    if (bits === 32) return [24n,16n,8n,0n].map(n => Number((value >> n)&255n)).join('.');
    const full = Array.from({length:8},(_,i) => ((value >> BigInt((7-i)*16))&65535n).toString(16)).join(':');
    return new URL('https://['+full+']/').hostname.slice(1,-1);
  }
  function randomBelow(size) {
    if (size <= 1n) return 0n;
    const words = new Uint32Array(4);
    scope.crypto.getRandomValues(words);
    return words.reduce((n,x) => (n << 32n)+BigInt(x),0n)%size;
  }
  function parseEntry(line, defaultPort=443) {
    const hash = line.indexOf('#'), note = hash < 0 ? '' : line.slice(hash+1).trim();
    let address = (hash < 0 ? line : line.slice(0,hash)).trim(), port=defaultPort;
    const match = address.match(/^\[([^\]]+)\](?::(\d+))?$/) || address.match(/^(\d+(?:\.\d+){3}):(\d+)$/);
    if (match) { address=match[1]; if (match[2]) port=Number(match[2]); }
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('端口必须为 0（随机）或 1–65535');
    let low, high, bits;
    if (address.includes('/')) {
      const [base,prefix,...extra] = address.split('/'), ip=ipNumber(base), p=Number(prefix);
      if (extra.length || !/^\d+$/.test(prefix) || p<0 || p>ip.bits) throw Error('CIDR 前缀无效');
      bits=ip.bits; const size=1n << BigInt(bits-p); low=ip.value/size*size; high=low+size-1n;
    } else if (address.includes('-')) {
      const [first,last,...extra]=address.split('-').map(x=>x.trim()), a=ipNumber(first), b=ipNumber(last);
      if (extra.length || a.bits!==b.bits || a.value>b.value) throw Error('IP 区间无效');
      bits=a.bits; low=a.value; high=b.value;
    } else { const ip=ipNumber(address); bits=ip.bits; low=high=ip.value; }
    return {low,high,bits,port,note};
  }
  function candidates(text, count=32, port=443) {
    if (!Number.isInteger(count) || count<1 || count>4096) throw Error('候选数量需为 1–4096');
    const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x && !x.startsWith('#'));
    const ranges=lines.map((line,i)=>{try{return parseEntry(line,port);}catch(error){throw Error('第 '+(i+1)+' 行：'+error.message);}});
    if (!ranges.length) throw Error('请先填写候选地址、CIDR 或 IP 区间');
    const result=[], seen=new Set();
    function add(range,value){const identity=range.bits+':'+value+':'+range.port;if(seen.has(identity))return;seen.add(identity);const ip=numberIP(value,range.bits),port=range.port||TLS_PORTS[Number(randomBelow(BigInt(TLS_PORTS.length)))],address=(range.bits===128?'['+ip+']':ip)+':'+port; {result.push({address,ip,port,bits:range.bits,note:range.note,selected:false,status:'未测试',latency:null,speed:null});}}
    // Explicit addresses must not disappear behind a randomly sampled CIDR.
    for(const range of ranges) if(range.low===range.high && result.length<count) add(range,range.low);
    const total=ranges.reduce((n,r)=>n+r.high-r.low+1n,0n);
    if(total<=BigInt(count)){for(const range of ranges) for(let n=range.low;n<=range.high;n++) add(range,n);}
    else for(let attempt=0;result.length<count && attempt<count*40;attempt++){const r=ranges[attempt%ranges.length];add(r,r.low+randomBelow(r.high-r.low+1n));}
    return result;
  }
  function probeURL(item,host,path,params={}) {
    if(!/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d-]+$/i.test(host)) throw Error('测速服务填写域名，不带协议和路径');
    const label=item.bits===32?item.ip.split('.').map(x=>Number(x).toString(16).padStart(2,'0')).join('').toUpperCase():item.ip.replaceAll(':','-');
    return 'https://'+label+'.'+host+':'+item.port+'/'+path+'?'+new URLSearchParams({_t:String(Date.now()),...params});
  }
  class ManualRun {
    constructor(){this.stopped=false;this.controllers=new Set();this.readers=new Set();}
    stop(){this.stopped=true;for(const c of this.controllers)c.abort();for(const r of this.readers)r.cancel().catch(()=>{});}
    async request(url,options={},timeout=5000){
      if(this.stopped) throw Error('已停止');
      const controller=new AbortController();this.controllers.add(controller);
      const timer=setTimeout(()=>controller.abort(),timeout);
      try{
        const response=await scope.fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',...options,signal:controller.signal});
        if(response.type==='opaque' || !response.body)return response;
        const reader=response.body.getReader();this.readers.add(reader);const chunks=[];let total=0;
        try{while(!this.stopped){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>2*1024*1024)throw Error('检测响应超过 2 MB');chunks.push(value);}if(this.stopped)throw Error('已停止');}
        finally{this.readers.delete(reader);await reader.cancel().catch(()=>{});}
        const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
        return new Response(bytes,{status:response.status,statusText:response.statusText,headers:response.headers});
      }
      finally{clearTimeout(timer);this.controllers.delete(controller);}
    }
    async pool(items,concurrency,task){let next=0;await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(!this.stopped && next<items.length){const i=next++;await task(items[i],i);}}));}
  }
  async function download(item,host,run,{seconds=10,bytes=20000000}={},progress=()=>{}) {
    if(run.stopped) throw Error('已停止');
    const controller=new AbortController();run.controllers.add(controller);
    let received=0, timedOut=false, reader;
    const started=performance.now(), timer=setTimeout(()=>{timedOut=true;controller.abort();},seconds*1000);
    const speed=()=>received*8/Math.max(0.001,(performance.now()-started)/1000)/1e6;
    try {
      const response=await scope.fetch(probeURL(item,host,'__down',{bytes:String(bytes)}),{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
      if(!response.ok || !response.body) throw Error('下载失败（HTTP '+response.status+'）');
      reader=response.body.getReader();run.readers.add(reader);
      while(!run.stopped && received<bytes){const {done,value}=await reader.read();if(done)break;received+=value.byteLength;progress(speed(),received);}
      if(run.stopped) throw Error('已停止');
      if(!received) throw Error('测速响应为空');
      return {mbps:speed(),bytes:received};
    } catch(error){if(timedOut && received && !run.stopped)return {mbps:speed(),bytes:received};throw error;}
    finally{clearTimeout(timer);controller.abort();run.controllers.delete(controller);if(reader){run.readers.delete(reader);await reader.cancel().catch(()=>{});}}
  }
  function resultValue(row,key) {
    if(key==='ipType')return row.bits===128?'IPv6':'IPv4';
    return row[key]??'';
  }
  function resultRows(rows,{search='',state='all',filters={},sort='latency',direction='asc'}={}) {
    const query=search.trim().toLowerCase(),sign=direction==='desc'?-1:1;
    return rows.filter(row=>{
      if(query && !['address','country','colo','type','note','ipType'].some(key=>String(resultValue(row,key)).toLowerCase().includes(query)))return false;
      if(!(state==='all'||state==='ok'&&row.latency!==null||state==='failed'&&row.status.startsWith('失败')||state==='v4'&&row.bits===32||state==='v6'&&row.bits===128||state==='selected'&&row.selected))return false;
      return Object.entries(filters).every(([key,values])=>!values.length||values.includes(String(resultValue(row,key)||'未知')));
    }).sort((a,b)=>{
      const first=resultValue(a,sort),second=resultValue(b,sort),numeric=sort==='latency'||sort==='speed';
      const missingFirst=first===''||numeric&&!Number.isFinite(first),missingSecond=second===''||numeric&&!Number.isFinite(second);
      if(missingFirst||missingSecond)return Number(missingFirst)-Number(missingSecond);
      return sign*(numeric?first-second:String(first).localeCompare(String(second),undefined,{numeric:true}));
    });
  }
  const api={ipNumber,numberIP,parseEntry,candidates,probeURL,ManualRun,download,resultValue,resultRows,init};
  scope.BrclioSpeedtest=api;
  if(scope.document && scope.BrclioUI) init(scope.BrclioUI);

  function init(bridge) {
    const root=document.getElementById('speedtest-root');if(!root || root.dataset.ready)return;root.dataset.ready='true';
    const allRuns=new Set();let rows=[],active=null;let siteResults=[];
    const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
    const label=(text,input)=>{const wrap=node('label',undefined,'field');wrap.append(node('span',text,'field-label'),input);return wrap;};
    const input=(type,value)=>{const n=node('input');n.type=type;n.value=value;n.className='field-input';return n;};
    const number=(value,min,max)=>{const n=input('number',value);n.min=min;n.max=max;return n;};
    const select=(options)=>{const n=node('select');n.className='field-input';for(const [value,text]of options){const o=node('option',text);o.value=value;n.append(o);}return n;};
    const button=(title,fn,primary=false)=>{const n=node('button',title,'button button-small'+(primary?' button-primary':''));n.type='button';n.addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>bridge.toast(e.message,true)));return n;};
    const section=(title,description)=>{const n=node('section',undefined,'form-section');n.append(node('h2',title),node('p',description,'field-hint'));root.append(n);return n;};
    function runStart(){const r=new ManualRun();allRuns.add(r);stop.disabled=false;return r;}
    function runDone(r){allRuns.delete(r);stop.disabled=!allRuns.size;}
    const stop=button('停止所有检测',()=>{for(const r of allRuns)r.stop();status.textContent='已停止；不会自动重新开始。';});stop.disabled=true;
    const status=node('p','尚未测速。打开页面、切换页面或等待都不会启动检测。','field-hint');status.setAttribute('role','status');root.append(stop,status);
    document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const r of allRuns)r.stop();}});
    scope.addEventListener('pagehide',()=>{for(const r of allRuns)r.stop();});
    document.addEventListener('brclio:navigate',event=>{if(event.detail!=='speedtest'){for(const r of allRuns)r.stop();}});
    const page=root.closest('.page');
    if(page)new MutationObserver(()=>{if(page.hidden)for(const r of allRuns)r.stop();}).observe(page,{attributes:true,attributeFilter:['hidden']});

    const net=section('网络与出口信息','仅点击后查询。结果表示此浏览器访问对应服务时的出口，不代表代理客户端已经连通。IP 和地区默认隐藏；查询详情会单独访问公开 IP 数据库。');
    let networkVisible=false,networkCards=[];
    const netOut=node('div',undefined,'probe-network-grid');
    const privacy=button('显示 IP 和地区',()=>{networkVisible=!networkVisible;privacy.textContent=networkVisible?'隐藏 IP 和地区':'显示 IP 和地区';privacy.setAttribute('aria-pressed',String(networkVisible));for(const card of networkCards)renderNetworkCard(card);});
    privacy.setAttribute('aria-pressed','false');privacy.disabled=true;
    const queryNetwork=button('查询网络信息',networkInfo);net.append(queryNetwork,privacy,netOut);
    function renderNetworkCard(card){if(card.result)card.out.textContent=networkVisible?card.result.text:'已获取 · IP 和地区已隐藏';}
    function networkResult(ip,parts=[]){ip=String(ip||'').trim();try{ipNumber(ip);}catch{throw Error('响应没有有效 IP');}return {ip,text:[ip,...parts].filter(Boolean).join(' · ')};}
    async function adminProbe(run,path,options={}){
      if(run.stopped)throw Error('已停止');const controller=new AbortController();run.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),8000);
      try{return await bridge.api(path,{...options,signal:controller.signal});}finally{clearTimeout(timer);run.controllers.delete(controller);}
    }
    async function networkIPDetail(ip){
      const dialog=node('dialog',undefined,'confirm-dialog ip-detail-dialog');dialog.setAttribute('aria-label','出口 IP 详情');dialog.append(node('h2','出口 IP 详情'));
      const message=node('p','正在查询公开网络信息…','field-hint'),content=node('dl',undefined,'detail-list'),close=button('关闭详情',()=>dialog.close());dialog.append(message,content,close);document.body.append(dialog);dialog.showModal();
      const run=runStart();dialog.addEventListener('close',()=>{run.stop();dialog.remove();},{once:true});
      try{
        const response=await adminProbe(run,'/admin/ipDetail',{method:'POST',data:{ip}});if(!dialog.open||run.stopped)return;
        const data=response.data||{},location=data.location||{},asn=data.asn||{},company=data.company||{};
        const values=[['IP',data.ip||ip],['地区',[location.country,location.state,location.city].filter(Boolean).join(' · ')],['时区',location.timezone],['ASN',asn.asn?'AS'+asn.asn:''],['网络组织',asn.org||asn.descr||company.name],['运营商类型',asn.type||company.type],['网段',asn.route||company.network],['来源',response.source||'https://api.ipapi.is/']];
        for(const [name,value]of values)if(value!==undefined&&value!==null&&value!=='')content.append(node('dt',name),node('dd',String(value)));
        for(const [key,name]of [['is_proxy','代理'],['is_vpn','VPN'],['is_tor','Tor'],['is_datacenter','数据中心'],['is_mobile','移动网络'],['is_abuser','滥用标记']])if(typeof data[key]==='boolean')content.append(node('dt',name),node('dd',data[key]?'是':'否'));
        message.textContent='以下信息来自第三方数据库，仅反映该来源的标记。';
      }catch(error){if(dialog.open){message.textContent=run.stopped?'查询已停止。':error.message;message.className='inline-error';}}finally{runDone(run);}
    }
    async function networkInfo(){const run=runStart();queryNetwork.disabled=true;netOut.replaceChildren();networkCards=[];privacy.disabled=true;try{
      const jobs=[
        ['当前 Cloudflare 入口','当前 Worker /admin/network',async()=>{const d=await adminProbe(run,'/admin/network');return networkResult(d.ip,[d.country,d.city,d.colo]);}],
        ['海外出口','api.ipapi.is',async()=>{const r=await run.request('https://api.ipapi.is',{},6000);if(!r.ok)throw Error('查询失败');const d=await r.json();return networkResult(d.ip,[d.cc||d.location?.country_code,d.asn_org||d.asn?.org]);}],
        ['国内出口','字节 / 网易资源响应头',async()=>{let failure;for(const [url,header]of [['https://perfops2.byte-test.com/500b-bench.jpg','X-Request-Ip'],['https://necaptcha.nosdn.127.net/ab7f4275c1744aa28e0a8f3a1c58c532.png','cdn-user-ip']]){try{const r=await run.request(url,{method:'HEAD'},5000);return networkResult(r.headers.get(header));}catch(e){failure=e;if(run.stopped)throw e;}}throw failure;}],
        ['X.com 出口','help.x.com/cdn-cgi/trace',async()=>{const r=await run.request('https://help.x.com/cdn-cgi/trace',{},6000);if(!r.ok)throw Error('查询失败');const d=Object.fromEntries((await r.text()).split('\n').map(x=>x.split('=')));return networkResult(d.ip,[d.loc,d.colo]);}],
        ...[['IPv4','104.16.0.1',32],['IPv6','2606:4700::1111',128]].map(([name,ip,bits])=>[name,host.value+' / ip.json',async()=>{const r=await run.request(probeURL({ip,bits,port:443},host.value,'ip.json'),{},6000);if(!r.ok)throw Error('查询失败');const d=await r.json();return networkResult(d.ip,[d.country,d.colo,d.cnIspCode]);}])
      ];
      await run.pool(jobs,3,async([name,source,task])=>{
        const item=node('div',undefined,'context-note'),out=node('p','查询中…'),detail=button('查询 IP 详情',()=>networkIPDetail(card.result.ip));detail.disabled=true;
        const card={out,detail,result:null};networkCards.push(card);item.append(node('strong',name),out,node('p','来源：'+source,'field-hint'),detail);netOut.append(item);
        try{const result=await task();if(run.stopped)throw Error('已停止');card.result=result;detail.disabled=false;privacy.disabled=false;renderNetworkCard(card);}catch(e){out.textContent=run.stopped?'已停止':'未获取：'+e.message;}
      });
    }finally{queryNetwork.disabled=false;runDone(run);}}

    const sites=section('网站延迟测速','测量浏览器发起请求所需时间，包含 DNS / TLS 等开销，不是 ICMP Ping。跨域 opaque 响应不能验证网站 HTTP 状态。');
    const siteInput=node('textarea');siteInput.rows=5;siteInput.className='code-input';siteInput.value='字节抖音 | https://lf3-zlink-tos.ugurl.cn/obj/zebra-public/resource_lmmizj_1632398893.png\n哔哩哔哩 | https://i0.hdslb.com/bfs/face/member/noface.jpg\n腾讯微信 | https://res.wx.qq.com/a/wx_fed/assets/res/NTI4MWU5.ico\n淘宝 | https://img.alicdn.com/imgextra/i2/O1CN01qnQCrN1VkzAWiU4Hs_!!6000000002692-2-tps-33-33.png\nGitHub | https://github.github.io/janky/images/bg_hr.png\nTelegram | https://flora.web.telegram.org/\nX.com | https://abs.twimg.com/favicons/twitter.3.ico\nYouTube | https://www.youtube.com/favicon.ico';
    const samples=number(3,1,16),siteOut=node('div',undefined,'probe-network-grid');sites.append(label('网站列表，每行 名称 | HTTPS 地址',siteInput),label('每个网站采样次数',samples),button('开始网站延迟测速',testSites,true),siteOut);
    async function testSites(){if(!samples.checkValidity())return samples.reportValidity();const list=siteInput.value.split('\n').filter(x=>x.trim()).map(line=>{const [name,address]=line.split('|').map(x=>x.trim()),url=new URL(address||name);if(url.protocol!=='https:')throw Error('网站地址必须使用 HTTPS');return {name:address?name:url.hostname,url:url.href};});if(list.length>32)throw Error('每轮最多 32 个网站');const run=runStart();siteOut.replaceChildren();siteResults=[];try{await run.pool(list,4,async site=>{const box=node('div',undefined,'context-note'),result=node('p','检测中…');box.append(node('strong',site.name),result);siteOut.append(box);const times=[];for(let i=0;i<Number(samples.value) && !run.stopped;i++){try{const url=new URL(site.url);url.searchParams.set('_brclio',Date.now()+'-'+i);const start=performance.now();await run.request(url.href,{method:'HEAD',mode:'no-cors'},5000);times.push(Math.round(performance.now()-start));}catch{times.push(null);}}const good=times.filter(x=>x!==null),mean=good.length?Math.round(good.reduce((a,b)=>a+b,0)/good.length):null;result.textContent=run.stopped?'已停止':mean===null?'请求失败 / 超时':mean+' ms · 成功 '+good.length+'/'+times.length+' · '+times.map(x=>x===null?'失败':x+' ms').join(' / ');siteResults.push({name:site.name,times,mean});});status.textContent=run.stopped?'网站检测已停止。':'本轮网站检测完成，等待你下次点击。';}finally{runDone(run);}}

    const best=section('在线优选地址','候选地址从你填写的范围生成。测速直接从当前浏览器连接所选第三方探测服务，完成一轮后停止。');
    const source=node('textarea');source.rows=6;source.className='code-input';source.value='104.16.0.0/13';
    const sourcePresets=select([['104.16.0.0/13','Cloudflare IPv4 CIDR'],['2606:4700::/32','Cloudflare IPv6 CIDR'],['104.16.0.0/13\n2606:4700::/32','IPv4 + IPv6']]);
    const sourceURL=input('url','https://cf.090227.xyz/ips-v4');
    const remotePresets=select([['https://cf.090227.xyz/ips-v4','CF 官方 IPv4'],['https://cf.090227.xyz/ips-v6','CF 官方 IPv6'],['https://raw.githubusercontent.com/cmliu/cmliu/main/CF-CIDR.txt','cmliu CF CIDR'],['https://raw.githubusercontent.com/ipverse/asn-ip/master/as/13335/ipv4-aggregated.txt','AS13335 IPv4'],['https://raw.githubusercontent.com/ipverse/asn-ip/master/as/13335/ipv6-aggregated.txt','AS13335 IPv6'],['https://raw.githubusercontent.com/ipverse/asn-ip/master/as/209242/ipv4-aggregated.txt','AS209242 IPv4'],['https://raw.githubusercontent.com/ipverse/asn-ip/master/as/209242/ipv6-aggregated.txt','AS209242 IPv6']]);remotePresets.addEventListener('change',()=>{sourceURL.value=remotePresets.value;});
    const count=number(32,1,4096),threads=number(8,1,64),timeout=number(3000,200,30000),port=number(443,0,65535),seconds=number(10,1,30),megabytes=number(20,1,100);
    const host=input('text','bestcf.cmliussss.hidns.vip');
    const backupHost=button('切换备用测速服务',()=>{host.value=host.value==='ns.psb.kdns.fr'?'bestcf.cmliussss.hidns.vip':'ns.psb.kdns.fr';});
    const settings=node('div',undefined,'field-grid');settings.append(label('候选数量',count),label('延迟并发',threads),label('每次延迟超时（毫秒）',timeout),label('目标端口（0 为随机 TLS 端口）',port),label('每个地址下载上限（MB）',megabytes),label('每个地址最长下载（秒）',seconds),label('测速服务域名',host));
    const file=input('file','');file.accept='.txt,.csv';file.addEventListener('change',async()=>{try{const f=file.files[0];if(!f)return;if(f.size>2*1024*1024)throw Error('文件最大 2 MB');let text=await f.text();if(f.name.endsWith('.csv')){const lines=text.trim().split(/\r?\n/),headers=lines[0].split(',').map(x=>x.replaceAll('"','').trim());const a=headers.findIndex(x=>/^(IP|IP地址|地址|address)$/i.test(x)),p=headers.findIndex(x=>/^(端口|port)$/i.test(x));if(a<0)throw Error('CSV 需要 IP / 地址 / address 列');text=lines.slice(1).map(line=>{const fields=line.split(',').map(x=>x.replaceAll('"','').trim()),address=fields[a];return p<0?address:(address.includes(':')?'['+address.replace(/^\[|\]$/g,'')+']':address)+':'+fields[p];}).join('\n');}source.value=text;bridge.toast('已导入来源，尚未启动测速。');}catch(e){bridge.toast(e.message,true);}finally{file.value='';}});
    best.append(label('本地范围预设',sourcePresets),button('使用所选范围',()=>{source.value=sourcePresets.value;}),label('远端地址库预设',remotePresets),label('来源 URL（只在点击时获取）',sourceURL),button('获取来源列表',async()=>{if(!sourceURL.checkValidity())return sourceURL.reportValidity();const url=new URL(sourceURL.value);if(url.protocol!=='https:')throw Error('来源必须是 HTTPS');const run=runStart();try{const r=await run.request(url.href,{},8000);if(!r.ok)throw Error('来源请求失败');const text=await r.text();if(text.length>2*1024*1024)throw Error('来源超过 2 MB');source.value=text;bridge.toast('已读取来源，尚未启动测速。');}finally{runDone(run);}}),label('导入 TXT / CSV',file),label('IPv4 / IPv6、CIDR 或起止 IP，每行一条，可加 #备注',source),settings,backupHost);
    const actions=node('div',undefined,'probe-actions');best.append(actions);
    const generate=()=>{if(active)throw Error('请先停止当前测速');for(const field of [count,port])if(!field.checkValidity()){field.reportValidity();return false;}rows=candidates(source.value,Number(count.value),Number(port.value));render();status.textContent='已生成 '+rows.length+' 个候选，尚未测速。';return true;};
    actions.append(button('生成候选',generate),button('开始延迟测速',()=>runRows('latency'),true),button('下载测速 · 选中或全部',()=>runRows('download')));
    const filter=input('search',''),kind=select([['all','全部结果'],['ok','延迟通过'],['failed','失败'],['v4','仅 IPv4'],['v6','仅 IPv6'],['selected','已选中']]),sort=select([['latency','延迟'],['speed','下载速度'],['address','地址'],['ipType','IP 类型'],['type','优选类型'],['country','国家 / 地区'],['colo','数据中心']]),direction=select([['asc','升序'],['desc','降序']]);
    filter.placeholder='筛选地址、地区、类型或备注';
    const filters=node('div',undefined,'field-grid');filters.append(label('搜索结果',filter),label('显示',kind),label('排序字段',sort),label('排序方向',direction));best.append(filters);
    const categoryFilters={};
    for(const [key,title]of [['ipType','IP 类型'],['type','优选类型'],['country','国家 / 地区'],['colo','数据中心']]){
      const control=select([]);control.multiple=true;control.size=4;control.setAttribute('aria-label',title+'多选筛选');categoryFilters[key]=control;filters.append(label(title+'（可多选，不选表示全部）',control));control.addEventListener('change',()=>{pageIndex=0;render();});
    }
    const resetFilters=button('清除全部筛选',()=>{filter.value='';kind.value='all';for(const control of Object.values(categoryFilters))for(const option of control.options)option.selected=false;pageIndex=0;render();});best.append(resetFilters,node('p','各组之间同时满足；同组可选多个值。桌面按住 Ctrl / Command 多选，手机可在选项窗口多选。','field-hint'));
    function updateCategoryFilters(){for(const [key,control]of Object.entries(categoryFilters)){const values=[...new Set(rows.map(row=>String(resultValue(row,key)||'未知')))].sort((a,b)=>a.localeCompare(b));if(JSON.stringify(values)===control.dataset.values)continue;const selected=new Set([...control.selectedOptions].map(option=>option.value));control.replaceChildren();for(const value of values){const option=node('option',value);option.value=value;option.selected=selected.has(value);control.append(option);}control.dataset.values=JSON.stringify(values);control.disabled=!values.length;}}

    const table=node('table',undefined,'data-table'),thead=node('thead'),header=node('tr'),tbody=node('tbody');
    ['选择','地址 / 备注','地区 / 类型','延迟','下载速度','状态','操作'].forEach(x=>header.append(node('th',x)));thead.append(header);table.append(thead,tbody);const wrap=node('div',undefined,'table-wrap');wrap.append(table);best.append(wrap);
    const resultCount=node('p','尚无结果','field-hint');best.append(resultCount);
    let pageIndex=0,renderTimer=null;const pageSize=100;
    const pageLabel=node('span','第 1 页','field-hint'),prevPage=button('上一页',()=>{pageIndex--;render();}),nextPage=button('下一页',()=>{pageIndex++;render();});
    const pagination=node('div',undefined,'probe-actions');pagination.append(prevPage,pageLabel,nextPage);best.append(pagination);
    for(const field of [filter,kind,sort,direction])field.addEventListener('input',()=>{pageIndex=0;render();});
    function scheduleRender(){if(renderTimer===null)renderTimer=setTimeout(()=>{renderTimer=null;render();},100);}
    const exportActions=node('div',undefined,'probe-actions');best.append(exportActions);
    function visible(){return resultRows(rows,{search:filter.value,state:kind.value,filters:Object.fromEntries(Object.entries(categoryFilters).map(([key,control])=>[key,[...control.selectedOptions].map(option=>option.value)])),sort:sort.value,direction:direction.value});}
    function selectedLines(){return rows.filter(r=>r.selected).map(r=>r.address+'#'+(r.note||['Brclio 优选',r.country,r.latency===null?'':r.latency+'ms'].filter(Boolean).join(' ')));}
    exportActions.append(button('选中当前筛选结果',()=>{for(const r of visible())r.selected=true;render();}),button('反选当前筛选结果',()=>{for(const r of visible())r.selected=!r.selected;render();}),button('取消所有选择',()=>{for(const r of rows)r.selected=false;render();}),button('复制选中地址',()=>bridge.copy(selectedLines().join('\n'))),button('追加选中到地址列表',()=>{const lines=selectedLines();if(!lines.length)throw Error('请先选中地址');bridge.appendAddresses(lines);}),button('导出 CSV',()=>{const quote=value=>'"'+String(value??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';const csv=[['address','country','colo','type','latency_ms','speed_mbps','status','note'],...visible().map(r=>[r.address,r.country,r.colo,r.type,r.latency,r.speed,r.status,r.note])].map(row=>row.map(quote).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=node('a');a.href=url;a.download='brclio-speed-results.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
    function render(){updateCategoryFilters();if(renderTimer!==null){clearTimeout(renderTimer);renderTimer=null;}const filtered=visible(),pages=Math.max(1,Math.ceil(filtered.length/pageSize));pageIndex=Math.max(0,Math.min(pageIndex,pages-1));prevPage.disabled=pageIndex===0;nextPage.disabled=pageIndex===pages-1;pageLabel.textContent='第 '+(pageIndex+1)+' / '+pages+' 页 · 每页最多 '+pageSize+' 条';tbody.replaceChildren();for(const r of filtered.slice(pageIndex*pageSize,(pageIndex+1)*pageSize)){const tr=node('tr'),check=input('checkbox','');check.checked=r.selected;check.setAttribute('aria-label','选择 '+r.address);check.addEventListener('change',()=>{r.selected=check.checked;resultCount.textContent=visible().length+' / '+rows.length+' 个结果，已选 '+rows.filter(x=>x.selected).length+' 个';});const first=node('td');first.append(check);tr.append(first);const address=node('td',r.address);address.append(node('div',r.note,'field-hint'));tr.append(address,node('td',[r.country,r.colo,r.type].filter(Boolean).join(' · ')||'—'),node('td',r.latency===null?'—':r.latency+' ms'),node('td',r.speed===null?'—':r.speed.toFixed(2)+' Mbps'),node('td',r.status));const action=node('td'),b=button('测速',()=>runRows('download',[r]));b.disabled=!!active;action.append(button('复制地址',()=>bridge.copy(r.address)),b);tr.append(action);tbody.append(tr);}resultCount.textContent=visible().length+' / '+rows.length+' 个结果，已选 '+rows.filter(r=>r.selected).length+' 个';}
    async function runRows(mode,targets){if(active)throw Error('已有一轮测速正在运行，请先停止');for(const f of [count,threads,timeout,port,seconds,megabytes])if(!f.checkValidity()){f.reportValidity();return;}if(!rows.length && !generate())return;probeURL(rows[0],host.value,'ip.json');const selected=rows.filter(r=>r.selected);targets=targets||(mode==='download' && selected.length?selected:rows);const run=runStart();active=run;let completed=0;const service=host.value;try{render();status.textContent='正在'+(mode==='download'?'下载测速':'检测延迟')+'，共 '+targets.length+' 个地址。';await run.pool(targets,mode==='download'?Math.min(4,Number(threads.value)):Number(threads.value),async r=>{r.status='检测中';scheduleRender();try{if(mode==='latency'){const started=performance.now(),response=await run.request(probeURL(r,service,'ip.json'),{},Number(timeout.value));if(!response.ok)throw Error('HTTP '+response.status);const d=await response.json();if(!d||typeof d.ip!=='string')throw Error('测速服务返回格式无效');r.latency=Math.max(1,Math.round(performance.now()-started));r.country=d.country||'未知';r.colo=d.colo||'';r.type=d.cnIspCode||d.ipType||'探测地址';}else{const result=await download(r,service,run,{seconds:Number(seconds.value),bytes:Number(megabytes.value)*1000000},speed=>{r.speed=speed;});r.speed=result.mbps;}r.status=run.stopped?'已停止':'完成';}catch(e){r.status=run.stopped?'已停止':'失败：'+e.message;if(mode==='download')r.speed=null;else r.latency=null;}completed++;status.textContent=(run.stopped?'已停止':'已完成 '+completed+' / '+targets.length)+'；本轮结束后不会继续请求。';scheduleRender();});}finally{active=null;runDone(run);render();}}
    render();
  }
})(globalThis);
