'use strict';
/* Tag & endpoint configuration. Stored in localStorage (gs_tc). Paths are relative to the server base URL. */
const DEF={ep:{read:'/api/tags/{id}',val:'value',run:'running',mode:'mode',write:'/api/tags/{id}/setpoint',wmethod:'PUT',wbody:'{"value":{v}}',alarms:'/api/alarms?state=active',alarmList:'',ack:'/api/alarms/{id}/ack',am:{id:'id',tag:'tag',text:'text',sev:'sev',time:'time',ack:'ack'}},
 tags:[{k:'tank',id:'R01',name:'Reservoir R1',unit:'%',lo:20,hi:92},{k:'tank',id:'R02',name:'Break Pressure Tank BPT-3',unit:'%',lo:25,hi:90},{k:'tank',id:'R03',name:'Sump WW-12',unit:'%',lo:10,hi:85},{k:'pump',id:'P01',name:'Booster Pump 1',unit:'bar',lo:0,hi:8},{k:'pump',id:'P02',name:'Macerator Pump 2',unit:'Hz',lo:0,hi:50}]};
const clone=o=>JSON.parse(JSON.stringify(o));
const norm=j=>({ep:{...DEF.ep,...(j&&j.ep),am:{...DEF.ep.am,...(j&&j.ep&&j.ep.am)}},tags:(Array.isArray(j&&j.tags)?j.tags:[]).map(t=>({...t,lo:+t.lo,hi:+t.hi}))});
let TC=(()=>{try{const s=JSON.parse(localStorage.getItem('gs_tc'));return s&&s.tags?norm(s):clone(DEF)}catch{return clone(DEF)}})();
const getp=(o,p)=>p?String(p).split('.').reduce((a,k)=>a==null?a:a[k],o):o;
const fill=(t,o)=>String(t).replace(/\{(\w+)\}/g,(m,k)=>k in o?o[k]:m);
const EPF=[['read','Read URL, one request per tag ({id})'],['val','Value path in response (e.g. data.value)'],['run','Running path (blank = assume running)'],['mode','Mode path HAND/OFF/AUTO (blank = assume AUTO)'],['write','Setpoint write URL ({id})'],['wmethod','Write method (PUT, POST, PATCH)'],['wbody','Write body, JSON ({v} = value)'],['alarms','Active alarms URL'],['alarmList','Alarm list path (blank = response is the list)'],['ack','Acknowledge URL ({id} = alarm id)']];
function check(c){
 const p=/^\/(?!\/)/;
 for(const k of ['read','write','alarms','ack'])if(!p.test(c.ep[k]||''))return k+' URL must start with a single "/" (relative to the server base URL).';
 if(!['PUT','POST','PATCH'].includes(c.ep.wmethod))return 'Write method must be PUT, POST or PATCH.';
 try{JSON.parse(fill(c.ep.wbody,{id:'x',v:1}))}catch{return 'Write body must be valid JSON once {v} is filled in.'}
 const seen=new Set();
 for(const t of c.tags){
  if(!t.id)return 'Every tag needs an ID.';
  if(t.k!=='tank'&&t.k!=='pump')return t.id+': kind must be tank or pump.';
  if(seen.has(t.k+t.id))return 'Duplicate '+t.k+' ID '+t.id+'.';seen.add(t.k+t.id);
  if(!isFinite(t.lo)||!isFinite(t.hi)||t.lo>=t.hi)return t.id+': low must be a number below high.';
 }
 return '';
}
/* ---- Editor UI ---- */
const q=s=>document.querySelector(s);let draft;
function showRows(){
 q('#epf').innerHTML=EPF.map(([k,l])=>`<label>${l}<input data-ep="${k}" value="${esc(draft.ep[k]??'')}"></label>`).join('');
 q('#tagrows').innerHTML=draft.tags.map((t,i)=>{const p=t.k==='pump';return `<div class="card trow"><h3>${p?'Pump':'Tank'}</h3><label>Tag ID<input data-i="${i}" data-f="id" value="${esc(t.id)}"></label><label>Name<input data-i="${i}" data-f="name" value="${esc(t.name)}"></label><label>Unit<input data-i="${i}" data-f="unit" value="${esc(t.unit)}"></label><label>${p?'Min setpoint':'Low limit'}<input type="number" step="any" data-i="${i}" data-f="lo" value="${esc(t.lo)}"></label><label>${p?'Max setpoint':'High limit'}<input type="number" step="any" data-i="${i}" data-f="hi" value="${esc(t.hi)}"></label><button type="button" class="btn" data-del="${i}">Remove</button></div>`}).join('');
}
q('#tagBtn').onclick=()=>{q('#dlg').close();draft=clone(TC);showRows();q('#cerr').textContent='';q('#cdlg').showModal()};
q('#cdlg').addEventListener('input',e=>{const d=e.target.dataset;if(d.ep!==undefined)draft.ep[d.ep]=e.target.value;if(d.f){draft.tags[+d.i][d.f]=(d.f==='lo'||d.f==='hi')?parseFloat(e.target.value):e.target.value}});
q('#cdlg').addEventListener('click',e=>{const d=e.target.dataset;if(d.del!==undefined){draft.tags.splice(+d.del,1);showRows()}});
q('#addTank').onclick=()=>{draft.tags.push({k:'tank',id:'',name:'New tank',unit:'%',lo:20,hi:90});showRows()};
q('#addPump').onclick=()=>{draft.tags.push({k:'pump',id:'',name:'New pump',unit:'bar',lo:0,hi:8});showRows()};
q('#cexp').onclick=()=>{q('#cjson').value=JSON.stringify(draft,null,1)};
q('#cimp').onclick=()=>{try{draft=norm(JSON.parse(q('#cjson').value));showRows();q('#cerr').textContent='Imported. Review, then Save.'}catch{q('#cerr').textContent='That is not valid JSON.'}};
q('#creset').onclick=()=>{draft=clone(DEF);showRows();q('#cerr').textContent='Defaults loaded. Save to apply.'};
q('#ccancel').onclick=()=>q('#cdlg').close();
q('#csave').onclick=()=>{draft.ep.wmethod=String(draft.ep.wmethod).toUpperCase();const err=check(draft);q('#cerr').textContent=err;if(err)return;TC=draft;try{localStorage.setItem('gs_tc',JSON.stringify(TC))}catch{}q('#cdlg').close();applyCfg()};

