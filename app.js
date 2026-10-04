'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const store={get:(k,d)=>{try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set:(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const cfg=Object.assign({mock:true,base:'',token:'',poll:5,day:false},store.get('gs_cfg',{}));

/* ---- Mock data (same shape the adapter returns) ---- */
const mock={
 tanks:[{id:'R01',name:'Reservoir R1',v:72.4,unit:'%',lo:20,hi:92},{id:'R02',name:'Break Pressure Tank BPT-3',v:48.9,unit:'%',lo:25,hi:90},{id:'R03',name:'Sump WW-12',v:81.6,unit:'%',lo:10,hi:85}],
 alarms:[{id:'A1001',tag:'WW-12.LevelHigh',text:'Wet well high level',sev:'HIGH',time:new Date(Date.now()-420000).toISOString(),ack:false},{id:'A1002',tag:'PRV-07.PressLow',text:'PRV-07 outlet pressure low (1.8 bar)',sev:'MED',time:new Date(Date.now()-3600000).toISOString(),ack:false}],
 pumps:[{id:'P01',name:'Booster Pump 1',run:true,mode:'AUTO',sp:4.2,unit:'bar',min:0,max:8},{id:'P02',name:'Macerator Pump 2',run:false,mode:'OFF',sp:35,unit:'Hz',min:0,max:50}]
};
function mockTick(){mock.tanks.forEach(t=>{t.v=Math.min(100,Math.max(0,+(t.v+(Math.random()-.5)*1.2).toFixed(1)))})}

/* ---- Adapter: edit paths here to match your GeoSCADA REST gateway ---- */
async function api(path,opt={}){
 const r=await fetch(cfg.base.replace(/\/$/,'')+path,{...opt,headers:{'Content-Type':'application/json',...(cfg.token?{Authorization:'Bearer '+cfg.token}:{})}});
 if(!r.ok)throw new Error('HTTP '+r.status);
 return r.status===204?null:r.json();
}
const live={
 snapshot:async()=>({tanks:await api('/api/tanks'),alarms:await api('/api/alarms?state=active'),pumps:await api('/api/pumps')}),
 ack:id=>api('/api/alarms/'+encodeURIComponent(id)+'/ack',{method:'POST',body:'{}'}),
 setpoint:(id,v)=>api('/api/pumps/'+encodeURIComponent(id)+'/setpoint',{method:'PUT',body:JSON.stringify({value:v})})
};

