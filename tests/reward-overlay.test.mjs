import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { Engine, TOTAL_ROWS } from '../public/js/engine.js';
import { Renderer } from '../public/js/renderer.js';
import { LineClearEffect } from '../public/js/line-clear-effect.js';
import { RewardOverlay, REWARD_MS } from '../public/js/reward-overlay.js';
const app=await readFile(new URL('../public/js/app.js',import.meta.url),'utf8');
const idiom=()=>({id:'idiom_001',word:'一帆风顺',characters:[...'一帆风顺']});
for(const [count,phrase] of [[0,null],[1,'万里挑一'],[2,'全军出击'],[3,'飞龙在天'],[4,'势如破竹']]) {
 test(`${count} lines maps only to ${phrase}`,()=>{
  const reward=new RewardOverlay();assert.equal(reward.show(count),count>0);
  assert.equal(reward.current?.phrase??null,phrase);
 });
}
test('invalid clear counts never create rewards',()=>{
 const reward=new RewardOverlay();
 for(const value of [-1,5,1.5,NaN,Infinity,'1','constructor',null,undefined,{},[],true]){
  assert.equal(reward.show(value),false);assert.equal(reward.current,null);
 }
});
test('new reward replaces old phrase and resets its timer without stacking',()=>{
 const reward=new RewardOverlay();reward.show(1);reward.update(350);reward.show(2);
 assert.deepEqual(reward.current,{phrase:'全军出击',age:0});
 reward.update(REWARD_MS-1);assert.ok(reward.current);reward.update(1);assert.equal(reward.current,null);
});
test('zero-line lock does not retrigger an existing reward',()=>{
 const reward=new RewardOverlay();reward.show(4);reward.update(300);reward.show(0);
 assert.deepEqual(reward.current,{phrase:'势如破竹',age:300});
});
for(const n of [0,1,2,3,4]) test(`actual app callback: ${n}-line lock ignores historical line total`,()=>{
 const reward=new RewardOverlay(),calls=[];const original=reward.show.bind(reward);
 reward.show=(count,flags)=>{calls.push(count);return original(count,flags);};
 const renderer={effects:new LineClearEffect(),reward};
 const code=app.slice(app.indexOf('const engine = new Engine('),app.indexOf('const sound = new Sound'));
 const e=vm.runInNewContext(`${code};engine`,{input:{cancelPending(){}},Engine,idioms:{random:idiom},renderer});
 e.lines=100;
 for(let y=TOTAL_ROWS-n;y<TOTAL_ROWS;y++)e.board[y]=Array.from({length:10},(_,x)=>x===4?0:{type:'T',character:'一',idiomId:'idiom_001'});
 e.current=e.spawn({type:'I',idiom:idiom()});e.rotate();e.current.x=2;e.current.y=2;e.hardDrop();
 assert.deepEqual(calls,n?[n]:[]);assert.equal(e.lines,100+n);
 assert.equal(reward.current?.phrase??null,[null,'万里挑一','全军出击','飞龙在天','势如破竹'][n]);
 assert.equal(e.move(-1),true);
});
test('production Restart clears reward immediately',()=>{
 const renderer={effects:new LineClearEffect(),reward:new RewardOverlay()};renderer.reward.show(3);
 const engine=new Engine({nextIdiom:idiom});
 const start=app.slice(app.indexOf('function startGame()'),app.indexOf('\ntitleScreen();'));
 vm.runInNewContext(`${start};startGame();`,{input:{cancelPending(){}},engine,renderer,stats:{},hideOverlay(){},sound:{ensure(){},stopRotate(){}},settings:{get:()=>false}});
 assert.equal(renderer.reward.current,null);
});
test('reward does not modify Board',()=>{
 const engine=new Engine({nextIdiom:idiom});engine.hardDrop();const before=structuredClone(engine.board);
 const reward=new RewardOverlay();reward.show(2,engine);reward.update(300);reward.clear();
 assert.deepEqual(engine.board,before);
});
test('reward does not modify current, Next or Hold idiom data',()=>{
 const engine=new Engine({nextIdiom:idiom});engine.holdPiece();
 const before=structuredClone({current:engine.current,queue:engine.queue,hold:engine.hold});
 const reward=new RewardOverlay();reward.show(4,engine);reward.update(REWARD_MS);
 assert.deepEqual({current:engine.current,queue:engine.queue,hold:engine.hold},before);
});
test('Pause and Game Over reject new rewards; paused rendering holds the timer',()=>{
 const renderer=Object.create(Renderer.prototype);renderer.effects=new LineClearEffect();renderer.reward=new RewardOverlay();
 renderer.drawBoard=renderer.drawHold=renderer.drawNext=()=>{};
 renderer.reward.show(1);renderer.reward.update(200);
 assert.equal(renderer.reward.show(2,{paused:true}),false);
 renderer.draw({paused:true},500);assert.equal(renderer.reward.current.age,200);
 assert.equal(renderer.reward.show(4,{gameOver:true}),false);
 renderer.draw({paused:false,gameOver:true},REWARD_MS);assert.equal(renderer.reward.current,null);
});
test('1000 replacements still use one state and empty drawing is safe',()=>{
 const reward=new RewardOverlay();reward.draw(null,200,400);
 for(let i=0;i<1000;i++)reward.show(i%4+1);
 assert.deepEqual(reward.current,{phrase:'势如破竹',age:0});
 reward.update(REWARD_MS);reward.draw(null,200,400);assert.equal(reward.current,null);
});
test('drawing is clipped, positioned above center, and restores canvas state',()=>{
 const calls=[],ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
 const reward=new RewardOverlay();reward.show(3);reward.update(160);reward.draw(ctx,200,400);
 assert.ok(calls.some(c=>c[0]==='clip'));
 assert.deepEqual(calls.find(c=>c[0]==='translate'),['translate',100,72]);
 assert.deepEqual(calls.find(c=>c[0]==='fillText'),['fillText','飞 龙 在 天',0,0]);
 assert.equal(calls.at(-1)[0],'restore');
});