/* ---- QR share: generate (qrcode.js) and scan (jsQR). Carries paths and tags only, never base URL or token. ---- */
const PFX='GSC1:';
q('#cqr').onclick=()=>{
 const txt=PFX+JSON.stringify(draft).replace(/[\u0080-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 if(txt.length>2300){q('#cerr').textContent='Config is '+txt.length+' bytes, too large for a reliable QR (limit about 2300). Remove tags or shorten paths.';return}
 const qr=qrcode(0,'L');qr.addData(txt,'Byte');qr.make();
 q('#qrbox').innerHTML=qr.createSvgTag({cellSize:4,margin:4,scalable:true,alt:'Config QR code'});q('#qrbox').hidden=false;
 q('#cerr').textContent='QR ready ('+txt.length+' bytes). Show it full screen and scan from the phone.';
};
let stream=null,scanning=false;
function stopScan(){scanning=false;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;q('#svid').srcObject=null;if(q('#sdlg').open)q('#sdlg').close()}
function loadScan(text){
 try{const d=norm(JSON.parse(text)),err=check(d);if(err){q('#cerr').textContent='Scanned config rejected: '+err;return}
  draft=d;showRows();q('#qrbox').hidden=true;q('#cerr').textContent='Scanned '+d.tags.length+' tags. Review, then Save.';buzz(80)}
 catch{q('#cerr').textContent='QR code did not contain a valid config.'}
}
q('#cscan').onclick=async()=>{
 const v=q('#svid'),c=document.createElement('canvas'),x=c.getContext('2d',{willReadFrequently:true});
 q('#serr').textContent='';q('#sdlg').showModal();
 try{stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});v.srcObject=stream;await v.play()}
 catch(e){q('#serr').textContent='Camera unavailable: '+e.message;return}
 scanning=true;
 const tick=()=>{if(!scanning)return;
  if(v.readyState>=2&&v.videoWidth){const w=Math.min(1280,v.videoWidth),h=Math.round(v.videoHeight*w/v.videoWidth);c.width=w;c.height=h;x.drawImage(v,0,0,w,h);
   const r=jsQR(x.getImageData(0,0,w,h).data,w,h,{inversionAttempts:'dontInvert'});
   if(r){const t=new TextDecoder().decode(Uint8Array.from(r.binaryData));if(t.startsWith(PFX)){stopScan();loadScan(t.slice(PFX.length));return}}}
  requestAnimationFrame(tick)};
 tick();
};
q('#sstop').onclick=stopScan;
q('#sdlg').addEventListener('close',()=>{scanning=false;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null});
