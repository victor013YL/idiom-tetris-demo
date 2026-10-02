import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Sound, STONE_LEVELS} from '../public/js/sound.js';
import {Engine, TOTAL_ROWS} from '../public/js/engine.js';
import {Renderer} from '../public/js/renderer.js';
import {RewardOverlay} from '../public/js/reward-overlay.js';
import {LineClearEffect} from '../public/js/line-clear-effect.js';
import {Input} from '../public/js/input.js';
const app=await readFile(new URL('../public/js/app.js',import.meta.url),'utf8');
const idiom=()=>({id:'test',word:'一帆风顺',characters:[...'一帆风顺']});
function audio() {
 const nodes=[];
 const node=()=>{const n={gain:{},connect(to){this.connected=true;return to;},disconnect(){this.connected=false;},start(){},stop(){this.stopped=true;}};nodes.push(n);return n;};
 const sound=new Sound();sound.ctx={state:'running',sampleRate:24000,destination:{},createGain:node,createBufferSource:node,createBuffer:(c,length,rate)=>({duration:length/rate,getChannelData:()=>new Float32Array(length)})};
 return {sound,nodes};
}
for(const n of [1,2,3,4])test(`${n} lines plays stone level ${n} with bounded duration and gain`,()=>{
 const {sound,nodes}=audio();sound.clear(n);
 assert.equal(sound.clearVoice.level,n);assert.equal(sound.clearVoice.gain.gain.value,STONE_LEVELS[n].gain*sound.sfxVolume);
 assert.ok(Math.abs(sound.clearVoice.source.buffer.duration-STONE_LEVELS[n].duration)<.0001);
 sound.clearVoice.source.onended();assert.equal(sound.clearVoice,null);assert.ok(nodes.every(n=>!n.connected));
});
test('zero/invalid clears and SFX off never create stone nodes',()=>{
 const {sound,nodes}=audio();for(const n of [0,-1,5,1.5,'2',NaN])sound.clear(n);
 sound.enabled=false;sound.clear(4);assert.equal(nodes.length,0);
});
test('repeated stone playback caches four buffers and keeps one live voice',()=>{
 const {sound,nodes}=audio();for(let i=0;i<100;i++)sound.clear(i%4+1);
 assert.equal(sound.stoneBuffers.size,4);assert.equal(nodes.filter(n=>n.connected).length,2);
 sound.stopClear();assert.ok(nodes.every(n=>!n.connected));
});
function harness() {
 const renderer=Object.create(Renderer.prototype);renderer.reward=new RewardOverlay();renderer.effects=new LineClearEffect();
 renderer.drawBoard=renderer.drawHold=renderer.drawNext=()=>{};
 const calls=[],sound={clear:n=>calls.push(n),move(){},rotate(){},drop(){},hold(){},ensure(){}};
 const context={Engine,renderer,sound,idioms:{random:idiom},input:{cancelPending(){}},started:true,stats:{},trackPiece(){},overlayEl:{dataset:{}},requestAnimationFrame(){},formatTime:()=>'',performance:{now:()=>0},$:()=>({}),document:{getElementById:()=>null},hideOverlay(){},pausedScreen(){},settings:{get:()=>false}};
 vm.createContext(context);
 vm.runInContext(app.slice(app.indexOf('const engine = new Engine('),app.indexOf('const sound = new Sound'))+';globalThis.e=engine;',context);
 vm.runInContext(app.slice(app.indexOf('function action(a)'),app.indexOf('// v1.5.6',app.indexOf('function action(a)'))),context);
 vm.runInContext(app.slice(app.indexOf('let last = performance.now();'),app.indexOf('\nrequestAnimationFrame(loop);',app.indexOf('let last = performance.now();'))),context);
 vm.runInContext(app.slice(app.indexOf('function startGame()'),app.indexOf('\ntitleScreen();')),context);
 return {context,engine:context.e,renderer,calls,act:a=>context.action(a),frame:t=>context.loop(t),restart:()=>context.startGame()};
}
function clear(h,n){
 const e=h.engine;e.board=e.board.map(r=>r.map(()=>0));
 for(let y=TOTAL_ROWS-n;y<TOTAL_ROWS;y++)e.board[y]=Array.from({length:10},(_,x)=>x===4?0:{type:'T',character:'一',idiomId:'test'});
 e.current=e.spawn({type:'I',idiom:idiom()});e.rotate();e.current.x=2;h.act('drop');
}
for(const n of [1,2,3,4])test(`production ${n}-line lock freezes and emits one matching sound`,()=>{
 const h=harness();clear(h,n);assert.equal(h.renderer.reward.freezing,true);h.frame(16);h.frame(32);assert.deepEqual(h.calls,[n]);
});
test('production freeze stops gravity and inputs then resumes without catch-up',()=>{
 const h=harness();clear(h,2);const piece=structuredClone(h.engine.current),timer=h.engine.dropTimer;
 for(let t=100;t<=600;t+=100){for(const a of ['left','right','rotate','rotateCCW','soft','drop','hold'])h.act(a);h.frame(t);}
 assert.deepEqual(h.engine.current,piece);assert.equal(h.engine.dropTimer,timer);assert.equal(h.engine.hold,null);assert.equal(h.renderer.reward.freezing,false);
 h.frame(616);assert.equal(h.engine.dropTimer,timer+16);assert.equal(h.engine.current.y,piece.y);
 h.act('left');assert.equal(h.engine.current.x,piece.x-1);
});
test('true Pause preserves reward clock separately; Restart clears both and Hold',()=>{
 const h=harness();h.act('hold');clear(h,4);h.frame(100);h.act('pause');h.frame(200);h.frame(300);
 assert.equal(h.engine.paused,true);assert.equal(h.renderer.reward.current.age,100);
 h.act('pause');h.frame(400);assert.equal(h.renderer.reward.current.age,200);
 h.restart();assert.equal(h.engine.paused,false);assert.equal(h.renderer.reward.freezing,false);assert.equal(h.engine.hold,null);assert.equal(h.renderer.effects.particles.length,0);
});
test('Hold roundtrip preserves Shape, Idiom and Characters in both previews',()=>{
 const h=harness();const original=structuredClone(h.engine.current);h.act('hold');
 assert.equal(h.engine.hold.type,original.type);assert.deepEqual(h.engine.hold.idiom,original.idiom);
 const seen=[];Renderer.prototype.drawHold.call({holdCtx:{},holdCanvas:{},holdCtxMobile:{},holdCanvasMobile:{},drawMini:(ctx,cv,p)=>seen.push(p[0])},h.engine);
 assert.equal(seen.length,2);assert.ok(seen.every(p=>p===h.engine.hold));
 h.act('drop');h.act('hold');assert.equal(h.engine.current.type,original.type);assert.deepEqual(h.engine.current.idiom,original.idiom);
});
test('mini preview trims empty bottom rows so held glyphs use available height',()=>{
 const oldDocument=globalThis.document,oldStyle=globalThis.getComputedStyle;
 globalThis.document={documentElement:{}};globalThis.getComputedStyle=()=>({getPropertyValue:()=> '#55aaff'});
 try {
 const rects=[],ctx=new Proxy({},{get:(_,key)=> (...args)=>{if(key==='fillText')rects.push(args);},set:()=>true});
 const canvas={width:1,height:1,getBoundingClientRect:()=>({width:68,height:44})};
 Renderer.prototype.drawMini.call({style:'flat'},ctx,canvas,[{type:'I',idiom:idiom()}]);
 assert.equal(canvas.width,68);assert.equal(canvas.height,44);
 assert.equal(rects.length,4);assert.deepEqual(rects.map(r=>r[0]),[...'一帆风顺']);
 assert.ok(rects.every(r=>r[2]===22));
 }finally{globalThis.document=oldDocument;globalThis.getComputedStyle=oldStyle;}
});
test('blocked held keys and pending keyboard repeat timers cannot resume later',()=>{
 const listeners={},oldWindow=globalThis.window,oldDocument=globalThis.document;
 globalThis.window={addEventListener:(name,fn)=>listeners[name]=fn};globalThis.document={activeElement:null};
 try {
  let blocked=false;const calls=[];const input=new Input({onAction:a=>calls.push(a),isBlocked:()=>blocked});
  const event=code=>({code,preventDefault(){}});
  listeners.keydown(event('ArrowLeft'));assert.ok(input.dasTimer);
  blocked=true;input.cancelPending();assert.equal(input.dasTimer,null);assert.equal(input.repeatInterval,null);
  listeners.keydown(event('ArrowDown'));listeners.keydown(event('KeyX'));listeners.keydown(event('KeyP'));
  blocked=false;listeners.keydown(event('ArrowLeft'));listeners.keydown(event('ArrowDown'));listeners.keydown(event('KeyX'));
  assert.deepEqual(calls,['left','pause']);assert.equal(input.dasTimer,null);
  listeners.keyup(event('KeyX'));listeners.keydown(event('KeyX'));assert.equal(calls.at(-1),'rotate');input.cancelPending();
 }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;}
});
test('freeze cancels pending virtual-pad repeat and touch long-press',()=>{
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 const padEvents={},touchEvents={},callbacks=new Map();let timerId=0;
 const oldTimeout=globalThis.setTimeout,oldInterval=globalThis.setInterval,oldClearTimeout=globalThis.clearTimeout,oldClearInterval=globalThis.clearInterval;
 globalThis.setTimeout=globalThis.setInterval=fn=>{callbacks.set(++timerId,fn);return timerId;};
 globalThis.clearTimeout=globalThis.clearInterval=id=>callbacks.delete(id);
 globalThis.window={addEventListener(){}};globalThis.document={body:{classList:{add(){},remove(){},contains:()=>false}}};
 try{
  let blocked=false;const calls=[];
  const button={dataset:{action:'left'},addEventListener:(name,fn)=>padEvents[name]=fn};
  const input=new Input({isBlocked:()=>blocked,onAction:a=>calls.push(a),vpadEl:{addEventListener(){},querySelectorAll:()=>[button]},boardEl:{addEventListener:(name,fn)=>touchEvents[name]=fn}});
  padEvents.pointerdown({preventDefault(){}});touchEvents.touchstart({touches:[{clientX:10,clientY:10}]});
  blocked=true;input.cancelPending();blocked=false;
  for(const callback of [...callbacks.values()])callback();
  touchEvents.touchend({changedTouches:[{clientX:10,clientY:10}]});
  assert.deepEqual(calls,['left']);
  blocked=true;padEvents.pointerdown({preventDefault(){}});touchEvents.touchstart({touches:[{clientX:10,clientY:10}]});blocked=false;
  touchEvents.touchend({changedTouches:[{clientX:10,clientY:10}]});assert.deepEqual(calls,['left']);
 }finally{globalThis.window=oldWindow;globalThis.document=oldDocument;globalThis.setTimeout=oldTimeout;globalThis.setInterval=oldInterval;globalThis.clearTimeout=oldClearTimeout;globalThis.clearInterval=oldClearInterval;}
});

