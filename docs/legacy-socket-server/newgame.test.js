// Plays a 2-player game to the end over sockets, then the host starts a new game from the winner screen. Server must be running.
const { io } = require('socket.io-client'); const assert = require('assert');
const URL=process.env.URL||'http://localhost:8001'; const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function client(){ const s=io(URL,{transports:['websocket']}); const c={s,state:null,room:null,id:null}; s.on('room',r=>{c.room=r;c.id=r.you;}); s.on('state',st=>{c.state=st;}); c.call=(ev,d)=>new Promise(res=>s.emit(ev,d||{},res)); return c; }
(async()=>{
  const A=client(),B=client(); await sleep(200);
  const r1=await A.call('create_room',{name:'Host'}); const r2=await B.call('join_room',{name:'Guest',code:r1.code}); await B.call('toggle_ready'); await sleep(100);
  assert.ok((await A.call('start_game')).ok); await sleep(200);
  // Non-host cannot start new game mid-game
  let r=await B.call('new_game'); assert.equal(r.ok,false);
  // Play until someone wins: each turn, active player Paid Kills when possible, else Income; targets choose index 0.
  const byId=id=>A.id===id?A:B; let guard=0; const GUARD=6000;
  while(A.state.phase==='playing' && guard++<GUARD){
    const st=A.state; const p=st.pending; if(!p){await sleep(20);continue;}
    const act=byId(p.actorId); const w=p.window;
    if(p.stage==='turn'){ const me=act.state.you; const other=st.players.find(x=>x.id!==act.id); await act.call('game_action', me.coins>=7?{type:'paidkill',targetId:other.id}:{type:'income'}); }
    else if(w&&w.type==='decision'){ await byId(w.playerId).call('game_decision',{index:0}); }
    await sleep(40);
  }
  assert.equal(A.state.phase,'ended'); const firstWinner=A.state.winnerId; console.log('game 1 ended, winner', firstWinner===A.id?'Host':'Guest');
  r=await A.call('new_game'); assert.ok(r.ok, r.error); await sleep(300);
  assert.equal(A.state.phase,'playing'); assert.equal(B.state.phase,'playing');
  assert.ok(A.state.players.every(p=>p.alive && p.coins===2 && p.cardCount===3), 'fresh deal');
  assert.ok(A.state.you.cards.length===3);
  console.log('✓ host started a new game straight from the winner screen; fresh deal for', A.state.players.length,'players');
  A.s.close(); B.s.close(); process.exit(0);
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
