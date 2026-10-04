'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const cfg=Object.assign({mock:true,base:'https://scada.yourdomain.com',poll:5,day:false,user:''},store.get('gs_cfg',{}));

/* ---- Mock data (same shape the adapter returns) ---- */
const mock={tanks:[],pumps:[],alarms:[{id:'A1001',tag:'WW-12.LevelHigh',text:'Wet well high level',sev:'HIGH',time:new Date(Date.now()-420000).toISOString(),ack:false},{id:'A1002',tag:'PRV-07.PressLow',text:'PRV-07 outlet pressure low',sev:'MED',time:new Date(Date.now()-3600000).toISOString(),ack:false}]};
function buildMock(){let i=0;mock.tanks=TC.tags.filter(t=>t.k==='tank').map(t=>({id:t.id,name:t.name,unit:t.unit,lo:t.lo,hi:t.hi,v:+(t.lo+(t.hi-t.lo)*(i++===2?.95:.6)).toFixed(1)}));i=0;mock.pumps=TC.tags.filter(t=>t.k==='pump').map(t=>({id:t.id,name:t.name,unit:t.unit,min:t.lo,max:t.hi,run:!i,mode:i++?'OFF':'AUTO',sp:+((t.lo+t.hi)/2).toFixed(1)}))}
buildMock();
function mockTick(){mock.tanks.forEach(t=>{t.v=Math.min(t.hi*1.1,Math.max(0,+(t.v+(Math.random()-.5)*(t.hi-t.lo)/60).toFixed(1)))})}

