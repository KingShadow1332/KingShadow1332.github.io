(function(){
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const NATIVE=!!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform());
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};

/* ---------- Zustand ---------- */
const cfg=Object.assign({provider:'groq',keys:{},fb:'',fbKey:'',lang:'de-DE',tts:'1',pcRoute:'auto',gClientId:'516097970054-g630cvf7uslcoijbvblo4m4pcagamj35.apps.googleusercontent.com'},store.get('ari-app-cfg',{}));
cfg.keys=cfg.keys||{};
let brain=store.get('ari-app-brain',[]);
let pcs=store.get('ari-app-pcs',[]);
const hist=[];
const saveCfg=()=>{store.set('ari-app-cfg',cfg);try{refreshReady();}catch(e){}};
const saveBrain=()=>store.set('ari-app-brain',brain);

/* ---------- Tabs / Uhr ---------- */
function goTab(t){$$('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t===t));$$('section').forEach(s=>s.classList.toggle('on',s.id==='t-'+t));if(t==='brain')renderBrain();if(t==='pc')renderPcs();if(t==='cal')loadCalData();}
$$('nav button').forEach(b=>b.onclick=()=>goTab(b.dataset.t));
// Wischen zwischen den Reitern (Chat/Termine/Gehirn/PC/Einst.) statt immer unten tippen zu muessen -
// nur bei ueberwiegend waagerechter Bewegung, damit normales Scrollen in den Listen nicht gestoert wird.
(function swipeTabs(){
  const mainEl=document.querySelector('main');if(!mainEl)return;
  const order=$$('nav button').map(b=>b.dataset.t);
  let sx=0,sy=0,tracking=false;
  mainEl.addEventListener('touchstart',e=>{if(e.touches.length!==1)return;sx=e.touches[0].clientX;sy=e.touches[0].clientY;tracking=true;},{passive:true});
  mainEl.addEventListener('touchend',e=>{
    if(!tracking)return;tracking=false;
    const t=e.changedTouches[0];if(!t)return;
    const dx=t.clientX-sx,dy=t.clientY-sy;
    if(Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return;
    const cur=$('nav button.on');if(!cur)return;
    let i=order.indexOf(cur.dataset.t);
    i=dx<0?Math.min(order.length-1,i+1):Math.max(0,i-1);
    goTab(order[i]);
  },{passive:true});
})();
setInterval(()=>{const d=new Date();$('#clock').firstChild.nodeValue=d.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  $('#clock small').textContent=d.toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'}).toUpperCase();},1000);

/* ---------- Werkzeuge (laufen komplett auf dem Handy) ---------- */
const TOOLS=[
  {name:'remember',description:'Speichert etwas Dauerhaftes ueber den Nutzer (Vorlieben, Namen, Personen, Gewohnheiten, Ziele) als kurzen ganzen Satz. Keine Passwoerter.',parameters:{type:'object',properties:{text:{type:'string'},category:{type:'string',description:'Kurze Kategorie, z.B. Personen, Vorlieben, Projekte'}},required:['text']}},
  {name:'forget',description:'Loescht Erinnerungen, die zum Suchbegriff passen.',parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}},
  {name:'maps_route',description:'Plant eine Route (Auto/zu Fuss/Fahrrad/OePNV) in Google Maps.',parameters:{type:'object',properties:{destination:{type:'string'},origin:{type:'string',description:'Optional, sonst aktueller Standort'},mode:{type:'string',enum:['driving','walking','bicycling','transit']}},required:['destination']}},
  {name:'find_restaurant',description:'Sucht ein Restaurant und bereitet die Tischreservierung vor (Personenzahl/Zeit vorausgefuellt). Bucht nicht selbst - der Nutzer bestaetigt auf der Seite.',parameters:{type:'object',properties:{query:{type:'string'},people:{type:'integer'},when:{type:'string',description:'YYYY-MM-DD HH:MM'}},required:['query']}}
];
let links=[];
function runTool(name,a){
  a=a||{};
  if(name==='remember'){const t=String(a.text||'').trim();if(t.length<4)return 'Nichts gespeichert (zu kurz).';
    if(brain.some(n=>n.text.toLowerCase()===t.toLowerCase()))return 'Das wusste ich schon.';
    brain.push({id:Date.now()+Math.random().toString(36).slice(2,6),text:t,cat:String(a.category||'Wissen').slice(0,30),ts:Date.now()});saveBrain();syncSoon();return 'Gespeichert.';}
  if(name==='forget'){const q=String(a.query||'').toLowerCase();const gone=brain.filter(n=>n.text.toLowerCase().includes(q));brain=brain.filter(n=>!gone.includes(n));saveBrain();gone.forEach(n=>{sync.deleted=(sync.deleted||[]).concat(n.text);});saveSync();syncSoon();return gone.length+' Eintrag/Eintraege geloescht.';}
  if(name==='maps_route'){const d=String(a.destination||'').trim();if(!d)return 'Kein Ziel.';
    const m={driving:1,walking:1,bicycling:1,transit:1}[a.mode]?a.mode:'driving';
    let u='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(d)+'&travelmode='+m;if(a.origin)u+='&origin='+encodeURIComponent(a.origin);
    links.push({url:u,label:'Route nach '+d});return 'Route nach '+d+' ('+m+') ist bereit - Start ist der aktuelle Standort.';}
  if(name==='find_restaurant'){const q=String(a.query||'').trim();if(!q)return 'Kein Suchbegriff.';
    links.push({url:'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q),label:'Auf Google Maps: '+q});
    let ot='https://www.opentable.de/s?term='+encodeURIComponent(q);const det=[];
    const n=parseInt(a.people,10);if(n>=1&&n<=20){ot+='&covers='+n;det.push(n+' Personen');}
    const m=/^\s*(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/.exec(String(a.when||''));if(m){ot+='&dateTime='+m[1]+'T'+m[2].padStart(2,'0')+':'+m[3];det.push(m[1]+' '+m[2].padStart(2,'0')+':'+m[3]+' Uhr');}
    links.push({url:ot,label:'Tisch reservieren (OpenTable)'+(det.length?': '+det.join(', '):'')});
    return 'Links bereit ('+(det.join(', ')||'ohne Personen/Zeit')+'). Die Buchung selbst bestaetigt der Nutzer auf der Seite - ich kann nicht verbindlich buchen.';}
  return 'Unbekanntes Werkzeug.';
}

/* ---------- Modelle / Anbieter (direkt vom Handy, kein Zwischenserver) ---------- */
const PROV={
  groq:{url:'https://api.groq.com/openai/v1/chat/completions',small:'llama-3.1-8b-instant',big:'openai/gpt-oss-20b',oa:true},
  openai:{url:'https://api.openai.com/v1/chat/completions',small:'gpt-4o-mini',big:'gpt-4o',oa:true},
  gemini:{url:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',small:'gemini-3.6-flash',big:'gemini-3.6-flash',oa:true},
  anthropic:{url:'https://api.anthropic.com/v1/messages',small:'claude-haiku-4-5-20251001',big:'claude-sonnet-5',oa:false}
};
const COMPLEX=/plan|zusammen|erklaer|erklär|schreib|verfass|vergleich|warum|wieso|weshalb|recherch|analys|uebersetz|übersetz|entwirf|idee|mail|reserv|geschichte|gedicht|unterschied/i;
function sysPrompt(query){
  const words=new Set((query||'').toLowerCase().match(/[a-zäöüß0-9]{4,}/g)||[]);
  let nodes=[...brain].reverse();
  if(words.size&&nodes.length>30){const sc=n=>[...words].filter(w=>(n.text+' '+n.cat).toLowerCase().includes(w)).length;
    const rel=nodes.filter(n=>sc(n)>0).sort((a,b)=>sc(b)-sc(a)).slice(0,15);nodes=[...rel,...nodes.filter(n=>!rel.includes(n))];}
  const mem=nodes.slice(0,30).map(n=>'- ['+n.cat+'] '+n.text).join('\n');
  const now=new Date().toLocaleString('de-DE',{dateStyle:'full',timeStyle:'short'});
  return 'Du bist A.R.I, der persoenliche Sprachassistent des Nutzers - kurz, freundlich, direkt (meist 1-3 Saetze). Antworte in der Sprache des Nutzers ('+cfg.lang+'). '+
   'Diese App laeuft eigenstaendig auf dem Handy ohne PC: du kannst Erinnerungen speichern/vergessen, Routen planen und Restaurants suchen. PC-Steuerung (Lautstaerke, Programme, Spotify am PC usw.) geht nur ueber den Reiter "PC" - sag das ehrlich, statt so zu tun. '+
   'Aktuell: '+now+'. Speichere Dauerhaftes ueber den Nutzer mit dem Werkzeug remember; erfinde nichts, Fragen ueber den Nutzer beantwortest du nur aus dem Gedaechtnis.'+(mem?'\n\nGEDAECHTNIS:\n'+mem:'');
}
async function post(url,headers,body){
  const r=await fetch(url,{method:'POST',headers:Object.assign({'Content-Type':'application/json'},headers),body:JSON.stringify(body)});
  if(!r.ok){const t=await r.text();const e=new Error(t.slice(0,300));e.status=r.status;throw e;}
  return r.json();
}
async function runProvider(p,key,history,small,query){
  const P=PROV[p],model=small?P.small:P.big,sys=sysPrompt(query);
  if(P.oa){
    const msgs=[{role:'system',content:sys},...history];
    const tools=TOOLS.map(t=>({type:'function',function:t}));
    for(let i=0;i<4;i++){
      const d=await post(P.url,{Authorization:'Bearer '+key},{model,messages:msgs,tools,max_tokens:1024});
      const m=d.choices[0].message;
      if(!m.tool_calls||!m.tool_calls.length)return (m.content||'').replace(/<\|[a-zA-Z_]+\|>/g,'').trim();
      msgs.push({role:'assistant',content:m.content||'',tool_calls:m.tool_calls});
      m.tool_calls.forEach(tc=>{let a={};try{a=JSON.parse(tc.function.arguments||'{}');}catch(e){}
        msgs.push({role:'tool',tool_call_id:tc.id,content:runTool(tc.function.name,a)});});
    }
    return 'Erledigt.';
  }
  const msgs=history.map(m=>({role:m.role,content:m.content}));
  const tools=TOOLS.map(t=>({name:t.name,description:t.description,input_schema:t.parameters}));
  for(let i=0;i<4;i++){
    const d=await post(P.url,{'x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},{model,max_tokens:1024,system:sys,messages:msgs,tools});
    if(d.stop_reason!=='tool_use')return (d.content.find(b=>b.type==='text')||{text:''}).text.trim();
    msgs.push({role:'assistant',content:d.content});
    msgs.push({role:'user',content:d.content.filter(b=>b.type==='tool_use').map(b=>({type:'tool_result',tool_use_id:b.id,content:runTool(b.name,b.input)}))});
  }
  return 'Erledigt.';
}
function keyList(p){const k=[cfg.keys[p]||''];if(p==='groq')(sync.groqAll||[]).slice(1).forEach(x=>k.push(x));return [...new Set(k.filter(Boolean))];}
async function runWithKeys(p,keys,h,small,q){let last;for(const k of keys){try{return await runProvider(p,k,h,small,q);}catch(e){last=e;if(!isLimit(e))throw e;}}throw last;}
const isLimit=e=>e&&(e.status===429||/rate|quota|limit|overload|exhaust/i.test(String(e.message)));
const PC_RE=/\b(pc|rechner|computer|laptop)\b|lautst[aä]rke|\bleiser\b|\blauter\b|\bstumm\b|screenshot|bildschirmfoto|minimier|maximier/i;
async function askPc(){
  const ctrl=new AbortController(),to=setTimeout(()=>ctrl.abort(),70000);
  try{
    const r=await hubFetch('/phone/api/chat',{method:'POST',headers:{'Content-Type':'application/json','X-Ari-Token':sync.token},body:JSON.stringify({messages:hist.slice(-10).map(m=>({role:m.role,content:m.content}))}),signal:ctrl.signal});
    if(r.status===401){sync.token='';saveSync();return {err:'Kopplung abgelaufen – bitte neu koppeln'};}
    const d=await r.json();
    if(!r.ok||d.error)return {err:d.error||('Fehler '+r.status)};
    return {reply:d.reply||'Erledigt.',links:d.links||[]};
  }catch(e){return {err:e&&e.name==='AbortError'?'keine Antwort':'keine Verbindung'};}
  finally{clearTimeout(to);}
}
async function ask(text){
  links=[];
  const q=text.toLowerCase();
  // Ohne KI: Uhrzeit/Datum
  if(/^(wie spaet|wie spät)( ist es)?\??$|^uhrzeit\??$/.test(q.trim()))return 'Es ist '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' Uhr.';
  if(/^(welcher tag|welches datum|den wievielten)/.test(q.trim()))return 'Heute ist '+new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'.';
  // Befehle an den PC: ueber den gekoppelten Hub ausfuehren (Apps oeffnen, Lautstaerke, Musik, Screenshot ...)
  const route=cfg.pcRoute||'auto',pcIntent=PC_RE.test(q),paired=!!(sync.token&&sync.origin);
  // Termine, Kalender und Mails beantwortet die App selbst (auch im Modus IMMER) - die laufen nicht ueber den PC
  const LOCAL_RE=/termin|kalender|calendar|geburtstag|e-?mail|mails?\b|posteingang|erinner/i;
  if(route!=='off'&&(route==='always'?!LOCAL_RE.test(q):pcIntent)){
    if(paired){
      const r=await askPc();
      if(r.reply){links=r.links||[];return r.reply;}
      if(pcIntent)return 'Der PC ist gerade nicht erreichbar ('+r.err+'). Ist er an und online? Sag es nochmal, sobald er da ist.';
    }else if(pcIntent){
      return 'Dafür muss die App mit deinem PC verbunden sein. Öffne Einstellungen → Synchronisation und koppel sie mit dem Link aus der A.R.I-Mail.';
    }
  }
  const key=cfg.keys[cfg.provider];
  if(!key)return 'Es ist noch kein KI-Schlüssel eingetragen. Öffne Einstellungen und trage einen Schlüssel ein (z. B. kostenlos bei Groq oder Gemini) – oder übernimm die Einstellungen vom PC.';
  const small=q.split(/\s+/).length<=10&&!COMPLEX.test(q);
  const h=hist.slice(-10);
  try{return await runWithKeys(cfg.provider,keyList(cfg.provider),h,small,text);}
  catch(e){
    if(small&&!isLimit(e)){try{return await runWithKeys(cfg.provider,keyList(cfg.provider),h,false,text);}catch(e2){e=e2;}}
    if(isLimit(e)&&cfg.fb&&cfg.fbKey&&cfg.fb!==cfg.provider){try{return await runProvider(cfg.fb,cfg.fbKey,h,small,text);}catch(e3){e=e3;}}
    return 'Fehler beim Anbieter ('+cfg.provider+'): '+String(e.message).slice(0,160);
  }
}

/* ---------- Chat ---------- */
function addMsg(who,text,lk){
  const d=document.createElement('div');d.className='m '+(who==='u'?'u':'a');const tx=document.createElement('div');tx.textContent=text;d.appendChild(tx);d._tx=tx;
  (lk||[]).forEach(l=>{const a=document.createElement('a');a.className='lk';a.href=l.url;a.target='_blank';a.rel='noopener';a.textContent='↗ '+l.label;d.appendChild(a);});
  $('#log').appendChild(d);$('#log').scrollTop=1e9;return d;
}
// Nur "bereit", wenn wirklich ein KI-Schluessel da ist
function hasKey(){return !!(cfg.keys[cfg.provider]||(cfg.fb&&cfg.fbKey));}
function refreshReady(){
  const ok=hasKey();$('#conn').classList.toggle('on',ok);$('#conn').textContent=ok?'BEREIT':'KEIN SCHLÜSSEL';
  $('#heroSub').textContent=ok?'SYSTEM ONLINE':'NICHT EINSATZBEREIT';
  if(!$('#orb').classList.contains('busy'))$('#orbState').textContent=ok?'BEREIT · TIPPEN ZUM SPRECHEN':'KI-SCHLÜSSEL FEHLT · EINSTELLUNGEN';
}
function orbBusy(b,txt){$('#orb').classList.toggle('busy',b);if(b||txt)$('#orbState').textContent=txt||'DENKT NACH …';else refreshReady();}
function speakWeb(t){if(!window.speechSynthesis)return;const u=new SpeechSynthesisUtterance(t);u.lang=cfg.lang;speechSynthesis.cancel();speechSynthesis.speak(u);}
// Native Android-Sprachausgabe statt der Browser-Stimme, wenn moeglich: nutzt bevorzugt Samsungs eigene
// TTS-Engine (klingt natuerlicher), faellt automatisch auf die Web-Stimme zurueck, wenn nicht verfuegbar.
// Fuer die Sprachausgabe: Emojis, Markdown-Zeichen und Links weglassen (sonst liest die Stimme sie vor)
function speechClean(t){return String(t||'').replace(/[\p{Extended_Pictographic}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu,' ').replace(/https?:\/\/\S+/g,' ').replace(/[*_`#~|]+/g,' ').replace(/\s{2,}/g,' ').trim();}
function speak(t){
  t=speechClean(t);
  if(cfg.tts!=='1'||!t)return;
  const P=NATIVE&&window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.AriTts;
  if(P){P.speak({text:t,lang:cfg.lang}).catch(()=>speakWeb(t));return;}
  speakWeb(t);
}
async function send(text){
  text=(text||'').trim();if(!text)return;
  addMsg('u',text);hist.push({role:'user',content:text});const w=addMsg('a','…');orbBusy(true);
  const reply=await ask(text);
  w._tx.textContent=String(reply).replace(/\*\*(.+?)\*\*/g,'$1');(links||[]).forEach(l=>{const a=document.createElement('a');a.className='lk';a.href=l.url;a.target='_blank';a.rel='noopener';a.textContent='↗ '+l.label;w.appendChild(a);});
  hist.push({role:'assistant',content:reply});if(hist.length>20)hist.splice(0,hist.length-20);
  $('#log').scrollTop=1e9;orbBusy(false);speak(reply);
}
$('#send').onclick=()=>{const v=$('#msg').value;$('#msg').value='';send(v);};
$('#msg').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#send').click();}});
$$('.chips .btn[data-q]').forEach(b=>b.onclick=()=>{const q=b.dataset.q;if(q.endsWith(' ')){$('#msg').value=q;$('#msg').focus();}else send(q);});
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
async function nativeMic(){
  const P=window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.SpeechRecognition;
  if(!P){addMsg('a','Spracheingabe ist in dieser App nicht verfügbar – nutze das Mikrofon deiner Tastatur.');return;}
  try{
    const av=await P.available();if(!av.available){addMsg('a','Dieses Handy hat keine Spracherkennung – nutze das Mikrofon deiner Tastatur.');return;}
    const perm=await P.requestPermissions();if(perm.speechRecognition!=='granted'){addMsg('a','Bitte erlaube A.R.I das Mikrofon (Handy-Einstellungen → Apps → A.R.I → Berechtigungen).');return;}
    orbBusy(true,'HÖRT ZU …');
    const r=await P.start({language:cfg.lang,maxResults:1,prompt:'Sag A.R.I, was er tun soll',partialResults:false,popup:false});
    orbBusy(false);const txt=(r&&r.matches&&r.matches[0])||'';if(txt)send(txt);
  }catch(e){orbBusy(false);}
}
function mic(){
  if(NATIVE){nativeMic();return;}
  if(!SR){addMsg('a','Spracheingabe wird von diesem Browser nicht unterstützt – nutze das Mikrofon deiner Tastatur.');return;}
  const r=new SR();r.lang=cfg.lang;orbBusy(true,'HÖRT ZU …');r.onresult=e=>send(e.results[0][0].transcript);r.onend=()=>orbBusy(false);r.onerror=()=>orbBusy(false);try{r.start();}catch(e){orbBusy(false);}
}
$('#mic').onclick=mic;$('#orb').onclick=mic;

/* ---------- Gehirn ---------- */
let brainCat='ALLE';
function renderBrain(){
  $('#brTag').textContent=brain.length+' ERINNERUNGEN';
  const cats={};brain.forEach(n=>cats[n.cat]=(cats[n.cat]||0)+1);
  const cb=$('#brCats');cb.textContent='';
  ['ALLE',...Object.keys(cats).sort()].forEach(c=>{const b=document.createElement('button');b.className='cat'+(c===brainCat?' on':'');b.textContent=c==='ALLE'?'ALLE ('+brain.length+')':c+' ('+cats[c]+')';b.onclick=()=>{brainCat=c;renderBrain();};cb.appendChild(b);});
  const q=$('#brSearch').value.trim().toLowerCase(),list=$('#brList');list.textContent='';
  const sel=[...brain].reverse().filter(n=>(brainCat==='ALLE'||n.cat===brainCat)&&(!q||n.text.toLowerCase().includes(q)));
  if(!sel.length){list.textContent=brain.length?'Nichts gefunden.':'Noch nichts gespeichert – sag „Merk dir, dass …“.';list.className='dim';return;}list.className='';
  sel.slice(0,200).forEach(n=>{const d=document.createElement('div');d.className='mem';d.style.display='flex';d.style.gap='8px';d.style.justifyContent='space-between';
    const c=document.createElement('div');const s=document.createElement('small');s.textContent=n.cat.toUpperCase();const t=document.createElement('div');t.textContent=n.text;c.append(s,t);
    const x=document.createElement('button');x.className='btn dng';x.style.cssText='min-height:32px;padding:4px 10px;flex:none';x.textContent='✕';x.onclick=()=>{brain=brain.filter(m=>m!==n);saveBrain();sync.deleted=(sync.deleted||[]).concat(n.text);saveSync();syncSoon();renderBrain();};
    d.append(c,x);list.appendChild(d);});
}
$('#brSearch').addEventListener('input',renderBrain);
$('#brAdd').onclick=()=>{const t=$('#brNew').value.trim();if(t.length<4)return;runTool('remember',{text:t,category:'Notizen'});$('#brNew').value='';renderBrain();};

/* ---------- Gehirn 3D-Ansicht (identische Optik/Physik wie am PC-Hub, Daten kommen aus dem lokalen "brain"-Array) ---------- */
(function brain3D(){
  const overlay=document.getElementById('brainOverlay');
  const stage=document.getElementById('brainStage');
  const canvas=document.getElementById('brainCanvas');
  if(!canvas)return;
  const ctx=canvas.getContext('2d');
  const info=document.getElementById('brainInfo');
  const statsEl=document.getElementById('brainStats');
  const posCache={};
  let cats=[],memories=[],nodes=[],edges=[],byId={};
  let W=0,H=0,dpr=1,raf=0,running=false;
  let yaw=0.6,pitch=0.25,zoom=1,targetZoom=1;
  let idleUntil=0,drag=null,hoverNode=null,selected=null,t0=performance.now();
  let particles=[];
  const STOP=new Set(['dass','eine','einen','einem','einer','nicht','oder','aber','auch','sind','wird','mein','meine','meiner','dein','habe','haben','wenn','dann','sehr','gerne','immer','mehr','wurde','beim','sich','über','unter']);
  const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||'#ff2d78';
  function rgba(hex,a){let h=hex.replace('#','');if(h.length===3)h=h.split('').map(c=>c+c).join('');if(!/^[0-9a-f]{6}$/i.test(h))return `rgba(255,45,120,${a})`;const n=parseInt(h,16);return `rgba(${n>>16},${(n>>8)&255},${n&255},${a})`;}
  let palette=[];
  function readPalette(){palette=[css('--pink'),css('--cyan'),css('--pink-2')||css('--pink'),css('--cyan-2')||css('--cyan')];}
  function words(t){return new Set((t.toLowerCase().match(/[a-zäöüß0-9]{5,}/g)||[]).filter(w=>!STOP.has(w)));}

  function build(){
    readPalette();
    nodes=[];edges=[];byId={};
    const core={id:'core',kind:'core',label:'A.R.I',x:0,y:0,z:0,r:15,col:palette[0]};
    nodes.push(core);
    const n=cats.length;
    cats.forEach((c,i)=>{
      const k=(i+0.5)/n,phi=Math.acos(1-2*k),th=Math.PI*(1+Math.sqrt(5))*i;
      const R=270;
      const hub={id:'hub:'+c,kind:'hub',label:c.toUpperCase(),cat:c,r:9,
        x:R*Math.sin(phi)*Math.cos(th),y:R*Math.cos(phi),z:R*Math.sin(phi)*Math.sin(th),
        col:palette[(i%2===0)?0:1]};
      nodes.push(hub);edges.push({a:core,b:hub,w:1});
    });
    const hubOf=c=>nodes.find(x=>x.id==='hub:'+c)||nodes[1];
    const wordSets=new Map();
    memories.forEach((m)=>{
      const hub=hubOf(m.cat);
      const a=Math.random()*Math.PI*2,b=Math.acos(2*Math.random()-1),d=70+Math.random()*90;
      const node={id:m.id,kind:'mem',label:m.text,m,cat:m.cat,hub,
        r:4.6+Math.min(3,(m.uses||0)*0.6),col:hub.col,
        x:hub.x+d*Math.sin(b)*Math.cos(a),y:hub.y+d*Math.cos(b),z:hub.z+d*Math.sin(b)*Math.sin(a)};
      if(posCache[m.id]&&posCache[m.id].cat===m.cat){Object.assign(node,{x:posCache[m.id].x,y:posCache[m.id].y,z:posCache[m.id].z,fixed:true});}
      nodes.push(node);byId[m.id]=node;
      edges.push({a:hub,b:node,w:0.6});
      wordSets.set(node,words(m.text));
    });
    const hubs=nodes.filter(x=>x.kind==='hub');
    hubs.forEach(a=>{
      hubs.filter(b=>b!==a).sort((p,q)=>Math.hypot(p.x-a.x,p.y-a.y,p.z-a.z)-Math.hypot(q.x-a.x,q.y-a.y,q.z-a.z)).slice(0,2).forEach(b=>{
        if(!edges.some(e=>(e.a===a&&e.b===b)||(e.a===b&&e.b===a)))edges.push({a,b,w:0.5,ring:true});
      });
    });
    hubs.forEach(hub=>{
      const ring=[];
      for(let i=0;i<20;i++){
        const a=Math.random()*Math.PI*2,b=Math.acos(2*Math.random()-1),d=45+Math.random()*130;
        const dn={id:'dust'+hub.cat+i,kind:'dust',r:1.7,col:hub.col,hub,
          x:hub.x+d*Math.sin(b)*Math.cos(a),y:hub.y+d*Math.cos(b),z:hub.z+d*Math.sin(b)*Math.sin(a)};
        nodes.push(dn);ring.push(dn);
        edges.push({a:hub,b:dn,w:0.25,dust:true});
        if(i>0&&Math.random()<0.7)edges.push({a:ring[i-1],b:dn,w:0.25,dust:true});
      }
    });
    const mems=nodes.filter(x=>x.kind==='mem');
    for(let i=0;i<mems.length;i++){
      let links=0;
      for(let j=i+1;j<mems.length&&links<2;j++){
        const A=wordSets.get(mems[i]),B=wordSets.get(mems[j]);
        for(const w of A)if(B.has(w)){edges.push({a:mems[i],b:mems[j],w:0.5,cross:true});links++;break;}
      }
    }
    const movable=mems.filter(n=>!n.fixed);
    for(let it=0;it<70;it++){
      for(let i=0;i<movable.length;i++){
        const p=movable[i];
        for(let j=i+1;j<movable.length;j++){
          const q=movable[j];
          let dx=p.x-q.x,dy=p.y-q.y,dz=p.z-q.z;
          const d2=dx*dx+dy*dy+dz*dz+1;
          if(d2>10000)continue;
          const f=260/d2;
          dx*=f;dy*=f;dz*=f;
          p.x+=dx;p.y+=dy;p.z+=dz;q.x-=dx;q.y-=dy;q.z-=dz;
        }
        const hx=p.hub.x-p.x,hy=p.hub.y-p.y,hz=p.hub.z-p.z;
        const hd=Math.sqrt(hx*hx+hy*hy+hz*hz)+0.01,want=100;
        const k=(hd-want)/hd*0.06;
        p.x+=hx*k;p.y+=hy*k;p.z+=hz*k;
      }
    }
    mems.forEach(n=>{posCache[n.id]={x:n.x,y:n.y,z:n.z,cat:n.cat};});
    particles=[];
    const count=Math.min(40,edges.length);
    for(let i=0;i<count;i++)particles.push({e:edges[Math.floor(Math.random()*edges.length)],t:Math.random(),s:0.15+Math.random()*0.3});
    statsEl.innerHTML=`${memories.length} ERINNERUNGEN<br>${cats.length} BEREICHE`;
  }

  function resize(){dpr=Math.min(2,window.devicePixelRatio||1);W=stage.clientWidth;H=stage.clientHeight;canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);}
  function project(p){
    const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
    let x=p.x*cy-p.z*sy,z=p.x*sy+p.z*cy;
    let y=p.y*cp-z*sp;z=p.y*sp+z*cp;
    const persp=700/(700+z);
    const sc=persp*zoom*Math.min(W,H)/800;
    p.sx=W/2+x*sc;p.sy=H/2+y*sc;p.sz=z;p.sc=sc;
  }
  const stars=Array.from({length:220},()=>({x:(Math.random()-.5)*1200,y:(Math.random()-.5)*1200,z:(Math.random()-.5)*1200,a:Math.random()}));
  function glow(x,y,r,col,a){
    const g=ctx.createRadialGradient(x,y,0,x,y,r*3.2);
    g.addColorStop(0,rgba(col,a));g.addColorStop(0.35,rgba(col,a*0.35));g.addColorStop(1,rgba(col,0));
    ctx.fillStyle=g;ctx.beginPath();ctx.arc(x,y,r*3.2,0,7);ctx.fill();
  }
  function focusSet(){
    if(!selected)return null;
    const s=new Set([selected]);
    edges.forEach(e=>{if(e.a===selected)s.add(e.b);if(e.b===selected)s.add(e.a);});
    if(selected.kind==='mem')s.add(selected.hub);
    return s;
  }
  function frame(now){
    if(!running)return;
    raf=requestAnimationFrame(frame);
    const dt=Math.min(0.05,(now-t0)/1000);t0=now;
    if(!drag&&now>idleUntil)yaw+=dt*0.12;
    zoom+=(targetZoom-zoom)*Math.min(1,dt*8);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,W,H);
    ctx.globalCompositeOperation='lighter';
    stars.forEach(st=>{project(st);ctx.fillStyle=`rgba(230,236,245,${0.10+0.25*st.a*(1-st.sz/1300)})`;ctx.fillRect(st.sx,st.sy,1.2,1.2);});
    nodes.forEach(project);
    const focus=focusSet();
    edges.forEach(e=>{
      const on=!focus||(focus.has(e.a)&&focus.has(e.b));
      const depth=1-Math.max(-1,Math.min(1,(e.a.sz+e.b.sz)/900));
      const al=(on?0.10+0.32*depth:0.03)*(e.w+0.4)*(e.dust?0.7:1);
      ctx.strokeStyle=rgba(e.cross?palette[1]:e.a.col,al);
      ctx.lineWidth=(e.cross||e.dust)?0.6:(e.ring?0.8:1);
      ctx.beginPath();ctx.moveTo(e.a.sx,e.a.sy);ctx.lineTo(e.b.sx,e.b.sy);ctx.stroke();
    });
    particles.forEach(p=>{
      p.t+=dt*p.s;if(p.t>1){p.t=0;p.e=edges[Math.floor(Math.random()*edges.length)];}
      if(!p.e)return;
      const x=p.e.a.sx+(p.e.b.sx-p.e.a.sx)*p.t,y=p.e.a.sy+(p.e.b.sy-p.e.a.sy)*p.t;
      glow(x,y,1.6,palette[1],0.9);
    });
    const order=nodes.slice().sort((a,b)=>b.sz-a.sz);
    order.forEach(n=>{
      const dim=focus&&!focus.has(n)?0.25:1;
      const depth=0.55+0.45*(1-Math.max(-1,Math.min(1,n.sz/400)))/2;
      let r=n.r*n.sc*(n===hoverNode||n===selected?1.35:1);
      if(n.kind==='core')r*=1.06;
      const a=Math.min(1,depth)*dim;
      if(n.kind==='dust'){glow(n.sx,n.sy,r,n.col,0.5*a);n._r=Math.max(7,r*2.6);return;}
      glow(n.sx,n.sy,r,n.col,(n.kind==='mem'?0.75:0.95)*a);
      if(n.kind==='hub'){ctx.strokeStyle=rgba(n.col,0.5*a);ctx.lineWidth=1;ctx.beginPath();ctx.arc(n.sx,n.sy,r*1.5,0,7);ctx.stroke();}
      ctx.fillStyle=rgba('#ffffff',(n.kind==='mem'?0.7:0.9)*a);
      ctx.beginPath();ctx.arc(n.sx,n.sy,Math.max(1,r*0.42),0,7);ctx.fill();
      n._r=Math.max(8,r*1.6);
    });
    ctx.globalCompositeOperation='source-over';
    order.forEach(n=>{
      const show=(n.kind!=='dust'&&n.kind!=='mem')||n===hoverNode||n===selected||(zoom>1.7&&n.sz<60&&(!focus||focus.has(n)));
      if(!show)return;
      const dim=focus&&!focus.has(n)?0.3:1;
      ctx.font=n.kind==='mem'?'500 11px JetBrains Mono, monospace':'700 '+(n.kind==='core'?13:10)+'px Chakra Petch, sans-serif';
      let txt=n.kind==='dust'?n.hub.label:n.label;
      if(n.kind==='mem'&&txt.length>40)txt=txt.slice(0,38)+'…';
      ctx.fillStyle=rgba(n.kind==='mem'?'#e6ecf5':n.col,0.95*dim);
      ctx.textAlign='center';
      ctx.fillText(txt,n.sx,n.sy-n._r-6);
    });
  }
  function pick(mx,my){let best=null,bd=1e9;nodes.forEach(n=>{const d=Math.hypot(n.sx-mx,n.sy-my);if(d<(n._r||14)+6&&d<bd){best=n;bd=d;}});return best;}
  const pos=ev=>{const r=canvas.getBoundingClientRect();const p=(ev.touches&&ev.touches[0])||ev;return [p.clientX-r.left,p.clientY-r.top];};

  canvas.addEventListener('pointerdown',ev=>{canvas.setPointerCapture(ev.pointerId);const [x,y]=pos(ev);drag={x,y,moved:false};});
  canvas.addEventListener('pointermove',ev=>{
    const [x,y]=pos(ev);
    if(drag){
      const dx=x-drag.x,dy=y-drag.y;
      if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
      yaw+=dx*0.007;pitch=Math.max(-1.4,Math.min(1.4,pitch+dy*0.007));
      drag.x=x;drag.y=y;idleUntil=performance.now()+3000;
    }else{hoverNode=pick(x,y);}
  });
  canvas.addEventListener('pointerup',ev=>{
    const wasClick=drag&&!drag.moved;drag=null;
    if(wasClick){const [x,y]=pos(ev);select(pick(x,y));}
    idleUntil=performance.now()+3000;
  });
  canvas.addEventListener('wheel',ev=>{ev.preventDefault();targetZoom=Math.max(0.5,Math.min(3.5,targetZoom*(ev.deltaY<0?1.12:1/1.12)));idleUntil=performance.now()+3000;},{passive:false});

  function select(n){
    if(n&&n.kind==='dust')n=n.hub;
    selected=n;
    if(!n||n.kind==='core'){selected=null;info.classList.remove('show');return;}
    info.classList.add('show');
    document.getElementById('biCat').textContent=(n.kind==='hub'?'BEREICH · ':'')+(n.cat||'').toUpperCase();
    if(n.kind==='hub'){
      const list=memories.filter(m=>m.cat===n.cat);
      const bt=document.getElementById('biText');
      bt.innerHTML=list.length?list.map(m=>`<div class="bi-item" data-id="${m.id}">• ${escHtml(m.text)}</div>`).join(''):'Noch nichts gespeichert.';
      bt.querySelectorAll('.bi-item').forEach(el=>el.addEventListener('click',()=>{if(byId[el.dataset.id])select(byId[el.dataset.id]);}));
      document.getElementById('biMeta').textContent='';
      document.getElementById('biDelete').style.display='none';
    }else{
      document.getElementById('biText').textContent=n.m.text;
      document.getElementById('biText').style.cssText='';
      document.getElementById('biMeta').textContent='GESPEICHERT';
      document.getElementById('biDelete').style.display='';
    }
  }

  function load(){
    const byC={};brain.forEach(n=>{byC[n.cat]=(byC[n.cat]||0)+1;});
    cats=Object.keys(byC).sort();
    if(!cats.length)cats=['Wissen'];
    memories=brain.map(n=>({id:n.id,cat:n.cat,text:n.text,uses:0}));
    selected=null;info.classList.remove('show');build();
  }
  function open(){
    overlay.classList.add('open');readPalette();resize();running=true;t0=performance.now();idleUntil=0;
    load();cancelAnimationFrame(raf);raf=requestAnimationFrame(frame);
  }
  function close(){overlay.classList.remove('open');running=false;cancelAnimationFrame(raf);}
  document.getElementById('brain3dBtn').addEventListener('click',open);
  document.getElementById('brainClose').addEventListener('click',close);
  overlay.addEventListener('mousedown',ev=>{if(ev.target===overlay)close();});
  window.addEventListener('resize',()=>{if(running)resize();});
  document.getElementById('biDelete').addEventListener('click',()=>{
    if(!selected||selected.kind!=='mem')return;
    brain=brain.filter(m=>m!==selected.m);saveBrain();sync.deleted=(sync.deleted||[]).concat(selected.m.text);saveSync();syncSoon();renderBrain();
    load();
  });
})();

/* ---------- PC ---------- */
function renderPcs(){
  const box=$('#pcSaved');box.textContent='';
  pcs.forEach((p,i)=>{const r=document.createElement('div');r.className='row';r.style.marginTop='8px';
    const go=document.createElement('button');go.className='btn';go.textContent='▣ '+p.name;go.onclick=()=>{location.href=p.url;};
    const del=document.createElement('button');del.className='btn dng';del.style.flex='0 0 52px';del.textContent='✕';del.onclick=()=>{pcs.splice(i,1);store.set('ari-app-pcs',pcs);renderPcs();};
    r.append(go,del);box.appendChild(r);});
}
$('#pcGo').onclick=()=>{
  let v=$('#pcLink').value.trim();if(!v){$('#pcMsg').textContent='Bitte Link oder Adresse einfügen.';return;}
  {const L=parseLink(v);if(L){$('#pcLink').value='';pairFromLink(L.origin,L.code);return;}}
  {const M=/^(https?:[/][/][^/#]+)[/]phone#c=([0-9]{6})/.exec(v);if(M&&NATIVE){$('#pcLink').value='';pairFromLink(M[1],M[2]);return;}}
  if(!/^https?:\/\//i.test(v))v='http://'+v;
  let u;try{u=new URL(v);}catch(e){$('#pcMsg').textContent='Ungültige Adresse.';return;}
  if(!/\/phone/.test(u.pathname))u.pathname=u.pathname.replace(/\/$/,'')+'/phone';
  const url=u.toString();
  if(!/[#&]l=/.test(url)){const nm=u.hostname.endsWith('trycloudflare.com')?'PC (unterwegs)':'PC ('+u.hostname+')';
    if(!pcs.some(p=>p.url===url)){pcs.push({name:nm,url});store.set('ari-app-pcs',pcs);}}
  location.href=url;
};

/* ---------- Termine / Benachrichtigungen (kommen vom verbundenen PC, gleiche Karten wie im Hub) ---------- */
/*GOOGLE-BEGIN*/
// Google direkt vom Handy (ohne PC): Anmeldung mit PKCE ueber den System-Browser, Kalender- und Gmail-API selbst abrufen.
const G_REDIRECT='com.ari.assistant:/oauth2redirect';
const gMailOn=()=>(cfg.gMail||'1')!=='0';
const gScopes=()=>'https://www.googleapis.com/auth/calendar.readonly'+(gMailOn()?' https://www.googleapis.com/auth/gmail.readonly':'');
let gTok=store.get('ari-app-gtok',null);
const gOn=()=>!!(cfg.gClientId&&gTok&&gTok.refresh);
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const gForm=o=>Object.keys(o).map(k=>encodeURIComponent(k)+'='+encodeURIComponent(o[k])).join('&');
async function gStart(){
  if(!cfg.gClientId){$('#gStatus').textContent='Bitte zuerst die Client-ID eintragen.';return;}
  const ver=b64u(crypto.getRandomValues(new Uint8Array(48))),st=b64u(crypto.getRandomValues(new Uint8Array(16)));
  const ch=b64u(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ver)));
  store.set('ari-app-gpkce',{ver,st,t:Date.now()});
  const url='https://accounts.google.com/o/oauth2/v2/auth?'+gForm({client_id:cfg.gClientId,redirect_uri:G_REDIRECT,response_type:'code',scope:gScopes(),code_challenge:ch,code_challenge_method:'S256',state:st,access_type:'offline',prompt:'consent'});
  $('#gStatus').textContent='Google-Anmeldung wird im Browser geöffnet …';
  const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener';document.body.appendChild(a);a.click();a.remove();
}
async function gTokenReq(body){
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:gForm(body)});
  const d=await r.json();if(!r.ok||d.error)throw new Error(d.error_description||d.error||('HTTP '+r.status));return d;
}
async function gHandleRedirect(u){
  try{
    const x=new URL(String(u).replace(/^com\.ari\.assistant:[/]?/,'https://ari.invalid/'));
    const code=x.searchParams.get('code'),st=x.searchParams.get('state'),err=x.searchParams.get('error');
    const p=store.get('ari-app-gpkce',null);store.set('ari-app-gpkce',null);
    if(err){$('#gStatus').textContent='Anmeldung abgebrochen ('+err+').';return;}
    if(!code||!p||p.st!==st){$('#gStatus').textContent='Anmeldung ungültig – bitte nochmal versuchen.';return;}
    const d=await gTokenReq({client_id:cfg.gClientId,code,code_verifier:p.ver,redirect_uri:G_REDIRECT,grant_type:'authorization_code'});
    gTok={access:d.access_token,refresh:d.refresh_token||(gTok&&gTok.refresh)||'',exp:Date.now()+(d.expires_in||3600)*1000};store.set('ari-app-gtok',gTok);
    loadSet();goTab('cal');
  }catch(e){$('#gStatus').textContent='Anmeldung fehlgeschlagen: '+String(e.message).slice(0,120);}
}
async function gAccess(){
  if(!gTok||!gTok.refresh)return null;
  if(gTok.access&&gTok.exp>Date.now()+60000)return gTok.access;
  let d;try{d=await gTokenReq({client_id:cfg.gClientId,refresh_token:gTok.refresh,grant_type:'refresh_token'});}
  catch(e){if(/invalid_grant|expired|revoked/i.test(String(e.message))){gTok=null;store.set('ari-app-gtok',null);try{loadSet();}catch(x){}throw new Error('Google-Anmeldung abgelaufen – bitte in den Einstellungen neu anmelden');}throw e;}
  gTok.access=d.access_token;gTok.exp=Date.now()+(d.expires_in||3600)*1000;store.set('ari-app-gtok',gTok);return gTok.access;
}
async function gApi(url,retry){
  const t=await gAccess();if(!t)throw new Error('nicht angemeldet');
  const r=await fetch(url,{headers:{Authorization:'Bearer '+t}});
  if(r.status===401&&!retry){gTok.exp=0;return gApi(url,true);}
  if(!r.ok)throw new Error('Google '+r.status);return r.json();
}
const gDate=(o)=>{if(!o)return null;if(o.date){const m=/^(\d{4})-(\d\d)-(\d\d)/.exec(o.date);return new Date(+m[1],+m[2]-1,+m[3]);}return new Date(o.dateTime);};
async function gLoadEvents(){
  const now=new Date(),from=new Date(now);from.setHours(0,0,0,0);const to=new Date(from.getTime()+90*86400000);
  const cals=['primary'];
  try{const cl=await gApi('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=owner&maxResults=8');
    (cl.items||[]).forEach(c=>{if(c.selected!==false&&!c.primary&&!/holiday|feiertag/i.test(c.id)&&cals.length<5)cals.push(c.id);});}catch(e){}
  const all=[];
  await Promise.all(cals.map(async id=>{
    try{const d=await gApi('https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(id)+'/events?'+gForm({timeMin:from.toISOString(),timeMax:to.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'40'}));
      (d.items||[]).forEach(e=>{if(e.status==='cancelled')return;const s0=gDate(e.start),e0=gDate(e.end);if(!s0)return;
        all.push({title:e.summary||'(ohne Titel)',start:s0.toISOString(),end:e0?e0.toISOString():'',allDay:!!(e.start&&e.start.date),location:e.location||''});});
    }catch(e){if(id==='primary')throw e;}
  }));
  const seen=new Set();const uniq=all.filter(e=>{const k=e.title+'|'+e.start;if(seen.has(k))return false;seen.add(k);return true;});
  uniq.sort((a,b)=>new Date(a.start)-new Date(b.start));return uniq.slice(0,40);
}
const spamList=()=>store.get('ari-app-spam',[]);
async function gLoadMails(){
  const l=await gApi('https://gmail.googleapis.com/gmail/v1/users/me/messages?'+gForm({q:'category:primary is:unread',labelIds:'INBOX',maxResults:'15'}));
  const spam=spamList().map(x=>x.toLowerCase());
  const out=await Promise.all((l.messages||[]).map(async m=>{
    try{const d=await gApi('https://gmail.googleapis.com/gmail/v1/users/me/messages/'+m.id+'?format=metadata&metadataHeaders=From&metadataHeaders=Subject');
      const H={};((d.payload&&d.payload.headers)||[]).forEach(x=>H[x.name.toLowerCase()]=x.value);
      const raw=H.from||'?',name=(/^\s*"?([^"<]+?)"?\s*</.exec(raw)||[])[1]||raw.replace(/[<>]/g,'');
      return {id:m.id,from:name.trim(),addr:raw,subject:H.subject||''};}catch(e){return null;}
  }));
  return out.filter(x=>x&&!spam.some(s=>x.addr.toLowerCase().includes(s)||s.includes(x.from.toLowerCase()))).slice(0,10);
}
window.__ariG={gStart,gHandleRedirect};
/*GOOGLE-END*/
/*ICS-BEGIN*/
// Google-Kalender direkt (ohne PC): "Geheime Adresse im iCal-Format" einlesen und Serientermine der naechsten 90 Tage ausrechnen
function parseIcs(txt){
  txt=String(txt).replace(/\r?\n[ \t]/g,'');
  const parseDt=(k,v)=>{
    if(/VALUE=DATE(?!-)/.test(k)||/^\d{8}$/.test(v)){const m=/^(\d{4})(\d\d)(\d\d)/.exec(v);return {d:new Date(+m[1],+m[2]-1,+m[3]),allDay:true};}
    const m=/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)?(Z?)/.exec(v);if(!m)return null;
    const d=m[7]?new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0))):new Date(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+(m[6]||0));
    return {d,allDay:false};
  };
  const raw=[];
  txt.split('BEGIN:VEVENT').slice(1).forEach(b=>{
    b=b.split('END:VEVENT')[0];const o={ex:[]};
    b.split(/\r?\n/).forEach(l=>{
      const i=l.indexOf(':');if(i<0)return;const k=l.slice(0,i),v=l.slice(i+1),n=k.split(';')[0].toUpperCase();
      if(n==='SUMMARY')o.title=v.replace(/\\n/g,' ').replace(/\\([,;\\])/g,'$1');
      else if(n==='LOCATION')o.location=v.replace(/\\n/g,', ').replace(/\\([,;\\])/g,'$1');
      else if(n==='UID')o.uid=v;
      else if(n==='STATUS')o.status=v;
      else if(n==='DTSTART'){const p=parseDt(k,v);if(p){o.start=p.d;o.allDay=p.allDay;}}
      else if(n==='DTEND'){const p=parseDt(k,v);if(p)o.end=p.d;}
      else if(n==='RRULE')o.rrule=v;
      else if(n==='EXDATE'){v.split(',').forEach(x=>{const p=parseDt(k,x);if(p)o.ex.push(p.d.getTime());});}
      else if(n==='RECURRENCE-ID'){const p=parseDt(k,v);if(p)o.recId=p.d.getTime();}
    });
    if(o.start&&o.status!=='CANCELLED')raw.push(o);
  });
  const now=new Date(),from=new Date(now);from.setHours(0,0,0,0);const to=new Date(from.getTime()+90*86400000);
  const overrides=new Set(raw.filter(e=>e.recId!=null).map(e=>e.uid+'|'+e.recId));
  const out=[];
  const push=(e,st)=>{const dur=e.end?e.end-e.start:(e.allDay?86400000:0),en=new Date(st.getTime()+dur);if(en>=from&&st<=to)out.push({title:e.title||'(ohne Titel)',start:st.toISOString(),end:en.toISOString(),allDay:!!e.allDay,location:e.location||''});};
  raw.forEach(e=>{
    if(e.recId!=null||!e.rrule){push(e,e.start);return;}
    const R={};e.rrule.split(';').forEach(p=>{const q=p.split('=');R[q[0]]=q[1];});
    const iv=Math.max(1,+R.INTERVAL||1),cnt=R.COUNT?+R.COUNT:1e9;let until=null;
    if(R.UNTIL){const p=parseDt('',R.UNTIL.length===8?R.UNTIL:R.UNTIL);if(p)until=p.d.getTime()+(p.allDay?86400000-1:0);}
    const days={SU:0,MO:1,TU:2,WE:3,TH:4,FR:5,SA:6};
    const cand=[];const s0=e.start;
    if(R.FREQ==='DAILY'){for(let i=0;i<800;i++){const d=new Date(s0);d.setDate(d.getDate()+i*iv);cand.push(d);if(d>to)break;}}
    else if(R.FREQ==='WEEKLY'){
      const wd=(R.BYDAY?R.BYDAY.split(',').map(x=>days[x.slice(-2)]):[s0.getDay()]).filter(x=>x!=null).sort((a,b)=>a-b);
      const wk0=new Date(s0);wk0.setDate(wk0.getDate()-wk0.getDay());
      for(let w=0;w<300;w++){let past=false;wd.forEach(x=>{const d=new Date(wk0);d.setDate(d.getDate()+w*7*iv+x);d.setHours(s0.getHours(),s0.getMinutes(),s0.getSeconds());if(d>=s0)cand.push(d);if(d>to)past=true;});if(past)break;}
    }
    else if(R.FREQ==='MONTHLY'){for(let i=0;i<120;i++){const d=new Date(s0);d.setDate(1);d.setMonth(d.getMonth()+i*iv);d.setDate(R.BYMONTHDAY?+R.BYMONTHDAY:s0.getDate());cand.push(d);if(d>to)break;}}
    else if(R.FREQ==='YEARLY'){for(let i=0;i<20;i++){const d=new Date(s0);d.setFullYear(d.getFullYear()+i*iv);cand.push(d);if(d>to)break;}}
    else cand.push(s0);
    let n=0;
    for(const d of cand){
      if(n>=cnt)break;n++;
      if(until!=null&&d.getTime()>until)break;
      if(e.ex.includes(d.getTime())||overrides.has(e.uid+'|'+d.getTime()))continue;
      push(e,d);
    }
  });
  out.sort((a,b)=>new Date(a.start)-new Date(b.start));
  return out.slice(0,40);
}
/*ICS-END*/
let calCache=store.get('ari-app-caldata',null);
function calAgo(t){const m=Math.round((Date.now()-t)/60000);return m<1?'gerade eben':m<60?'vor '+m+' Min.':m<1440?'vor '+Math.round(m/60)+' Std.':'vor '+Math.round(m/1440)+' Tg.';}
async function loadCalData(){
  const calList=$('#calList'),mailList=$('#mailList');
  const paired=!!(sync.token&&sync.origin),hasIcs=!!(cfg.icsUrl),direct=gOn();
  if(calCache&&(calCache.events||calCache.mails)){renderCalEvents(calCache);renderCalMails(calCache);}   // sofort zeigen, was zuletzt geladen wurde
  if(!paired&&!hasIcs&&!direct&&!(calCache&&calCache.at)){
    calList.innerHTML='<li class="termin-empty">Melde dich in den Einstellungen bei Google an – dann laufen Termine und Mails ganz ohne PC. Oder verbinde dich im Tab „PC".</li>';
    mailList.innerHTML='<li class="termin-empty">Noch nicht bei Google angemeldet.</li>';$('#calTag').textContent='–';$('#mailTag').textContent='–';return;
  }
  $('#calTag').textContent='LÄDT …';if(paired)$('#mailTag').textContent='LÄDT …';
  const fresh={events:calCache&&calCache.events||[],mails:calCache&&calCache.mails||[],at:calCache&&calCache.at||0};
  let calOk=false,mailOk=false,authErr=false;
  let gErr='';
  if(direct){
    try{fresh.events=await gLoadEvents();calOk=true;}catch(e){gErr=String(e.message);}
    if(gMailOn()){try{fresh.mails=await gLoadMails();mailOk=true;}catch(e){gErr=gErr||String(e.message);}}
  }
  if(!calOk&&hasIcs){
    try{const r=await fetch(cfg.icsUrl);if(!r.ok)throw new Error('http '+r.status);fresh.events=parseIcs(await r.text());calOk=true;}catch(e){}
  }
  if(paired&&!(calOk&&(mailOk||(direct&&!gMailOn())))){
    try{
      const r=await hubFetch('/phone/api/data',{headers:{'X-Ari-Token':sync.token}});
      if(r.status===401)authErr=true;
      else{const d=await r.json();if(!mailOk){fresh.mails=d.mails||[];mailOk=true;}if(!calOk){fresh.events=d.events||[];fresh.events_error=d.events_error;calOk=true;}}
    }catch(e){}
  }
  if(calOk||mailOk){fresh.at=Date.now();calCache=fresh;store.set('ari-app-caldata',{events:fresh.events,mails:fresh.mails,at:fresh.at});}
  renderCalEvents(calCache||fresh);renderCalMails(calCache||fresh);
  if(!calOk){$('#calTag').textContent=calCache&&calCache.at?'OFFLINE · '+calAgo(calCache.at).toUpperCase():'OFFLINE';if(!(calCache&&(calCache.events||[]).length))calList.innerHTML='<li class="termin-empty">'+(hasIcs?'Kalender-Adresse gerade nicht erreichbar.':'PC gerade nicht erreichbar.')+'</li>';}
  if(paired&&!mailOk){$('#mailTag').textContent=authErr?'NEU KOPPELN':(calCache&&calCache.at?'OFFLINE · '+calAgo(calCache.at).toUpperCase():'OFFLINE');}
  if(direct&&gErr&&!calOk)$('#calTag').textContent=/neu anmelden/.test(gErr)?'NEU ANMELDEN':'GOOGLE-FEHLER';
  if(!paired&&!mailOk){$('#mailTag').textContent=(calCache&&(calCache.mails||[]).length)?'STAND '+calAgo(calCache.at).toUpperCase():'–';if(!(calCache&&(calCache.mails||[]).length))mailList.innerHTML='<li class="termin-empty">'+(direct?'E-Mails konnten nicht geladen werden ('+escHtml(gErr)+').':'E-Mails kommen vom verbundenen PC.')+'</li>';}
}
const CAL_PAL=['#e8c468','#3fa9ff','#b58cff','#5ec8b8','#ff2d78','#39ff9e'];
function calColor(seed){let h=0;for(const c of String(seed))h=(h*31+c.charCodeAt(0))>>>0;return CAL_PAL[h%CAL_PAL.length];}
function renderCalEvents(d){
  const list=$('#calList');
  if(d.events_error&&!(d.events||[]).length){list.innerHTML='<li class="termin-empty">'+escHtml(d.events_error)+'</li>';$('#calTag').textContent='FEHLER';return;}
  const ev=(d.events||[]).slice(0,10);
  $('#calTag').textContent=ev.length?ev.length+' TERMINE':'KEINE TERMINE';
  if(!ev.length){list.innerHTML='<li class="termin-empty">Keine anstehenden Termine.</li>';return;}
  list.innerHTML=ev.map(e=>{
    const start=new Date(e.start),color=calColor(e.title||'?');
    const fmt=x=>x.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'});
    const when=e.allDay?fmt(start):fmt(start)+' · '+start.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    const day=String(start.getDate()).padStart(2,'0'),mon=start.toLocaleDateString('de-DE',{month:'short'}).replace('.','').toUpperCase();
    const today0=new Date();today0.setHours(0,0,0,0);const start0=new Date(start);start0.setHours(0,0,0,0);
    const diff=Math.round((start0-today0)/86400000);
    let rel='',relCls='';
    if(diff<0){rel='läuft';relCls='today';}else if(diff===0){rel='heute';relCls='today';}else if(diff===1){rel='morgen';relCls='soon';}else if(diff<=7){rel='in '+diff+' Tagen';relCls='soon';}else rel='in '+diff+' Tagen';
    return `<li class="termin-item" style="--cal-color:${color}"><div class="t-date"><b>${day}</b><span>${escHtml(mon)}</span></div><div class="t-body"><div class="ttitle">${escHtml(e.title||'')}</div><div class="when"><span class="chip"><span class="dot"></span><span class="txt">${escHtml(when)}</span></span></div>${e.location?`<div class="tsub">📍 ${escHtml(e.location)}</div>`:''}</div><span class="t-rel ${relCls}">${escHtml(rel)}</span></li>`;
  }).join('');
}
function renderCalMails(d){
  const list=$('#mailList');
  const mails=(d.mails||[]).slice(0,8);
  $('#mailTag').textContent=mails.length?mails.length+' NEU':'KEINE';
  if(!mails.length){list.innerHTML='<li class="termin-empty">Keine wichtigen E-Mails — alles ruhig.</li>';return;}
  list.innerHTML=mails.map(m=>{
    const from=String(m.from||'?'),color=calColor(from),initial=(from.replace(/[^A-Za-zÄÖÜäöü0-9]/g,'').charAt(0)||'✉').toUpperCase();
    return `<li class="termin-item notif-card" style="--cal-color:${color}" data-mail-id="${escHtml(m.id||'')}" data-mail-from="${escHtml(from)}"><div class="t-date"><b>${escHtml(initial)}</b><span>MAIL</span></div><div class="t-body"><div class="ttitle">${escHtml(from)}</div><div class="when"><span class="chip"><span class="dot"></span><span class="txt">${escHtml(m.subject||'')}</span></span></div></div><button type="button" class="notif-dismiss" data-spam="1" title="Als Spam markieren" aria-label="Als Spam markieren"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/></svg></button></li>`;
  }).join('');
}
$('#mailList').addEventListener('click',async(e)=>{
  const btn=e.target.closest('[data-spam]');if(!btn)return;
  const li=btn.closest('[data-mail-id]');const id=li.dataset.mailId,from=li.dataset.mailFrom;
  li.remove();
  if(gOn()){const sp=spamList();const k=(li.dataset.mailFrom||'').toLowerCase();if(k&&!sp.includes(k)){sp.push(k);store.set('ari-app-spam',sp.slice(-200));}}
  if(!sync.token||!sync.origin)return;
  try{await hubFetch('/phone/api/spam',{method:'POST',headers:{'Content-Type':'application/json','X-Ari-Token':sync.token},body:JSON.stringify({id,from})});}catch(err){}
});
function escHtml(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
setInterval(()=>{if(document.getElementById('t-cal').classList.contains('on'))loadCalData();},60000);


/* ---------- Einstellungen ---------- */
function loadSet(){
  $('#sProv').value=cfg.provider;$('#sKey').value=cfg.keys[cfg.provider]||'';$('#sProv2').value=cfg.fb||'';$('#sKey2').value=cfg.fbKey||'';$('#sLang').value=cfg.lang;$('#sGroqMore').value=(sync.groqAll||[]).slice(1).join(String.fromCharCode(10));
  $$('#sTts .btn').forEach(b=>b.classList.toggle('on',b.dataset.v===cfg.tts));
  $$('#sPc .btn').forEach(b=>b.classList.toggle('on',b.dataset.v===(cfg.pcRoute||'auto')));
  $('#sIcs').value=cfg.icsUrl||'';$('#sGid').value=cfg.gClientId||'';
  $('#gStatus').textContent=gOn()?'✓ Bei Google angemeldet – Termine und Mails laufen direkt über Google, ohne PC.':'Nicht angemeldet.';
  $('#gLogout').style.display=gOn()?'':'none';
  $$('#sGMail .btn').forEach(b=>b.classList.toggle('on',b.dataset.v===(cfg.gMail||'1')));
}
$('#sProv').onchange=()=>{cfg.provider=$('#sProv').value;$('#sKey').value=cfg.keys[cfg.provider]||'';saveCfg();sync.dirtySet=true;saveSync();syncSoon();};
$('#sKey').onchange=()=>{cfg.keys[cfg.provider]=$('#sKey').value.trim();saveCfg();sync.dirtyKeys=true;saveSync();syncSoon();};
$('#sGroqMore').onchange=()=>{const more=$('#sGroqMore').value.split(new RegExp("[ "+String.fromCharCode(9,10,13)+",;]+")).map(x=>x.trim()).filter(Boolean);sync.groqAll=[cfg.keys.groq||'',...more];sync.dirtyKeys=true;saveSync();syncSoon();};
$('#sProv2').onchange=()=>{cfg.fb=$('#sProv2').value;saveCfg();};
$('#sKey2').onchange=()=>{cfg.fbKey=$('#sKey2').value.trim();saveCfg();};
$('#sLang').onchange=()=>{cfg.lang=$('#sLang').value;saveCfg();};
$$('#sTts .btn').forEach(b=>b.onclick=()=>{cfg.tts=b.dataset.v;saveCfg();loadSet();});
$$('#sPc .btn').forEach(b=>b.onclick=()=>{cfg.pcRoute=b.dataset.v;saveCfg();loadSet();});
$$('#sGMail .btn').forEach(b=>b.onclick=()=>{cfg.gMail=b.dataset.v;saveCfg();loadSet();});
$('#gCopyPkg').onclick=()=>{try{navigator.clipboard.writeText('com.ari.assistant');$('#gStatus').textContent='Paketname kopiert.';}catch(e){}};
$('#gCopySha').onclick=()=>{try{navigator.clipboard.writeText('B6:AF:C9:89:4F:7A:A9:4E:0B:8B:E7:A2:A2:A7:72:D9:0E:B8:2E:48');$('#gStatus').textContent='SHA-1 kopiert.';}catch(e){}};
$('#sGid').onchange=()=>{cfg.gClientId=$('#sGid').value.trim();saveCfg();};
$('#gLogin').onclick=()=>{cfg.gClientId=$('#sGid').value.trim();saveCfg();gStart();};
$('#gLogout').onclick=()=>{gTok=null;store.set('ari-app-gtok',null);calCache=null;store.set('ari-app-caldata',null);loadSet();loadCalData();};
$('#sIcs').onchange=()=>{cfg.icsUrl=$('#sIcs').value.trim();saveCfg();calCache=null;store.set('ari-app-caldata',null);loadCalData();};
$('#sImportBtn').onclick=()=>$('#sImport').click();
$('#sImport').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;const msg=$('#sImportMsg');
  try{
    const s=JSON.parse(await f.text());const k=s.apiKeys||{};
    const groq=(Array.isArray(k.groq)?k.groq:[k.groq]).filter(Boolean)[0]||'';
    ['anthropic','openai','gemini'].forEach(p=>{if(k[p])cfg.keys[p]=String(k[p]);});if(groq)cfg.keys.groq=String(groq);{const gl=(Array.isArray(k.groq)?k.groq:[k.groq]).filter(Boolean).map(String);if(gl.length)sync.groqAll=gl;}
    if(PROV[s.provider])cfg.provider=s.provider;
    if(s.language&&s.language!=='auto')cfg.lang=s.language;
    for(const p of ['gemini','groq','openai','anthropic']){if(p!==cfg.provider&&cfg.keys[p]){cfg.fb=p;cfg.fbKey=cfg.keys[p];break;}}
    if(s.primary&&/^#[0-9a-f]{6}$/i.test(s.primary))document.documentElement.style.setProperty('--pink',s.primary);
    if(s.accent&&/^#[0-9a-f]{6}$/i.test(s.accent))document.documentElement.style.setProperty('--cyan',s.accent);
    store.set('ari-app-theme',{primary:s.primary,accent:s.accent});
    sync.dirtyKeys=true;sync.dirtySet=true;saveSync();syncSoon();saveCfg();loadSet();msg.textContent='✓ Übernommen: Anbieter '+cfg.provider+(cfg.fb?', Ausweich '+cfg.fb:'')+'. (Nur Schlüssel/Anbieter/Sprache/Farben – die Datei bleibt auf dem Handy.)';
  }catch(er){msg.textContent='Datei nicht lesbar.';}
  e.target.value='';
};
{const th=store.get('ari-app-theme',null);if(th){if(th.primary)document.documentElement.style.setProperty('--pink',th.primary);if(th.accent)document.documentElement.style.setProperty('--cyan',th.accent);}}
function dl(name,obj){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(obj,null,1)],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();a.remove();}
$('#brExport').onclick=()=>dl('ari-gehirn.json',{nodes:brain});
$('#brImportBtn').onclick=()=>$('#brImport').click();
$('#brImport').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{const d=JSON.parse(await f.text());const arr=Array.isArray(d)?d:(d.nodes||[]);
  arr.forEach(n=>{const t=String(n.text||'').trim();if(t.length>=4&&!brain.some(m=>m.text.toLowerCase()===t.toLowerCase()))brain.push({id:String(n.id||Date.now()+Math.random()),text:t,cat:String(n.cat||n.category||'Wissen').slice(0,30),ts:Date.now()});});
  saveBrain();renderBrain();}catch(er){}e.target.value='';};
$('#wipe').onclick=()=>{if(!confirm('Alle Daten dieser App auf diesem Handy löschen (Schlüssel, Gehirn, gespeicherte PCs)?'))return;
  ['ari-app-cfg','ari-app-brain','ari-app-pcs','ari-app-theme'].forEach(k=>{try{localStorage.removeItem(k);}catch(e){}});location.reload();};


/* ---------- Synchronisation mit dem PC (Gehirn, Einstellungen, API-Schluessel) ---------- */
// Die App sendet Daten NUR an den PC, mit dem du sie per Link gekoppelt hast (Geraete-Token).
let sync=store.get('ari-app-sync',{origin:'',token:'',deleted:[],dirtyKeys:false,dirtySet:false,last:0,groqAll:[],pc:{}});
const saveSync=()=>store.set('ari-app-sync',sync);
// Der PC-Tunnel hat bei jedem Start eine neue Adresse. Antwortet der PC nicht, holt sich die App die aktuelle Adresse
// selbststaendig (der Hub meldet sie unter dem geheimen Themennamen bei ntfy.sh) und versucht es damit noch einmal.
async function hubResolve(){
  if(!sync.topic)return false;
  try{
    const r=await fetch('https://ntfy.sh/'+encodeURIComponent(sync.topic)+'/json?poll=1&since=24h');
    const t=await r.text();let url='';
    t.split('\n').forEach(l=>{try{const m=JSON.parse(l);const x=/^ARI-URL (https:\/\/[a-z0-9-]+\.trycloudflare\.com)$/.exec(String(m.message||''));if(x)url=x[1];}catch(e){}});
    if(url&&url!==sync.origin){sync.origin=url;saveSync();return true;}
  }catch(e){}
  return false;
}
async function hubFetch(path,opts){
  try{return await fetch(sync.origin+path,opts);}
  catch(e){if(e&&e.name==='AbortError')throw e;if(await hubResolve())return await fetch(sync.origin+path,opts);throw e;}
}
const SYNC_TRUSTED=new RegExp('^https:[/][/][a-z0-9-]+[.]trycloudflare[.]com$');
const LAN_OK=new RegExp('^http:[/][/](192[.]168[.][0-9]+[.][0-9]+|10[.][0-9]+[.][0-9]+[.][0-9]+|172[.](1[6-9]|2[0-9]|3[01])[.][0-9]+[.][0-9]+)(:[0-9]+)?$');
function syncStatus(t,ok){$('#syncStatus').textContent=t;$('#syncTag').textContent=sync.token?(ok===false?'GETRENNT':'VERBUNDEN'):'–';}
async function pairFromLink(origin,code){
  if(!(SYNC_TRUSTED.test(origin)||(NATIVE&&LAN_OK.test(origin)))){syncStatus('Ungültige PC-Adresse im Link.',false);return;}
  if(!confirm('Mit deinem PC verbinden und alles synchronisieren (Gehirn, Einstellungen, API-Schlüssel)?\n\nAdresse: '+origin+'\n\nNur bestätigen, wenn der Link von deinem eigenen A.R.I stammt.'))return;
  syncStatus('Verbinde …');
  try{
    const r=await fetch(origin+'/phone/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,name:'Handy-App'})});
    const d=await r.json();
    if(!r.ok||!d.token){syncStatus('Kopplung fehlgeschlagen: '+(d.error||r.status),false);return;}
    sync.origin=origin;sync.token=d.token;sync.topic=d.topic||'';sync.dirtyKeys=false;sync.dirtySet=false;saveSync();
    await syncNow();goTab('pc');
  }catch(e){syncStatus('PC nicht erreichbar (läuft A.R.I und der Tunnel?).',false);}
}
function parseLink(str){
  const m=/pc=([^&]+)&l=([A-Za-z0-9_-]+)/.exec(str||'');if(!m)return null;
  let o;try{o=decodeURIComponent(m[1]);}catch(e){return null;}return {origin:o.replace(/\/+$/,''),code:m[2]};
}
function pushSettings(){const s={};if(!sync.dirtySet)return s;s.provider=cfg.provider;return s;}
function pushKeys(){
  if(!sync.dirtyKeys)return undefined;
  const k={};['anthropic','openai','gemini'].forEach(p=>{k[p]=cfg.keys[p]||'';});
  const g=(sync.groqAll||[]).slice();g[0]=cfg.keys.groq||'';k.groq=g.filter(Boolean);return k;
}
let syncBusy=false;
async function syncNow(){
  if(!sync.token||!sync.origin||syncBusy)return;syncBusy=true;
  try{
    const body={brain:brain.map(n=>({text:n.text,cat:n.cat})),deleted:sync.deleted||[],settings:pushSettings(),apiKeys:pushKeys()};
    const r=await hubFetch('/phone/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Ari-Token':sync.token},body:JSON.stringify(body)});
    if(r.status===401){sync.token='';saveSync();syncStatus('Kopplung abgelaufen – bitte den neuen Link aus der A.R.I-Mail öffnen.',false);return;}
    const d=await r.json();
    if(d.topic&&d.topic!==sync.topic){sync.topic=d.topic;saveSync();}
    // Gehirn: Stand vom PC uebernehmen (enthaelt jetzt auch unsere Ergaenzungen), lokale IDs behalten
    const old=new Map(brain.map(n=>[n.text.toLowerCase(),n]));
    brain=(d.brain||[]).map(n=>{const o=old.get(String(n.text).toLowerCase());return o?Object.assign(o,{cat:n.cat}):{id:Date.now()+Math.random().toString(36).slice(2,6),text:n.text,cat:n.cat,ts:Date.now()};});
    saveBrain();sync.deleted=[];
    // Einstellungen + Schluessel vom PC
    const s=d.settings||{};sync.pc=s;
    if(!sync.dirtySet){if(PROV[s.provider])cfg.provider=s.provider;}
    if(s.language&&s.language!=='auto'&&[...$('#sLang').options].some(o=>o.value===s.language))cfg.lang=s.language;
    if(s.primary&&/^#[0-9a-f]{6}$/i.test(s.primary)||s.accent){const th={primary:s.primary,accent:s.accent};store.set('ari-app-theme',th);applyThemeSaved();}
    const k=d.apiKeys||{};['anthropic','openai','gemini'].forEach(p=>{if(typeof k[p]==='string'&&k[p])cfg.keys[p]=k[p];});
    if(Array.isArray(k.groq)&&k.groq.length){sync.groqAll=k.groq;cfg.keys.groq=k.groq[0];}
    if(cfg.fb&&cfg.keys[cfg.fb])cfg.fbKey=cfg.keys[cfg.fb];
    else{for(const p of ['gemini','groq','openai','anthropic']){if(p!==cfg.provider&&cfg.keys[p]){cfg.fb=p;cfg.fbKey=cfg.keys[p];break;}}}
    sync.dirtyKeys=false;sync.dirtySet=false;sync.last=Date.now();saveSync();saveCfg();loadSet();
    syncStatus('✓ Synchron · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' · '+brain.length+' Erinnerungen'+(d.hud_seen?'':' · (HUD am PC einmal öffnen, damit alle Einstellungen ankommen)'));
    if($('#t-brain').classList.contains('on'))renderBrain();
  }catch(e){syncStatus('PC gerade nicht erreichbar – Änderungen werden nachgeholt. (Tunnel-Adresse ändert sich bei jedem PC-Start: neuen Link aus der Mail öffnen.)',false);}
  finally{syncBusy=false;}
}
function applyThemeSaved(){const th=store.get('ari-app-theme',null);if(th){if(th.primary)document.documentElement.style.setProperty('--pink',th.primary);if(th.accent)document.documentElement.style.setProperty('--cyan',th.accent);}}
let syncT=null;const syncSoon=()=>{clearTimeout(syncT);syncT=setTimeout(syncNow,1500);};
$('#syncNow').onclick=syncNow;
$('#syncOff').onclick=()=>{if(!confirm('Synchronisation mit dem PC beenden? (Daten auf dem Handy bleiben.)'))return;sync.token='';sync.origin='';saveSync();syncStatus('Nicht mit dem PC verbunden.');};
setInterval(()=>{if(!document.hidden)syncNow();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncNow();});
/* QR-Link im Handy-Browser: Button, der die installierte A.R.I-App oeffnet (statt im Browser weiterzumachen) */
function showOpenInApp(L){
  const ov=document.createElement('div');ov.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:9998;padding:16px;background:#0b1620;border-top:1px solid var(--cyan);color:#dff6ff;text-align:center';
  const link='intent://pair?pc='+encodeURIComponent(L.origin)+'&l='+encodeURIComponent(L.code)+'#Intent;scheme=ari;package=com.ari.assistant;end';
  ov.innerHTML='<div style="margin-bottom:10px;font-size:14px">Mit der A.R.I-App verbinden?</div><a href="'+link+'" class="btn pri" style="display:block;text-decoration:none;margin-bottom:8px">IN DER A.R.I-APP ÖFFNEN</a><button class="btn" id="stayWeb" style="width:100%">IM BROWSER FORTFAHREN</button>';
  document.body.appendChild(ov);
  setTimeout(()=>{try{location.href=link;}catch(e){}},350);   // gleich versuchen, die App zu oeffnen (manche Browser blockieren das - dann bleibt der Knopf)
  $('#stayWeb').onclick=()=>{ov.remove();history.replaceState(null,'',location.pathname+location.search);pairFromLink(L.origin,L.code);};
}
function handleDeepLink(u){
  if(/^com\.ari\.assistant:/.test(String(u))){gHandleRedirect(u);return;}
  {const L=parseLink(String(u));if(L&&/^https:/i.test(String(u))){goTab('pc');pairFromLink(L.origin,L.code);return;}}   // App-Link aus der Mail: https://…/app/#pc=…&l=…
  try{const x=new URL(String(u).replace(/^ari:[/][/]/,'https://ari.invalid/'));const o=x.searchParams.get('pc'),c=x.searchParams.get('l');
    if(o&&c){goTab('pc');pairFromLink(o.replace(/[/]+$/,''),c);}}catch(e){}
}
if(NATIVE){try{const AP=Capacitor.Plugins.App;AP.addListener('appUrlOpen',e=>handleDeepLink(e.url));AP.getLaunchUrl().then(r=>{if(r&&r.url)handleDeepLink(r.url);}).catch(()=>{});}catch(e){}}
{const L=parseLink(location.hash);if(L&&!NATIVE&&/android/i.test(navigator.userAgent)){showOpenInApp(L);}else if(L){history.replaceState(null,'',location.pathname+location.search);pairFromLink(L.origin,L.code);}
 else if(sync.token){syncStatus('Verbunden mit PC – synchronisiere …');syncNow();}}


/* ---------- App-Update ueber GitHub (nur in der installierten Android-App) ---------- */
// Prueft beim Start und alle 6 Stunden version.json neben der App-Seite. Ist die Version neuer, laedt die App die
// neue ARI.apk von derselben Adresse und startet die Installation (Android fragt einmal "Aktualisieren?").
const UPDATE_BASE='https://kingshadow1332.github.io/app/';
let updInfo=null;
async function appBuild(){try{const i=await Capacitor.Plugins.App.getInfo();return {build:parseInt(i.build,10)||0,version:i.version||''};}catch(e){return null;}}
async function checkUpdate(manual){
  if(!NATIVE){if(manual){$('#updText').textContent='Updates gibt es nur in der installierten Android-App. Die Web-App aktualisiert sich beim Neuladen selbst.';}return;}
  const cur=await appBuild();if(cur){$('#updVer').textContent='VERSION '+cur.version;}
  try{
    const r=await fetch(UPDATE_BASE+'version.json?t='+Date.now(),{cache:'no-store'});
    const d=await r.json();
    if(cur&&d.versionCode>cur.build){
      updInfo=d;
      const nl=(d.notes||'').split('\n').map(s=>s.trim()).filter(Boolean);
      $('#updBannerVer').textContent='v'+d.versionName;$('#updBannerText').textContent=(nl.length?nl.slice(0,2).join(' · ')+(nl.length>2?' …':''):'Neue Version bereit.')+' (ca. '+(d.sizeMb||6)+' MB)';
      if(nl.length>2){$('#updBannerText').onclick=()=>showPatchNotes('Neu in '+d.versionName,d.notes);}
      $('#updBanner').style.display='';$('#updGo').style.display='';$('#updText').textContent='Neue Version '+d.versionName+' ist verfügbar.';
    }else{
      updInfo=null;$('#updBanner').style.display='none';$('#updGo').style.display='none';if(manual)$('#updText').textContent='✓ Du hast die neueste Version.';
      // Nach einem Update einmalig die Patch Notes der jetzt installierten Version zeigen
      try{
        const seen=localStorage.getItem('ari_seen_build');
        if(cur&&seen!==String(cur.build)){localStorage.setItem('ari_seen_build',String(cur.build));if(seen!==null&&d.versionCode===cur.build&&d.notes)showPatchNotes('Neu in '+d.versionName,d.notes);}
      }catch(e){}
    }
  }catch(e){if(manual)$('#updText').textContent='Update-Suche nicht möglich (kein Internet?).';}
}
function showPatchNotes(title,notes){
  const items=(notes||'').split('\n').map(s=>s.trim().replace(/^[-*•]\s*/,'')).filter(Boolean);if(!items.length)return;
  const esc=s=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const old=document.getElementById('ariPatchNotes');if(old)old.remove();
  const o=document.createElement('div');o.id='ariPatchNotes';
  o.style.cssText='position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.6)';
  o.innerHTML='<div style="max-width:460px;width:90%;max-height:80vh;overflow:auto;padding:20px 24px;border:1px solid #00d4ff;border-radius:10px;background:#0b1620;color:#dff6ff"><div style="letter-spacing:.2em;font-size:12px;opacity:.7">PATCH NOTES</div><div style="font-size:18px;margin:4px 0 12px">'+esc(title)+'</div><ul style="margin:0 0 16px 18px;padding:0;line-height:1.6;font-size:14px">'+items.map(i=>'<li>'+esc(i)+'</li>').join('')+'</ul><button type="button" id="ariPatchOk" style="width:100%;padding:10px;border:1px solid #00d4ff;background:transparent;color:#dff6ff;border-radius:6px">OK</button></div>';
  document.body.appendChild(o);const close=()=>o.remove();o.querySelector('#ariPatchOk').onclick=close;o.onclick=e=>{if(e.target===o)close();};
}
async function doUpdate(){
  if(!updInfo)return;const P=Capacitor.Plugins.ApkInstaller;$('#updProg').textContent='Lade …';$('#updBannerText').textContent='Lade Update …';
  try{
    P.addListener('progress',e=>{const t='Lade '+e.percent+' %';$('#updProg').textContent=t;$('#updBannerText').textContent=t;});
    await P.install({url:UPDATE_BASE+(updInfo.apk||'ARI.apk')});
    $('#updProg').textContent='Installation gestartet – bestätige „Aktualisieren“.';
  }catch(e){
    if(String(e&&e.message||e).includes('permission')){$('#updProg').textContent='Erlaube A.R.I einmal „Apps installieren“ in dem Fenster, das sich geöffnet hat – und tippe dann nochmal auf Aktualisieren.';}
    else $('#updProg').textContent='Fehler: '+(e&&e.message||e);
  }
}
if(NATIVE){$('#updPanel').style.display='';}
$('#updCheck').onclick=()=>checkUpdate(true);$('#updGo').onclick=doUpdate;$('#updBannerGo').onclick=doUpdate;$('#updBannerLater').onclick=()=>{$('#updBanner').style.display='none';};
if(NATIVE){setTimeout(()=>checkUpdate(false),1500);setInterval(()=>checkUpdate(false),6*3600*1000);}
/* ---------- QR-Code vom PC scannen ---------- */
let qrStream=null,qrRaf=0;
async function qrStart(){
  $('#qrOv').style.display='flex';$('#qrMsg').textContent='Richte die Kamera auf den QR-Code am PC (Einstellungen → HANDY).';
  try{qrStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});}
  catch(e){qrStop();$('#pcMsg').textContent='Kamera nicht erlaubt (Handy-Einstellungen → Apps → A.R.I → Berechtigungen).';return;}
  const v=$('#qrVid');v.srcObject=qrStream;await v.play().catch(()=>{});
  const c=document.createElement('canvas'),x=c.getContext('2d',{willReadFrequently:true});let n=0;
  const tick=()=>{
    if(!qrStream)return;
    if(v.videoWidth&&(n++%3===0)){
      const sc=Math.min(1,640/v.videoWidth);c.width=Math.round(v.videoWidth*sc);c.height=Math.round(v.videoHeight*sc);x.drawImage(v,0,0,c.width,c.height);
      const d=x.getImageData(0,0,c.width,c.height),r=window.jsQR&&jsQR(d.data,d.width,d.height);
      if(r&&r.data){
        const L=parseLink(r.data),M=/^(https?:[/][/][^/#]+)[/]phone#c=([0-9]{6})/.exec(r.data);
        if(L||M){qrStop();if(L)pairFromLink(L.origin,L.code);else if(NATIVE)pairFromLink(M[1],M[2]);else $('#pcLink').value=r.data;return;}
        $('#qrMsg').textContent='Das ist kein A.R.I-QR-Code.';
      }
    }
    qrRaf=requestAnimationFrame(tick);
  };
  tick();
}
function qrStop(){cancelAnimationFrame(qrRaf);if(qrStream){qrStream.getTracks().forEach(t=>t.stop());qrStream=null;}$('#qrOv').style.display='none';}
$('#qrScan').onclick=qrStart;$('#qrClose').onclick=qrStop;

/* ---------- Weckwort im Hintergrund (nur Android-App, optional) ---------- */
const WK=()=>window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.AriWake;
async function wakeRefresh(){
  if(!NATIVE||!WK())return;$('#wakeSection').style.display='';
  try{const s=await WK().status();$('#wakeTag').textContent=s.running?'AN':'AUS';$('#wakeToggle').textContent=s.running?'AUSSCHALTEN':'EINSCHALTEN';
    $('#wakeMsg').textContent=s.overlay?'':'Tipp: Erlaube „Über anderen Apps“, damit sich A.R.I von selbst nach vorne holen darf.';}catch(e){}
}
async function wakeStart(){
  const SRP=Capacitor.Plugins.SpeechRecognition;
  try{if(SRP){const p=await SRP.requestPermissions();if(p.speechRecognition!=='granted'){$('#wakeMsg').textContent='Bitte erlaube A.R.I das Mikrofon.';return false;}}}catch(e){}
  try{await WK().start();return true;}catch(e){$('#wakeMsg').textContent=String(e&&e.message||e)==='mic_permission'?'Bitte erlaube A.R.I das Mikrofon.':'Konnte nicht starten: '+(e&&e.message||e);return false;}
}
if(NATIVE&&WK()){
  $('#wakeToggle').onclick=async()=>{
    const s=await WK().status();
    if(s.running){await WK().stop();cfg.wake='0';saveCfg();}
    else if(await wakeStart()){cfg.wake='1';saveCfg();}
    wakeRefresh();
  };
  $('#wakeOverlay').onclick=()=>WK().openOverlaySettings();
  // Vom Weckwort geoeffnet -> sofort zuhoeren
  const wakeCheck=async()=>{try{const r=await WK().consumeWake();if(r&&r.wake){goTab('chat');setTimeout(mic,400);}}catch(e){}};
  try{Capacitor.Plugins.App.addListener('appStateChange',st=>{if(st.isActive){wakeCheck();wakeRefresh();}});}catch(e){}
  wakeRefresh();wakeCheck();
  if(cfg.wake==='1')WK().status().then(s=>{if(!s.running)wakeStart().then(wakeRefresh);});
}
/* ---------- Start ---------- */
refreshReady();
loadSet();
addMsg('a','Hallo! Ich bin A.R.I – diese App läuft auch ohne PC. '+(cfg.keys[cfg.provider]?'Sag oder tipp mir, was ich tun soll.':'Trage zuerst in den Einstellungen einen KI-Schlüssel ein (oder übernimm die Datei vom PC).'));
if('serviceWorker' in navigator&&!NATIVE){navigator.serviceWorker.register('sw.js').catch(()=>{});}
})();
