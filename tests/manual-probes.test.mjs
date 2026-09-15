// Copyright (C) 2026 Brclio. GPL-2.0-only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('loading the probe module is inert; finite queues never repeat and cancellation stops pending work', async () => {
  const originalFetch=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return new Response('{}');};
  try {
    await import('../public/assets/speedtest.js');
    const P=globalThis.BrclioSpeedtest;
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(requests,0,'Importing the module must not start any request');
    const run=new P.ManualRun();
    await run.pool([1,2,3],2,()=>run.request('https://probe.example.test/ip.json'));
    assert.equal(requests,3);
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(requests,3,'Completing a queue must not schedule a repeat');
    const cancelled=new P.ManualRun();let visited=0;
    await cancelled.pool([1,2,3,4],1,async()=>{visited++;cancelled.stop();});
    assert.equal(visited,1);
    await assert.rejects(()=>cancelled.request('https://probe.example.test'),/已停止/);
    assert.equal(requests,3);
  } finally {globalThis.fetch=originalFetch;}
});

test('IPv4, IPv6, CIDR and ranges preserve explicit addresses without expanding huge networks', async()=>{
  await import('../public/assets/speedtest.js');const P=globalThis.BrclioSpeedtest;
  assert.equal(P.numberIP(P.ipNumber('2001:db8::1').value,128),'2001:db8::1');
  const range=P.candidates('192.0.2.0/30',10);
  assert.deepEqual(range.map(r=>r.address),['192.0.2.0:443','192.0.2.1:443','192.0.2.2:443','192.0.2.3:443']);
  assert.deepEqual(P.candidates('[2001:db8::1]:8443#测试\n2001:db8::2-2001:db8::3',10).map(r=>r.address),['[2001:db8::1]:8443','[2001:db8::2]:443','[2001:db8::3]:443']);
  const huge=P.candidates('2001:db8::/32\n192.0.2.9:2083#保留',25);
  assert.equal(huge.length,25);assert.ok(huge.some(r=>r.address==='192.0.2.9:2083'));
  for(const invalid of ['300.0.0.1','192.0.2.1/33','2001:::1','192.0.2.9-192.0.2.1','[2001:db8::1]:65536'])assert.throws(()=>P.candidates(invalid),/第 1 行/);
  const randomPorts=P.candidates('192.0.2.1\n192.0.2.2\n192.0.2.0/30',10,0);
  assert.equal(randomPorts.length,4,'Random ports must not duplicate overlapping IP candidates');
  assert.ok(randomPorts.every(r=>[443,2053,2083,2087,2096,8443].includes(r.port)));
  assert.equal(P.candidates('192.0.0.0/16',4096).length,4096);
  assert.throws(()=>P.candidates('192.0.2.1',4097),/1–4096/);
  assert.match(P.probeURL({ip:'104.16.0.1',bits:32,port:443},'probe.example.com','ip.json'),/^https:\/\/68100001\.probe\.example\.com:443\/ip.json/);
  assert.throws(()=>P.probeURL({ip:'104.16.0.1',bits:32,port:443},'evil.example/path','ip.json'));
});

test('download speed uses streamed bytes, stops at the byte cap, and never restarts after completion',async()=>{
  await import('../public/assets/speedtest.js');const P=globalThis.BrclioSpeedtest;
  const originalFetch=globalThis.fetch;let calls=0,cancelled=0;
  globalThis.fetch=async()=>{calls++;return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024));},cancel(){cancelled++;}}));};
  try{const result=await P.download({ip:'192.0.2.1',bits:32,port:443},'probe.example.test',new P.ManualRun(),{bytes:4096,seconds:1});assert.equal(result.bytes,4096);assert.ok(result.mbps>0);assert.equal(calls,1);assert.equal(cancelled,1);await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,1);}
  finally{globalThis.fetch=originalFetch;}
});

test('stopping an active download aborts its reader and does not report an invented speed',async()=>{
  await import('../public/assets/speedtest.js');const P=globalThis.BrclioSpeedtest;
  const originalFetch=globalThis.fetch;const run=new P.ManualRun();let aborted=false;
  globalThis.fetch=async(_url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>{aborted=true;controller.error(new DOMException('Stopped','AbortError'));});controller.enqueue(new Uint8Array(1024));}}));
  try{await assert.rejects(()=>P.download({ip:'192.0.2.1',bits:32,port:443},'probe.example.test',run,{bytes:4096,seconds:1},()=>run.stop()),/已停止|Stopped/);assert.equal(aborted,true);assert.equal(run.controllers.size,0);assert.equal(run.readers.size,0);}
  finally{globalThis.fetch=originalFetch;}
});
