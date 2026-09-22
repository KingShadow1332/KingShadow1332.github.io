(function(){
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const NATIVE=!!(window.Capacitor&&Capacitor.isNativePlatform&&Capacitor.isNativePlatform());
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};

/* ---------- Zustand ---------- */
const cfg=Object.assign({provider:'groq',keys:{},fb:'',fbKey:'',lang:'de-DE',tts:'1'},store.get('ari-app-cfg',{}));
cfg.keys=cfg.keys||{};
let brain=store.get('ari-app-brain',[]);
let pcs=store.get('ari-app-pcs',[]);
const hist=[];
const saveCfg=()=>{store.set('ari-app-cfg',cfg);try{refreshReady();}catch(e){}};
const saveBrain=()=>store.set('ari-app-brain',brain);

/* ---------- Tabs / Uhr ---------- */
function goTab(t){$$('nav button').forEach(x=>x.classList.toggle('on',x.dataset.t===t));$$('section').forEach(s=>s.classList.toggle('on',s.id==='t-'+t));if(t==='brain')renderBrain();if(t==='pc')renderPcs();}
$$('nav button').forEach(b=>b.onclick=()=>goTab(b.dataset.t));
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
async function ask(text){
  links=[];
  const q=text.toLowerCase();
  // Ohne KI: Uhrzeit/Datum
  if(/^(wie spaet|wie spät)( ist es)?\??$|^uhrzeit\??$/.test(q.trim()))return 'Es ist '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+' Uhr.';
  if(/^(welcher tag|welches datum|den wievielten)/.test(q.trim()))return 'Heute ist '+new Date().toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long',year:'numeric'})+'.';
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
function speak(t){
  if(cfg.tts!=='1'||!t)return;
  const P=NATIVE&&window.Capacitor&&Capacitor.Plugins&&Capacitor.Plugins.AriTts;
  if(P){P.speak({text:t,lang:cfg.lang}).catch(()=>speakWeb(t));return;}
  speakWeb(t);
}
async function send(text){
  text=(text||'').trim();if(!text)return;
  addMsg('u',text);hist.push({role:'user',content:text});const w=addMsg('a','…');orbBusy(true);
  const reply=await ask(text);
  w._tx.textContent=reply;(links||[]).forEach(l=>{const a=document.createElement('a');a.className='lk';a.href=l.url;a.target='_blank';a.rel='noopener';a.textContent='↗ '+l.label;w.appendChild(a);});
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
    const r=await P.start({language:cfg.lang,maxResults:1,prompt:'Sag A.R.I, was er tun soll',partialResults:false,popup:true});
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

/* ---------- Einstellungen ---------- */
function loadSet(){
  $('#sProv').value=cfg.provider;$('#sKey').value=cfg.keys[cfg.provider]||'';$('#sProv2').value=cfg.fb||'';$('#sKey2').value=cfg.fbKey||'';$('#sLang').value=cfg.lang;$('#sGroqMore').value=(sync.groqAll||[]).slice(1).join(String.fromCharCode(10));
  $$('#sTts .btn').forEach(b=>b.classList.toggle('on',b.dataset.v===cfg.tts));
}
$('#sProv').onchange=()=>{cfg.provider=$('#sProv').value;$('#sKey').value=cfg.keys[cfg.provider]||'';saveCfg();sync.dirtySet=true;saveSync();syncSoon();};
$('#sKey').onchange=()=>{cfg.keys[cfg.provider]=$('#sKey').value.trim();saveCfg();sync.dirtyKeys=true;saveSync();syncSoon();};
$('#sGroqMore').onchange=()=>{const more=$('#sGroqMore').value.split(new RegExp("[ "+String.fromCharCode(9,10,13)+",;]+")).map(x=>x.trim()).filter(Boolean);sync.groqAll=[cfg.keys.groq||'',...more];sync.dirtyKeys=true;saveSync();syncSoon();};
$('#sProv2').onchange=()=>{cfg.fb=$('#sProv2').value;saveCfg();};
$('#sKey2').onchange=()=>{cfg.fbKey=$('#sKey2').value.trim();saveCfg();};
$('#sLang').onchange=()=>{cfg.lang=$('#sLang').value;saveCfg();};
$$('#sTts .btn').forEach(b=>b.onclick=()=>{cfg.tts=b.dataset.v;saveCfg();loadSet();});
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
    sync.origin=origin;sync.token=d.token;sync.dirtyKeys=false;sync.dirtySet=false;saveSync();
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
    const r=await fetch(sync.origin+'/phone/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Ari-Token':sync.token},body:JSON.stringify(body)});
    if(r.status===401){sync.token='';saveSync();syncStatus('Kopplung abgelaufen – bitte den neuen Link aus der A.R.I-Mail öffnen.',false);return;}
    const d=await r.json();
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
  $('#stayWeb').onclick=()=>{ov.remove();history.replaceState(null,'',location.pathname+location.search);pairFromLink(L.origin,L.code);};
}
function handleDeepLink(u){
  try{const x=new URL(String(u).replace(/^ari:[/][/]/,'https://ari.invalid/'));const o=x.searchParams.get('pc'),c=x.searchParams.get('l');
    if(o&&c){goTab('pc');pairFromLink(o.replace(/[/]+$/,''),c);}}catch(e){}
}
if(NATIVE){try{const AP=Capacitor.Plugins.App;AP.addListener('appUrlOpen',e=>handleDeepLink(e.url));AP.getLaunchUrl().then(r=>{if(r&&r.url)handleDeepLink(r.url);}).catch(()=>{});}catch(e){}}
{const L=parseLink(location.hash);if(L&&!NATIVE&&/android/i.test(navigator.userAgent)){showOpenInApp(L);}else if(L){history.replaceState(null,'',location.pathname+location.search);pairFromLink(L.origin,L.code);}
 else if(sync.token){syncStatus('Verbunden mit PC – synchronisiere …');syncNow();}}

/* ---------- Als App installieren ---------- */
let installEvt=null;
const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvt=e;$('#installPanel').style.display='';$('#installBtn').style.display='';});
$('#installBtn').onclick=async()=>{if(!installEvt)return;installEvt.prompt();try{await installEvt.userChoice;}catch(e){}installEvt=null;$('#installBtn').style.display='none';};
window.addEventListener('appinstalled',()=>{$('#installPanel').style.display='none';});
if(!isStandalone()){
  const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
  if(ios){$('#installPanel').style.display='';$('#installText').textContent='iPhone/iPad: Tippe unten in Safari auf „Teilen“ (Quadrat mit Pfeil) und dann auf „Zum Home-Bildschirm“. Danach startet A.R.I wie eine App.';}
  else{setTimeout(()=>{if(!installEvt&&!isStandalone()){$('#installPanel').style.display='';$('#installText').textContent='Android/Chrome: Tippe oben rechts auf das Menü (⋮) und dann auf „App installieren“ bzw. „Zum Startbildschirm hinzufügen“.';}},2500);}
}

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
  if(!NATIVE||!WK())return;$('#wakePanel').style.display='';
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
