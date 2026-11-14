/*
  SUMIT CHAT: React frontend + Node.js backend + SQLite database in ONE file.
  No npm install needed.

  RUN (PowerShell):
    cd to the folder that contains this file   (check with: dir)
    node sumit_chat.js
    open http://localhost:3000

  Needs Node.js 22.13 or newer (you have 22.14, good). Check with: node -v
  Creates: sumit_chat.db (database) and sumit_chat_uploads/ (photos & videos).
  Camera/mic work on http://localhost, or on any https:// address.
*/
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); }
catch (e) { console.log('This app needs Node.js 22.13+ (built-in SQLite). Run "node -v" to check, or install the latest LTS from nodejs.org'); process.exit(1); }

const PORT = process.env.PORT || 3000;
const UP = path.join(__dirname, 'sumit_chat_uploads');
fs.mkdirSync(UP, { recursive: true });

// ===================== DATABASE (SQLite) =====================
const db = new DatabaseSync(path.join(__dirname, 'sumit_chat.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- 1 username = 1 account
  salt TEXT NOT NULL, hash TEXT NOT NULL,
  device_id TEXT NOT NULL UNIQUE,                 -- 1 device = 1 account
  created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created INTEGER);
CREATE TABLE IF NOT EXISTS media(name TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER, owner INTEGER REFERENCES users(id), created INTEGER);
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender INTEGER NOT NULL REFERENCES users(id),
  recipient INTEGER REFERENCES users(id),         -- NULL = public room "Everyone"
  kind TEXT NOT NULL, body TEXT, media TEXT, time INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_msg ON messages(recipient, id);
`);

// ===================== FRONTEND (React) =====================
const PAGE = String.raw`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sumit Chat</title>
<style>
:root{--ink:#eef2f7;--mut:#94a3b8;--acc:#5eead4;--pan:#111827;--bd:rgba(255,255,255,.1)}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b0f19;color:var(--ink)}
button,input,select{font:inherit}
button{cursor:pointer;border:0;border-radius:10px;padding:9px 14px;background:var(--acc);color:#052b27;font-weight:600}
button.g{background:rgba(255,255,255,.12);color:var(--ink)}button.r{background:#ef4444;color:#fff}
input[type=text],input[type=password]{width:100%;padding:11px;margin:6px 0 12px;border-radius:10px;border:1px solid var(--bd);background:rgba(0,0,0,.35);color:var(--ink)}
#app{display:flex;height:100%}#side{width:300px;background:var(--pan);border-right:1px solid var(--bd);display:flex;flex-direction:column}
#main{flex:1;display:flex;flex-direction:column;min-width:0}
.top{padding:12px 14px;border-bottom:1px solid var(--bd);display:flex;gap:8px;align-items:center}.top b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bk{display:none}#list{overflow:auto;flex:1}
.it{padding:12px 14px;display:flex;gap:8px;align-items:center;cursor:pointer;border-bottom:1px solid var(--bd)}.it:hover,.it.on{background:rgba(255,255,255,.07)}
.it span.n{flex:1}.dot{width:9px;height:9px;border-radius:50%;background:#475569}.dot.on{background:#22c55e}
.live{background:#ef4444;color:#fff;font-size:11px;padding:2px 7px;border-radius:99px;cursor:pointer}.un{background:var(--acc);color:#052b27;border-radius:99px;font-size:12px;padding:1px 8px;font-weight:700}
#msgs{flex:1;overflow:auto;padding:14px;background:var(--bgc,#0b0f19)}
.m{max-width:min(520px,85%);margin:0 0 10px;padding:8px 12px;border-radius:14px;background:rgba(255,255,255,.1);word-break:break-word}
.m.me{margin-left:auto;background:rgba(94,234,212,.22)}.m small{display:block;color:var(--mut);font-size:11px}.m img,.m video{max-width:100%;max-height:320px;border-radius:10px;display:block;margin-top:4px}
.bar{display:flex;gap:8px;padding:10px;border-top:1px solid var(--bd);background:var(--pan)}.bar input{margin:0;flex:1}
.err{color:#fca5a5;font-size:13px;padding:0 12px}
.ov{position:fixed;inset:0;background:#000d;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px}
.ov video{max-width:100%;max-height:70vh;background:#000;border-radius:12px}.ov .pip{position:absolute;right:14px;top:14px;width:140px;border-radius:10px}
.box{background:var(--pan);border:1px solid var(--bd);border-radius:16px;padding:22px;width:min(380px,100%)}
#auth{height:100%;display:flex;align-items:center;justify-content:center;padding:16px}
@media(max-width:700px){#side{width:100%}#app.open #side{display:none}#app:not(.open) #main{display:none}.bk{display:inline-block}}
</style></head><body><div id="root" style="height:100%"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>
if(!window.React||!window.ReactDOM){document.getElementById('root').innerHTML='<p style="padding:30px">Could not load React. Check your internet and refresh.</p>';}
else{(function(){
var h=React.createElement,uS=React.useState,uE=React.useEffect,uR=React.useRef;
var ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
var BGS=['#0b0f19','linear-gradient(135deg,#0f2027,#2c5364)','linear-gradient(135deg,#3a1c71,#d76d77)','linear-gradient(135deg,#134e5e,#71b280)'];
var DEV=null;try{DEV=localStorage.getItem('dev')}catch(e){}
function api(p,m,b){var hd={'Content-Type':'application/json'};if(DEV)hd['x-device']=DEV;
 return fetch('/api/'+p,{method:m||'GET',headers:hd,body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().then(function(j){j.ok=r.ok;return j})}).catch(function(){return {ok:false,error:'Cannot reach server'}})}
function Vid(p){var r=uR();uE(function(){if(r.current)r.current.srcObject=p.stream||null},[p.stream]);
 return h('video',{ref:r,autoPlay:true,playsInline:true,muted:!!p.muted,className:p.cls})}
function gum(){return navigator.mediaDevices.getUserMedia({video:true,audio:true})}

function Auth(p){
 var a=uS(p.deviceUser?'login':'register'),mode=a[0],setMode=a[1],u=uS(''),user=u[0],setUser=u[1],w=uS(''),pw=w[0],setPw=w[1],e=uS(''),err=e[0],setErr=e[1];
 function go(){api(mode,'POST',{username:user,password:pw}).then(function(r){if(!r.ok){setErr(r.error||'Error');if(r.deviceUser)setMode('login')}else p.onDone(r.user)})}
 var reg=mode==='register',key=function(ev){if(ev.key==='Enter')go()};
 return h('div',{id:'auth'},h('div',{className:'box'},h('h2',{style:{marginTop:0}},'Sumit Chat — '+(reg?'Register':'Login')),
  p.deviceUser&&h('p',{style:{color:'#94a3b8',fontSize:14}},'This device already has an account: '+p.deviceUser+'. Only one account per device is allowed.'),
  h('label',null,'Username'),h('input',{type:'text',maxLength:20,value:user,onChange:function(x){setUser(x.target.value)},onKeyDown:key}),
  h('label',null,'Password'),h('input',{type:'password',value:pw,onChange:function(x){setPw(x.target.value)},onKeyDown:key}),
  h('div',{className:'err',style:{padding:'0 0 10px'}},err),
  h('button',{onClick:go},reg?'Create account':'Login'),' ',
  !p.deviceUser&&h('button',{className:'g',onClick:function(){setMode(reg?'login':'register');setErr('')}},reg?'I have an account':'New here? Register')))}

function Msg(p){var m=p.m,me=p.me;
 return h('div',{className:'m'+(m.fromId===me.id?' me':'')},h('small',null,m.fromName+' · '+new Date(m.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})),
  m.kind==='image'?h('a',{href:'/media/'+m.media,target:'_blank',rel:'noopener'},h('img',{src:'/media/'+m.media,alt:'photo'})):
  m.kind==='video'?h('video',{src:'/media/'+m.media,controls:true,preload:'metadata'}):h('div',null,m.body))}

function App(){
 var s=uS(undefined),me=s[0],setMe=s[1],du=uS(null),deviceUser=du[0],setDU=du[1],us=uS([]),users=us[0],setUsers=us[1],ac=uS(0),active=ac[0],setActive=ac[1],
  ms=uS([]),msgs=ms[0],setMsgs=ms[1],un=uS({}),unread=un[0],setUnread=un[1],op=uS(false),open=op[0],setOpen=op[1],tx=uS(''),text=tx[0],setText=tx[1],
  er=uS(''),err=er[0],setErr=er[1],bz=uS(false),busy=bz[0],setBusy=bz[1],cl=uS({st:'idle'}),call=cl[0],setCall=cl[1],lv0=uS(null),lv=lv0[0],setLv=lv0[1],
  bgs=uS(function(){try{return +localStorage.getItem('bgi')||0}catch(e){return 0}}),bgi=bgs[0],setBgi=bgs[1];
 var C=uR({st:'idle',pc:null,peer:null,local:null,queue:[],offer:null}).current,L=uR({stream:null,pcs:{},q:{},vpc:null,host:null,queue:[]}).current;
 var onSig=uR(),onMsg=uR(),onUsers=uR(),box=uR();

 function sig(to,kind,data){return api('signal','POST',{to:to,kind:kind,data:data})}
 function mkPc(to,ice,onTrack){var pc=new RTCPeerConnection(ICE);pc.onicecandidate=function(e){if(e.candidate)sig(to,ice,e.candidate.toJSON())};if(onTrack)pc.ontrack=function(e){onTrack(e.streams[0])};return pc}
 function flush(pc,q){var c;while((c=q.shift()))pc.addIceCandidate(c).catch(function(){})}

 // ---- 1-to-1 video call ----
 function cleanCall(){if(C.pc)C.pc.close();if(C.local)C.local.getTracks().forEach(function(t){t.stop()});C.pc=null;C.local=null;C.peer=null;C.queue=[];C.offer=null;C.st='idle';setCall({st:'idle'})}
 async function startCall(u){if(C.st!=='idle')return;var st;try{st=await gum()}catch(e){alert('Camera/microphone not available or blocked. Use http://localhost or https.');return}
  C.st='calling';C.local=st;C.peer=u.id;C.pc=mkPc(u.id,'call-ice',function(r){setCall(function(c){return Object.assign({},c,{remote:r})})});
  st.getTracks().forEach(function(t){C.pc.addTrack(t,st)});var o=await C.pc.createOffer();await C.pc.setLocalDescription(o);
  setCall({st:'calling',peer:u,local:st,remote:null});sig(u.id,'call-offer',{sdp:o})}
 async function acceptCall(){var u=call.peer,st;try{st=await gum()}catch(e){sig(u.id,'call-decline');cleanCall();alert('Camera/microphone not available.');return}
  C.local=st;C.pc=mkPc(u.id,'call-ice',function(r){setCall(function(c){return Object.assign({},c,{remote:r})})});
  st.getTracks().forEach(function(t){C.pc.addTrack(t,st)});await C.pc.setRemoteDescription(C.offer);flush(C.pc,C.queue);
  var a=await C.pc.createAnswer();await C.pc.setLocalDescription(a);C.st='active';setCall(function(c){return Object.assign({},c,{st:'active',local:st})});sig(u.id,'call-answer',{sdp:a})}
 function hangUp(){if(C.peer)sig(C.peer,call.st==='incoming'?'call-decline':'call-end');cleanCall()}
 function tog(kind){if(!C.local)return;C.local.getTracks().forEach(function(t){if(t.kind===kind)t.enabled=!t.enabled})}

 // ---- livestream (host -> many viewers) ----
 async function goLive(){if(L.stream||L.host)return;var st;try{st=await gum()}catch(e){alert('Camera/microphone not available or blocked.');return}
  L.stream=st;await api('live','POST',{on:true});setLv({mode:'host',stream:st,viewers:0})}
 function stopLive(){Object.keys(L.pcs).forEach(function(id){sig(+id,'live-stop');L.pcs[id].close()});L.pcs={};L.q={};
  if(L.stream)L.stream.getTracks().forEach(function(t){t.stop()});L.stream=null;api('live','POST',{on:false});setLv(null)}
 function watch(u){if(L.host||L.stream)return;L.host=u.id;L.queue=[];setLv({mode:'view',host:u,remote:null});sig(u.id,'live-watch')}
 function closeViewer(){if(L.vpc)L.vpc.close();L.vpc=null;L.host=null;L.queue=[];setLv(null)}
 function leave(){if(L.host)sig(L.host,'live-leave');closeViewer()}

 onSig.current=async function(s){var k=s.kind,d=s.data||{},u={id:s.from,username:s.fromName};
  try{
  if(k==='call-offer'){if(C.st!=='idle'){sig(s.from,'call-decline');return}C.st='incoming';C.peer=s.from;C.offer=d.sdp;setCall({st:'incoming',peer:u})}
  else if(k==='call-answer'&&C.pc&&s.from===C.peer){await C.pc.setRemoteDescription(d.sdp);flush(C.pc,C.queue);C.st='active';setCall(function(c){return Object.assign({},c,{st:'active'})})}
  else if(k==='call-ice'&&s.from===C.peer){if(C.pc&&C.pc.remoteDescription)C.pc.addIceCandidate(d).catch(function(){});else C.queue.push(d)}
  else if((k==='call-end'||k==='call-decline')&&s.from===C.peer){cleanCall()}
  else if(k==='live-watch'&&L.stream){var pc=mkPc(s.from,'live-ice');L.pcs[s.from]=pc;L.stream.getTracks().forEach(function(t){pc.addTrack(t,L.stream)});
   var o=await pc.createOffer();await pc.setLocalDescription(o);sig(s.from,'live-offer',{sdp:o});setLv(function(v){return v&&Object.assign({},v,{viewers:Object.keys(L.pcs).length})})}
  else if(k==='live-offer'&&L.host===s.from){var vp=mkPc(s.from,'live-ice',function(r){setLv(function(v){return v&&Object.assign({},v,{remote:r})})});L.vpc=vp;
   await vp.setRemoteDescription(d.sdp);flush(vp,L.queue);var an=await vp.createAnswer();await vp.setLocalDescription(an);sig(s.from,'live-answer',{sdp:an})}
  else if(k==='live-answer'&&L.pcs[s.from]){await L.pcs[s.from].setRemoteDescription(d.sdp);flush(L.pcs[s.from],L.q[s.from]=L.q[s.from]||[])}
  else if(k==='live-ice'){if(L.pcs[s.from]){var hp=L.pcs[s.from];if(hp.remoteDescription)hp.addIceCandidate(d).catch(function(){});else(L.q[s.from]=L.q[s.from]||[]).push(d)}
   else if(L.host===s.from){if(L.vpc&&L.vpc.remoteDescription)L.vpc.addIceCandidate(d).catch(function(){});else L.queue.push(d)}}
  else if(k==='live-stop'&&L.host===s.from){closeViewer()}
  else if(k==='live-leave'&&L.pcs[s.from]){L.pcs[s.from].close();delete L.pcs[s.from];setLv(function(v){return v&&Object.assign({},v,{viewers:Object.keys(L.pcs).length})})}
  }catch(e){console.log(e)}};

 function loadUsers(){api('users').then(function(r){if(r.ok){setUsers(r.users);if(L.host&&!r.users.some(function(x){return x.id===L.host&&x.live}))closeViewer()}})}
 onUsers.current=loadUsers;
 onMsg.current=function(m){var key=m.toId===null?0:(m.fromId===me.id?m.toId:m.fromId);
  if(key===active){setMsgs(function(o){return o.some(function(x){return x.id===m.id})?o:o.concat(m)})}
  else if(m.fromId!==me.id){setUnread(function(o){var n=Object.assign({},o);n[key]=(n[key]||0)+1;return n})}};

 uE(function(){api('me').then(function(r){if(r.device){DEV=r.device;try{localStorage.setItem('dev',DEV)}catch(e){}}setDU(r.deviceUser||null);setMe(r.user||null)})},[]);
 uE(function(){if(!me)return;loadUsers();var es=new EventSource('/api/events');
  es.addEventListener('users',function(){onUsers.current()});
  es.addEventListener('message',function(e){onMsg.current(JSON.parse(e.data))});
  es.addEventListener('signal',function(e){onSig.current(JSON.parse(e.data))});
  return function(){es.close()}},[me&&me.id]);
 uE(function(){if(!me)return;setMsgs([]);api('messages?with='+active).then(function(r){if(r.ok)setMsgs(r.messages)})},[active,me&&me.id]);
 uE(function(){var el=box.current;if(el)el.scrollTop=el.scrollHeight},[msgs]);

 function pick(id){setActive(id);setOpen(true);setErr('');setUnread(function(o){var n=Object.assign({},o);delete n[id];return n})}
 function sendText(){var t=text.trim();if(!t)return;setText('');api('messages','POST',{to:active||null,text:t}).then(function(r){setErr(r.ok?'':(r.error||'Failed'))})}
 function sendFile(f){if(!f)return;setBusy(true);setErr('');var hd={'Content-Type':f.type||'application/octet-stream'};if(DEV)hd['x-device']=DEV;
  fetch('/api/upload',{method:'POST',headers:hd,body:f}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){
   if(!x.ok){setErr(x.j.error||'Upload failed');setBusy(false);return}
   return api('messages','POST',{to:active||null,media:x.j.media}).then(function(){setBusy(false)})}).catch(function(){setErr('Upload failed');setBusy(false)})}
 function logout(){if(L.stream)stopLive();if(L.host)leave();if(C.st!=='idle')hangUp();api('logout','POST').then(function(){setMe(null);setDU(deviceUser)})}

 if(me===undefined)return h('p',{style:{padding:30}},'Loading…');
 if(!me)return h(Auth,{deviceUser:deviceUser,onDone:function(u){setDU(u.username);setMe(u)}});
 var peer=active?users.find(function(x){return x.id===active}):null;
 return h('div',{id:'app',className:open?'open':''},
  h('div',{id:'side'},h('div',{className:'top'},h('b',null,'👤 '+me.username),
    h('select',{title:'Chat background',value:bgi,onChange:function(e){var v=+e.target.value;setBgi(v);try{localStorage.setItem('bgi',v)}catch(x){}},style:{background:'#1f2937',color:'#eee',border:0,borderRadius:8,padding:6}},BGS.map(function(b,i){return h('option',{key:i,value:i},'Theme '+(i+1))})),
    h('button',{className:'g',onClick:logout},'Logout')),
   h('div',{id:'list'},
    h('div',{className:'it'+(active===0?' on':''),onClick:function(){pick(0)}},h('span',{className:'n'},'🌍 Everyone (public room)'),unread[0]&&h('span',{className:'un'},unread[0])),
    users.filter(function(x){return x.id!==me.id}).map(function(x){return h('div',{key:x.id,className:'it'+(active===x.id?' on':''),onClick:function(){pick(x.id)}},
     h('span',{className:'dot'+(x.online?' on':'')}),h('span',{className:'n'},x.username),
     x.live&&h('span',{className:'live',onClick:function(e){e.stopPropagation();watch(x)}},'● LIVE – Watch'),
     unread[x.id]&&h('span',{className:'un'},unread[x.id]))}))),
  h('div',{id:'main'},h('div',{className:'top'},h('button',{className:'g bk',onClick:function(){setOpen(false)}},'←'),
    h('b',null,active===0?'🌍 Everyone':(peer?peer.username:'Chat')),
    peer&&h('button',{onClick:function(){startCall(peer)},disabled:!peer.online},'📹 Call'),
    h('button',{className:'g',onClick:goLive},'🔴 Go Live')),
   h('div',{id:'msgs',ref:box,style:{'--bgc':BGS[bgi]}},msgs.length===0?h('p',{style:{color:'#94a3b8'}},'No messages yet. Say hello!'):msgs.map(function(m){return h(Msg,{key:m.id,m:m,me:me})})),
   h('div',{className:'err'},err),
   h('div',{className:'bar'},
    h('label',{className:'g',style:{padding:'9px 12px',borderRadius:10,background:'rgba(255,255,255,.12)',cursor:'pointer'}},busy?'⏳':'📎',h('input',{type:'file',accept:'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime',style:{display:'none'},onChange:function(e){sendFile(e.target.files[0]);e.target.value=''}})),
    h('input',{type:'text',maxLength:2000,value:text,placeholder:'Type a message…',onChange:function(e){setText(e.target.value)},onKeyDown:function(e){if(e.key==='Enter')sendText()}}),
    h('button',{onClick:sendText},'Send'))),
  call.st==='incoming'&&h('div',{className:'ov'},h('div',{className:'box'},h('h3',null,'📞 '+call.peer.username+' is calling…'),h('button',{onClick:acceptCall},'Accept'),' ',h('button',{className:'r',onClick:hangUp},'Decline'))),
  (call.st==='calling'||call.st==='active')&&h('div',{className:'ov'},h('h3',null,call.st==='calling'?'Calling '+call.peer.username+'…':'In call with '+call.peer.username),
    h(Vid,{stream:call.remote,cls:''}),h(Vid,{stream:call.local,muted:true,cls:'pip'}),
    h('div',null,h('button',{className:'g',onClick:function(){tog('audio')}},'🎤 Mute'),' ',h('button',{className:'g',onClick:function(){tog('video')}},'📷 Camera'),' ',h('button',{className:'r',onClick:hangUp},'Hang up'))),
  lv&&h('div',{className:'ov'},lv.mode==='host'?h('div',{style:{textAlign:'center'}},h('h3',null,'🔴 You are LIVE · viewers: '+lv.viewers),h(Vid,{stream:lv.stream,muted:true,cls:''}),h('div',{style:{marginTop:12}},h('button',{className:'r',onClick:stopLive},'Stop live'))):
    h('div',{style:{textAlign:'center'}},h('h3',null,'Watching '+lv.host.username+' LIVE'),lv.remote?h(Vid,{stream:lv.remote,cls:''}):h('p',null,'Connecting…'),h('div',{style:{marginTop:12}},h('button',{className:'g',onClick:leave},'Leave')))))}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();}
</script></body></html>`;

// ===================== BACKEND (Node.js) =====================
const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const KINDS = new Set(['call-offer', 'call-answer', 'call-ice', 'call-end', 'call-decline', 'live-watch', 'live-offer', 'live-answer', 'live-ice', 'live-stop', 'live-leave']);
const conns = new Map(), live = new Set(), hits = {};
function limited(key, max) { var now = Date.now(), a = (hits[key] = (hits[key] || []).filter(function (t) { return now - t < 60000; })); if (a.length >= max) return true; a.push(now); return false; }
function push(uid, ev, d) { var s = conns.get(uid); if (s) s.forEach(function (r) { r.write('event: ' + ev + '\ndata: ' + JSON.stringify(d || {}) + '\n\n'); }); }
function all(ev, d) { conns.forEach(function (s, uid) { push(uid, ev, d); }); }
function J(res, code, o) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
function readBody(req, max) {
  return new Promise(function (ok) {
    var c = [], n = 0;
    req.on('data', function (d) { n += d.length; if (n > max * 3) return req.destroy(); if (n <= max) c.push(d); });
    req.on('end', function () { ok(n > max ? null : Buffer.concat(c)); });
    req.on('error', function () { ok(null); });
  });
}
async function readJson(req) { var b = await readBody(req, 100000); try { return JSON.parse(b ? b.toString() : '{}'); } catch (e) { return {}; } }
function cookies(req) { var o = {}; (req.headers.cookie || '').split(';').forEach(function (p) { var i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; }
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
const HEX32 = /^[a-f0-9]{32}$/;
function msgRow(r) { return { id: Number(r.id), fromId: r.fromId, fromName: r.fromName, toId: r.toId, kind: r.kind, body: r.body, media: r.media, time: r.time }; }
const MSG_SQL = 'SELECT m.id, m.sender AS fromId, u.username AS fromName, m.recipient AS toId, m.kind, m.body, m.media, m.time FROM messages m JOIN users u ON u.id = m.sender ';

const server = http.createServer(async function (req, res) {
  try {
    const url = new URL(req.url, 'http://x'), p = url.pathname, ck = cookies(req), ip = req.socket.remoteAddress;
    const did = HEX32.test(ck.did || '') ? ck.did : (HEX32.test(req.headers['x-device'] || '') ? req.headers['x-device'] : crypto.randomBytes(16).toString('hex'));
    const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    const didCookie = 'did=' + did + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=315360000' + sec;
    res.setHeader('Set-Cookie', [didCookie]);
    const sess = HEX32.test((ck.sid || '').slice(0, 32)) && /^[a-f0-9]{64}$/.test(ck.sid || '')
      ? db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(ck.sid) : null;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      return res.end(PAGE);
    }
    if (p === '/api/me') {
      var du = db.prepare('SELECT username FROM users WHERE device_id = ?').get(did);
      return J(res, 200, { user: sess ? { id: sess.id, username: sess.username } : null, device: did, deviceUser: du ? du.username : null });
    }
    if (p === '/api/register' && req.method === 'POST') {
      if (limited('a' + ip, 15)) return J(res, 429, { error: 'Too many attempts. Wait a minute.' });
      var b = await readJson(req), uname = String(b.username || '').trim(), pw = String(b.password || '');
      var dev = db.prepare('SELECT username FROM users WHERE device_id = ?').get(did);
      if (dev) return J(res, 403, { error: 'This device already has an account (' + dev.username + '). Only one account per device. Please log in.', deviceUser: dev.username });
      if (!/^[A-Za-z0-9_]{3,20}$/.test(uname)) return J(res, 400, { error: 'Username: 3-20 letters, numbers or _' });
      if (pw.length < 6 || pw.length > 100) return J(res, 400, { error: 'Password must be at least 6 characters' });
      var salt = crypto.randomBytes(16).toString('hex'), uid;
      try { uid = Number(db.prepare('INSERT INTO users(username,salt,hash,device_id,created) VALUES(?,?,?,?,?)').run(uname, salt, hashPw(pw, salt), did, Date.now()).lastInsertRowid); }
      catch (e) { return J(res, 409, { error: /device_id/.test(e.message) ? 'This device already has an account' : 'Username already taken' }); }
      var tok = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tok, uid, Date.now());
      res.setHeader('Set-Cookie', [didCookie, 'sid=' + tok + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000' + sec]);
      all('users'); return J(res, 200, { user: { id: uid, username: uname } });
    }
    if (p === '/api/login' && req.method === 'POST') {
      if (limited('a' + ip, 15)) return J(res, 429, { error: 'Too many attempts. Wait a minute.' });
      var lb = await readJson(req), row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(lb.username || '').trim());
      if (!row) return J(res, 401, { error: 'Wrong username or password' });
      var x = Buffer.from(hashPw(String(lb.password || ''), row.salt), 'hex'), y = Buffer.from(row.hash, 'hex');
      if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return J(res, 401, { error: 'Wrong username or password' });
      var t2 = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t2, row.id, Date.now());
      res.setHeader('Set-Cookie', [didCookie, 'sid=' + t2 + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000' + sec]);
      return J(res, 200, { user: { id: row.id, username: row.username } });
    }
    if (p === '/api/logout' && req.method === 'POST') {
      if (ck.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(ck.sid);
      res.setHeader('Set-Cookie', [didCookie, 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']);
      return J(res, 200, { ok: true });
    }
    if (!sess) return J(res, 401, { error: 'Please log in first' });

    if (p === '/api/users') {
      return J(res, 200, { users: db.prepare('SELECT id, username FROM users ORDER BY username').all().map(function (u) { return { id: u.id, username: u.username, online: conns.has(u.id), live: live.has(u.id) }; }) });
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      var set = conns.get(sess.id); if (!set) { set = new Set(); conns.set(sess.id, set); }
      set.add(res); all('users');
      var ka = setInterval(function () { res.write(': ka\n\n'); }, 20000);
      req.on('close', function () { clearInterval(ka); set.delete(res); if (!set.size) { conns.delete(sess.id); live.delete(sess.id); all('users'); } });
      return;
    }
    if (p === '/api/messages' && req.method === 'GET') {
      var w = Number(url.searchParams.get('with')) || 0;
      var rows = w ? db.prepare(MSG_SQL + 'WHERE (m.sender = ? AND m.recipient = ?) OR (m.sender = ? AND m.recipient = ?) ORDER BY m.id DESC LIMIT 100').all(sess.id, w, w, sess.id)
                   : db.prepare(MSG_SQL + 'WHERE m.recipient IS NULL ORDER BY m.id DESC LIMIT 100').all();
      return J(res, 200, { messages: rows.reverse().map(msgRow) });
    }
    if (p === '/api/messages' && req.method === 'POST') {
      if (limited('m' + sess.id, 60)) return J(res, 429, { error: 'Slow down a little' });
      var mb = await readJson(req), to = mb.to ? Number(mb.to) : null;
      if (to && (to === sess.id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(to))) return J(res, 400, { error: 'Unknown user' });
      var kind = 'text', body = String(mb.text || '').trim().slice(0, 2000), media = null;
      if (mb.media) {
        var mm = db.prepare('SELECT mime FROM media WHERE name = ? AND owner = ?').get(String(mb.media), sess.id);
        if (!mm) return J(res, 400, { error: 'Unknown file' });
        media = String(mb.media); kind = mm.mime.indexOf('video') === 0 ? 'video' : 'image'; body = null;
      } else if (!body) return J(res, 400, { error: 'Empty message' });
      var id = db.prepare('INSERT INTO messages(sender,recipient,kind,body,media,time) VALUES(?,?,?,?,?,?)').run(sess.id, to, kind, body, media, Date.now()).lastInsertRowid;
      var out = msgRow(db.prepare(MSG_SQL + 'WHERE m.id = ?').get(id));
      if (to) { push(sess.id, 'message', out); push(to, 'message', out); } else all('message', out);
      return J(res, 200, { ok: true });
    }
    if (p === '/api/upload' && req.method === 'POST') {
      if (limited('u' + sess.id, 20)) return J(res, 429, { error: 'Too many uploads. Wait a minute.' });
      var mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase(), ext = MIME[mime];
      var buf = await readBody(req, 30 * 1024 * 1024);
      if (!ext) return J(res, 415, { error: 'Only JPG, PNG, GIF, WEBP, MP4, WEBM or MOV files are allowed' });
      if (!buf || !buf.length) return J(res, 413, { error: 'File is empty or larger than 30 MB' });
      var name = crypto.randomBytes(16).toString('hex') + '.' + ext;
      fs.writeFileSync(path.join(UP, name), buf);
      db.prepare('INSERT INTO media VALUES(?,?,?,?,?)').run(name, mime, buf.length, sess.id, Date.now());
      return J(res, 200, { media: name });
    }
    if (p.indexOf('/media/') === 0) {
      var fn = p.slice(7), md = /^[a-f0-9]{32}\.[a-z0-9]{3,4}$/.test(fn) && db.prepare('SELECT mime FROM media WHERE name = ?').get(fn);
      if (!md) { res.writeHead(404); return res.end('Not found'); }
      var f = path.join(UP, fn), st = fs.statSync(f);
      var hd = { 'Content-Type': md.mime, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': 'sandbox', 'Cache-Control': 'private, max-age=86400' };
      var rg = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      if (rg && (rg[1] || rg[2])) {
        var s = rg[1] ? Number(rg[1]) : st.size - Number(rg[2]), e = rg[1] && rg[2] ? Number(rg[2]) : st.size - 1;
        e = Math.min(e, st.size - 1);
        if (s < 0 || s > e) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
        hd['Content-Range'] = 'bytes ' + s + '-' + e + '/' + st.size; hd['Content-Length'] = e - s + 1;
        res.writeHead(206, hd); return fs.createReadStream(f, { start: s, end: e }).pipe(res);
      }
      hd['Content-Length'] = st.size; res.writeHead(200, hd); return fs.createReadStream(f).pipe(res);
    }
    if (p === '/api/signal' && req.method === 'POST') {
      var sb = await readJson(req), target = Number(sb.to);
      if (!KINDS.has(sb.kind) || !conns.has(target) || target === sess.id) return J(res, 404, { error: 'User is offline' });
      push(target, 'signal', { from: sess.id, fromName: sess.username, kind: sb.kind, data: sb.data });
      return J(res, 200, { ok: true });
    }
    if (p === '/api/live' && req.method === 'POST') {
      var lv = await readJson(req); if (lv.on) live.add(sess.id); else live.delete(sess.id);
      all('users'); return J(res, 200, { ok: true });
    }
    J(res, 404, { error: 'Not found' });
  } catch (e) { console.log(e); try { J(res, 500, { error: 'Server error' }); } catch (x) {} }
});
server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') console.log('Port ' + PORT + ' is busy. Run:  $env:PORT=3001; node sumit_chat.js');
  else console.log(e);
});
server.listen(PORT, function () { console.log('Sumit Chat running at http://localhost:' + PORT + '  (Ctrl+C to stop)'); });