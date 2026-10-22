/* Native fast export (Android APK only).
   Hardware decode + hardware encode (Media3 Transformer) - not tied to playback speed.
   In a normal browser / iPhone this file does nothing and the old Standard export is used. */
(function(){
  var C=window.Capacitor;
  function plug(){try{return C&&C.isNativePlatform&&C.isNativePlatform()&&C.Plugins&&C.Plugins.OnellyExport||null}catch(e){return null}}
  var origRun=window.runExport,SRC={},nSrc=0,busy=false;
  if(typeof origRun!=='function')return;

  function b64(bl){return new Promise(function(res,rej){var f=new FileReader();f.onload=function(){res(String(f.result).split(',')[1]||'')};f.onerror=rej;f.readAsDataURL(bl)})}
  async function push(P,name,blob,cb){
    var CH=2*1024*1024;
    if(!blob.size){await P.writeChunk({name:name,data:'',first:true});return}
    for(var o=0;o<blob.size;o+=CH){
      await P.writeChunk({name:name,data:await b64(blob.slice(o,o+CH)),first:o===0});
      if(cb)cb(Math.min(1,(o+CH)/blob.size));
    }
  }

  /* things the native renderer cannot do yet */
  function unsupported(){
    var u={};
    clips.forEach(function(c){
      var fx=c.fx||{},f=c.f||{};
      if(c.cv)u['speed curve']=1; if(c.tr&&c.tr.type!=='none')u['transitions']=1;
      if(c.kb)u['Ken Burns']=1; if(c.lut)u['LUT']=1; if(c.cg)u['color grade']=1; if(c.mk)u['mask/shape']=1;
      if(c.sharp)u['sharpen']=1; if(c.mb)u['motion blur']=1; if(c.zx||c.zy)u['zoom position']=1; if(c.ang)u['angle']=1;
      if(c.afi||c.afo)u['audio fade']=1;
      if(fx.blur>0||fx.vig>0||fx.grn>0||fx.mos>0)u['blur/vignette/grain/mosaic']=1;
      if(f.sep>0)u['sepia']=1;
    });
    if(typeof bgm!=='undefined'&&bgm)u['background']=1;
    if(aud&&aud.length)u['music/audio tracks']=1;
    ovs.forEach(function(o){
      var ts=o.ts||{},txt=(o.kind==='emoji'||o.kind==='text');
      if(o.kf&&o.kf.length)u['overlay keyframes']=1;
      if(o.bm)u['overlay blend']=1;
      if(txt){if((ts.ai&&ts.ai!=='none')||(ts.ao&&ts.ao!=='none'))u['text animation']=1}
      else{var el=OE[o.id];if(o.ck&&o.ck.on)u['green screen']=1;else if(!el||!el.querySelector('img'))u['video overlay']=1;else if(o.ts)u['overlay animation']=1}
    });
    return Object.keys(u);
  }

  function renderOv(o,W,H){
    var cv=document.createElement('canvas');cv.width=W;cv.height=H;var x=cv.getContext('2d');
    var st=ovState(o,o.from),w=W*st.sc;
    x.save();x.translate(W*st.x/100,H*st.y/100);x.rotate(st.rot*Math.PI/180);
    if(o.kind==='emoji'||o.kind==='text')txDraw(x,o,w,o.from);
    else{var el=OE[o.id],m=el&&el.querySelector('img');
      if(m){var iw=m.naturalWidth||m.width||1,ih=m.naturalHeight||m.height||1;x.drawImage(m,-w/2,-w*ih/iw/2,w,w*ih/iw)}}
    x.restore();
    return new Promise(function(r){cv.toBlob(r,'image/png')});
  }

  async function nativeExport(P,S,fps,bpp){
    if(busy)return;busy=true;
    var ev=function(n){return Math.round(n/2)*2},
      W=ratio>=1?ev(S*ratio):ev(S),H=ratio>=1?ev(S):ev(S/ratio),
      br=Math.round(W*H*Math.min(fps,30)*bpp*(MULT[S]||1)),tot=total(),cancelled=false,lis=null;
    XO.mode='bal';xoShow(W+'×'+H+' · ⚡ hardware');
    $('#xact').innerHTML='<button class="xb" id="xcancel">'+L('x_cancel')+'</button>';
    $('#xcancel').onclick=function(){cancelled=true;try{P.cancel()}catch(e){}xoHide()};
    try{
      /* 1) copy source videos to real files (once; reused on the next export) */
      var urls=[];clips.forEach(function(c){if(urls.indexOf(c.url)<0)urls.push(c.url)});
      for(var i=0;i<urls.length;i++){
        var u=urls[i];
        if(SRC[u]){var ex=await P.exists({name:SRC[u]});if(!ex||!ex.exists)delete SRC[u]}
        if(!SRC[u]){
          var bl=await(await fetch(u)).blob(),name='src'+(++nSrc)+'_'+Date.now()+(/quicktime/.test(bl.type)?'.mov':'.mp4'),base=i/urls.length;
          await push(P,name,bl,function(p){xoSet(.25*(base+p/urls.length))});
          SRC[u]=name;
        }
        if(cancelled)return;
      }
      xoSet(.25);
      /* 2) overlays (text / emoji / images) -> transparent PNG per overlay */
      var ovj=[];
      for(var k=0;k<ovs.length;k++){
        var o=ovs[k];if(!(o.to>o.from))continue;
        var png=await renderOv(o,W,H),pn='ov'+k+'_'+Date.now()+'.png';
        await push(P,pn,png);ovj.push({file:pn,from:o.from,to:o.to});
        if(cancelled)return;
      }
      /* 3) go */
      var proj={W:W,H:H,bitrate:br,total:tot,fade:{i:FADE.i||0,o:FADE.o||0},overlays:ovj,
        clips:clips.map(function(c){var f=c.f||{};
          return{file:SRC[c.url],in:c.in,out:c.out,speed:c.speed||1,vol:c.vol==null?1:c.vol,rot:c.rot||0,flip:c.flip?1:0,zm:c.zm||1,
            b:f.b==null?1:f.b,c:f.c==null?1:f.c,s:f.s==null?1:f.s,hue:f.hue||0}})};
      lis=await P.addListener('progress',function(e){xoSet(.25+.75*(e.p||0))});
      var r=await P.startExport({project:JSON.stringify(proj)});
      if(cancelled)return;
      done(r);
    }catch(e){
      if(!cancelled){xoHide();msg('Native export failed: '+(e&&(e.message||e.errorMessage)||e))}
    }finally{busy=false;try{lis&&lis.remove()}catch(_){}}
  }

  function done(r){
    xoRelease();gameToggle(false);var o=$('#xo'),mb=(r.size||0)/1e6;
    XO.shown=1;xoSet(1);o.className='done';
    $('#xpct').textContent='✓';$('#xst').textContent=L('x_done');$('#xeta').textContent='';$('#xtip').textContent='';
    $('#xinfo').textContent=(mb<10?mb.toFixed(1):Math.round(mb))+' MB · ⚡';
    var share=function(){try{C.Plugins.Share.share({title:'onelly-edit.mp4',url:r.uri,dialogTitle:'onelly-edit.mp4'})}catch(e){msg('Share failed')}};
    $('#xact').innerHTML='<button class="xb main" id="xsv">'+L('x_save')+'</button><button class="xb" id="xclose">'+L('x_close')+'</button>';
    $('#xclose').onclick=xoHide;$('#xsv').onclick=share;
    if(navigator.vibrate)navigator.vibrate([40,60,40]);confetti();
  }

  window.runExport=function(S,fps,bpp,M,A,G){
    var P=plug();
    if(A||G||!P)return origRun.apply(this,arguments);          /* audio-only + GIF stay as before */
    var un=unsupported();
    if(un.length&&!confirm('⚡ Fast export cannot do yet:\n'+un.join(', ')+'\n\nOK = fast export WITHOUT these.\nCancel = slow Standard export (with them).'))
      return origRun.apply(this,arguments);
    nativeExport(P,S,fps,bpp);
  };
})();
