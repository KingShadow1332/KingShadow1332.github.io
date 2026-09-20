(function(){
'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const store={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v);}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};

/* ---------- Zustand ---------- */
const cfg=Object.assign({provider:'groq',keys:{},fb:'',fbKey:'',lang:'de-DE',tts:'1'},store.get('ari-app-cfg',{}));
cfg.keys=cfg.keys||{};
let brain=store.get('ari-app-brain',[]);
let pcs=store.get('ari-app-pcs',[]);
const hist=[];
const saveCfg=()=>store.set('ari-app-cfg',cfg);
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
    brain.push({id:Date.now()+Math.random().toString(36).slice(2,6),text:t,cat:String(a.category||'Wissen').slice(0,30),ts:Date.now()});saveBrain();return 'Gespeichert.';}
  if(name==='forget'){const q=String(a.query||'').toLowerCase();const n0=brain.length;brain=brain.filter(n=>!n.text.toLowerCase().includes(q));saveBrain();return (n0-brain.length)+' Eintrag/Eintraege geloescht.';}
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
  try{return await runProvider(cfg.provider,key,h,small,text);}
  catch(e){
    if(small&&!isLimit(e)){try{return await runProvider(cfg.provider,key,h,false,text);}catch(e2){e=e2;}}
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
function orbBusy(b,txt){$('#orb').classList.toggle('busy',b);$('#orbState').textContent=txt||(b?'DENKT NACH …':'BEREIT · TIPPEN ZUM SPRECHEN');}
function speak(t){if(cfg.tts!=='1'||!window.speechSynthesis||!t)return;const u=new SpeechSynthesisUtterance(t);u.lang=cfg.lang;speechSynthesis.cancel();speechSynthesis.speak(u);}
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
function mic(){
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
    const x=document.createElement('button');x.className='btn dng';x.style.cssText='min-height:32px;padding:4px 10px;flex:none';x.textContent='✕';x.onclick=()=>{brain=brain.filter(m=>m!==n);saveBrain();renderBrain();};
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
  $('#sProv').value=cfg.provider;$('#sKey').value=cfg.keys[cfg.provider]||'';$('#sProv2').value=cfg.fb||'';$('#sKey2').value=cfg.fbKey||'';$('#sLang').value=cfg.lang;
  $$('#sTts .btn').forEach(b=>b.classList.toggle('on',b.dataset.v===cfg.tts));
}
$('#sProv').onchange=()=>{cfg.provider=$('#sProv').value;$('#sKey').value=cfg.keys[cfg.provider]||'';saveCfg();};
$('#sKey').onchange=()=>{cfg.keys[cfg.provider]=$('#sKey').value.trim();saveCfg();};
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
    ['anthropic','openai','gemini'].forEach(p=>{if(k[p])cfg.keys[p]=String(k[p]);});if(groq)cfg.keys.groq=String(groq);
    if(PROV[s.provider])cfg.provider=s.provider;
    if(s.language&&s.language!=='auto')cfg.lang=s.language;
    for(const p of ['gemini','groq','openai','anthropic']){if(p!==cfg.provider&&cfg.keys[p]){cfg.fb=p;cfg.fbKey=cfg.keys[p];break;}}
    if(s.primary&&/^#[0-9a-f]{6}$/i.test(s.primary))document.documentElement.style.setProperty('--pink',s.primary);
    if(s.accent&&/^#[0-9a-f]{6}$/i.test(s.accent))document.documentElement.style.setProperty('--cyan',s.accent);
    store.set('ari-app-theme',{primary:s.primary,accent:s.accent});
    saveCfg();loadSet();msg.textContent='✓ Übernommen: Anbieter '+cfg.provider+(cfg.fb?', Ausweich '+cfg.fb:'')+'. (Nur Schlüssel/Anbieter/Sprache/Farben – die Datei bleibt auf dem Handy.)';
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

/* ---------- Start ---------- */
loadSet();
addMsg('a','Hallo! Ich bin A.R.I – diese App läuft auch ohne PC. '+(cfg.keys[cfg.provider]?'Sag oder tipp mir, was ich tun soll.':'Trage zuerst in den Einstellungen einen KI-Schlüssel ein (oder übernimm die Datei vom PC).'));
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').catch(()=>{});}
})();
