// Appended by the test-only server, runs the real action/input/loop/render code.
const panel=document.createElement('aside');
panel.style.cssText='position:fixed;bottom:4px;left:4px;z-index:100;background:#142030;color:white;padding:8px;font:12px sans-serif;max-width:310px;max-height:45vh;overflow:auto';
panel.innerHTML='<b>碎石音 / 奖励停顿验证</b><div id="test-buttons"></div><pre id="test-result" style="white-space:pre-wrap"></pre><div id="test-frames" style="display:flex"></div>';
document.body.append(panel);
let sample=null, history=[], clearCalls=[], testTimers=[];
const originalClear=sound.clear.bind(sound);
sound.clear=n=>{originalClear(n);clearCalls.push({level:n,voice:sound.clearVoice?.level??null,context:sound.ctx?.state});};
function testButton(label,fn){const b=document.createElement('button');b.textContent=label;b.style.cssText='padding:5px;margin:3px;color:white;background:#345';b.onclick=fn;panel.querySelector('#test-buttons').append(b);}
function prepare(n){
 testTimers.forEach(clearTimeout);testTimers=[];startGame();clearCalls=[];history=[];
 panel.querySelector('#test-frames').replaceChildren();
 engine.board=engine.board.map(row=>row.map(()=>0));
 for(let y=engine.board.length-n;y<engine.board.length;y++)for(let x=0;x<10;x++)if(x!==4)engine.board[y][x]={type:['T','I','L','S','Z'][x%5],character:[...'一帆风顺'][x%4],idiomId:'idiom_001'};
 engine.current=engine.spawn({type:'I',idiom:idioms.getById('idiom_001')});engine.rotate();engine.current.x=2;
 action('drop');sample={start:performance.now(),n,initial:JSON.stringify(engine.current),timer:engine.dropTimer,changed:false,end:null,marks:[],frames:[],draw:[]};
}
for(const n of [1,2,3,4])testButton(n+'行',()=>prepare(n));
testButton('冻结乱按',()=>{prepare(2);for(let i=0;i<30;i++)testTimers.push(setTimeout(()=>{for(const code of ['ArrowLeft','ArrowDown','KeyX','Space','KeyC'])window.dispatchEvent(new KeyboardEvent('keydown',{code}));},i*15));testTimers.push(setTimeout(()=>{for(const code of ['ArrowLeft','ArrowDown','KeyX','Space','KeyC'])window.dispatchEvent(new KeyboardEvent('keyup',{code}));},800));});
testButton('中途Restart',()=>{prepare(4);testTimers.push(setTimeout(()=>{startGame();history.push('Restart:'+JSON.stringify({freeze:renderer.reward.freezing,hold:engine.hold,particles:renderer.effects.particles.length}));sample=null;},250));});
testButton('P暂停',()=>action('pause'));
testButton('C Hold',()=>{action('hold');history.push('Hold:'+JSON.stringify(engine.hold));});
testButton('落块再换回',()=>{action('drop');action('hold');history.push('换回:'+JSON.stringify({type:engine.current.type,idiom:engine.current.idiom}));});
testButton('重新开始',()=>{startGame();sample=null;history=[];});
testButton('SFX开关',()=>{sound.enabled=!sound.enabled;if(!sound.enabled)sound.stopClear();});
const realDraw=renderer.draw.bind(renderer);
renderer.draw=(e,dt)=>{const before=renderer.reward.freezing,t=performance.now();realDraw(e,dt);
 if(sample&&!sample.end){sample.frames.push(dt);sample.draw.push(performance.now()-t);if(before&&(JSON.stringify(engine.current)!==sample.initial||engine.dropTimer!==sample.timer))sample.changed=true;
  const elapsed=performance.now()-sample.start;
  for(const mark of [140,380])if(elapsed>=mark&&!sample.marks.includes(mark)){sample.marks.push(mark);const image=document.createElement('img');image.src=renderer.canvas.toDataURL();image.style.width='70px';image.alt=mark+'ms奖励截图';panel.querySelector('#test-frames').append(image);}
  if(!renderer.reward.freezing){sample.end=elapsed;sample.yAtEnd=engine.current.y;}
 }
 const p95=a=>a.length?[...a].sort((a,b)=>a-b)[Math.floor((a.length-1)*.95)].toFixed(2):null;
 panel.querySelector('#test-result').textContent=JSON.stringify({settingsFreeze:!!input.uiFrozen,musicVolume:sound.musicVolume,sfxVolume:sound.sfxVolume,music:sound.music,freeze:renderer.reward.freezing,paused:engine.paused,reward:renderer.reward.current,hold:engine.hold,SFX:sound.enabled,clearCalls,liveStone:!!sound.clearVoice,particles:renderer.effects.particles.length,y:engine.current?.y,dropTimer:Math.round(engine.dropTimer),sample:sample&&{lines:sample.n,freezeMs:sample.end,frozenPieceChanged:sample.changed,drawP95:p95(sample.draw),frameP95:p95(sample.frames)},history},null,1);
};
