// The widget window: three modes — the cat alone, the card with the cat sitting on it, and a
// strip at the left or right screen edge that slides the card out on hover. Dragging snaps to an
// edge; transparent pixels let clicks through; the cat's eyes follow the cursor anywhere on
// screen. Window geometry is Rust's, in physical pixels (main.rs) — this side only decides.
(function(){
  var invoke=window.__TAURI__.core.invoke,listen=window.__TAURI__.event.listen;
  var root=document.getElementById('root');
  var SNAP=24,BAND=58;
  var S={mode:'cat',dock:null,open:false,idleOpen:false};
  var big=Pixel.Sprite('cat','catB',3,'idle'),small=Pixel.Sprite('cat','catB',2,'idle');

  // Step 1 shows the card with sample sessions; the real ones arrive in step 2.
  var ACT=[
    {n:'Оновити залежності',st:'wait',ic:'HelpCircleOutline',a:'Питає тебе · 2 питання',t:'4 хв'},
    {n:'Рефакторинг auth middleware',st:'run',ic:'ConsoleLine',a:'Bash · cargo test',t:'2 хв'},
    {n:'Сторінка цін',st:'run',ic:'PencilOutline',a:'Edit · pricing.html',t:'12 с'},
    {n:'Огляд репозиторію',st:'done',ic:'CheckCircleOutline',a:'Готово — твоя черга',t:'1 хв'}
  ];
  var IDLE=[['Нічна збірка падає','55 хв'],['Документація API','3 г 49 хв'],['Чистка логів','вчора']];
  var LIM=[{l:'5 годин',p:25,r:'31 хв'},{l:'Тиждень',p:34,r:'4 д 17 г'},{l:'Fable',p:5,r:'4 д 17 г'}];

  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function ic(n){return '<svg class="i"><use href="#'+n+'"/></svg>';}
  function col(p){return p>=85?'var(--danger)':p>=60?'var(--warn)':'var(--primary)';}
  function row(s){var h='<div class="row '+s.st+'"><span class="dot '+s.st+'"></span><div class="tx"><div class="l1"><span class="nm">'+esc(s.n)+'</span><span class="tm">'+s.t+'</span></div><div class="ac">'+ic(s.ic)+'<span class="at">'+esc(s.a)+'</span></div>';if(s.st==='wait')h+='<div class="qa"><button type="button" class="qbtn">'+ic('HelpCircleOutline')+'Відповісти</button></div>';return h+'</div></div>';}
  function idleRow(x){return '<div class="row idle"><span class="dot"></span><div class="tx"><div class="l1"><span class="nm">'+esc(x[0])+'</span><span class="tm">'+x[1]+'</span></div></div></div>';}
  function grp(t,arr){return arr.length?'<div class="gh"><span>'+t+'</span><span>'+arr.length+'</span></div>'+arr.map(row).join(''):'';}
  function card(edge){
    var by=function(k){return ACT.filter(function(s){return s.st===k;});};
    return '<div class="wg'+(edge?' e'+edge:'')+'"><div class="hdr grab">'+ic('ConsoleLine')+'<span class="tt">Claude</span><span class="ct">'+ACT.length+' активні</span><span class="sp"></span>'+(edge?'':'<button type="button" class="ib" data-act="min" title="Згорнути">'+ic('Minus')+'</button>')+'</div>'+
      '<div class="ss">'+grp('Чекають на тебе',by('wait'))+grp('Працюють',by('run'))+grp('Твоя черга',by('done'))+
      '<button type="button" class="grp'+(S.idleOpen?' open':'')+'" data-act="idle">'+ic('ChevronRight')+'Неактивні<span class="n">'+IDLE.length+'</span></button>'+(S.idleOpen?IDLE.map(idleRow).join(''):'')+'</div>'+
      '<div class="lim">'+LIM.map(function(l){return '<div class="lr"><span class="ll">'+l.l+'</span><span class="lp">'+l.p+'%</span><span class="lb"><i style="width:'+l.p+'%;background:'+col(l.p)+'"></i></span><span class="rs">'+ic('Autorenew')+l.r+'</span></div>';}).join('')+'</div>'+
      '<div class="demo">демо-дані — справжні сесії з’являться на кроці 2</div></div>';
  }
  function strip(edge){var m=LIM.reduce(function(a,b){return b.p>a.p?b:a;});return '<div class="strip e'+edge+'">'+ACT.map(function(s){return '<span class="dot '+s.st+'"></span>';}).join('')+'<span class="vb"><i style="height:'+m.p+'%;background:'+col(m.p)+'"></i></span></div>';}

  function render(){
    if(S.dock&&!S.open)root.innerHTML=strip(S.dock);
    else if(S.mode==='cat'&&!S.dock)root.innerHTML='<div class="grab cat"></div>';
    else root.innerHTML='<div class="cardwrap'+(S.dock==='l'?' dl':'')+'"><div class="sit grab"></div>'+card(S.dock)+'</div>';
    var c=root.querySelector('.cat');if(c)c.appendChild(big.canvas);
    var s=root.querySelector('.sit');if(s)s.appendChild(small.canvas);
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
        else if(S.dock&&S.open&&!S.hold){if(inside)lastInside=now;else if(now-lastInside>450){S.open=false;await relayout();}}
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
    if(!d.moved){if(d.onCat&&S.mode==='cat'){S.mode='card';await relayout('toCard');}return;}
    big.drag=small.drag=false;big.dropT=small.dropT=performance.now();document.body.classList.remove('dragging');
    var p=await invoke('drag_end'),k=p.work,w=p.win,cw=measure(p.scale).w,edge=Math.round(SNAP*p.scale);
    if(w.x-k.x<edge)S.dock='l';else if(k.x+k.w-(w.x+cw)<edge)S.dock='r';else S.dock=null;
    S.open=false;await relayout();
  });
  root.addEventListener('click',async function(e){
    var a=e.target.closest('[data-act]');if(!a)return;var act=a.getAttribute('data-act');
    if(act==='min'){S.mode='cat';await relayout('toCat');}
    else if(act==='idle'){S.idleOpen=!S.idleOpen;await relayout();}
  });

  var KINDS={cat:['cat','catB'],blob:['blob','blob'],ghost:['ghost','ghost']};
  listen('tray',function(ev){
    var id=String(ev.payload);
    if(id.indexOf('mood:')===0){big.mood=small.mood=id.slice(5);big.t0=small.t0=performance.now();}
    else if(id.indexOf('kind:')===0){var k=KINDS[id.slice(5)];if(k){big.kind=small.kind=k[0];big.pal=small.pal=Pixel.PAL[k[1]];}}
  });

  (async function start(){
    var hint=await invoke('start_hint'),how=hint[0]||'';
    if(how==='card')S.mode='card';
    if(how.indexOf('dock-')===0){S.dock=how.charAt(5);S.open=/open$/.test(how);S.hold=S.open;}
    if(hint[1]){big.mood=small.mood=hint[1];}
    render();align();
    var p=await invoke('poll'),sc=p.scale,z=measure(sc),k=p.work;
    await fit(k.x+k.w-z.w-48*sc,k.y+k.h-z.h-48*sc);
    await invoke('show');
  })();
})();
