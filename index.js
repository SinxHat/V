/*
  SUMIT CHAT v2: React + Node.js + SQLite in ONE file. No npm install.

  RUN (PowerShell):  cd <folder with this file>   (check with: dir)
                     node sumit_chat.js
  OPEN:              http://localhost:3000

  Needs Node.js 22.13+ (check: node -v) and internet in the browser (React/CodeMirror from cdnjs).
  OPTIONAL - run code on the server (python, c, c++, java, go, rust, php, ruby...):
     PowerShell:  $env:RUN_CODE=1; node sumit_chat.js        (only the admin = first account can run)
     WARNING: it runs as YOU on your PC (not a sandbox). Leave it off unless you trust the admin account.
  Creates sumit_chat.db (database) + sumit_chat_uploads/ (photos & videos).
  Camera/mic work on http://localhost or any https:// address.
*/
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os'), cp = require('child_process');
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
  recipient INTEGER REFERENCES users(id),         -- NULL = public room or group
  kind TEXT NOT NULL, body TEXT, media TEXT, time INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS ix_msg ON messages(recipient, id);
CREATE TABLE IF NOT EXISTS chat_groups(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  owner INTEGER NOT NULL REFERENCES users(id),
  salt TEXT NOT NULL, hash TEXT NOT NULL,         -- invite password (hashed)
  created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS group_members(
  group_id INTEGER NOT NULL REFERENCES chat_groups(id), user_id INTEGER NOT NULL REFERENCES users(id),
  joined INTEGER, PRIMARY KEY(group_id, user_id));
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL REFERENCES chat_groups(id),
  name TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', UNIQUE(group_id, name));
`);
try { db.exec('ALTER TABLE messages ADD COLUMN group_id INTEGER'); } catch (e) { /* already exists */ }
db.exec('CREATE INDEX IF NOT EXISTS ix_msg_g ON messages(group_id, id)');

// ===== Live-edit engine (shared by server AND browser): one text edit = replace [from,to) with t =====
function apply(s, o) { return s.slice(0, o.from) + o.t + s.slice(o.to); }
function diff(a, b) {
  if (a === b) return null;
  var p = 0, m = Math.min(a.length, b.length);
  while (p < m && a.charCodeAt(p) === b.charCodeAt(p)) p++;
  var s = 0;
  while (s < m - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
  return { from: p, to: a.length - s, t: b.slice(p, b.length - s) };
}
// transform edit a so it applies AFTER edit b. bf=true: b was applied first (wins ties)
function tr(a, b, bf) {
  var bl = b.t.length, d = bl - (b.to - b.from), n = function (p) { return { from: p, to: p, t: '' }; };
  if (a.from === a.to && a.from === b.from) return (b.from === b.to && bf) ? { from: a.from + bl, to: a.to + bl, t: a.t } : a;
  if (a.to <= b.from) return a;
  if (a.from >= b.to) return { from: a.from + d, to: a.to + d, t: a.t };
  var ai = a.from >= b.from && a.to <= b.to, bi = b.from >= a.from && b.to <= a.to;
  if (ai && bi) return bf ? { from: b.from, to: b.from + bl, t: a.t } : n(b.from + bl);
  if (ai) return n(b.from + bl);
  if (bi) return { from: a.from, to: a.to + d, t: a.t };
  return a.from < b.from ? { from: a.from, to: b.from, t: a.t } : { from: b.from + bl, to: a.to + d, t: a.t };
}

// ===================== FRONTEND (React) =====================
const PAGE = String.raw`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sumit Chat</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/material-darker.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/dracula.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/monokai.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/nord.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/material-palenight.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/ayu-mirage.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/gruvbox-dark.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/oceanic-next.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/solarized.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/theme/eclipse.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldgutter.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/dialog/dialog.min.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.css">
<style>
:root{--ink:#eef2f7;--mut:#94a3b8;--acc:#5eead4;--pan:#111827;--bd:rgba(255,255,255,.1);--bgc:#0b0f19}
*{box-sizing:border-box}html,body{height:100%}body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#0b0f19;color:var(--ink)}
button,input,select{font:inherit}
button{cursor:pointer;border:0;border-radius:10px;padding:8px 13px;background:var(--acc);color:#052b27;font-weight:600}button:disabled{opacity:.4}
button.g{background:rgba(255,255,255,.12);color:var(--ink)}button.r{background:#ef4444;color:#fff}
input[type=text],input[type=password]{width:100%;padding:10px;margin:6px 0 10px;border-radius:10px;border:1px solid var(--bd);background:rgba(0,0,0,.35);color:var(--ink)}
#app{display:flex;height:100%}#side{width:310px;background:var(--pan);border-right:1px solid var(--bd);display:flex;flex-direction:column}
#main{flex:1;display:flex;flex-direction:column;min-width:0}
.top{padding:10px 12px;border-bottom:1px solid var(--bd);display:flex;gap:8px;align-items:center;flex-wrap:wrap}.top b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.top input{margin:0;flex:1}
.bk{display:none}#list{overflow:auto;flex:1}.hd{padding:10px 14px;color:var(--mut);font-size:12px;text-transform:uppercase}
.it{padding:11px 14px;display:flex;gap:8px;align-items:center;cursor:pointer;border-bottom:1px solid var(--bd)}.it:hover,.it.on{background:rgba(255,255,255,.07)}
.it .n{flex:1;overflow:hidden;text-overflow:ellipsis}.dot{width:9px;height:9px;border-radius:50%;background:#475569;flex:none}.dot.on{background:#22c55e}
.live{background:#ef4444;color:#fff;font-size:11px;padding:2px 7px;border-radius:99px;cursor:pointer}.un{background:var(--acc);color:#052b27;border-radius:99px;font-size:12px;padding:1px 8px;font-weight:700}
.tabs{display:flex;border-bottom:1px solid var(--bd)}.tabs div{flex:1;text-align:center;padding:10px;cursor:pointer;color:var(--mut)}.tabs div.on{color:var(--acc);border-bottom:2px solid var(--acc)}
#msgs{flex:1;overflow:auto;padding:14px;background:var(--bgc)}
.m{max-width:min(520px,85%);margin:0 0 10px;padding:8px 12px;border-radius:14px;background:rgba(255,255,255,.1);word-break:break-word}
.m.me{margin-left:auto;background:rgba(94,234,212,.22)}.m small{display:block;color:var(--mut);font-size:11px}.m img,.m video{max-width:100%;max-height:320px;border-radius:10px;display:block;margin-top:4px}
.bar{display:flex;gap:8px;padding:10px;border-top:1px solid var(--bd);background:var(--pan)}.bar input{margin:0;flex:1}
.err{color:#fca5a5;font-size:13px;padding:2px 12px}
.ov{position:fixed;inset:0;background:#000d;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px}
.ov video{max-width:100%;max-height:60vh;background:#000;border-radius:12px}.ov .pip{position:absolute;right:14px;top:14px;width:140px;border-radius:10px}
.box{background:var(--pan);border:1px solid var(--bd);border-radius:16px;padding:22px;width:min(400px,100%)}
#auth{height:100%;display:flex;align-items:center;justify-content:center;padding:16px}
.chips{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px;font-size:13px;color:var(--mut);border-bottom:1px solid var(--bd)}.chip{background:rgba(255,255,255,.08);border-radius:99px;padding:2px 10px}
.tiles{display:flex;gap:8px;padding:8px 12px;overflow-x:auto;background:#000;align-items:center}.tile{position:relative;flex:none}.tile video{width:150px;height:100px;background:#111;border-radius:8px;object-fit:cover}.tile small{position:absolute;left:6px;bottom:4px;background:#000a;padding:0 6px;border-radius:6px;font-size:11px}
#code{flex:1;display:flex;min-height:0}#files{width:180px;border-right:1px solid var(--bd);background:#0d1117;overflow:auto}
#edcol{flex:1;display:flex;flex-direction:column;min-width:0}#edwrap{flex:1;min-height:0;position:relative}.CodeMirror{height:100%;font-size:14px}
#outp{height:170px;border-top:1px solid var(--bd);overflow:auto;background:#0d1117;font-family:Consolas,monospace;font-size:13px;padding:8px}#outp iframe{width:100%;height:150px;border:0;background:#fff;border-radius:6px}
.ide{flex:1;display:flex;flex-direction:column;min-height:0}.ide .body{flex:1;display:flex;min-height:0}
.exp{width:240px;background:#0d1117;border-right:1px solid var(--bd);overflow:auto;flex:none}
.eh{display:flex;gap:10px;align-items:center;padding:8px 10px;color:var(--mut);font-size:12px;text-transform:uppercase}.eh .sp,.ptabs .sp,.sbar .sp{flex:1}.eh .ic{cursor:pointer;font-size:15px}
.it.fo{font-weight:600;color:#fbbf24}.it .act{display:none;gap:6px;font-size:12px}.it:hover .act{display:flex}.it{padding:6px 10px}
.vd{width:8px;height:8px;border-radius:50%;display:inline-block;margin-left:3px;flex:none}
.ecol{flex:1;display:flex;flex-direction:column;min-width:0}
.tbar{display:flex;overflow-x:auto;background:#0d1117;border-bottom:1px solid var(--bd);min-height:36px}
.tab{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;color:var(--mut);border-right:1px solid var(--bd);white-space:nowrap;font-size:13px}.tab.on{color:var(--ink);background:#161b22;border-top:2px solid var(--acc)}.tab .x{opacity:.6}.tab .x:hover{opacity:1;color:#f87171}
.tool{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--bd);flex-wrap:wrap;background:linear-gradient(90deg,#1e1b4b,#0f172a)}.hint{color:var(--mut);font-size:12px}
.pan{height:200px;border-top:1px solid var(--bd);display:flex;flex-direction:column;background:#0d1117;position:relative}
.ptabs{display:flex;gap:16px;align-items:center;padding:4px 12px;color:var(--mut);font-size:12px}.ptabs span{cursor:pointer;padding-bottom:2px}.ptabs .on{color:var(--acc);border-bottom:2px solid var(--acc)}
.outt{flex:1;overflow:auto;padding:6px 12px;font-family:Consolas,monospace;font-size:13px;white-space:pre-wrap}
.pan textarea{width:100%;background:#161b22;color:var(--ink);border:0;border-top:1px solid var(--bd);padding:6px 12px;font-family:Consolas,monospace;resize:none}
.pan iframe{flex:1;width:100%;border:0;background:#fff}
.sbar{display:flex;gap:12px;align-items:center;padding:3px 12px;background:linear-gradient(90deg,#2563eb,#7c3aed);color:#fff;font-size:12px;flex-wrap:wrap}
.CodeMirror{font-size:var(--fs,14px)}.CodeMirror-foldgutter{width:14px}
@media(max-width:700px){#side{width:100%}#app.open #side{display:none}#app:not(.open) #main{display:none}.bk{display:inline-block}#files{width:110px}}
</style></head><body><div id="root" style="height:100%"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/javascript/javascript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/xml/xml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/css/css.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/htmlmixed/htmlmixed.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/python/python.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/clike/clike.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/closebrackets.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/edit/matchbrackets.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/mode/loadmode.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/meta.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/comment/comment.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/selection/active-line.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldcode.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/foldgutter.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/brace-fold.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/indent-fold.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/fold/comment-fold.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/dialog/dialog.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/search/searchcursor.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/search/search.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/show-hint.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/addon/hint/anyword-hint.min.js"></script>
<script>
if(!window.React||!window.ReactDOM){document.getElementById('root').innerHTML='<p style="padding:30px">Could not load React. Check your internet and refresh.</p>';}
else{(function(){
var h=React.createElement,uS=React.useState,uE=React.useEffect,uR=React.useRef;
__OT__
var CID=Math.random().toString(36).slice(2);
var ICE={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
var BGS=['#0b0f19','linear-gradient(135deg,#0f2027,#2c5364)','linear-gradient(135deg,#3a1c71,#d76d77)','linear-gradient(135deg,#134e5e,#71b280)'];
var HOOK='<script>(function(){function s(a){return Array.prototype.map.call(a,function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}}).join(" ")}console.log=function(){parent.postMessage({sumit:1,t:"log",m:s(arguments)},"*")};console.error=function(){parent.postMessage({sumit:1,t:"err",m:s(arguments)},"*")};window.onerror=function(m){parent.postMessage({sumit:1,t:"err",m:String(m)},"*")}})();<\/script>';
var DEV=null;try{DEV=localStorage.getItem('dev')}catch(e){}
function api(p,m,b){var hd={'Content-Type':'application/json'};if(DEV)hd['x-device']=DEV;
 return fetch('/api/'+p,{method:m||'GET',headers:hd,body:b?JSON.stringify(b):undefined}).then(function(r){return r.json().then(function(j){j.ok=r.ok&&!j.error;return j})}).catch(function(){return {ok:false,error:'Cannot reach server'}})}
var BUS={l:{},on:function(e,f){(BUS.l[e]=BUS.l[e]||[]).push(f);return function(){BUS.l[e]=BUS.l[e].filter(function(x){return x!==f})}},emit:function(e,d){(BUS.l[e]||[]).slice().forEach(function(f){f(d)})}};
function modeOf(n){var e=(n.split('.').pop()||'').toLowerCase();return {js:'javascript',json:{name:'javascript',json:true},py:'python',html:'htmlmixed',htm:'htmlmixed',css:'css',xml:'xml',c:'text/x-csrc',cpp:'text/x-c++src',java:'text/x-java',cs:'text/x-csharp'}[e]||'null'}
function mkey(m,me){return m.groupId?'g'+m.groupId:m.toId===null?'all':'u'+(m.fromId===me.id?m.toId:m.fromId)}
function Vid(p){var r=uR();uE(function(){if(r.current)r.current.srcObject=p.stream||null},[p.stream]);return h('video',{ref:r,autoPlay:true,playsInline:true,muted:!!p.muted,className:p.cls})}
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

function Chat(p){
 var k=p.k,ms=uS([]),msgs=ms[0],setMsgs=ms[1],tx=uS(''),text=tx[0],setText=tx[1],er=uS(''),err=er[0],setErr=er[1],bz=uS(false),busy=bz[0],setBusy=bz[1],box=uR();
 var path=k==='all'?'messages':k[0]==='g'?'messages?group='+k.slice(1):'messages?with='+k.slice(1);
 var tgt=k==='all'?{}:k[0]==='g'?{group:+k.slice(1)}:{to:+k.slice(1)};
 uE(function(){setMsgs([]);api(path).then(function(r){if(r.ok)setMsgs(r.messages)});
  return BUS.on('message',function(m){if(mkey(m,p.me)===k)setMsgs(function(o){return o.some(function(x){return x.id===m.id})?o:o.concat(m)})})},[k]);
 uE(function(){var el=box.current;if(el)el.scrollTop=el.scrollHeight},[msgs]);
 function sendText(){var t=text.trim();if(!t)return;setText('');api('messages','POST',Object.assign({text:t},tgt)).then(function(r){setErr(r.ok?'':(r.error||'Failed'))})}
 function sendFile(f){if(!f)return;setBusy(true);setErr('');var hd={'Content-Type':f.type||'application/octet-stream'};if(DEV)hd['x-device']=DEV;
  fetch('/api/upload',{method:'POST',headers:hd,body:f}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(x){
   if(!x.ok){setErr(x.j.error||'Upload failed');setBusy(false);return}
   return api('messages','POST',Object.assign({media:x.j.media},tgt)).then(function(){setBusy(false)})}).catch(function(){setErr('Upload failed');setBusy(false)})}
 return h(React.Fragment,null,
  h('div',{id:'msgs',ref:box},msgs.length===0?h('p',{style:{color:'#94a3b8'}},'No messages yet. Say hello!'):msgs.map(function(m){return h(Msg,{key:m.id,m:m,me:p.me})})),
  h('div',{className:'err'},err),
  h('div',{className:'bar'},
   h('label',{style:{padding:'8px 12px',borderRadius:10,background:'rgba(255,255,255,.12)',cursor:'pointer'}},busy?'⏳':'📎',h('input',{type:'file',accept:'image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,video/quicktime',style:{display:'none'},onChange:function(e){sendFile(e.target.files[0]);e.target.value=''}})),
   h('input',{type:'text',maxLength:2000,value:text,placeholder:'Type a message…',onChange:function(e){setText(e.target.value)},onKeyDown:function(e){if(e.key==='Enter')sendText()}}),
   h('button',{onClick:sendText},'Send')))}

// ---------- IDE: file tree, tabs, colour themes, any-language colouring, run ----------
if(window.CodeMirror)CodeMirror.modeURL='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/mode/%N/%N.min.js';
var THEMES=['material-darker','dracula','monokai','nord','material-palenight','ayu-mirage','gruvbox-dark','oceanic-next','solarized dark','solarized light','eclipse'];
var ICONS={js:'🟨',jsx:'🟨',mjs:'🟨',ts:'🟦',tsx:'🟦',py:'🐍',html:'🟧',htm:'🟧',css:'🟪',scss:'🟪',json:'🟩',md:'📝',txt:'📄',java:'☕',c:'🔵',h:'🔵',cpp:'🔷',cc:'🔷',cs:'🟣',go:'🐹',rs:'🦀',php:'🐘',rb:'💎',sh:'🐚',sql:'🗄️',lua:'🌙',pl:'🐪',kt:'🟠',swift:'🕊️',r:'📊',yml:'⚙️',yaml:'⚙️',xml:'📰',dart:'🎯',scala:'🔴'};
function icon(n){return ICONS[(n.split('.').pop()||'').toLowerCase()]||'📄'}
function ucol(n){var x=0;for(var i=0;i<n.length;i++)x=(x*31+n.charCodeAt(i))%360;return 'hsl('+x+',75%,60%)'}
function buildTree(files){
 var root={d:{},f:[],path:''};
 files.forEach(function(f){var parts=f.name.split('/'),n=root;
  for(var i=0;i<parts.length-1;i++){var k=parts[i];n=n.d[k]=n.d[k]||{d:{},f:[],path:parts.slice(0,i+1).join('/')}}
  var last=parts[parts.length-1];if(last!=='.keep')n.f.push({id:f.id,name:last,full:f.name})});
 return root}

function Tree(p){
 var n=p.node,rows=[];
 Object.keys(n.d).sort().forEach(function(k){var d=n.d[k],cl=p.closed[d.path];
  rows.push(h('div',{key:'d'+d.path,className:'it fo'+(p.sel===d.path?' on':''),style:{paddingLeft:8+p.depth*14},onClick:function(){p.toggle(d.path)}},
   h('span',null,cl?'📁':'📂'),h('span',{className:'n'},k),
   h('span',{className:'act'},h('span',{title:'Rename / move folder',onClick:function(e){e.stopPropagation();p.act('renameFolder',d.path)}},'✏️'),
    p.owner&&h('span',{title:'Delete folder',onClick:function(e){e.stopPropagation();p.act('deleteFolder',d.path)}},'🗑️'))));
  if(!cl)rows.push(h(Tree,Object.assign({},p,{key:'t'+d.path,node:d,depth:p.depth+1})))});
 n.f.slice().sort(function(a,b){return a.name<b.name?-1:1}).forEach(function(f){
  rows.push(h('div',{key:'f'+f.id,className:'it'+(p.fid===f.id?' on':''),style:{paddingLeft:22+p.depth*14},onClick:function(){p.pick(f.id)}},
   h('span',null,icon(f.name)),h('span',{className:'n'},f.name),
   p.pres.filter(function(x){return x.file===f.id}).map(function(x){return h('span',{key:x.id,className:'vd',title:x.name+' is here',style:{background:ucol(x.name)}})}),
   h('span',{className:'act'},h('span',{title:'Rename / move',onClick:function(e){e.stopPropagation();p.act('rename',f)}},'✏️'),
    p.owner&&h('span',{title:'Delete',onClick:function(e){e.stopPropagation();p.act('delete',f)}},'🗑️'))))});
 return h(React.Fragment,null,rows)}

// ---------- live collaborative editor (CodeMirror + server-ordered text sync) ----------
function Editor(p){
 var el=uR(),S=uR({cm:null,base:'',ver:0,infl:null,t:null,id:0,loaded:false,lang:'Plain Text'}).current;
 function upd(){if(!S.cm||!p.stRef.current)return;var c=S.cm.getCursor();p.stRef.current.textContent=S.lang+'   ·   Ln '+(c.line+1)+', Col '+(c.ch+1)}
 function lang(name){var cm=S.cm,info=CodeMirror.findModeByFileName?CodeMirror.findModeByFileName(name):null;
  if(info&&info.mode!=='null'){cm.setOption('mode',info.mime||info.mode);if(CodeMirror.autoLoadMode)CodeMirror.autoLoadMode(cm,info.mode);S.lang=info.name}
  else{cm.setOption('mode','null');S.lang='Plain Text'}upd()}
 function reload(){var id=S.id;api('file?id='+id).then(function(r){if(!r.ok||S.id!==id||!S.cm)return;S.base=r.content;S.ver=r.ver;S.infl=null;S.cm.setOption('readOnly',false);S.cm.setValue(r.content);lang(r.name);S.loaded=true})}
 function flush(){if(S.infl||!S.loaded)return;var d=diff(S.base,S.cm.getValue());if(!d)return;S.infl=d;
  api('file/op','POST',{id:S.id,baseVer:S.ver,op:d,cid:CID}).then(function(r){if(r.resync)reload();else if(!r.ok)S.infl=null})}
 function hint(cm){if(CodeMirror.showHint&&CodeMirror.hint&&CodeMirror.hint.anyword)cm.showHint({hint:CodeMirror.hint.anyword,completeSingle:false})}
 uE(function(){
  if(!window.CodeMirror){el.current.textContent='CodeMirror failed to load (check internet).';return}
  var cm=CodeMirror(el.current,{value:'',lineNumbers:true,theme:p.theme,autoCloseBrackets:true,matchBrackets:true,styleActiveLine:true,foldGutter:true,gutters:['CodeMirror-linenumbers','CodeMirror-foldgutter'],indentUnit:2,tabSize:2,readOnly:true,
   extraKeys:{Tab:function(c){if(c.somethingSelected())c.indentSelection('add');else c.replaceSelection('  ')},'Shift-Tab':function(c){c.indentSelection('subtract')},'Ctrl-/':'toggleComment','Ctrl-Space':hint,'Ctrl-Enter':function(){if(p.runRef.current)p.runRef.current()}}});
  S.cm=cm;p.cmRef.current=cm;
  cm.on('change',function(i,ch){if(ch.origin==='remote'||ch.origin==='setValue')return;clearTimeout(S.t);S.t=setTimeout(flush,100)});
  cm.on('cursorActivity',upd);
  var off=BUS.on('op',function(ev){if(ev.file!==S.id||!S.loaded)return;
   if(ev.ver<=S.ver)return;if(ev.ver>S.ver+1){reload();return}
   if(ev.cid===CID&&S.infl){S.base=apply(S.base,ev.op);S.ver=ev.ver;S.infl=null;flush();return}
   var L=diff(S.base,cm.getValue());S.base=apply(S.base,ev.op);S.ver=ev.ver;
   var R=L?tr(ev.op,L,false):ev.op;
   cm.replaceRange(R.t,cm.posFromIndex(R.from),cm.posFromIndex(R.to),'remote')});
  var off2=BUS.on('open',reload);
  return function(){off();off2();clearTimeout(S.t);S.cm=null;if(el.current)el.current.innerHTML=''}},[]);
 uE(function(){clearTimeout(S.t);if(S.cm&&S.loaded)flush();S.id=p.id;S.loaded=false;S.infl=null;if(S.cm){S.cm.setOption('readOnly',true);reload()}},[p.id]);
 uE(function(){if(S.cm&&S.loaded)lang(p.name)},[p.name]);
 uE(function(){if(S.cm)S.cm.setOption('theme',p.theme)},[p.theme]);
 uE(function(){if(S.cm)S.cm.refresh()},[p.fs]);
 return h('div',{ref:el,style:{position:'absolute',inset:0}})}

function CodeView(p){
 var f=uS(null),fid=f[0],setFid=f[1],tb=uS([]),tabs=tb[0],setTabs=tb[1],cl=uS({}),closed=cl[0],setClosed=cl[1],sl=uS(''),sel=sl[0],setSel=sl[1],
  th=uS(function(){try{return localStorage.getItem('theme')||'material-darker'}catch(e){return 'material-darker'}}),theme=th[0],setTheme=th[1],
  fz=uS(14),fs=fz[0],setFs=fz[1],o=uS([]),out=o[0],setOut=o[1],pn=uS('out'),pane=pn[0],setPane=pn[1],rs=uS({id:0,src:''}),run=rs[0],setRun=rs[1],
  si=uS(''),stdin=si[0],setStdin=si[1],lg=uS({enabled:false,allowed:false,exts:[]}),langs=lg[0],setLangs=lg[1],bz=uS(false),busy=bz[0],setBusy=bz[1],er=uS(''),err=er[0],setErr=er[1];
 var cmRef=uR(),ifr=uR(),stRef=uR(),runRef=uR(),files=p.files,cur=files.find(function(x){return x.id===fid});
 function dirOf(n){var i=n.lastIndexOf('/');return i<0?'':n.slice(0,i)}
 function openF(id){setFid(id);setTabs(function(t){return t.indexOf(id)<0?t.concat(id):t});var fl=files.find(function(x){return x.id===id});if(fl)setSel(dirOf(fl.name))}
 function closeTab(id){var i=tabs.indexOf(id);setTabs(function(t){return t.filter(function(x){return x!==id})});if(id===fid){var nx=tabs[i+1]||tabs[i-1];setFid(nx||null)}}
 uE(function(){setTabs(function(t){return t.filter(function(id){return files.some(function(x){return x.id===id})})});
  if(!files.some(function(x){return x.id===fid})){var first=files.find(function(x){return !/(^|\/)\.keep$/.test(x.name)});if(first)openF(first.id);else setFid(null)}},[files]);
 uE(function(){api('presence','POST',{group:p.g,file:fid})},[fid,p.g]);
 uE(function(){return function(){api('presence','POST',{group:p.g,file:null})}},[p.g]);
 uE(function(){api('langs').then(function(r){if(r.ok)setLangs(r)})},[]);
 uE(function(){try{localStorage.setItem('theme',theme)}catch(e){}},[theme]);
 uE(function(){function on(e){if(ifr.current&&e.source===ifr.current.contentWindow&&e.data&&e.data.sumit)setOut(function(a){return a.concat({t:e.data.t==='err'?'e':'o',s:e.data.m+'\n'})})}
  window.addEventListener('message',on);return function(){window.removeEventListener('message',on)}},[]);
 function toggle(path){setSel(path);setClosed(function(c){var n=Object.assign({},c);if(n[path])delete n[path];else n[path]=1;return n})}
 function act(kind,x){setErr('');var base=sel?sel+'/':'',pr;
  function done(r){if(!r.ok)setErr(r.error||'Error');else if(r.id)openF(r.id)}
  if(kind==='newFile'){var n=prompt('New file name'+(sel?' (inside '+sel+')':'')+' — e.g. app.py, main.cpp, index.html');if(n)api('file/create','POST',{group:p.g,name:base+n.trim().replace(/^\/+|\/+$/g,'')}).then(done)}
  else if(kind==='newFolder'){var d=prompt('New folder name'+(sel?' (inside '+sel+')':'')+':');if(d)api('file/create','POST',{group:p.g,name:base+d.trim().replace(/^\/+|\/+$/g,'')+'/.keep'}).then(done)}
  else if(kind==='rename'){var r2=prompt('Rename / move file to (use / for folders):',x.full);if(r2&&r2!==x.full)api('file/rename','POST',{id:x.id,name:r2.trim()}).then(done)}
  else if(kind==='renameFolder'){var r3=prompt('Rename / move folder to:',x);if(r3&&r3!==x)api('folder/rename','POST',{group:p.g,from:x,to:r3.trim()}).then(done)}
  else if(kind==='delete'){if(confirm('Delete '+x.full+'?'))api('file/delete','POST',{id:x.id}).then(done)}
  else if(kind==='deleteFolder'){if(confirm('Delete folder '+x+' and everything inside?'))api('folder/delete','POST',{group:p.g,prefix:x}).then(done)}}
 function serverRun(){setPane('out');setBusy(true);setOut([{t:'i',s:'▶ Running '+cur.name+' on the server…\n'}]);
  setTimeout(function(){api('run','POST',{group:p.g,file:cur.id,stdin:stdin}).then(function(r){setBusy(false);
   if(!r.ok){setOut([{t:'e',s:(r.error||'Run failed')+'\n'}]);return}
   setOut(r.chunks.concat({t:'i',s:'\n[finished · exit code '+r.code+' · '+r.ms+' ms]\n'}))})},300)}
 function doRun(){if(!cur)return;var ext=cur.name.split('.').pop().toLowerCase(),cm=cmRef.current;if(!cm)return;
  if(ext==='html'||ext==='htm'){setOut([]);setPane('prev');setRun({id:run.id+1,src:HOOK+cm.getValue()})}
  else if(langs.allowed&&langs.exts.indexOf(ext)>=0)serverRun();
  else if(ext==='js'){setOut([]);setPane('out');setRun({id:run.id+1,src:HOOK+'<script>'+cm.getValue().replace(/<\/script/gi,'<\\/script')+'<\/script>'})}
  else setOut([{t:'e',s:langs.enabled?'Only the server admin can run .'+ext+' files.\n':'Running .'+ext+' needs the host to start the server with RUN_CODE=1 and the language installed. (Colours and editing work for every language.)\n'}])}
 runRef.current=doRun;
 function dl(){var cm=cmRef.current;if(!cm||!cur)return;var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([cm.getValue()],{type:'text/plain'}));a.download=cur.name.split('/').pop();a.click()}
 var tree=buildTree(files);
 return h('div',{className:'ide',style:{'--fs':fs+'px'}},
  h('div',{className:'tool'},h('button',{onClick:doRun,disabled:!cur||busy},busy?'⏳ Running…':'▶ Run'),h('span',{className:'hint'},'Ctrl+Enter'),
   h('select',{value:theme,title:'Colour theme',onChange:function(e){setTheme(e.target.value)},style:{background:'#1f2937',color:'#eee',border:0,borderRadius:8,padding:6}},THEMES.map(function(t){return h('option',{key:t,value:t},'🎨 '+t)})),
   h('button',{className:'g',onClick:function(){setFs(Math.max(10,fs-1))}},'A−'),h('button',{className:'g',onClick:function(){setFs(Math.min(28,fs+1))}},'A+'),
   h('button',{className:'g',onClick:dl,disabled:!cur},'⬇ Save file'),h('span',{className:'hint'},'Ctrl+F find · Ctrl+/ comment · Ctrl+Space suggest')),
  h('div',{className:'body'},
   h('div',{className:'exp'},h('div',{className:'eh'},h('span',null,'Explorer'),h('span',{className:'sp'}),
     h('span',{className:'ic',title:'New file',onClick:function(){act('newFile')}},'📄＋'),h('span',{className:'ic',title:'New folder',onClick:function(){act('newFolder')}},'📁＋')),
    h('div',{className:'it fo'+(sel===''?' on':''),onClick:function(){setSel('')}},h('span',null,'🗂️'),h('span',{className:'n'},'Project root')),
    h(Tree,{node:tree,depth:0,fid:fid,closed:closed,sel:sel,pres:p.pres,owner:p.owner,toggle:toggle,pick:openF,act:act}),h('div',{className:'err'},err)),
   h('div',{className:'ecol'},
    h('div',{className:'tbar'},tabs.map(function(id){var fl=files.find(function(x){return x.id===id});if(!fl)return null;
     return h('div',{key:id,className:'tab'+(id===fid?' on':''),onClick:function(){openF(id)}},icon(fl.name)+' '+fl.name.split('/').pop(),h('span',{className:'x',onClick:function(e){e.stopPropagation();closeTab(id)}},'✕'))})),
    h('div',{id:'edwrap'},fid?h(Editor,{id:fid,name:cur?cur.name:'',theme:theme,fs:fs,cmRef:cmRef,stRef:stRef,runRef:runRef}):h('p',{style:{padding:18,color:'#94a3b8'}},'Open a file from the explorer, or press 📄＋ to create one (any language: .py .cpp .java .go .rs .php .html …).')),
    h('div',{className:'pan'},h('div',{className:'ptabs'},h('span',{className:pane==='out'?'on':'',onClick:function(){setPane('out')}},'OUTPUT'),h('span',{className:pane==='prev'?'on':'',onClick:function(){setPane('prev')}},'PREVIEW'),h('span',{className:'sp'}),
      h('span',{onClick:function(){setOut([])}},'🧹 Clear')),
     h('iframe',{key:run.id,ref:ifr,sandbox:'allow-scripts',srcDoc:run.src||'',style:{display:pane==='prev'?'block':'none'}}),
     pane==='out'&&h('div',{className:'outt'},out.length?out.map(function(l,i){return h('span',{key:i,style:{color:l.t==='e'?'#fca5a5':l.t==='i'?'#93c5fd':'#d1fae5'}},l.s)}):h('span',{style:{color:'#64748b'}},'Press ▶ Run. HTML shows in PREVIEW, JavaScript runs in a safe browser sandbox'+(langs.allowed?', and these run on the server: '+langs.exts.join(', ')+'.':'. Other languages run on the server when the host enables RUN_CODE=1.'))),
     pane==='out'&&h('textarea',{value:stdin,rows:1,placeholder:'Program input (stdin) for server runs…',onChange:function(e){setStdin(e.target.value)}})))),
  h('div',{className:'sbar'},h('span',{ref:stRef},''),h('span',{className:'sp'}),h('span',null,'👁'),
   p.pres.length?p.pres.map(function(x){var fl=files.find(function(y){return y.id===x.file});return h('span',{key:x.id,style:{display:'flex',alignItems:'center',gap:4}},h('span',{className:'vd',style:{background:ucol(x.name)}}),x.name+(fl?' · '+fl.name.split('/').pop():''))}):h('span',null,'nobody')))}

function GroupView(p){
 var id=p.id,inf=uS(null),info=inf[0],setInfo=inf[1],tb=uS('chat'),tab=tb[0],setTab=tb[1],pr=uS([]),pres=pr[0],setPres=pr[1],cl=uS([]),callers=cl[0],setCallers=cl[1];
 function load(){api('group?id='+id).then(function(r){if(r.ok){setInfo(r);setPres(r.pres);setCallers(r.call)}})}
 uE(function(){setInfo(null);setTab('chat');load();
  var a=BUS.on('ginfo',function(e){if(e.group===id)load()}),b=BUS.on('users',load),
   c=BUS.on('pres',function(e){if(e.group===id)setPres(e.list)}),d=BUS.on('gcall',function(e){if(e.group===id)setCallers(e.members)});
  return function(){a();b();c();d()}},[id]);
 if(!info)return h('div',{id:'main',style:{padding:20}},'Loading group…');
 var inCall=p.gcs.g===id,nm=function(uid){var m=info.members.find(function(x){return x.id==uid});return m?m.username:'user'};
 return h('div',{id:'main'},
  h('div',{className:'top'},h('button',{className:'g bk',onClick:p.onBack},'←'),h('b',null,'👥 '+info.group.name),
   inCall?h(React.Fragment,null,h('button',{className:'g',onClick:function(){p.gtog('audio')}},'🎤'),h('button',{className:'g',onClick:function(){p.gtog('video')}},'📷'),h('button',{className:'r',onClick:p.onLeaveCall},'Leave call')):
    h('button',{onClick:function(){p.onJoinCall(id)}},'📹 Join call'+(callers.length?' ('+callers.length+')':'')),
   info.group.owner!==p.me.id&&h('button',{className:'g',onClick:function(){if(confirm('Leave this group?'))p.onLeaveGroup(id)}},'Leave')),
  h('div',{className:'chips'},info.members.map(function(m){return h('span',{key:m.id,className:'chip'},(m.online?'🟢 ':'⚪ ')+m.username+(m.id===info.group.owner?' ★':''))})),
  inCall&&h('div',{className:'tiles'},h('div',{className:'tile'},h(Vid,{stream:p.gcs.local,muted:true}),h('small',null,'You')),
   Object.keys(p.gcs.streams).map(function(uid){return h('div',{key:uid,className:'tile'},h(Vid,{stream:p.gcs.streams[uid]}),h('small',null,nm(uid)))})),
  h('div',{className:'tabs'},h('div',{className:tab==='chat'?'on':'',onClick:function(){setTab('chat')}},'💬 Chat'),h('div',{className:tab==='code'?'on':'',onClick:function(){setTab('code')}},'💻 Live Code')),
  tab==='chat'?h(Chat,{key:'g'+id,k:'g'+id,me:p.me}):h(CodeView,{g:id,files:info.files,owner:info.group.owner===p.me.id,pres:pres}))}

function GModal(p){
 var a=uS(''),name=a[0],setName=a[1],b=uS(''),pw=b[0],setPw=b[1],e=uS(''),err=e[0],setErr=e[1],create=p.mode==='create';
 function go(){api(create?'groups':'groups/join','POST',create?{name:name,password:pw}:{id:p.g.id,password:pw}).then(function(r){if(!r.ok)setErr(r.error||'Error');else p.onDone(create?r.group.id:p.g.id)})}
 return h('div',{className:'ov',onClick:function(ev){if(ev.target===ev.currentTarget)p.onClose()}},h('div',{className:'box'},
  h('h3',{style:{marginTop:0}},create?'Create a group':'Join “'+p.g.name+'”'),
  create&&h('label',null,'Group name'),create&&h('input',{type:'text',maxLength:30,value:name,onChange:function(x){setName(x.target.value)}}),
  h('label',null,create?'Invite password (share it only with people you want inside)':'Enter the invite password'),
  h('input',{type:'password',maxLength:50,value:pw,onChange:function(x){setPw(x.target.value)},onKeyDown:function(x){if(x.key==='Enter')go()}}),
  h('div',{className:'err',style:{padding:'0 0 10px'}},err),
  h('button',{onClick:go},create?'Create group':'Join group'),' ',h('button',{className:'g',onClick:p.onClose},'Cancel')))}

function App(){
 var s=uS(undefined),me=s[0],setMe=s[1],du=uS(null),deviceUser=du[0],setDU=du[1],us=uS([]),users=us[0],setUsers=us[1],ac=uS('all'),active=ac[0],setActive=ac[1],
  un=uS({}),unread=un[0],setUnread=un[1],op=uS(false),open=op[0],setOpen=op[1],cl=uS({st:'idle'}),call=cl[0],setCall=cl[1],lv0=uS(null),lv=lv0[0],setLv=lv0[1],
  st0=uS('chats'),stab=st0[0],setStab=st0[1],gr=uS([]),groups=gr[0],setGroups=gr[1],gq0=uS(''),gq=gq0[0],setGq=gq0[1],gm0=uS(null),gm=gm0[0],setGm=gm0[1],
  gc0=uS({g:0,local:null,streams:{}}),gcs=gc0[0],setGcs=gc0[1],
  bgs=uS(function(){try{return +localStorage.getItem('bgi')||0}catch(e){return 0}}),bgi=bgs[0],setBgi=bgs[1];
 var C=uR({st:'idle',pc:null,peer:null,local:null,queue:[],offer:null}).current,L=uR({stream:null,pcs:{},q:{},vpc:null,host:null,queue:[]}).current,G=uR({g:0,pcs:{},q:{},local:null}).current;
 var onSig=uR(),onMsg=uR(),onUsers=uR(),onGroups=uR();

 function sig(to,kind,data){return api('signal','POST',{to:to,kind:kind,data:data})}
 function mkPc(to,ice,onTrack){var pc=new RTCPeerConnection(ICE);pc.onicecandidate=function(e){if(e.candidate)sig(to,ice,e.candidate.toJSON())};if(onTrack)pc.ontrack=function(e){onTrack(e.streams[0])};return pc}
 function flush(pc,q){var c;while((c=q.shift()))pc.addIceCandidate(c).catch(function(){})}
 function merge(f){return function(c){return Object.assign({},c,f)}}

 // ---- 1-to-1 video call ----
 function cleanCall(){if(C.pc)C.pc.close();if(C.local)C.local.getTracks().forEach(function(t){t.stop()});C.pc=null;C.local=null;C.peer=null;C.queue=[];C.offer=null;C.st='idle';setCall({st:'idle'})}
 async function startCall(u){if(C.st!=='idle')return;var st;try{st=await gum()}catch(e){alert('Camera/microphone not available or blocked. Use http://localhost or https.');return}
  C.st='calling';C.local=st;C.peer=u.id;C.pc=mkPc(u.id,'call-ice',function(r){setCall(merge({remote:r}))});
  st.getTracks().forEach(function(t){C.pc.addTrack(t,st)});var o=await C.pc.createOffer();await C.pc.setLocalDescription(o);
  setCall({st:'calling',peer:u,local:st,remote:null});sig(u.id,'call-offer',{sdp:o})}
 async function acceptCall(){var u=call.peer,st;try{st=await gum()}catch(e){sig(u.id,'call-decline');cleanCall();alert('Camera/microphone not available.');return}
  C.local=st;C.pc=mkPc(u.id,'call-ice',function(r){setCall(merge({remote:r}))});
  st.getTracks().forEach(function(t){C.pc.addTrack(t,st)});await C.pc.setRemoteDescription(C.offer);flush(C.pc,C.queue);
  var a=await C.pc.createAnswer();await C.pc.setLocalDescription(a);C.st='active';setCall(merge({st:'active',local:st}));sig(u.id,'call-answer',{sdp:a})}
 function hangUp(){if(C.peer)sig(C.peer,call.st==='incoming'?'call-decline':'call-end');cleanCall()}
 function tog(kind){if(!C.local)return;C.local.getTracks().forEach(function(t){if(t.kind===kind)t.enabled=!t.enabled})}

 // ---- livestream (host -> many viewers) ----
 async function goLive(){if(L.stream||L.host)return;var st;try{st=await gum()}catch(e){alert('Camera/microphone not available or blocked.');return}
  L.stream=st;await api('live','POST',{on:true});setLv({mode:'host',stream:st})}
 function stopLive(){Object.keys(L.pcs).forEach(function(id){sig(+id,'live-stop');L.pcs[id].close()});L.pcs={};L.q={};
  if(L.stream)L.stream.getTracks().forEach(function(t){t.stop()});L.stream=null;api('live','POST',{on:false});setLv(null)}
 function watch(u){if(L.host||L.stream)return;L.host=u.id;L.queue=[];setLv({mode:'view',host:u,remote:null});sig(u.id,'live-watch')}
 function closeViewer(){if(L.vpc)L.vpc.close();L.vpc=null;L.host=null;L.queue=[];setLv(null)}
 function leave(){if(L.host)sig(L.host,'live-leave');closeViewer()}

 // ---- group video call (mesh) ----
 function gPc(to,g){var pc=new RTCPeerConnection(ICE);pc.onicecandidate=function(e){if(e.candidate)sig(to,'g-ice',{g:g,c:e.candidate.toJSON()})};
  pc.ontrack=function(e){setGcs(function(c){var s=Object.assign({},c.streams);s[to]=e.streams[0];return Object.assign({},c,{streams:s})})};
  G.local.getTracks().forEach(function(t){pc.addTrack(t,G.local)});G.pcs[to]=pc;return pc}
 async function joinG(g){if(G.g)return;var st;try{st=await gum()}catch(e){alert('Camera/microphone not available or blocked. Use http://localhost or https.');return}
  G.g=g;G.local=st;setGcs({g:g,local:st,streams:{}});var r=await api('gcall','POST',{group:g,on:true});
  (r.others||[]).forEach(async function(id){var pc=gPc(id,g);var o=await pc.createOffer();await pc.setLocalDescription(o);sig(id,'g-offer',{g:g,sdp:o})})}
 function leaveG(){if(!G.g)return;api('gcall','POST',{group:G.g,on:false});Object.keys(G.pcs).forEach(function(k){G.pcs[k].close()});G.pcs={};G.q={};
  if(G.local)G.local.getTracks().forEach(function(t){t.stop()});G.local=null;G.g=0;setGcs({g:0,local:null,streams:{}})}
 function gtog(kind){if(!G.local)return;G.local.getTracks().forEach(function(t){if(t.kind===kind)t.enabled=!t.enabled})}

 onSig.current=async function(s){var k=s.kind,d=s.data||{},u={id:s.from,username:s.fromName};
  try{
  if(k==='call-offer'){if(C.st!=='idle'){sig(s.from,'call-decline');return}C.st='incoming';C.peer=s.from;C.offer=d.sdp;setCall({st:'incoming',peer:u})}
  else if(k==='call-answer'&&C.pc&&s.from===C.peer){await C.pc.setRemoteDescription(d.sdp);flush(C.pc,C.queue);C.st='active';setCall(merge({st:'active'}))}
  else if(k==='call-ice'&&s.from===C.peer){if(C.pc&&C.pc.remoteDescription)C.pc.addIceCandidate(d).catch(function(){});else C.queue.push(d)}
  else if((k==='call-end'||k==='call-decline')&&s.from===C.peer){cleanCall()}
  else if(k==='live-watch'&&L.stream){var pc=mkPc(s.from,'live-ice');L.pcs[s.from]=pc;L.stream.getTracks().forEach(function(t){pc.addTrack(t,L.stream)});
   var o=await pc.createOffer();await pc.setLocalDescription(o);sig(s.from,'live-offer',{sdp:o})}
  else if(k==='live-offer'&&L.host===s.from){var vp=mkPc(s.from,'live-ice',function(r){setLv(function(v){return v&&Object.assign({},v,{remote:r})})});L.vpc=vp;
   await vp.setRemoteDescription(d.sdp);flush(vp,L.queue);var an=await vp.createAnswer();await vp.setLocalDescription(an);sig(s.from,'live-answer',{sdp:an})}
  else if(k==='live-answer'&&L.pcs[s.from]){await L.pcs[s.from].setRemoteDescription(d.sdp);flush(L.pcs[s.from],L.q[s.from]=L.q[s.from]||[])}
  else if(k==='live-ice'){if(L.pcs[s.from]){var hp=L.pcs[s.from];if(hp.remoteDescription)hp.addIceCandidate(d).catch(function(){});else(L.q[s.from]=L.q[s.from]||[]).push(d)}
   else if(L.host===s.from){if(L.vpc&&L.vpc.remoteDescription)L.vpc.addIceCandidate(d).catch(function(){});else L.queue.push(d)}}
  else if(k==='live-stop'&&L.host===s.from){closeViewer()}
  else if(k==='live-leave'&&L.pcs[s.from]){L.pcs[s.from].close();delete L.pcs[s.from]}
  else if(k==='g-offer'&&G.g===d.g){var gp=G.pcs[s.from]||gPc(s.from,d.g);await gp.setRemoteDescription(d.sdp);flush(gp,G.q[s.from]=G.q[s.from]||[]);
   var ga=await gp.createAnswer();await gp.setLocalDescription(ga);sig(s.from,'g-answer',{g:d.g,sdp:ga})}
  else if(k==='g-answer'&&G.pcs[s.from]){await G.pcs[s.from].setRemoteDescription(d.sdp);flush(G.pcs[s.from],G.q[s.from]=G.q[s.from]||[])}
  else if(k==='g-ice'&&G.g===d.g){var gq2=G.pcs[s.from];if(gq2&&gq2.remoteDescription)gq2.addIceCandidate(d.c).catch(function(){});else(G.q[s.from]=G.q[s.from]||[]).push(d.c)}
  }catch(e){console.log(e)}};

 function loadUsers(){api('users').then(function(r){if(r.ok){setUsers(r.users);if(L.host&&!r.users.some(function(x){return x.id===L.host&&x.live}))closeViewer()}})}
 function loadGroups(){api('groups?q='+encodeURIComponent(gq)).then(function(r){if(r.ok)setGroups(r.groups)})}
 onUsers.current=loadUsers;onGroups.current=loadGroups;
 onMsg.current=function(m){var key=mkey(m,me);if(key!==active&&m.fromId!==me.id)setUnread(function(o){var n=Object.assign({},o);n[key]=(n[key]||0)+1;return n})};

 uE(function(){api('me').then(function(r){if(r.device){DEV=r.device;try{localStorage.setItem('dev',DEV)}catch(e){}}setDU(r.deviceUser||null);setMe(r.user||null)})},[]);
 uE(function(){if(!me)return;loadUsers();var es=new EventSource('/api/events');
  ['users','message','signal','groups','ginfo','pres','gcall','op'].forEach(function(t){es.addEventListener(t,function(e){var d=JSON.parse(e.data);BUS.emit(t,d)})});
  es.onopen=function(){BUS.emit('open')};
  var o1=BUS.on('users',function(){onUsers.current()}),o2=BUS.on('message',function(m){onMsg.current(m)}),o3=BUS.on('signal',function(x){onSig.current(x)}),o4=BUS.on('groups',function(){onGroups.current()});
  return function(){es.close();o1();o2();o3();o4()}},[me&&me.id]);
 uE(function(){if(me)loadGroups()},[gq,me&&me.id]);
 uE(function(){document.documentElement.style.setProperty('--bgc',BGS[bgi]);try{localStorage.setItem('bgi',bgi)}catch(e){}},[bgi]);

 function pick(key){setActive(key);setOpen(true);setUnread(function(o){var n=Object.assign({},o);delete n[key];return n})}
 function logout(){if(L.stream)stopLive();if(L.host)leave();if(G.g)leaveG();if(C.st!=='idle')hangUp();api('logout','POST').then(function(){setMe(null);setDU(deviceUser)})}
 function gDone(id){setGm(null);loadGroups();setStab('groups');pick('g'+id)}
 function leaveGroup(id){api('groups/leave','POST',{id:id}).then(function(){if(G.g===id)leaveG();pick('all');setOpen(false);loadGroups()})}

 if(me===undefined)return h('p',{style:{padding:30}},'Loading…');
 if(!me)return h(Auth,{deviceUser:deviceUser,onDone:function(u){setDU(u.username);setMe(u)}});
 var peer=active[0]==='u'?users.find(function(x){return x.id===+active.slice(1)}):null;
 var mine=groups.filter(function(g){return g.member}),disc=groups.filter(function(g){return !g.member});
 var hostId=lv?(lv.mode==='host'?me.id:lv.host.id):0,hostU=users.find(function(x){return x.id===hostId}),wl=(hostU&&hostU.watchers)||[];
 var side=stab==='chats'?h('div',{id:'list'},
   h('div',{className:'it'+(active==='all'?' on':''),onClick:function(){pick('all')}},h('span',{className:'n'},'🌍 Everyone (public room)'),unread.all&&h('span',{className:'un'},unread.all)),
   users.filter(function(x){return x.id!==me.id}).map(function(x){return h('div',{key:x.id,className:'it'+(active==='u'+x.id?' on':''),onClick:function(){pick('u'+x.id)}},
    h('span',{className:'dot'+(x.online?' on':'')}),h('span',{className:'n'},x.username),
    x.live&&h('span',{className:'live',onClick:function(e){e.stopPropagation();watch(x)}},'● LIVE 👁'+(x.watchers||[]).length+' Watch'),
    unread['u'+x.id]&&h('span',{className:'un'},unread['u'+x.id]))})):
  h('div',{id:'list'},h('div',{className:'top'},h('input',{type:'text',placeholder:'🔍 Search groups…',value:gq,onChange:function(e){setGq(e.target.value)}}),h('button',{onClick:function(){setGm({mode:'create'})}},'＋ New')),
   h('div',{className:'hd'},'My groups'),mine.length?mine.map(function(g){return h('div',{key:g.id,className:'it'+(active==='g'+g.id?' on':''),onClick:function(){pick('g'+g.id)}},h('span',{className:'n'},'👥 '+g.name),h('small',null,g.members+' 👤'),unread['g'+g.id]&&h('span',{className:'un'},unread['g'+g.id]))}):h('div',{className:'hd'},'none yet'),
   h('div',{className:'hd'},'Discover · click to join with invite password'),disc.length?disc.map(function(g){return h('div',{key:g.id,className:'it',onClick:function(){setGm({mode:'join',g:g})}},h('span',{className:'n'},'🔒 '+g.name),h('small',null,g.members+' 👤 · by '+g.owner))}):h('div',{className:'hd'},gq?'no match':'no other groups'));

 return h('div',{id:'app',className:open?'open':''},
  h('div',{id:'side'},h('div',{className:'top'},h('b',null,'👤 '+me.username),
    h('select',{title:'Chat background',value:bgi,onChange:function(e){setBgi(+e.target.value)},style:{background:'#1f2937',color:'#eee',border:0,borderRadius:8,padding:6}},BGS.map(function(b,i){return h('option',{key:i,value:i},'Theme '+(i+1))})),
    h('button',{onClick:goLive},'🔴 Live'),h('button',{className:'g',onClick:logout},'Logout')),
   h('div',{className:'tabs'},h('div',{className:stab==='chats'?'on':'',onClick:function(){setStab('chats')}},'💬 Chats'),h('div',{className:stab==='groups'?'on':'',onClick:function(){setStab('groups')}},'👥 Groups')),side),
  active[0]==='g'?h(GroupView,{key:active,id:+active.slice(1),me:me,gcs:gcs,onBack:function(){setOpen(false)},onJoinCall:joinG,onLeaveCall:leaveG,gtog:gtog,onLeaveGroup:leaveGroup}):
  h('div',{id:'main'},h('div',{className:'top'},h('button',{className:'g bk',onClick:function(){setOpen(false)}},'←'),
    h('b',null,active==='all'?'🌍 Everyone':(peer?peer.username:'Chat')),
    peer&&h('button',{onClick:function(){startCall(peer)},disabled:!peer.online},'📹 Call')),
   h(Chat,{key:active,k:active,me:me})),
  gm&&h(GModal,{mode:gm.mode,g:gm.g,onClose:function(){setGm(null)},onDone:gDone}),
  call.st==='incoming'&&h('div',{className:'ov'},h('div',{className:'box'},h('h3',null,'📞 '+call.peer.username+' is calling…'),h('button',{onClick:acceptCall},'Accept'),' ',h('button',{className:'r',onClick:hangUp},'Decline'))),
  (call.st==='calling'||call.st==='active')&&h('div',{className:'ov'},h('h3',null,call.st==='calling'?'Calling '+call.peer.username+'…':'In call with '+call.peer.username),
    h(Vid,{stream:call.remote}),h(Vid,{stream:call.local,muted:true,cls:'pip'}),
    h('div',null,h('button',{className:'g',onClick:function(){tog('audio')}},'🎤 Mute'),' ',h('button',{className:'g',onClick:function(){tog('video')}},'📷 Camera'),' ',h('button',{className:'r',onClick:hangUp},'Hang up'))),
  lv&&h('div',{className:'ov'},lv.mode==='host'?h('div',{style:{textAlign:'center'}},h('h3',null,'🔴 You are LIVE'),h(Vid,{stream:lv.stream,muted:true}),
     h('p',null,'👁 Watching now ('+wl.length+'): '+(wl.length?wl.join(', '):'nobody yet')),h('button',{className:'r',onClick:stopLive},'Stop live')):
    h('div',{style:{textAlign:'center'}},h('h3',null,'Watching '+lv.host.username+' LIVE'),lv.remote?h(Vid,{stream:lv.remote}):h('p',null,'Connecting…'),
     h('p',null,'👁 Watching ('+wl.length+'): '+wl.join(', ')),h('button',{className:'g',onClick:leave},'Leave'))))}

ReactDOM.createRoot(document.getElementById('root')).render(h(App));
})();}
</script></body></html>`;

// ===================== BACKEND (Node.js) =====================
const MIME = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const KINDS = new Set(['call-offer', 'call-answer', 'call-ice', 'call-end', 'call-decline', 'live-watch', 'live-offer', 'live-answer', 'live-ice', 'live-stop', 'live-leave', 'g-offer', 'g-answer', 'g-ice']);
const conns = new Map(), live = new Set(), liveV = new Map(), gpres = new Map(), gcalls = new Map(), docs = new Map(), hits = {};
function limited(key, max) { var now = Date.now(), a = (hits[key] = (hits[key] || []).filter(function (t) { return now - t < 60000; })); if (a.length >= max) return true; a.push(now); return false; }
function push(uid, ev, d) { var s = conns.get(uid); if (s) s.forEach(function (r) { r.write('event: ' + ev + '\ndata: ' + JSON.stringify(d || {}) + '\n\n'); }); }
function all(ev, d) { conns.forEach(function (s, uid) { push(uid, ev, d); }); }
function gmembers(g) { return db.prepare('SELECT user_id AS id FROM group_members WHERE group_id = ?').all(g).map(function (r) { return r.id; }); }
function gpush(g, ev, d) { gmembers(g).forEach(function (u) { push(u, ev, d); }); }
function isMember(g, u) { return !!db.prepare('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?').get(g, u); }
function uname(id) { var r = db.prepare('SELECT username FROM users WHERE id = ?').get(id); return r ? r.username : '?'; }
function presList(g) { var m = gpres.get(g), o = []; if (m) m.forEach(function (f, u) { o.push({ id: u, name: uname(u), file: f }); }); return o; }
function callList(g) { var s = gcalls.get(g), o = []; if (s) s.forEach(function (u) { o.push({ id: u, name: uname(u) }); }); return o; }
function dropUser(uid) {
  conns.delete(uid); live.delete(uid); liveV.delete(uid); liveV.forEach(function (s) { s.delete(uid); });
  gpres.forEach(function (m, g) { if (m.delete(uid)) gpush(g, 'pres', { group: g, list: presList(g) }); });
  gcalls.forEach(function (s, g) { if (s.delete(uid)) gpush(g, 'gcall', { group: g, members: callList(g) }); });
  all('users');
}
function doc(id) {
  var d = docs.get(id);
  if (!d) { var r = db.prepare('SELECT content FROM files WHERE id = ?').get(id); if (!r) return null; d = { text: r.content, ver: 0, hist: [], t: null }; docs.set(id, d); }
  return d;
}
function saveDocs() { docs.forEach(function (d, id) { try { db.prepare('UPDATE files SET content = ? WHERE id = ?').run(d.text, id); } catch (e) {} }); }
process.on('SIGINT', function () { saveDocs(); process.exit(0); });

function J(res, code, o) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); }
function readBody(req, max) {
  return new Promise(function (ok) {
    var c = [], n = 0;
    req.on('data', function (d) { n += d.length; if (n > max * 3) return req.destroy(); if (n <= max) c.push(d); });
    req.on('end', function () { ok(n > max ? null : Buffer.concat(c)); });
    req.on('error', function () { ok(null); });
  });
}
async function readJson(req) { var b = await readBody(req, 200000); try { return JSON.parse(b ? b.toString() : '{}') || {}; } catch (e) { return {}; } }
function cookies(req) { var o = {}; (req.headers.cookie || '').split(';').forEach(function (p) { var i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }); return o; }
function hashPw(pw, salt) { return crypto.scryptSync(pw, salt, 64).toString('hex'); }
function checkPw(pw, salt, hash) { var x = Buffer.from(hashPw(pw, salt), 'hex'), y = Buffer.from(hash, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); }
const HEX32 = /^[a-f0-9]{32}$/;
function msgRow(r) { return { id: Number(r.id), fromId: r.fromId, fromName: r.fromName, toId: r.toId, groupId: r.groupId, kind: r.kind, body: r.body, media: r.media, time: r.time }; }
const MSG_SQL = 'SELECT m.id, m.sender AS fromId, u.username AS fromName, m.recipient AS toId, m.group_id AS groupId, m.kind, m.body, m.media, m.time FROM messages m JOIN users u ON u.id = m.sender ';

// ===================== FILE SYSTEM HELPERS + OPT-IN CODE RUNNER =====================
// Running other people's code on your PC is dangerous. It is OFF unless you start with RUN_CODE=1,
// and then only the admin (first account, or names in RUN_USERS="name1,name2") can run code.
// It is NOT a sandbox: the code runs as you. Only enable it if you trust the admin account.
const RUN = process.env.RUN_CODE === '1';
const RUN_USERS = new Set((process.env.RUN_USERS || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(Boolean));
const EXE = process.platform === 'win32' ? '.exe' : '';
const exe = function (d) { return path.join(d, 'prog' + EXE); };
const LANGS = {};
let running = 0;
function has(cmd, args) { try { var r = cp.spawnSync(cmd, args || ['--version'], { timeout: 5000, stdio: 'ignore', windowsHide: true }); return !r.error && r.status === 0; } catch (e) { return false; } }
if (RUN) {
  LANGS.js = function (f) { return [[process.execPath, [f]]]; };
  var py = ['python', 'python3', 'py'].find(function (c) { return has(c); });
  if (py) LANGS.py = function (f) { return [[py, ['-u', f]]]; };
  if (has('gcc')) LANGS.c = function (f, d) { return [['gcc', [f, '-o', exe(d), '-lm']], [exe(d), []]]; };
  if (has('g++')) LANGS.cpp = function (f, d) { return [['g++', [f, '-o', exe(d)]], [exe(d), []]]; };
  if (has('javac', ['-version']) && has('java', ['-version'])) LANGS.java = function (f, d) { return [['javac', [f]], ['java', ['-cp', d, path.basename(f).replace(/\.java$/, '')]]]; };
  if (has('go', ['version'])) LANGS.go = function (f) { return [['go', ['run', f]]]; };
  if (has('rustc')) LANGS.rs = function (f, d) { return [['rustc', [f, '-o', exe(d)]], [exe(d), []]]; };
  if (has('php')) LANGS.php = function (f) { return [['php', [f]]]; };
  if (has('ruby')) LANGS.rb = function (f) { return [['ruby', [f]]]; };
  if (has('lua', ['-v'])) LANGS.lua = function (f) { return [['lua', [f]]]; };
  if (has('perl', ['-v'])) LANGS.pl = function (f) { return [['perl', [f]]]; };
  if (process.platform !== 'win32' && has('bash')) LANGS.sh = function (f) { return [['bash', [f]]]; };
}
function canRun(u) {
  if (!RUN) return false;
  if (RUN_USERS.size) return RUN_USERS.has(u.username.toLowerCase());
  return db.prepare('SELECT MIN(id) AS id FROM users').get().id === u.id;
}
function runStep(cmd, args, cwd, stdin, ms) {
  return new Promise(function (done) {
    var chunks = [], size = 0, c;
    function add(t, d) { if (size > 100000) return; var s = d.toString(); size += s.length; chunks.push({ t: t, s: s }); }
    try { c = cp.spawn(cmd, args, { cwd: cwd, windowsHide: true }); } catch (e) { return done({ chunks: [{ t: 'e', s: String(e.message) + '\n' }], code: 1 }); }
    var timer = setTimeout(function () { add('e', '\n[stopped: time limit of ' + Math.round(ms / 1000) + ' s]\n'); c.kill('SIGKILL'); }, ms);
    c.stdout.on('data', function (d) { add('o', d); });
    c.stderr.on('data', function (d) { add('e', d); });
    c.stdin.on('error', function () {}); c.stdin.end(String(stdin || ''));
    c.on('error', function (e) { add('e', e.message + '\n'); });
    c.on('close', function (code) { clearTimeout(timer); done({ chunks: chunks, code: code === null ? 1 : code }); });
  });
}
function validName(n) {
  if (typeof n !== 'string' || !/^[A-Za-z0-9_.\- \/]{1,80}$/.test(n)) return false;
  var parts = n.split('/');
  return parts.length <= 6 && parts.every(function (s) { return s && s !== '.' && s !== '..' && s.trim() === s; });
}
function nameConflict(g, n, exceptIds) {
  return db.prepare('SELECT id, name FROM files WHERE group_id = ?').all(g).some(function (f) {
    return !(exceptIds || []).includes(f.id) && (f.name === n || n.indexOf(f.name + '/') === 0 || f.name.indexOf(n + '/') === 0);
  });
}

const server = http.createServer(async function (req, res) {
  try {
    const url = new URL(req.url, 'http://x'), p = url.pathname, ck = cookies(req), ip = req.socket.remoteAddress, POST = req.method === 'POST';
    const did = HEX32.test(ck.did || '') ? ck.did : (HEX32.test(req.headers['x-device'] || '') ? req.headers['x-device'] : crypto.randomBytes(16).toString('hex'));
    const sec = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    const didCookie = 'did=' + did + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=315360000' + sec;
    res.setHeader('Set-Cookie', [didCookie]);
    const sess = /^[a-f0-9]{64}$/.test(ck.sid || '')
      ? db.prepare('SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(ck.sid) : null;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      return res.end(PAGE.replace('__OT__', function () { return apply.toString() + '\n' + diff.toString() + '\n' + tr.toString(); }));
    }
    if (p === '/api/me') {
      var du = db.prepare('SELECT username FROM users WHERE device_id = ?').get(did);
      return J(res, 200, { user: sess ? { id: sess.id, username: sess.username } : null, device: did, deviceUser: du ? du.username : null });
    }
    if (p === '/api/register' && POST) {
      if (limited('a' + ip, 15)) return J(res, 429, { error: 'Too many attempts. Wait a minute.' });
      var b = await readJson(req), uname0 = String(b.username || '').trim(), pw = String(b.password || '');
      var dev = db.prepare('SELECT username FROM users WHERE device_id = ?').get(did);
      if (dev) return J(res, 403, { error: 'This device already has an account (' + dev.username + '). Only one account per device. Please log in.', deviceUser: dev.username });
      if (!/^[A-Za-z0-9_]{3,20}$/.test(uname0)) return J(res, 400, { error: 'Username: 3-20 letters, numbers or _' });
      if (pw.length < 6 || pw.length > 100) return J(res, 400, { error: 'Password must be at least 6 characters' });
      var salt = crypto.randomBytes(16).toString('hex'), uid;
      try { uid = Number(db.prepare('INSERT INTO users(username,salt,hash,device_id,created) VALUES(?,?,?,?,?)').run(uname0, salt, hashPw(pw, salt), did, Date.now()).lastInsertRowid); }
      catch (e) { return J(res, 409, { error: /device_id/.test(e.message) ? 'This device already has an account' : 'Username already taken' }); }
      var tok = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(tok, uid, Date.now());
      res.setHeader('Set-Cookie', [didCookie, 'sid=' + tok + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000' + sec]);
      all('users'); return J(res, 200, { user: { id: uid, username: uname0 } });
    }
    if (p === '/api/login' && POST) {
      if (limited('a' + ip, 15)) return J(res, 429, { error: 'Too many attempts. Wait a minute.' });
      var lb = await readJson(req), row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(lb.username || '').trim());
      if (!row || !checkPw(String(lb.password || ''), row.salt, row.hash)) return J(res, 401, { error: 'Wrong username or password' });
      var t2 = crypto.randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(t2, row.id, Date.now());
      res.setHeader('Set-Cookie', [didCookie, 'sid=' + t2 + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000' + sec]);
      return J(res, 200, { user: { id: row.id, username: row.username } });
    }
    if (p === '/api/logout' && POST) {
      if (ck.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(ck.sid);
      res.setHeader('Set-Cookie', [didCookie, 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']);
      return J(res, 200, { ok: true });
    }
    if (!sess) return J(res, 401, { error: 'Please log in first' });

    if (p === '/api/users') {
      return J(res, 200, { users: db.prepare('SELECT id, username FROM users ORDER BY username').all().map(function (u) {
        var w = []; if (live.has(u.id)) (liveV.get(u.id) || new Set()).forEach(function (x) { w.push(uname(x)); });
        return { id: u.id, username: u.username, online: conns.has(u.id), live: live.has(u.id), watchers: w }; }) });
    }
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      var set = conns.get(sess.id); if (!set) { set = new Set(); conns.set(sess.id, set); }
      set.add(res); all('users');
      var ka = setInterval(function () { res.write(': ka\n\n'); }, 20000);
      req.on('close', function () { clearInterval(ka); set.delete(res); if (!set.size) dropUser(sess.id); });
      return;
    }

    // ---------- groups ----------
    if (p === '/api/groups' && req.method === 'GET') {
      var q = (url.searchParams.get('q') || '').trim().slice(0, 30).toLowerCase();
      return J(res, 200, { groups: db.prepare('SELECT g.id, g.name, u.username AS owner, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS members, EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = ?) AS member FROM chat_groups g JOIN users u ON u.id = g.owner WHERE instr(lower(g.name), ?) > 0 ORDER BY member DESC, g.name LIMIT 50').all(sess.id, q).map(function (g) { return { id: g.id, name: g.name, owner: g.owner, members: g.members, member: !!g.member }; }) });
    }
    if (p === '/api/groups' && POST) {
      if (limited('cg' + sess.id, 10)) return J(res, 429, { error: 'Too many groups created. Wait a minute.' });
      var gb = await readJson(req), gname = String(gb.name || '').trim(), gpw = String(gb.password || '');
      if (!/^[A-Za-z0-9_ \-]{3,30}$/.test(gname)) return J(res, 400, { error: 'Group name: 3-30 letters, numbers, space, _ or -' });
      if (gpw.length < 4 || gpw.length > 50) return J(res, 400, { error: 'Invite password must be 4-50 characters' });
      var gs = crypto.randomBytes(16).toString('hex'), gid;
      try { gid = Number(db.prepare('INSERT INTO chat_groups(name,owner,salt,hash,created) VALUES(?,?,?,?,?)').run(gname, sess.id, gs, hashPw(gpw, gs), Date.now()).lastInsertRowid); }
      catch (e) { return J(res, 409, { error: 'Group name already taken' }); }
      db.prepare('INSERT INTO group_members VALUES(?,?,?)').run(gid, sess.id, Date.now());
      db.prepare('INSERT INTO files(group_id,name,content) VALUES(?,?,?)').run(gid, 'main.js', "// Welcome! Everyone in this group can edit this file live.\nconsole.log('Hello from Sumit Chat!');\n");
      all('groups'); return J(res, 200, { group: { id: gid, name: gname } });
    }
    if (p === '/api/groups/join' && POST) {
      var jb = await readJson(req), jg = db.prepare('SELECT * FROM chat_groups WHERE id = ?').get(Number(jb.id));
      if (!jg) return J(res, 404, { error: 'Group not found' });
      if (!isMember(jg.id, sess.id)) {
        if (limited('j' + sess.id + '_' + jg.id, 6)) return J(res, 429, { error: 'Too many wrong tries. Wait a minute.' });
        if (!checkPw(String(jb.password || ''), jg.salt, jg.hash)) return J(res, 403, { error: 'Wrong invite password' });
        db.prepare('INSERT INTO group_members VALUES(?,?,?)').run(jg.id, sess.id, Date.now());
        gpush(jg.id, 'ginfo', { group: jg.id }); all('groups');
      }
      return J(res, 200, { ok: true });
    }
    if (p === '/api/groups/leave' && POST) {
      var lg = await readJson(req), gl = db.prepare('SELECT owner FROM chat_groups WHERE id = ?').get(Number(lg.id));
      if (!gl || gl.owner === sess.id) return J(res, 400, { error: 'The owner cannot leave the group' });
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(Number(lg.id), sess.id);
      var pm = gpres.get(Number(lg.id)); if (pm) pm.delete(sess.id);
      var cs = gcalls.get(Number(lg.id)); if (cs) cs.delete(sess.id);
      gpush(Number(lg.id), 'ginfo', { group: Number(lg.id) }); push(sess.id, 'groups'); return J(res, 200, { ok: true });
    }
    if (p === '/api/group') {
      var gi = Number(url.searchParams.get('id')), gg = db.prepare('SELECT id, name, owner FROM chat_groups WHERE id = ?').get(gi);
      if (!gg || !isMember(gi, sess.id)) return J(res, 403, { error: 'Not a member' });
      return J(res, 200, { group: gg,
        members: gmembers(gi).map(function (u) { return { id: u, username: uname(u), online: conns.has(u) }; }),
        files: db.prepare('SELECT id, name FROM files WHERE group_id = ? ORDER BY name').all(gi),
        call: callList(gi), pres: presList(gi) });
    }
    if (p === '/api/presence' && POST) {
      var pb = await readJson(req), pg = Number(pb.group);
      if (!isMember(pg, sess.id)) return J(res, 403, { error: 'Not a member' });
      var pmap = gpres.get(pg); if (!pmap) { pmap = new Map(); gpres.set(pg, pmap); }
      if (pb.file && db.prepare('SELECT 1 FROM files WHERE id = ? AND group_id = ?').get(Number(pb.file), pg)) pmap.set(sess.id, Number(pb.file)); else pmap.delete(sess.id);
      gpush(pg, 'pres', { group: pg, list: presList(pg) }); return J(res, 200, { ok: true });
    }
    if (p === '/api/gcall' && POST) {
      var cb = await readJson(req), cg = Number(cb.group);
      if (!isMember(cg, sess.id)) return J(res, 403, { error: 'Not a member' });
      var cset = gcalls.get(cg); if (!cset) { cset = new Set(); gcalls.set(cg, cset); }
      var others = Array.from(cset).filter(function (x) { return x !== sess.id; });
      if (cb.on) { if (cset.size >= 6 && !cset.has(sess.id)) return J(res, 400, { error: 'Call is full (max 6)' }); cset.add(sess.id); } else cset.delete(sess.id);
      gpush(cg, 'gcall', { group: cg, members: callList(cg) }); return J(res, 200, { ok: true, others: cb.on ? others : [] });
    }

    // ---------- shared code files ----------
    if (p === '/api/file') {
      var fid = Number(url.searchParams.get('id')), fr = db.prepare('SELECT group_id, name FROM files WHERE id = ?').get(fid);
      if (!fr || !isMember(fr.group_id, sess.id)) return J(res, 403, { error: 'Not allowed' });
      var fd = doc(fid); return J(res, 200, { name: fr.name, content: fd.text, ver: fd.ver });
    }
    if (p === '/api/file/create' && POST) {
      var fb = await readJson(req), fgid = Number(fb.group), fname = String(fb.name || '').trim();
      if (!isMember(fgid, sess.id)) return J(res, 403, { error: 'Not a member' });
      if (!validName(fname)) return J(res, 400, { error: 'Bad name (letters, numbers, . _ - space and / for folders, max 80)' });
      if (nameConflict(fgid, fname, [])) return J(res, 409, { error: 'A file or folder with that name already exists' });
      if (db.prepare('SELECT COUNT(*) AS c FROM files WHERE group_id = ?').get(fgid).c >= 200) return J(res, 400, { error: 'Max 200 files per group' });
      try { var nid = Number(db.prepare('INSERT INTO files(group_id,name,content) VALUES(?,?,?)').run(fgid, fname, '').lastInsertRowid); }
      catch (e) { return J(res, 409, { error: 'File already exists' }); }
      gpush(fgid, 'ginfo', { group: fgid }); return J(res, 200, { ok: true, id: nid });
    }
    if (p === '/api/file/delete' && POST) {
      var db1 = await readJson(req), df = db.prepare('SELECT f.id, f.group_id, g.owner FROM files f JOIN chat_groups g ON g.id = f.group_id WHERE f.id = ?').get(Number(db1.id));
      if (!df || df.owner !== sess.id) return J(res, 403, { error: 'Only the group owner can delete files' });
      db.prepare('DELETE FROM files WHERE id = ?').run(df.id); docs.delete(df.id); gpush(df.group_id, 'ginfo', { group: df.group_id }); return J(res, 200, { ok: true });
    }
    if (p === '/api/file/op' && POST) {
      var ob = await readJson(req), ofid = Number(ob.id), of = db.prepare('SELECT group_id FROM files WHERE id = ?').get(ofid);
      if (!of || !isMember(of.group_id, sess.id)) return J(res, 403, { error: 'Not allowed' });
      var o = ob.op || {}, bv = ob.baseVer, d = doc(ofid);
      if (!Number.isInteger(o.from) || !Number.isInteger(o.to) || o.from < 0 || o.to < o.from || typeof o.t !== 'string' || o.t.length > 100000 || !Number.isInteger(bv)) return J(res, 400, { error: 'Bad edit' });
      var off = d.ver - d.hist.length;
      if (bv > d.ver || bv < off) return J(res, 200, { resync: true });
      var op = { from: o.from, to: o.to, t: o.t };
      for (var v = bv; v < d.ver; v++) op = tr(op, d.hist[v - off], true);
      op.from = Math.min(op.from, d.text.length); op.to = Math.min(Math.max(op.to, op.from), d.text.length);
      if (d.text.length - (op.to - op.from) + op.t.length > 400000) return J(res, 400, { error: 'File too large' });
      d.text = apply(d.text, op); d.ver++; d.hist.push(op); if (d.hist.length > 300) d.hist.shift();
      clearTimeout(d.t); d.t = setTimeout(function () { db.prepare('UPDATE files SET content = ? WHERE id = ?').run(d.text, ofid); }, 400);
      gpush(of.group_id, 'op', { file: ofid, ver: d.ver, op: op, cid: String(ob.cid || '').slice(0, 20), by: sess.username });
      return J(res, 200, { ok: true });
    }

    // ---------- file system (rename/move, folders) + run ----------
    if (p === '/api/langs') return J(res, 200, { enabled: RUN, allowed: canRun(sess), exts: canRun(sess) ? Object.keys(LANGS) : [] });
    if (p === '/api/file/rename' && POST) {
      var rb = await readJson(req), rn = String(rb.name || '').trim(), rr = db.prepare('SELECT id, group_id FROM files WHERE id = ?').get(Number(rb.id));
      if (!rr || !isMember(rr.group_id, sess.id)) return J(res, 403, { error: 'Not allowed' });
      if (!validName(rn)) return J(res, 400, { error: 'Bad name (letters, numbers, . _ - space and / for folders)' });
      if (nameConflict(rr.group_id, rn, [rr.id])) return J(res, 409, { error: 'A file or folder with that name already exists' });
      db.prepare('UPDATE files SET name = ? WHERE id = ?').run(rn, rr.id); gpush(rr.group_id, 'ginfo', { group: rr.group_id }); return J(res, 200, { ok: true });
    }
    if (p === '/api/folder/rename' && POST) {
      var fb2 = await readJson(req), fg = Number(fb2.group), ffrom = String(fb2.from || ''), fto = String(fb2.to || '').trim();
      if (!isMember(fg, sess.id)) return J(res, 403, { error: 'Not a member' });
      if (!validName(ffrom) || !validName(fto) || fto.indexOf(ffrom + '/') === 0) return J(res, 400, { error: 'Bad folder name' });
      var moved = db.prepare('SELECT id, name FROM files WHERE group_id = ?').all(fg).filter(function (f) { return f.name.indexOf(ffrom + '/') === 0; });
      if (!moved.length) return J(res, 404, { error: 'Folder not found' });
      var ids = moved.map(function (f) { return f.id; });
      if (moved.some(function (f) { return nameConflict(fg, fto + f.name.slice(ffrom.length), ids); }) || nameConflict(fg, fto, ids)) return J(res, 409, { error: 'That name already exists' });
      try { db.exec('BEGIN'); moved.forEach(function (f) { db.prepare('UPDATE files SET name = ? WHERE id = ?').run(fto + f.name.slice(ffrom.length), f.id); }); db.exec('COMMIT'); }
      catch (e) { try { db.exec('ROLLBACK'); } catch (x) {} return J(res, 409, { error: 'Could not rename folder' }); }
      gpush(fg, 'ginfo', { group: fg }); return J(res, 200, { ok: true });
    }
    if (p === '/api/folder/delete' && POST) {
      var db2 = await readJson(req), dg = Number(db2.group), dpre = String(db2.prefix || ''), go = db.prepare('SELECT owner FROM chat_groups WHERE id = ?').get(dg);
      if (!go || go.owner !== sess.id) return J(res, 403, { error: 'Only the group owner can delete folders' });
      db.prepare('SELECT id, name FROM files WHERE group_id = ?').all(dg).filter(function (f) { return f.name.indexOf(dpre + '/') === 0; }).forEach(function (f) { db.prepare('DELETE FROM files WHERE id = ?').run(f.id); docs.delete(f.id); });
      gpush(dg, 'ginfo', { group: dg }); return J(res, 200, { ok: true });
    }
    if (p === '/api/run' && POST) {
      if (!canRun(sess)) return J(res, 403, { error: RUN ? 'Only the server admin can run code on the server.' : 'Server-side running is OFF. Stop the server and start it with RUN_CODE=1 (PowerShell: $env:RUN_CODE=1; node sumit_chat.js).' });
      var rq = await readJson(req), rf = db.prepare('SELECT id, group_id, name FROM files WHERE id = ?').get(Number(rq.file));
      if (!rf || !isMember(rf.group_id, sess.id)) return J(res, 403, { error: 'Not allowed' });
      var lf = LANGS[rf.name.split('.').pop().toLowerCase()];
      if (!lf) return J(res, 400, { error: 'No runner for this file type on this machine (install the language, then restart).' });
      if (running >= 2 || limited('run' + sess.id, 15)) return J(res, 429, { error: 'Busy. Try again in a few seconds.' });
      running++;
      var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sumitrun-'));
      try {
        db.prepare('SELECT id, name FROM files WHERE group_id = ?').all(rf.group_id).forEach(function (f) {
          if (/(^|\/)\.keep$/.test(f.name)) return;
          var fp = path.join(dir, f.name); if (fp.indexOf(dir) !== 0) return;
          fs.mkdirSync(path.dirname(fp), { recursive: true }); var dd = doc(f.id); fs.writeFileSync(fp, dd ? dd.text : '');
        });
        var t0 = Date.now(), chunks = [], code = 0, steps = lf(rf.name, dir);
        for (var si = 0; si < steps.length; si++) {
          var left = 10000 - (Date.now() - t0); if (left < 500) { chunks.push({ t: 'e', s: '[time limit reached]\n' }); code = 1; break; }
          var r = await runStep(steps[si][0], steps[si][1], dir, si === steps.length - 1 ? rq.stdin : '', left);
          chunks = chunks.concat(r.chunks); code = r.code; if (code !== 0) break;
        }
        return J(res, 200, { chunks: chunks, code: code, ms: Date.now() - t0 });
      } finally { running--; try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
    }

    // ---------- messages ----------
    if (p === '/api/messages' && req.method === 'GET') {
      var w = Number(url.searchParams.get('with')) || 0, wg = Number(url.searchParams.get('group')) || 0, rows;
      if (wg) { if (!isMember(wg, sess.id)) return J(res, 403, { error: 'Not a member' }); rows = db.prepare(MSG_SQL + 'WHERE m.group_id = ? ORDER BY m.id DESC LIMIT 100').all(wg); }
      else if (w) rows = db.prepare(MSG_SQL + 'WHERE m.group_id IS NULL AND ((m.sender = ? AND m.recipient = ?) OR (m.sender = ? AND m.recipient = ?)) ORDER BY m.id DESC LIMIT 100').all(sess.id, w, w, sess.id);
      else rows = db.prepare(MSG_SQL + 'WHERE m.recipient IS NULL AND m.group_id IS NULL ORDER BY m.id DESC LIMIT 100').all();
      return J(res, 200, { messages: rows.reverse().map(msgRow) });
    }
    if (p === '/api/messages' && POST) {
      if (limited('m' + sess.id, 60)) return J(res, 429, { error: 'Slow down a little' });
      var mb = await readJson(req), to = mb.to ? Number(mb.to) : null, mg = mb.group ? Number(mb.group) : null;
      if (mg && !isMember(mg, sess.id)) return J(res, 403, { error: 'Not a member' });
      if (to && (to === sess.id || !db.prepare('SELECT 1 FROM users WHERE id = ?').get(to))) return J(res, 400, { error: 'Unknown user' });
      var kind = 'text', body = String(mb.text || '').trim().slice(0, 2000), media = null;
      if (mb.media) {
        var mm = db.prepare('SELECT mime FROM media WHERE name = ? AND owner = ?').get(String(mb.media), sess.id);
        if (!mm) return J(res, 400, { error: 'Unknown file' });
        media = String(mb.media); kind = mm.mime.indexOf('video') === 0 ? 'video' : 'image'; body = null;
      } else if (!body) return J(res, 400, { error: 'Empty message' });
      var id = db.prepare('INSERT INTO messages(sender,recipient,group_id,kind,body,media,time) VALUES(?,?,?,?,?,?,?)').run(sess.id, mg ? null : to, mg, kind, body, media, Date.now()).lastInsertRowid;
      var out = msgRow(db.prepare(MSG_SQL + 'WHERE m.id = ?').get(id));
      if (mg) gpush(mg, 'message', out); else if (to) { push(sess.id, 'message', out); push(to, 'message', out); } else all('message', out);
      return J(res, 200, { ok: true });
    }
    if (p === '/api/upload' && POST) {
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

    // ---------- WebRTC signalling + livestream ----------
    if (p === '/api/signal' && POST) {
      var sb = await readJson(req), target = Number(sb.to);
      if (!KINDS.has(sb.kind) || !conns.has(target) || target === sess.id) return J(res, 404, { error: 'User is offline' });
      if (sb.kind.indexOf('g-') === 0) {
        var cset2 = gcalls.get(Number(sb.data && sb.data.g));
        if (!cset2 || !cset2.has(sess.id) || !cset2.has(target)) return J(res, 403, { error: 'Not in the same call' });
      }
      if (sb.kind === 'live-watch' && live.has(target)) { if (!liveV.has(target)) liveV.set(target, new Set()); liveV.get(target).add(sess.id); all('users'); }
      if (sb.kind === 'live-leave' && liveV.has(target)) { liveV.get(target).delete(sess.id); all('users'); }
      if (sb.kind === 'live-stop' && liveV.has(sess.id)) { liveV.get(sess.id).delete(target); all('users'); }
      push(target, 'signal', { from: sess.id, fromName: sess.username, kind: sb.kind, data: sb.data });
      return J(res, 200, { ok: true });
    }
    if (p === '/api/live' && POST) {
      var lv = await readJson(req); if (lv.on) live.add(sess.id); else { live.delete(sess.id); liveV.delete(sess.id); }
      all('users'); return J(res, 200, { ok: true });
    }
    J(res, 404, { error: 'Not found' });
  } catch (e) { console.log(e); try { J(res, 500, { error: 'Server error' }); } catch (x) {} }
});
server.on('error', function (e) {
  if (e.code === 'EADDRINUSE') console.log('Port ' + PORT + ' is busy. Run:  $env:PORT=3001; node sumit_chat.js');
  else console.log(e);
});
server.listen(PORT, function () {
  console.log('Sumit Chat running at http://localhost:' + PORT + '  (Ctrl+C to stop)');
  console.log(RUN ? 'Server-side code running is ON for: ' + Object.keys(LANGS).join(', ') + '  (admin only - runs as YOU, not sandboxed)' : 'Server-side code running is OFF (safe). HTML/JS still run inside the browser. To enable: $env:RUN_CODE=1; node sumit_chat.js');
});
