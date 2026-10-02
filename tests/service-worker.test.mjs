import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { IdiomManager } from '../public/js/idiom-manager.js';
import { Engine } from '../public/js/engine.js';
const source=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');
const app=await readFile(new URL('../public/js/app.js',import.meta.url),'utf8');
const records=JSON.parse(await readFile(new URL('../public/data/idioms.json',import.meta.url),'utf8'));
const origin='https://tetris.test';
const jsonURL=origin+'/data/idioms.json';

// Run the actual worker with a minimal in-memory Cache API, not a second SW implementation.
function worker() {
 const stores=new Map(),handlers={},requests=[],cacheModes=[];let mode=200;
 const key=req=>new URL(typeof req==='string'?req:req.url,origin+'/').href;
 const network=async req=>{
  const url=key(req);requests.push(url);cacheModes.push(req.cache);
  if(mode==='offline') throw new TypeError('network unavailable');
  if(url===jsonURL) return new Response(mode===200?JSON.stringify(records):'failure',{status:mode===200?200:mode});
  return new Response('<html>game shell</html>',{headers:{'Content-Type':'text/html'}});
 };
 const caches={
  async open(name) {
   if(!stores.has(name)) stores.set(name,new Map());const store=stores.get(name);
   return {
    async match(req){return store.get(key(req))?.clone();},
    async put(req,res){store.set(key(req),res.clone());},
    async addAll(urls){for(const url of urls){const res=await network(url);if(!res.ok)throw Error('HTTP');store.set(key(url),res);}},
   };
  },
  async match(req){for(const store of stores.values())if(store.has(key(req)))return store.get(key(req)).clone();},
  async keys(){return [...stores.keys()];},
  async delete(name){return stores.delete(name);},
 };
 vm.runInNewContext(source,{caches,fetch:network,URL,Request,Response,AbortSignal,console,self:{location:{origin,href:origin+'/sw.js'},addEventListener:(name,fn)=>{handlers[name]=fn;},skipWaiting:async()=>{},clients:{claim:async()=>{}}}});
 async function lifecycle(name){const jobs=[];handlers[name]({waitUntil:p=>jobs.push(p)});await Promise.all(jobs);}
 async function request(url=jsonURL,opts={}) {
  let response;const jobs=[];
  handlers.fetch({request:{url,method:'GET',mode:'cors',...opts},respondWith:p=>{response=p;},waitUntil:p=>jobs.push(p)});
  try{return await response;}finally{await Promise.all(jobs);}
 }
 return {caches,stores,requests,cacheModes,lifecycle,request,setMode:value=>{mode=value;}};
}

for(const readyState of ['complete','loading']) test(`registration after async data load: document ${readyState}`,async()=>{
 let calls=0;const listeners={};
 vm.runInNewContext(app.slice(app.lastIndexOf("if ('serviceWorker' in navigator)")),{
  navigator:{serviceWorker:{register:async()=>{calls++;}}},document:{readyState},
  window:{addEventListener:(event,fn)=>{listeners[event]=fn;}}
 });
 if(readyState==='loading'){assert.equal(calls,0);listeners.load();}
 assert.equal(calls,1);
});
test('first successful installation caches JSON before offline refresh',async()=>{
 const w=worker();await w.lifecycle('install');await w.lifecycle('activate');
 const cached=await w.caches.match(jsonURL);assert.ok(cached,'first load JSON must be available offline');
 assert.deepEqual(await cached.json(),records);
 w.setMode('offline');const m=await IdiomManager.load(jsonURL,w.request);
 for(const record of records)assert.deepEqual(m.getById(record.id),record);
});
for(const status of [404,500]) test(`HTTP ${status} is never cached and later refresh recovers`,async t=>{
 t.mock.method(console,'error',()=>{});
 const w=worker();w.setMode(status);await w.lifecycle('install');await w.lifecycle('activate');
 const fallback=await IdiomManager.load(jsonURL,w.request);
 assert.equal(fallback.getById('idiom_002'),null);assert.equal(fallback.random().word,'一帆风顺');
 assert.equal(await w.caches.match(jsonURL),undefined);
 const e=new Engine({nextIdiom:()=>fallback.random()});e.hardDrop();assert.ok(e.score>0);
 w.setMode(200);const restored=await IdiomManager.load(jsonURL,w.request);
 for(const record of records)assert.deepEqual(restored.getById(record.id),record);
 assert.deepEqual(await (await w.caches.match(jsonURL)).json(),records);
});
test('uncached network failure triggers fallback, never returns HTML as JSON, then recovers',async t=>{
 t.mock.method(console,'error',()=>{});
 const w=worker();w.setMode(404);await w.lifecycle('install');w.setMode('offline');
 const res=await w.request();assert.ok(!res || !res.ok,'JSON failure must not masquerade as successful HTML');
 const fallback=await IdiomManager.load(jsonURL,w.request);assert.equal(fallback.getById('idiom_005'),null);
 assert.equal(await w.caches.match(jsonURL),undefined);
 w.setMode(200);const restored=await IdiomManager.load(jsonURL,w.request);
 assert.equal(restored.getById('idiom_005').word,'海阔天空');
});
test('successful runtime JSON fetch is cached for next refresh',async()=>{
 const w=worker();await w.request();assert.deepEqual(await (await w.caches.match(jsonURL)).json(),records);
});
test('activation removes old caches and keeps only current cache',async()=>{
 const w=worker();await w.caches.open('tetris-v1.5.6-idiom-2');await w.caches.open('tetris-v1.5.6-idiom-3');
 await w.lifecycle('install');await w.lifecycle('activate');
 const names=await w.caches.keys();assert.equal(names.length,1);assert.match(names[0],/zh-offline-6$/);
});
test('ten cached refreshes reuse formal data with no repeated network loads',async()=>{
 const w=worker();await w.lifecycle('install');await w.request();const before=w.requests.length;
 w.setMode('offline');
 for(let i=0;i<10;i++){
  const manager=await IdiomManager.load(jsonURL,w.request);
  assert.equal(manager.getById('idiom_005').word,'海阔天空');
 }
 assert.equal(w.requests.length,before);
});
test('cold offline install fails once without retries or cached fallback',async()=>{
 const w=worker();w.setMode('offline');await assert.rejects(w.lifecycle('install'));
 assert.equal(w.requests.length,1);assert.equal(await w.caches.match(jsonURL),undefined);
});

test('installation reloads shell resources rather than reusing stale HTTP modules',async()=>{
 const w=worker();await w.lifecycle('install');
 assert.ok(w.cacheModes.slice(0,-1).every(mode=>mode==='reload'));
});
