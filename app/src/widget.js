// The widget window: three modes — the cat alone, the card with the cat sitting on it, and a
// strip at the left or right screen edge that slides the card out on hover. Dragging snaps to an
// edge; transparent pixels let clicks through; the cat's eyes follow the cursor anywhere on
// screen. Window geometry is Rust's, in physical pixels (main.rs) — this side only decides.
(function(){
  var invoke=window.__TAURI__.core.invoke,listen=window.__TAURI__.event.listen;
  var root=document.getElementById('root');
  var SNAP=24,BAND=58;
  var S={mode:'cat',dock:null,open:false,idleOpen:false,back:false};
  var big=Pixel.Sprite('cat','catB',3,'idle'),small=Pixel.Sprite('cat','catB',2,'idle');
  // Settings live on the back of the card (config.json through Rust); SET holds what the back shows.
  var KINDS={cat:['cat','catB','Котик'],blob:['blob','blob','Краплинка'],ghost:['ghost','ghost','Привидок']};
  var CFG={kind:'cat',sound:true},SET={autostart:false,hook:null,confirm:null,err:''};
  var minis={};Object.keys(KINDS).forEach(function(k){minis[k]=Pixel.Sprite(KINDS[k][0],KINDS[k][1],2,'idle');});

  // Live data from Rust: the session list (sessions.rs) and the plan limits (limits.rs).
  var LIST=[],moodOverride=null,lastDone=0,LIM=null,LIMWHY='';
  var ICON={Bash:'ConsoleLine',PowerShell:'ConsoleLine',Edit:'PencilOutline',Write:'PencilOutline',MultiEdit:'PencilOutline',NotebookEdit:'PencilOutline',Read:'FileDocumentOutline',Grep:'Magnify',Glob:'Magnify',WebFetch:'Internet',WebSearch:'Internet',Task:'Magic',Agent:'Magic','Агент':'Magic',Skill:'Magic','Думає':'Loading','Питає тебе':'HelpCircleOutline','Готово — твоя черга':'CheckCircleOutline','Зупинилась з помилкою':'AlertCircleOutline'};

  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function ic(n){return '<svg class="i"><use href="#'+n+'"/></svg>';}
  function col(p){return p>=85?'var(--danger)':p>=60?'var(--warn)':'var(--primary)';}
  // How long the current state has lasted — or, for an idle session, how long ago it was active.
  function ago(since){
    var s=Math.max(0,Math.floor((Date.now()-since)/1000));
    if(s<60)return s+' с';var m=Math.floor(s/60);if(m<60)return m+' хв';
    var h=Math.floor(m/60);if(h<24)return h+' г'+(m%60?' '+(m%60)+' хв':'');return 'вчора';
  }
  function until(ts){
    var m=Math.max(0,Math.round((ts-Date.now())/60000));
    if(m<60)return m+' хв';var h=Math.floor(m/60);if(h<24)return h+' г'+(m%60?' '+(m%60)+' хв':'');
    var d=Math.floor(h/24);return d+' д'+(h%24?' '+(h%24)+' г':'');
  }
  // The usage response lists the limits the way Desktop's usage card shows them: `limits` —
  // session (5 hours), weekly_all, weekly_scoped per model — each with a percent and a reset time.
  // Older responses only had five_hour / seven_day objects with a utilization; those are the fallback.
  function normLimits(d){
    if(d&&Array.isArray(d.limits)&&d.limits.length)return d.limits.filter(function(x){return typeof x.percent==='number';}).map(function(x){
      var name=x.kind==='session'?'5 годин':x.kind==='weekly_all'?'Тиждень':(x.scope&&x.scope.model&&x.scope.model.display_name)||x.kind;
      return {l:name,p:Math.round(x.percent),r:Date.parse(x.resets_at)};
    });
    var keys=Object.keys(d||{}).filter(function(k){return d[k]&&typeof d[k]==='object'&&typeof d[k].utilization==='number'&&/^(five_hour|seven_day)/.test(k);});
    keys.sort(function(a,b){var o=function(k){return k==='five_hour'?0:k==='seven_day'?1:2;};return o(a)-o(b)||a.localeCompare(b);});
    return keys.map(function(k){
      var v=d[k],r=v.resets_at,label=k==='five_hour'?'5 годин':k==='seven_day'?'Тиждень':k.replace('seven_day_','');
      label=label.charAt(0).toUpperCase()+label.slice(1);
      return {l:label,p:Math.round(v.utilization),r:typeof r==='number'?(r<1e12?r*1000:r):Date.parse(r)};
    });
  }
  function maxLim(){return LIM&&LIM.length?LIM.reduce(function(a,b){return b.p>a.p?b:a;}):null;}
  function limHTML(){
    if(!LIM||!LIM.length)return '<div class="lim"><div class="nolim">'+(LIMWHY==='net'?'Ліміти: нема з’єднання':'Ліміти: увійди в Claude Code — <code>claude</code> у терміналі')+'</div></div>';
    return '<div class="lim">'+LIM.map(function(l){return '<div class="lr"><span class="ll">'+esc(l.l)+'</span><span class="lp">'+l.p+'%</span><span class="lb"><i style="width:'+Math.min(100,l.p)+'%;background:'+col(l.p)+'"></i></span><span class="rs">'+ic('Autorenew')+'<span data-reset="'+l.r+'">'+until(l.r)+'</span></span></div>';}).join('')+'</div>';
  }
  function iconFor(s){if(s.what.indexOf('Чекає дозволу')===0)return 'KeyOutline';return ICON[s.what]||(s.state==='wait'?'HelpCircleOutline':'ConsoleLine');}
  function row(s){
    var h='<div class="row '+s.state+'" data-local="'+esc(s.local||'')+'"><span class="dot '+s.state+'"></span><div class="tx"><div class="l1"><span class="nm">'+esc(s.title)+'</span><span class="tm" data-since="'+s.since+'">'+ago(s.since)+'</span></div>';
    if(s.state!=='idle')h+='<div class="ac">'+ic(iconFor(s))+'<span class="at">'+esc(s.what+(s.detail?' · '+s.detail:''))+'</span></div>';
    if(s.round)h+='<div class="qa"><button type="button" class="qbtn" data-act="round" data-sid="'+esc(s.sid)+'" data-round="'+esc(s.round)+'" data-title="'+esc(s.title)+'">'+ic('HelpCircleOutline')+'Відповісти</button></div>';
    else if(s.state==='wait'&&s.local)h+='<div class="qa"><button type="button" class="qbtn" data-act="open">'+ic('HelpCircleOutline')+'Відкрити в Desktop</button></div>';
    return h+'</div></div>';
  }
  function by(k){return LIST.filter(function(s){return s.state===k;});}
  function active(){return LIST.filter(function(s){return s.state!=='idle';});}
  function grp(t,arr){return arr.length?'<div class="gh"><span>'+t+'</span><span>'+arr.length+'</span></div>'+arr.map(row).join(''):'';}
  function card(edge){
    var idle=by('idle'),act=active();
    return '<div class="wg'+(edge?' e'+edge:'')+'"><div class="hdr grab">'+ic('ConsoleLine')+'<span class="tt">Claude</span><span class="ct">'+(act.length?act.length+' активні':'усе тихо')+'</span><span class="sp"></span><button type="button" class="ib" data-act="flip" title="Налаштування">'+ic('CogOutline')+'</button>'+(edge?'':'<button type="button" class="ib" data-act="min" title="Згорнути">'+ic('Minus')+'</button>')+'</div>'+
      '<div class="ss">'+grp('Чекають на тебе',by('wait'))+grp('Працюють',by('run'))+grp('Твоя черга',by('done'))+
      (idle.length?'<button type="button" class="grp'+(S.idleOpen?' open':'')+'" data-act="idle">'+ic('ChevronRight')+'Неактивні<span class="n">'+idle.length+'</span></button>'+(S.idleOpen?idle.map(row).join(''):''):'')+
      (LIST.length?'':'<div class="empty">Сесій за добу нема</div>')+'</div>'+
      limHTML()+'</div>';
  }
  function hookHTML(){
    var h=SET.hook||{installed:false};
    if(SET.confirm==='install')return '<div class="hk"><div class="hk1">Додати хук віджета на 11 подій у ~/.claude/settings.json? Інші хуки не зачіпаю, копія файлу буде поруч.</div><div class="hkb"><button type="button" class="btn p" data-act="hook-yes">Додати</button><button type="button" class="btn" data-act="hook-no">Ні</button></div></div>';
    if(SET.confirm==='uninstall')return '<div class="hk"><div class="hk1">Прибрати хук віджета з ~/.claude/settings.json? Сесії перестануть оновлюватись. Інші хуки не зачіпаю, копія файлу буде поруч.</div><div class="hkb"><button type="button" class="btn p" data-act="hook-yes">Прибрати</button><button type="button" class="btn" data-act="hook-no">Ні</button></div></div>';
    return '<div class="opt"><span>Хук Claude Code<br><small class="'+(h.installed?'okc':'mut')+'">'+(h.installed?'стоїть — сесії видно':'не стоїть — сесій не видно')+'</small></span><button type="button" class="btn" data-act="hook">'+(h.installed?'Зняти':'Поставити')+'</button></div>'+(SET.err?'<div class="err">'+esc(SET.err)+'</div>':'');
  }
  function settings(edge){
    return '<div class="wg'+(edge?' e'+edge:'')+'"><div class="hdr grab">'+ic('CogOutline')+'<span class="tt">Налаштування</span><span class="sp"></span><button type="button" class="ib" data-act="flip" title="Назад до сесій">'+ic('Close')+'</button></div>'+
      '<div class="sec"><div class="sl">Персонаж</div><div class="kinds">'+Object.keys(KINDS).map(function(k){return '<button type="button" class="kd'+(CFG.kind===k?' on':'')+'" data-act="kind" data-kind="'+k+'"><span class="mini" data-mini="'+k+'"></span><span>'+KINDS[k][2]+'</span></button>';}).join('')+'</div></div>'+
      '<div class="opt"><span>Звук, коли сесія питає</span><button type="button" class="tgl'+(CFG.sound!==false?' on':'')+'" data-act="sound" title="Звук"></button></div>'+
      '<div class="opt"><span>Запускати з Windows</span><button type="button" class="tgl'+(SET.autostart?' on':'')+'" data-act="autostart" title="Автозапуск"></button></div>'+
      hookHTML()+'<div class="ver">Claude Widget 0.1</div></div>';
  }
  function strip(edge){var m=maxLim(),act=active();return '<div class="strip e'+edge+'">'+(act.length?act.map(function(s){return '<span class="dot '+s.state+'"></span>';}).join(''):'<span class="dot"></span>')+(m?'<span class="vb"><i style="height:'+Math.min(100,m.p)+'%;background:'+col(m.p)+'"></i></span>':'')+'</div>';}
  // The cat's mood follows the sessions: someone waiting for you beats everything, then work;
  // a session that just finished gets a little jump; long silence puts the cat to sleep.
  function autoMood(){
    if(by('wait').length)return 'ask';
    var m=maxLim();if(m&&m.p>=85)return 'tired';
    if(by('run').length)return 'work';
    if(Date.now()-lastDone<6000)return 'done';
    var newest=LIST.reduce(function(m,s){return Math.max(m,s.since);},0);
    return Date.now()-newest>20*60*1000?'sleep':'idle';
  }
  function setMood(m){if(big.mood!==m){big.mood=small.mood=m;big.t0=small.t0=performance.now();}}
  function applyMood(){setMood(moodOverride||autoMood());}

  function render(){
    if(S.dock&&!S.open)root.innerHTML=strip(S.dock);
    else if(S.mode==='cat'&&!S.dock)root.innerHTML='<div class="grab cat"></div>';
    else root.innerHTML='<div class="cardwrap'+(S.dock==='l'?' dl':'')+'"><div class="sit grab"></div>'+(S.back?settings(S.dock):card(S.dock))+'</div>';
    var c=root.querySelector('.cat');if(c)c.appendChild(big.canvas);
    var s=root.querySelector('.sit');if(s)s.appendChild(small.canvas);
    root.querySelectorAll('[data-mini]').forEach(function(m){m.appendChild(minis[m.getAttribute('data-mini')].canvas);});
  }
  function save(patch){invoke('set_config',{patch:patch});}
  // Where the widget was left, so it comes back there: mode, docked edge, the content's top-left.
  async function savePlace(){
    var p=await invoke('poll'),z=measure(p.scale);
    save({place:{mode:S.mode,dock:S.dock,x:Math.round(contentX(p,z)),y:Math.round(p.win.y)}});
  }
  function setKind(k){if(!KINDS[k])return;CFG.kind=k;big.kind=small.kind=KINDS[k][0];big.pal=small.pal=Pixel.PAL[KINDS[k][1]];}
  // The card turns over: a quarter turn out, swap the side, a quarter turn back in.
  async function flip(){
    var wg=root.querySelector('.wg');if(wg){wg.classList.add('fl-out');await new Promise(function(r){setTimeout(r,140);});}
    S.back=!S.back;SET.confirm=null;SET.err='';
    if(S.back){try{SET.autostart=await invoke('autostart_get');SET.hook=await invoke('hook_status');}catch(e){}}
    await relayout();
    var n=root.querySelector('.wg');if(n){n.classList.add('fl-in');requestAnimationFrame(function(){requestAnimationFrame(function(){n.classList.remove('fl-in');});});}
  }
  function measure(sc){var r=root.getBoundingClientRect();return {w:Math.ceil(r.width*sc),h:Math.ceil(r.height*sc)};}
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

  // Windows keeps a captioned window at least SM_CXMIN (136 px) wide, so the window can be wider
  // than its content. The spare is transparent and click-through; at the right edge the content
  // hugs the window's right side, and the window always stays whole on its own monitor (a window
  // poking into a neighbouring monitor gets moved back by Windows).
  function align(){var r=S.dock==='r';root.style.left=r?'auto':'0';root.style.right=r?'0':'auto';S.alignedR=r;}
  function contentX(p,z){return S.alignedR?p.win.x+p.win.w-z.w:p.win.x;}
  // Size the window to the content, learn the width Windows actually allows, then place it with the
  // content's left edge at cx (or flush with the docked edge).
  async function fit(cx,cy){
    var p=await invoke('poll'),sc=p.scale,z=measure(sc),k=p.work;
    await invoke('place',{x:Math.round(p.win.x),y:Math.round(p.win.y),w:z.w,h:z.h});
    var aw=(await invoke('poll')).win.w;
    var x=S.dock==='l'?k.x:S.dock==='r'?k.x+k.w-aw:clamp(cx,k.x,k.x+k.w-aw),y=clamp(cy,k.y,k.y+k.h-z.h);
    await invoke('place',{x:Math.round(x),y:Math.round(y),w:z.w,h:z.h});
  }
  // Re-render after a state change. `how` says which point of the old content stays put.
  async function relayout(how){
    var before=await invoke('poll'),sc=before.scale,bz=measure(sc),bx=contentX(before,bz),by=before.win.y;
    render();align();
    var z=measure(sc),cx=bx,cy=by;
    if(how==='toCard'){cx=bx+bz.w-z.w+4*sc;cy=by+16*sc;}
    else if(how==='toCat'){cx=bx+bz.w-112*sc;cy=by-16*sc;}
    await fit(cx,cy);
  }

  // Click-through: the window ignores the mouse unless the cursor is over something solid —
  // a card, the strip or an opaque pixel of the cat. Polled, since an ignoring window gets no events.
  var ignoring=null,drag=null,lastInside=0,busy=false;
  function solidAt(x,y){
    var el=document.elementFromPoint(x,y);
    if(!el||el===document.body||el===document.documentElement||el===root||el.classList.contains('cardwrap')||el.classList.contains('sit')||el.classList.contains('cat'))return false;
    if(el.tagName==='CANVAS'){var sp=el===big.canvas?big:small,r=el.getBoundingClientRect();return Pixel.opaqueAt(sp,x-r.left,y-r.top);}
    return true;
  }
  function setIgnore(on){if(on!==ignoring){ignoring=on;invoke('ignore',{on:on});}}
  async function poll(){
    if(busy)return;busy=true;
    try{
      var p=await invoke('poll'),sc=p.scale,x=(p.cursor[0]-p.win.x)/sc,y=(p.cursor[1]-p.win.y)/sc;
      Pixel.pointer.x=x;Pixel.pointer.y=y;
      var inside=x>=0&&y>=0&&x<p.win.w/sc&&y<p.win.h/sc,now=performance.now();
      if(!drag){
        var solid=inside&&solidAt(x,y);setIgnore(!solid);
        big.hover=small.hover=solid&&document.elementFromPoint(x,y)&&document.elementFromPoint(x,y).tagName==='CANVAS';
        if(S.dock&&!S.open&&solid){S.open=true;lastInside=now;await relayout();}
        else if(S.dock&&S.open&&!S.hold){if(inside)lastInside=now;else if(now-lastInside>450){S.open=false;S.back=false;SET.confirm=null;await relayout();}}
      }
    }finally{busy=false;}
  }
  setInterval(poll,70);

  // Dragging: by the cat, the card header or the strip. Rust keeps the grab offset and moves the
  // window to the cursor; on release we snap to an edge within SNAP px.
  var pending=false,pet=[],petX=null,petSign=0;
  root.addEventListener('pointerdown',function(e){
    if(e.button!==0||e.target.closest('button'))return;
    if(!e.target.closest('.grab,.strip'))return;
    drag={sx:e.screenX,sy:e.screenY,moved:false,onCat:!!e.target.closest('.cat')};
    try{root.setPointerCapture(e.pointerId);}catch(x){}
    e.preventDefault();
  });
  root.addEventListener('pointermove',async function(e){
    if(!drag){
      if(e.target.tagName!=='CANVAS')return;
      var now=performance.now();if(petX!=null){var sg=Math.sign(e.screenX-petX);if(sg&&sg!==petSign){pet.push(now);petSign=sg;}}petX=e.screenX;
      pet=pet.filter(function(t){return now-t<1200;});if(pet.length>=4){big.petUntil=small.petUntil=now+2200;pet=[];}
      return;
    }
    if(!drag.moved){
      if(Math.hypot(e.screenX-drag.sx,e.screenY-drag.sy)<4)return;
      drag.moved=true;
      if(S.dock){
        S.dock=null;S.open=false;render();align();
        var p=await invoke('poll'),sc=p.scale,z=measure(sc),gx=S.mode==='cat'?54:150,gy=S.mode==='cat'?40:BAND+17;
        await invoke('place',{x:Math.round(p.cursor[0]-gx*sc),y:Math.round(p.cursor[1]-gy*sc),w:z.w,h:z.h});
      }
      big.drag=small.drag=true;document.body.classList.add('dragging');
      await invoke('drag_start');
    }
    if(!pending){pending=true;requestAnimationFrame(function(){invoke('drag_move').finally(function(){pending=false;});});}
  });
  root.addEventListener('pointerup',async function(){
    if(!drag)return;var d=drag;drag=null;
    if(!d.moved){if(d.onCat&&S.mode==='cat'){S.mode='card';await relayout('toCard');savePlace();}return;}
    big.drag=small.drag=false;big.dropT=small.dropT=performance.now();document.body.classList.remove('dragging');
    var p=await invoke('drag_end'),k=p.work,w=p.win,cw=measure(p.scale).w,edge=Math.round(SNAP*p.scale);
    if(w.x-k.x<edge)S.dock='l';else if(k.x+k.w-(w.x+cw)<edge)S.dock='r';else S.dock=null;
    S.open=false;await relayout();savePlace();
  });
  root.addEventListener('click',async function(e){
    var a=e.target.closest('[data-act]'),r=e.target.closest('.row');
    if(!a){if(r&&r.dataset.local)invoke('open_session',{local:r.dataset.local});return;}
    var act=a.getAttribute('data-act');
    if(act==='min'){S.mode='cat';S.back=false;await relayout('toCat');savePlace();}
    else if(act==='idle'){S.idleOpen=!S.idleOpen;save({idleOpen:S.idleOpen});await relayout();}
    else if(act==='flip')await flip();
    else if(act==='kind'){setKind(a.dataset.kind);save({kind:CFG.kind});render();align();}
    else if(act==='sound'){CFG.sound=CFG.sound===false;save({sound:CFG.sound});render();align();if(CFG.sound)chirp();}
    else if(act==='autostart'){try{SET.autostart=await invoke('autostart_set',{on:!SET.autostart});SET.err='';}catch(x){SET.err='Автозапуск: '+x;}render();align();}
    else if(act==='hook'){SET.confirm=SET.hook&&SET.hook.installed?'uninstall':'install';await relayout();}
    else if(act==='hook-no'){SET.confirm=null;await relayout();}
    else if(act==='hook-yes'){var which=SET.confirm;SET.confirm=null;try{SET.hook=await invoke(which==='install'?'hook_install':'hook_uninstall');SET.err='';}catch(x){SET.err=String(x);}await relayout();}
    else if(act==='open'&&r&&r.dataset.local)invoke('open_session',{local:r.dataset.local});
    else if(act==='round')invoke('open_round',{sid:a.dataset.sid,name:a.dataset.round,title:a.dataset.title});
  });

  // New data: re-render what is on screen; resize the window only when the content's size changed,
  // so a session switching tools does not make the widget twitch.
  async function refresh(){
    if(!(S.dock||S.mode==='card')||S.back)return;
    var p=await invoke('poll'),sc=p.scale,bz=measure(sc),bx=contentX(p,bz),by0=p.win.y;
    render();align();
    var z=measure(sc);if(z.w!==bz.w||z.h!==bz.h)await fit(bx,by0);
  }
  // The widget's only sound: a short chirp when a session starts waiting for you.
  var audio=null,primed=false;
  function chirp(){try{audio=audio||new AudioContext();[[660,0,.16],[880,.14,.24]].forEach(function(t){var o=audio.createOscillator(),g=audio.createGain(),at=audio.currentTime+t[1];o.frequency.setValueAtTime(t[0],at);g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(.16,at+.02);g.gain.exponentialRampToValueAtTime(.001,at+t[2]);o.connect(g);g.connect(audio.destination);o.start(at);o.stop(at+t[2]+.05);});}catch(e){}}
  function onData(list){
    var wasDone={},wasWait={};LIST.forEach(function(x){if(x.state==='done')wasDone[x.sid]=1;if(x.state==='wait')wasWait[x.sid+'|'+(x.round||x.what)]=1;});
    if(list.some(function(x){return x.state==='done'&&!wasDone[x.sid];})&&LIST.length)lastDone=Date.now();
    if(primed&&CFG.sound!==false&&list.some(function(x){return x.state==='wait'&&!wasWait[x.sid+'|'+(x.round||x.what)];}))chirp();
    primed=true;
    LIST=list||[];applyMood();
    if(!drag)refresh();
  }
  listen('sessions',function(ev){onData(ev.payload);});
  function setLimits(l){if(l&&l.status==='ok'){LIM=normLimits(l.data);LIMWHY='';}else{LIM=null;LIMWHY=l?l.status:'';}applyMood();if(!drag)refresh();}
  listen('limits',function(ev){setLimits(ev.payload);});
  setInterval(function(){
    root.querySelectorAll('.tm[data-since]').forEach(function(t){t.textContent=ago(+t.getAttribute('data-since'));});
    root.querySelectorAll('[data-reset]').forEach(function(t){t.textContent=until(+t.getAttribute('data-reset'));});
    applyMood();
  },1000);

  listen('tray',function(ev){
    var id=String(ev.payload);
    if(id.indexOf('mood:')===0){moodOverride=id==='mood:auto'?null:id.slice(5);applyMood();}
    else if(id.indexOf('kind:')===0){setKind(id.slice(5));save({kind:CFG.kind});if(S.back){render();align();}}
  });

  (async function start(){
    var hint=await invoke('start_hint'),how=hint[0]||'',cfg=await invoke('get_config')||{};
    if(cfg.kind)setKind(cfg.kind);
    if(cfg.sound===false)CFG.sound=false;
    if(cfg.idleOpen)S.idleOpen=true;
    var place=!how&&cfg.place&&typeof cfg.place.x==='number'?cfg.place:null;
    if(place){S.mode=place.mode==='card'?'card':'cat';S.dock=place.dock==='l'||place.dock==='r'?place.dock:null;}
    if(how==='card')S.mode='card';
    if(how==='settings'){S.mode='card';S.back=true;try{SET.autostart=await invoke('autostart_get');SET.hook=await invoke('hook_status');}catch(e){}}
    if(how.indexOf('dock-')===0){S.dock=how.charAt(5);S.open=/open$/.test(how);S.hold=S.open;}
    if(hint[1])moodOverride=hint[1];
    LIST=await invoke('sessions');setLimits(await invoke('limits'));applyMood();
    if(hint[2]){var rp=hint[2].split('/');invoke('open_round',{sid:rp[0],name:rp[1],title:'перевірка'});}
    render();align();
    var p=await invoke('poll'),sc=p.scale,z=measure(sc),k=p.work;
    // Back where it was left: move there first, so the clamp uses that monitor (or, if that monitor
    // is gone, the primary one).
    if(place){await invoke('place',{x:place.x,y:place.y,w:z.w,h:z.h});await fit(place.x,place.y);}
    else await fit(k.x+k.w-z.w-48*sc,k.y+k.h-z.h-48*sc);
    await invoke('show');
  })();
})();
