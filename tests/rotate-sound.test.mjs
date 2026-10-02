import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {Sound} from '../public/js/sound.js';
import {Engine} from '../public/js/engine.js';
const app=await readFile(new URL('../public/js/app.js',import.meta.url),'utf8');
const actionCode=app.slice(app.indexOf('function action(a)'),app.indexOf('// v1.5.6',app.indexOf('function action(a)')));
const idiom=()=>({id:'test',word:'abcd',characters:[...'abcd']});
function actionHarness(type='T') {
 const engine=new Engine({nextIdiom:idiom});engine.current=engine.spawn({type,idiom:idiom()});
 const calls=[];const sound={rotate:()=>calls.push('rotate'),hold(){},drop(){},move(){}};
 const context={input:{cancelPending(){}},renderer:{reward:{freezing:false}},engine,sound,started:true,stats:{rotates:0},startGame(){},pausedScreen(){},hideOverlay(){}};
 return {engine,calls,act:vm.runInNewContext(actionCode+';action',context)};
}
for(const action of ['rotate','rotateCCW'])test(`${action}: successful actual action plays exactly once`,()=>{
 const h=actionHarness();h.act(action);assert.deepEqual(h.calls,['rotate']);
 assert.equal(h.engine.current.rot,action==='rotate'?1:3);
});
test('blocked rotation is silent',()=>{
 const h=actionHarness();h.engine.current.y=10;
 h.engine.board=h.engine.board.map(row=>row.map(()=>({type:'J',character:'a'})));
 for(const [y,row] of h.engine.current.matrix.entries())for(const [x,value] of row.entries())if(value)h.engine.board[h.engine.current.y+y][h.engine.current.x+x]=0;
 h.act('rotate');h.act('rotateCCW');assert.deepEqual(h.calls,[]);assert.equal(h.engine.current.rot,0);
});
test('O, Pause and Game Over do not play rotation sound',()=>{
 const h=actionHarness('O');h.act('rotate');h.act('rotateCCW');
 h.engine.current=h.engine.spawn({type:'T',idiom:idiom()});h.engine.paused=true;h.act('rotate');
 h.engine.paused=false;h.engine.gameOver=true;h.act('rotateCCW');assert.deepEqual(h.calls,[]);
});
test('Hold and Hard Drop never call rotation sound',()=>{
 const h=actionHarness();h.act('hold');h.act('drop');assert.deepEqual(h.calls,[]);
});
function audioHarness() {
 const nodes=[];
 const parameter=()=>({value:0,calls:[],cancelAndHoldAtTime(...v){this.calls.push(['hold',...v]);},cancelScheduledValues(...v){this.calls.push(['cancel',...v]);},setValueAtTime(...v){this.calls.push(['set',...v]);},linearRampToValueAtTime(...v){this.calls.push(['linear',...v]);},exponentialRampToValueAtTime(...v){this.calls.push(['exponential',...v]);}});
 const node=kind=>{const n={kind,frequency:parameter(),gain:parameter(),connected:false,connect(to){this.connected=true;return to;},disconnect(){this.connected=false;},start(){},stop(t){this.stopAt=t;}};nodes.push(n);return n;};
 const ctx={state:'running',currentTime:0,destination:{},createOscillator:()=>node('oscillator'),createGain:()=>node('gain'),resume(){this.state='running';return Promise.resolve();}};
 const sound=new Sound();sound.ctx=ctx;return {sound,ctx,nodes};
}
test('rotate uses quiet 820 to 520Hz square with 60ms envelope',()=>{
 const {sound}=audioHarness();sound.rotate();const {oscillator,gain,end}=sound.rotateVoice;
 assert.equal(oscillator.type,'square');assert.equal(end,.065);
 assert.ok(oscillator.frequency.calls.some(c=>c[0]==='set'&&c[1]===820));
 assert.ok(oscillator.frequency.calls.some(c=>c[0]==='exponential'&&c[1]===520&&c[2]===.06));
 assert.ok(gain.gain.calls.some(c=>c[0]==='linear'&&c[1]===.025*sound.sfxVolume&&c[2]===.003));
 assert.ok(gain.gain.calls.some(c=>c[0]==='exponential'&&c[1]===.0001&&c[2]===.06));
});
test('1000 rapid rotations reuse one voice and release both nodes on end',()=>{
 const {sound,ctx,nodes}=audioHarness();
 for(let i=0;i<1000;i++){ctx.currentTime=i*.001;sound.rotate();assert.equal(nodes.length,2);}
 const voice=sound.rotateVoice;voice.oscillator.onended();assert.equal(sound.rotateVoice,null);
 assert.ok(nodes.every(n=>!n.connected));
});
test('delayed ended callbacks cannot clear a newer voice',()=>{
 const {sound,ctx,nodes}=audioHarness();sound.rotate();const old=sound.rotateVoice;
 ctx.currentTime=.1;sound.rotate();const current=sound.rotateVoice;old.oscillator.onended();
 assert.equal(sound.rotateVoice,current);assert.equal(nodes.filter(n=>n.connected).length,2);
 sound.stopRotate();sound.stopRotate();assert.equal(sound.rotateVoice,null);assert.ok(nodes.every(n=>!n.connected));
});
test('production Restart stops old rotate voice and allows next rotation',()=>{
 const {sound,nodes}=audioHarness();sound.rotate();
 const start=app.slice(app.indexOf('function startGame()'),app.indexOf('\ntitleScreen();'));
 vm.runInNewContext(start+';startGame();',{input:{cancelPending(){}},sound,engine:new Engine({nextIdiom:idiom}),renderer:{effects:{clear(){}},reward:{clear(){}}},stats:{},hideOverlay(){},settings:{get:()=>false}});
 assert.equal(sound.rotateVoice,null);assert.ok(nodes.every(n=>!n.connected));sound.rotate();assert.ok(sound.rotateVoice);
});
test('disabled or unavailable audio is harmless',()=>{
 const {sound,nodes}=audioHarness();sound.enabled=false;sound.rotate();assert.equal(nodes.length,0);
 sound.enabled=true;sound.ctx=null;sound.ensure=()=>{};assert.doesNotThrow(()=>sound.rotate());
});
test('suspended context resumes; denied resume never queues voices',async()=>{
 const {sound,ctx,nodes}=audioHarness();ctx.state='suspended';sound.rotate();assert.equal(ctx.state,'running');assert.equal(nodes.length,2);sound.stopRotate();
 ctx.state='suspended';ctx.resume=()=>Promise.reject(new Error('blocked'));sound.rotate();await Promise.resolve();assert.equal(sound.rotateVoice,null);assert.equal(nodes.length,2);
});

test('start remains compatible with a previous cached Sound module',()=>{
 const start=app.slice(app.indexOf('function startGame()'),app.indexOf('\ntitleScreen();'));
 assert.doesNotThrow(()=>vm.runInNewContext(start+';startGame();',{input:{cancelPending(){}},sound:{ensure(){}},engine:new Engine({nextIdiom:idiom}),renderer:{effects:{clear(){}},reward:{clear(){}}},stats:{},hideOverlay(){},settings:{get:()=>false}}));
});