test('settings UI freeze stops gravity and all actions, then resumes without catch-up',()=>{
 const h=harness();const before=structuredClone(h.engine.current),timer=h.engine.dropTimer;
 h.context.input.uiFrozen=true;
 for(let t=100;t<=3000;t+=100){for(const a of ['left','right','rotate','rotateCCW','soft','drop','hold','pause'])h.act(a);h.frame(t);}
 assert.deepEqual(h.engine.current,before);assert.equal(h.engine.dropTimer,timer);assert.equal(h.engine.paused,false);
 h.context.input.uiFrozen=false;h.frame(3016);assert.equal(h.engine.dropTimer,timer+16);
 assert.deepEqual(h.engine.current,before);h.act('left');assert.equal(h.engine.current.x,before.x-1);
});
test('Restart clears settings freeze and its dialog independently from Pause',()=>{
 const h=harness();let closed=0;h.context.input.closeUI=()=>closed++;
 h.context.input.uiFrozen=true;h.engine.paused=true;h.renderer.reward.show(4);h.restart();
 assert.equal(h.context.input.uiFrozen,false);assert.equal(h.engine.paused,false);assert.equal(h.renderer.reward.current,null);assert.equal(closed,1);
});
test('settings freeze holds reward and effects clocks without modifying user Pause',()=>{
 const h=harness();clear(h,4);h.frame(100);h.context.input.uiFrozen=true;h.frame(200);h.frame(300);
 assert.equal(h.renderer.reward.current.age,100);assert.equal(h.engine.paused,false);
 h.context.input.uiFrozen=false;h.frame(400);assert.equal(h.renderer.reward.current.age,200);
});
test('reward stays visible after 600ms freeze and clears at 1600ms',()=>{
 const h=harness();clear(h,4);for(let t=100;t<=600;t+=100)h.frame(t);
 assert.equal(h.renderer.reward.freezing,false);assert.ok(h.renderer.reward.current);
 const timer=h.engine.dropTimer;h.frame(700);assert.equal(h.engine.dropTimer,timer+100);
 for(let t=800;t<=1600;t+=100)h.frame(t);assert.equal(h.renderer.reward.current,null);
});