/* ---- Adapter: edit paths here to match your GeoSCADA REST gateway ---- */
/* ---- Authentication: HTTP Basic, HTTPS only. Password lives in sessionStorage (cleared when the app closes). ---- */
const pw=()=>{try{return sessionStorage.getItem('gs_pw')||''}catch{return ''}};
const b64=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s)));   // UTF-8 safe btoa(user:password)
async function api(path,opt={}){
 if(!/^\/(?!\/)/.test(path))throw new Error('Bad path in config');
 if(!/^https:\/\//i.test(cfg.base))throw new Error('Base URL must start with https://');
 if(!cfg.user||!pw())throw Object.assign(new Error('Enter username and password in settings'),{auth:true});
 const r=await fetch(cfg.base.replace(/\/$/,'')+path,{...opt,credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Basic '+b64(cfg.user+':'+pw())}});
 if(r.status===401||r.status===403)throw Object.assign(new Error('Login rejected (HTTP '+r.status+')'),{auth:true});
 if(r.status===429)throw new Error('Rate limited by gateway (HTTP 429)');
 if(!r.ok)throw new Error('HTTP '+r.status);
 return r.status===204?null:r.json();
}
const live={
 snapshot:async()=>{const e=TC.ep,m=e.am;
  let j=await api(e.alarms);
  const rows=await Promise.all(TC.tags.map(t=>api(fill(e.read,{id:encodeURIComponent(t.id)}))));
  const tanks=[],pumps=[];
  TC.tags.forEach((t,i)=>{const r=rows[i],n=+getp(r,e.val);
   if(!isFinite(n))throw new Error('Tag '+t.id+': no number at "'+e.val+'"');
   if(t.k==='pump')pumps.push({id:t.id,name:t.name,unit:t.unit,min:t.lo,max:t.hi,sp:n,run:e.run?!!getp(r,e.run):true,mode:e.mode?String(getp(r,e.mode)||'').toUpperCase():'AUTO'});
   else tanks.push({id:t.id,name:t.name,unit:t.unit,lo:t.lo,hi:t.hi,v:n})});
  if(e.alarmList)j=getp(j,e.alarmList);
  const alarms=(Array.isArray(j)?j:[]).map(a=>({id:getp(a,m.id),tag:getp(a,m.tag),text:getp(a,m.text),sev:String(getp(a,m.sev)||'MED').toUpperCase(),time:getp(a,m.time),ack:!!getp(a,m.ack)}));
  return {tanks,alarms,pumps}},
 ack:id=>api(fill(TC.ep.ack,{id:encodeURIComponent(id)}),{method:'POST',body:'{}'}),
 setpoint:(id,v)=>api(fill(TC.ep.write,{id:encodeURIComponent(id)}),{method:TC.ep.wmethod,body:fill(TC.ep.wbody,{id:JSON.stringify(String(id)).slice(1,-1),v})})
};
function applyCfg(){buildMock();for(const k in hist)delete hist[k];data=null;store.set('gs_last',null);['#tanks','#alarms','#pumps'].forEach(x=>$(x).innerHTML='');start()}

/* ---- State & render ---- */
let data=store.get('gs_last',null),stale=false,timer;const edits={},hist={};let fails=0,authHalt=false;
const sc=t=>t.hi*1.15||100;
const buzz=p=>{try{navigator.vibrate&&navigator.vibrate(p)}catch{}};
function track(){const n=Date.now();data.tanks.forEach(t=>{const h=hist[t.id]=(hist[t.id]||[]).filter(p=>n-p.t<9e5);h.push({t:n,v:t.v})})}
function spark(id){const h=hist[id];if(!h||h.length<2)return'';const n=Date.now(),vs=h.map(p=>p.v),lo=Math.min(...vs),sp=(Math.max(...vs)-lo)||1;return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label="15 minute trend"><polyline fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" points="${h.map(p=>((p.t-(n-9e5))/9e5*100).toFixed(1)+','+(22-(p.v-lo)/sp*20).toFixed(1)).join(' ')}"/></svg><p class="muted">15 min trend (auto-scaled)</p>`}
const busy=()=>(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#pumps'));
function renderPumps(){
 $('#pumps').innerHTML=data.pumps.map(p=>`<div class="card"><h3>${esc(p.name)} <span class="${p.run?'run':'stop'}">${p.run?'RUNNING':'STOPPED'}</span> <span class="mode">${esc(p.mode||'—')}</span></h3><div class="val">${p.sp}<small> ${esc(p.unit)}</small></div><div class="sp"><input type="number" inputmode="decimal" step="any" min="${p.min}" max="${p.max}" value="${edits['sp-'+p.id]??p.sp}" aria-label="New setpoint for ${esc(p.name)}" id="sp-${esc(p.id)}"${p.mode==='AUTO'?'':' disabled'}><button class="btn primary" data-sp="${esc(p.id)}"${p.mode==='AUTO'?'':' disabled'}>Set</button></div><p class="muted">Range ${p.min}–${p.max} ${esc(p.unit)}${p.mode==='AUTO'?'':' · <b>Locked: AUTO required</b>'}</p></div>`).join('');
}
document.addEventListener('input',e=>{if(e.target.id&&e.target.id.startsWith('sp-')){edits[e.target.id]=e.target.value;}});
function render(){
 if(!data)return;
 $('#tanks').innerHTML=data.tanks.map(t=>{const m=(t.hi-t.lo)*.07,st=(t.v<=t.lo||t.v>=t.hi)?'alarm':(t.v<=t.lo+m||t.v>=t.hi-m)?'warn':'';return `<div class="card ${st==='alarm'?'alarm':''}"><h3>${esc(t.name)}</h3><div class="val">${t.v}<small> ${esc(t.unit)}</small></div><div class="bar ${st}" role="progressbar" aria-valuenow="${t.v}" aria-valuemin="0" aria-valuemax="${Math.round(sc(t))}"><i style="width:${Math.min(100,t.v/sc(t)*100)}%"></i><b class="tick" style="left:${t.lo/sc(t)*100}%"></b><b class="tick" style="left:${t.hi/sc(t)*100}%"></b></div>${spark(t.id)}<p class="muted">Limits ${t.lo}–${t.hi} ${esc(t.unit)}${st?' · <b>'+(st==='alarm'?'LIMIT BREACH':'NEAR LIMIT')+'</b>':''}</p></div>`}).join('');
 $('#alarms').innerHTML=data.alarms.length?data.alarms.map(a=>`<div class="card alm s-${esc(a.sev)}${a.ack?' ackd':''}"><div><span class="sev">${esc(a.sev)}</span> ${esc(a.text)}<p class="muted">${esc(a.tag)} · ${new Date(a.time).toLocaleTimeString()}${a.ack?' · acknowledged':''}</p></div>${a.ack?'':`<button class="btn primary" data-ack="${esc(a.id)}">Ack</button>`}</div>`).join(''):'<p class="muted">No active alarms.</p>';
 if(!busy())renderPumps();
 const b=$('#badge');b.textContent=cfg.mock?'MOCK':stale?'STALE':'LIVE';b.className='badge '+(cfg.mock?'':stale?'stale':'live');
 document.body.classList.toggle('stale',stale&&!cfg.mock);$('#dot').className='dot '+(cfg.mock?'mock':stale?'fail':'ok');$('#dot').title=cfg.mock?'Demo data':stale?'Comms failure':'Live';
 $('#meta').textContent=(stale?'Cached ':'Updated ')+new Date(data.ts||Date.now()).toLocaleTimeString()+(cfg.mock?' · demo data':'');
}
function banner(t){const b=$('#banner');b.hidden=!t;b.textContent=t?'COMMS FAULT · '+t:''}
/* Two-stage write: Set opens a modal; only Confirm dispatches the request. */
let pend=null;
function openConfirm(p,v){
 pend={id:p.id,v};const y=$('#wyes');y.disabled=true;y.textContent='Confirm';
 $('#wtxt').innerHTML='<b>'+esc(p.name)+'</b> ('+esc(p.mode)+')<br>'+p.sp+' → <b>'+v+'</b> '+esc(p.unit);
 $('#wdlg').showModal();setTimeout(()=>{y.disabled=false},800);
}
$('#wdlg').addEventListener('close',()=>{pend=null});
$('#wno').onclick=()=>$('#wdlg').close();
$('#wyes').onclick=async()=>{
 if(!pend)return;const w=pend;pend=null;const y=$('#wyes');y.disabled=true;y.textContent='Sending…';
 if(!navigator.onLine||(stale&&!cfg.mock)){$('#wdlg').close();alert('Comms fault: setpoint not sent.');return}
 try{if(cfg.mock)mock.pumps.find(x=>x.id===w.id).sp=w.v;else await live.setpoint(w.id,w.v);delete edits['sp-'+w.id];buzz([60,40,60]);$('#wdlg').close();refresh()}
 catch(err){$('#wdlg').close();alert('Command failed: '+err.message)}
};
async function refresh(){
 try{
  if(cfg.mock){mockTick();data=structuredClone(mock)}else data=await live.snapshot();
  data.ts=Date.now();stale=false;fails=0;track();store.set('gs_last',data);banner(navigator.onLine?'':'Offline: showing last data');
  if(!navigator.onLine)stale=true;
 }catch(e){stale=true;fails++;if(e.auth)authHalt=true;banner(e.auth?e.message+'. Polling paused: fix credentials in settings.':'Cannot reach server ('+e.message+'). Showing cached data.')}
 render();
}
function start(){clearTimeout(timer);loop()}
async function loop(){await refresh();if(authHalt)return;const b=Math.max(2,cfg.poll)*1000;timer=setTimeout(loop,fails?Math.min(60000,b*2**Math.min(fails,4)):b)}

/* ---- Actions ---- */
document.addEventListener('click',async e=>{
 const a=e.target.dataset.ack,s=e.target.dataset.sp;
 try{
  if(a){if(cfg.mock){mock.alarms.find(x=>x.id===a).ack=true}else await live.ack(a);buzz(40);refresh()}
  if(s){
   const p=data.pumps.find(x=>x.id===s),v=parseFloat($('#sp-'+s).value);
   if(p.mode!=='AUTO'){alert('Setpoint locked: pump must be in AUTO.');return}
   if(!isFinite(v)||v<p.min||v>p.max){alert('Value must be between '+p.min+' and '+p.max+' '+p.unit);return}
   if(!navigator.onLine||stale&&!cfg.mock){alert('Offline: setpoint not sent.');return}
   openConfirm(p,v);
  }
 }catch(err){alert('Command failed: '+err.message)}
});
const dlg=$('#dlg');
$('#cfgBtn').onclick=()=>{$('#mock').checked=cfg.mock;$('#base').value=cfg.base;$('#poll').value=cfg.poll;$('#day').checked=cfg.day;$('#user').value=cfg.user;$('#pw').value='';dlg.showModal()};
$('#cfgForm').addEventListener('submit',e=>{
 if(e.submitter&&e.submitter.value==='ok'){Object.assign(cfg,{mock:$('#mock').checked,base:$('#base').value.trim(),poll:+$('#poll').value||5,day:$('#day').checked,user:$('#user').value.trim()});if($('#pw').value){try{sessionStorage.setItem('gs_pw',$('#pw').value)}catch{}}authHalt=false;store.set('gs_cfg',cfg);theme();start()}
});
addEventListener('online',refresh);addEventListener('offline',refresh);

/* ---- PWA ---- */
let dp;
addEventListener('beforeinstallprompt',e=>{e.preventDefault();dp=e;$('#install').hidden=false});
$('#install').onclick=async()=>{if(dp){dp.prompt();await dp.userChoice;dp=null;$('#install').hidden=true}};
if(/iphone|ipad|ipod/i.test(navigator.userAgent)&&!navigator.standalone)$('#ios').hidden=false;
if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
function theme(){document.documentElement.dataset.theme=cfg.day?'day':'dark'}
theme();render();start();
