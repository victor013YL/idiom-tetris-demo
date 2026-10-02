import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Sound} from '../public/js/sound.js';
import {RewardOverlay,REWARD_MS,REWARD_FREEZE_MS} from '../public/js/reward-overlay.js';
const app=await readFile(new URL('../public/js/app.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/css/game.css',import.meta.url),'utf8');
const storage=await readFile(new URL('../public/js/storage.js',import.meta.url),'utf8');
test('independent music and SFX defaults and channel changes',()=>{
 const s=new Sound();assert.equal(s.musicVolume,.4);assert.equal(s.sfxVolume,.75);
 s.audio={volume:.4};s.setVolume('musicVolume',0);assert.equal(s.audio.volume,0);assert.equal(s.sfxVolume,.75);
 s.setVolume('sfxVolume',0);assert.equal(s.musicVolume,0);s.setVolume('musicVolume',.8);assert.equal(s.sfxVolume,0);
 assert.equal(s.audio.volume,.8);
});
test('zero SFX creates no blip, rotation or stone audio nodes, Music state preserved',()=>{
 const s=new Sound();s.music=true;s.setVolume('sfxVolume',0);s.ensure=()=>{throw Error('unexpected audio node');};
 for(const action of ['move','rotate','drop','hold','lock'])assert.doesNotThrow(()=>s[action]());
 assert.doesNotThrow(()=>s.clear(4));assert.equal(s.music,true);assert.equal(s.enabled,true);
});
test('music disabled only pauses music; SFX switch does not change music',()=>{
 const s=new Sound();let pauses=0;s.audio={pause(){pauses++;}};s.setMusic(false);assert.equal(pauses,1);assert.equal(s.enabled,true);
 s.enabled=false;s.music=true;assert.equal(s.music,true);
});
test('volume clamping and invalid values are safe',()=>{
 const s=new Sound();s.setVolume('sfxVolume',2);assert.equal(s.sfxVolume,1);s.setVolume('musicVolume',-1);assert.equal(s.musicVolume,0);
 s.setVolume('musicVolume',NaN);assert.equal(s.musicVolume,0);
});
test('volume preferences persist and old saves receive defaults',()=>{
 let value='{"music":false}';const localStorage={getItem:()=>value,setItem:(k,v)=>value=v};
 const load=()=>vm.runInNewContext(storage.replace('export const settings','const settings')+';settings',{localStorage});
 let settings=load();assert.equal(settings.get('musicVolume'),.4);assert.equal(settings.get('sfxVolume'),.75);
 settings.patch({musicVolume:.2,sfxVolume:0});settings=load();assert.equal(settings.get('musicVolume'),.2);assert.equal(settings.get('sfxVolume'),0);assert.equal(settings.get('music'),false);
});
test('settings opening and all close paths cancel pending input',()=>{
 const start=app.slice(app.indexOf("$('#btn-settings').addEventListener"),app.indexOf('// Live-update'));
 assert.match(start,/input.cancelPending\(\)/);assert.match(start,/input.uiFrozen = true/);
 const close=app.slice(app.indexOf("settingsDialog.addEventListener('close'"),app.indexOf('// Quick-access'));
 assert.ok(close.indexOf('input.cancelPending()')<close.indexOf("returnValue !== 'save'"));
 assert.ok(close.indexOf('input.uiFrozen = false')<close.indexOf("returnValue !== 'save'"));
});
test('reward duration and frozen phase have separate bounds',()=>{
 assert.equal(REWARD_MS,1600);assert.equal(REWARD_FREEZE_MS,600);
 const r=new RewardOverlay();r.show(1);r.update(599);assert.equal(r.freezing,true);r.update(1);assert.equal(r.freezing,false);assert.ok(r.current);
 r.update(1000);assert.equal(r.current,null);
});
test('phone border is independent of canvas with explicit sizing and contrast',()=>{
 const rule=css.slice(css.indexOf('/* Keep the physical playfield'));
 assert.match(rule,/border: 2px solid #8b9fbd/);assert.match(rule,/width: calc\(var\(--board-w\) \+ 4px\)/);
 assert.match(rule,/height: calc\(var\(--board-h\) \+ 4px\)/);assert.match(rule,/box-sizing: border-box/);
 assert.ok(!css.includes('body.dialog-open .mobile-bar,'));
});

test('SFX gain follows SFX slider while music volume is zero',()=>{
 const s=new Sound();const values=[];const param={setValueAtTime:v=>values.push(v),exponentialRampToValueAtTime(){}};
 const gain={gain:param,connect:to=>to};const osc={frequency:{},connect:to=>to,start(){},stop(){}};
 s.ctx={currentTime:0,state:'running',destination:{},createGain:()=>gain,createOscillator:()=>osc};
 s.setVolume('musicVolume',0);s.setVolume('sfxVolume',.8);s.drop();assert.equal(values[0],.07*.8);
 assert.equal(s.musicVolume,0);
});

const {Renderer}=await import('../public/js/renderer.js');
const {Input}=await import('../public/js/input.js');
for(const dpr of [1,2,3])test(`DPR ${dpr} changes bitmap only, preserving CSS board bounds`,()=>{
 const previous=globalThis.window;globalThis.window={devicePixelRatio:dpr};
 try{const scale=Math.min(dpr,2),transforms=[];const cv={getBoundingClientRect:()=>({width:300,height:600}),getContext:()=>({setTransform:(...v)=>transforms.push(v)})};
 Renderer.prototype.resize.call({canvas:cv,holdCanvas:cv,nextCanvas:cv});assert.equal(cv.width,300*scale);assert.equal(cv.height,600*scale);assert.deepEqual(transforms[0],[scale,0,0,scale,0,0]);
 }finally{globalThis.window=previous;}
});
test('open dialog range and Escape retain native controls without game actions',()=>{
 const previousWindow=globalThis.window,previousDocument=globalThis.document,listeners={};
 globalThis.window={addEventListener:(name,fn)=>listeners[name]=fn};globalThis.document={activeElement:null};
 try{const actions=[];const input=new Input({onAction:a=>actions.push(a),isBlocked:()=>true});
 let prevented=0;for(const code of ['ArrowLeft','ArrowRight','Escape','KeyP'])listeners.keydown({code,target:{closest:()=>({})},preventDefault(){prevented++;}});
 assert.equal(prevented,0);assert.deepEqual(actions,[]);assert.equal(input.dasTimer,null);
 }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});
test('keys held while settings closes cannot replay; releasing inside dialog clears them',()=>{
 const previousWindow=globalThis.window,previousDocument=globalThis.document,listeners={};
 globalThis.window={addEventListener:(name,fn)=>listeners[name]=fn};globalThis.document={activeElement:null};
 try{const actions=[],input=new Input({onAction:a=>actions.push(a)});const inDialog={code:'ArrowLeft',target:{closest:()=>({})},preventDefault(){}};
 listeners.keydown(inDialog);listeners.keydown({code:'ArrowLeft',preventDefault(){}});assert.deepEqual(actions,[]);
 listeners.keyup(inDialog);assert.equal(input.blockedKeys.has('ArrowLeft'),false);
 listeners.keydown({code:'ArrowLeft',preventDefault(){}});assert.deepEqual(actions,['left']);input.cancelPending();
 }finally{globalThis.window=previousWindow;globalThis.document=previousDocument;}
});