/* ---- State & render ---- */
let data=store.get('gs_last',null),stale=false,timer,armed=null,armT;const edits={};
const busy=()=>armed||(document.activeElement&&document.activeElement.closest&&document.activeElement.closest('#pumps'));
function renderPumps(){
 $('#pumps').innerHTML=data.pumps.map(p=>`<div class="card"><h3>${esc(p.name)} <span class="${p.run?'run':'stop'}">${p.run?'RUNNING':'STOPPED'}</span> <span class="mode">${esc(p.mode||'—')}</span></h3><div class="val">${p.sp}<small> ${esc(p.unit)}</small></div><div class="sp"><input type="number" inputmode="decimal" step="any" min="${p.min}" max="${p.max}" value="${edits['sp-'+p.id]??p.sp}" aria-label="New setpoint for ${esc(p.name)}" id="sp-${esc(p.id)}"><button class="btn primary${armed===p.id?' arm':''}" data-sp="${esc(p.id)}">${armed===p.id?'Confirm?':'Set'}</button></div><p class="muted">Range ${p.min}–${p.max} ${esc(p.unit)}</p></div>`).join('');
}
document.addEventListener('input',e=>{if(e.target.id&&e.target.id.startsWith('sp-')){edits[e.target.id]=e.target.value;if(armed){armed=null;document.querySelectorAll('.arm').forEach(b=>{b.textContent='Set';b.classList.remove('arm')})}}});
function render(){
 if(!data)return;
 $('#tanks').innerHTML=data.tanks.map(t=>{const st=(t.v<=t.lo||t.v>=t.hi)?'alarm':(t.v<=t.lo+5||t.v>=t.hi-5)?'warn':'';return `<div class="card ${st==='alarm'?'alarm':''}"><h3>${esc(t.name)}</h3><div class="val">${t.v}<small> ${esc(t.unit)}</small></div><div class="bar ${st}" role="progressbar" aria-valuenow="${t.v}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.min(100,t.v)}%"></i></div><p class="muted">Limits ${t.lo}–${t.hi} ${esc(t.unit)}${st?' · <b>'+(st==='alarm'?'LIMIT BREACH':'NEAR LIMIT')+'</b>':''}</p></div>`}).join('');
 $('#alarms').innerHTML=data.alarms.length?data.alarms.map(a=>`<div class="card alm s-${esc(a.sev)}${a.ack?' ackd':''}"><div><span class="sev">${esc(a.sev)}</span> ${esc(a.text)}<p class="muted">${esc(a.tag)} · ${new Date(a.time).toLocaleTimeString()}${a.ack?' · acknowledged':''}</p></div>${a.ack?'':`<button class="btn primary" data-ack="${esc(a.id)}">Ack</button>`}</div>`).join(''):'<p class="muted">No active alarms.</p>';
 if(!busy())renderPumps();
 const b=$('#badge');b.textContent=cfg.mock?'MOCK':stale?'STALE':'LIVE';b.className='badge '+(cfg.mock?'':stale?'stale':'live');
 $('#dot').className='dot '+(cfg.mock?'mock':stale?'fail':'ok');$('#dot').title=cfg.mock?'Demo data':stale?'Comms failure':'Live';
 $('#meta').textContent=(stale?'Cached ':'Updated ')+new Date(data.ts||Date.now()).toLocaleTimeString()+(cfg.mock?' · demo data':'');
}
function banner(t){const b=$('#banner');b.hidden=!t;b.textContent=t||''}
async function refresh(){
 try{
  if(cfg.mock){mockTick();data=structuredClone(mock)}else data=await live.snapshot();
  data.ts=Date.now();stale=false;store.set('gs_last',data);banner(navigator.onLine?'':'Offline: showing last data');
  if(!navigator.onLine)stale=true;
 }catch(e){stale=true;banner('Cannot reach server ('+e.message+'). Showing cached data.')}
 render();
}
function start(){clearInterval(timer);refresh();timer=setInterval(refresh,Math.max(2,cfg.poll)*1000)}

/* ---- Actions ---- */
document.addEventListener('click',async e=>{
 const a=e.target.dataset.ack,s=e.target.dataset.sp;
 try{
  if(a){if(cfg.mock){mock.alarms.find(x=>x.id===a).ack=true}else await live.ack(a);refresh()}
  if(s){
   const p=data.pumps.find(x=>x.id===s),v=parseFloat($('#sp-'+s).value);
   if(!isFinite(v)||v<p.min||v>p.max){alert('Value must be between '+p.min+' and '+p.max+' '+p.unit);return}
   if(!navigator.onLine||stale&&!cfg.mock){alert('Offline: setpoint not sent.');return}
   if(armed!==s){armed=s;clearTimeout(armT);armT=setTimeout(()=>{armed=null;renderPumps()},6000);renderPumps();return}
   clearTimeout(armT);armed=null;if(document.activeElement)document.activeElement.blur();
   if(cfg.mock)mock.pumps.find(x=>x.id===s).sp=v;else await live.setpoint(s,v);
   delete edits['sp-'+s];
   refresh();
  }
 }catch(err){alert('Command failed: '+err.message)}
});
const dlg=$('#dlg');
$('#cfgBtn').onclick=()=>{$('#mock').checked=cfg.mock;$('#base').value=cfg.base;$('#token').value=cfg.token;$('#poll').value=cfg.poll;$('#day').checked=cfg.day;dlg.showModal()};
$('#cfgForm').addEventListener('submit',e=>{
 if(e.submitter&&e.submitter.value==='ok'){Object.assign(cfg,{mock:$('#mock').checked,base:$('#base').value.trim(),token:$('#token').value,poll:+$('#poll').value||5,day:$('#day').checked});store.set('gs_cfg',cfg);theme();start()}
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
