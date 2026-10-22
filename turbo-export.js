/* ⚡ Turbo export (web / Chrome / Android WebView)
   Viidiyoo taphachiisuu dhiisee: mp4box -> VideoDecoder (hardware) -> canvas (same drawing code as Standard)
   -> VideoEncoder (hardware) -> mp4-muxer. Not tied to playback speed, so it can run many times faster than real time.
   Audio: AudioDecoder -> mix (volume, speed, fades, music) -> AudioEncoder (AAC, else Opus).
   If anything fails, the reason is shown and you choose: slow Standard export or stop. */
(function(){
  var LIBS=["https://cdn.jsdelivr.net/npm/mp4box@0.5.2/dist/mp4box.all.min.js","https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.js"];
  var prevRun=window.runExport,busy=false,CANCEL={cancel:1};
  if(typeof prevRun!=='function')return;

  function isNative(){try{var C=window.Capacitor;return !!(C&&C.isNativePlatform&&C.isNativePlatform()&&C.Plugins&&C.Plugins.OnellyExport)}catch(e){return false}}
  var mc=new MessageChannel(),yq=[];mc.port1.onmessage=function(){var f=yq.shift();if(f)f()};
  function yieldNow(){return new Promise(function(r){yq.push(r);mc.port2.postMessage(0)})}
  function Sig(){var r=null;return{wait:function(){return new Promise(function(a){r=a})},fire:function(){if(r){var f=r;r=null;f()}}}}
  async function loadLibs(){
    if(window.MP4Box&&window.Mp4Muxer)return;
    for(var i=0;i<LIBS.length;i++){var u=LIBS[i];
      await new Promise(function(res,rej){var s=document.createElement('script');s.src=u;s.onload=res;s.onerror=function(){rej(new Error('Library hin buufamne (interneetii ilaali): '+u))};document.head.appendChild(s)})}
  }

  /* ---------------- what Turbo cannot do (needs the live <video>) ---------------- */
  function unsupported(){
    var u={};
    clips.forEach(function(c){var fx=c.fx||{};
      if(c.cv)u['speed curve']=1;
      if(fx.mos>0)u['mosaic']=1;
      if(fx.shake>0||fx.glit>0)u['shake/glitch']=1});
    if(bgm&&bgm.t==='blur')u['blur background']=1;
    ovs.forEach(function(o){if(o.kind==='emoji'||o.kind==='text')return;
      var el=OE[o.id];if(!el||el.querySelector('video')||(o.ck&&o.ck.on))u['video / green-screen overlay']=1});
    return Object.keys(u);
  }

  /* ---------------- MP4 reading (mp4box gives only the sample table; bytes are read with Blob.slice) ---------------- */
  function esdsOf(file,tr){var e=file.getTrackById(tr.id).mdia.minf.stbl.stsd.entries[0],f=function(b){if(b.type==='esds')return b;for(var c of(b.boxes||[])){var r=f(c);if(r)return r}};return f(e)||e.esds}
  function aacDesc(file,tr){try{var d=esdsOf(file,tr).esd.descs[0].descs[0];return d?new Uint8Array(d.data):undefined}catch(e){}}
  function getDesc(file,tr){var trak=file.getTrackById(tr.id);for(var e of trak.mdia.minf.stbl.stsd.entries){var box=e.avcC||e.hvcC;if(box){var ds=new DataStream(undefined,0,DataStream.BIG_ENDIAN);box.write(ds);return new Uint8Array(ds.buffer,8)}}}

  async function parse(blob,seq){
    var mp4=MP4Box.createFile(),info=null,off=0,stuck=0,CH=8e6;
    mp4.onReady=function(i){info=i};mp4.onError=function(e){throw e};
    async function feed(){if(off>=blob.size)return false;var prev=off,b=await blob.slice(off,Math.min(blob.size,off+CH)).arrayBuffer();b.fileStart=off;var nx=mp4.appendBuffer(b);
      if(!seq&&typeof nx==='number'&&nx>=0){if(nx===prev){if(++stuck>3){off=prev+b.byteLength;stuck=0}else off=nx}else{off=nx;stuck=0}}else off=prev+b.byteLength;return true}
    while(!info&&await feed());
    return info?{mp4:mp4,info:info}:null;
  }
  async function openSource(url){
    var blob=await(await fetch(url)).blob();
    var p=await parse(blob,false)||await parse(blob,true);
    if(!p)throw new Error('MP4/MOV miti (Turbo MP4/MOV H.264/H.265 qofa)');
    var mp4=p.mp4,info=p.info,vt=info.videoTracks[0],at=info.audioTracks[0];
    if(!vt||!/^(avc1|hvc1|hev1)/.test(vt.codec))throw new Error('Codec viidiyoo hin deeggaramu: '+(vt&&vt.codec));
    var vs=mp4.getTrackSamplesInfo(vt.id);
    if(!vs||!vs.length||vs[0].offset==null)throw new Error('mp4box sample table hin argamne (fragmented MP4?)');
    var m=vt.matrix||[65536,0],rot=((Math.round(Math.atan2(m[1],m[0])*180/Math.PI)%360)+360)%360;
    var S={blob:blob,vt:vt,vs:vs,rot:rot,vdesc:getDesc(mp4,vt),at:null,as:null};
    S.vcfg={codec:vt.codec,codedWidth:vt.video.width,codedHeight:vt.video.height,description:S.vdesc};
    if(at){
      var nch=at.audio.channel_count,sr=at.audio.sample_rate;
      if(!(/^mp4a\.40/.test(at.codec)||at.codec==='mp4a'))throw new Error('Sagaleen AAC miti ('+at.codec+')');
      var desc=aacDesc(mp4,at)||(function(){var si=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350].indexOf(sr);return new Uint8Array([(2<<3)|(si>>1),((si&1)<<7)|(nch<<3)])})();
      S.at=at;S.as=mp4.getTrackSamplesInfo(at.id);S.acfg={codec:'mp4a.40.2',sampleRate:sr,numberOfChannels:nch,description:desc};S.sr=sr;
    }
    return S;
  }
  /* reads sample bytes in big windows (1 slice per ~8 MB, not 1 per sample) */
  function reader(blob,samples){var cb=null,cs=0,ce=0;
    return async function(i){var s=samples[i];
      if(!cb||s.offset<cs||s.offset+s.size>ce){var j=i,st=s.offset,en=s.offset+s.size;
        while(j+1<samples.length){var n=samples[j+1],ne=n.offset+n.size;if(n.offset<st||ne-st>8e6||n.offset-en>1e6)break;en=Math.max(en,ne);j++}
        cb=await blob.slice(st,en).arrayBuffer();cs=st;ce=en}
      return new Uint8Array(cb,s.offset-cs,s.size)}}
  var us=function(v,ts){return Math.round(1e6*v/ts)};

  /* ---------------- drawing: identical to the Standard export, but the picture comes from a decoded VideoFrame ---------------- */
  var RC=document.createElement('canvas');
  function drawFrame(x,W,H,RES,c,frame,S,T){
    var rot=S.rot,cw=frame.displayWidth||frame.codedWidth,ch=frame.displayHeight||frame.codedHeight,
      vw=(rot%180)?ch:cw,vh=(rot%180)?cw:ch,src=frame;
    if(rot){if(RC.width!==vw||RC.height!==vh){RC.width=vw;RC.height=vh}
      var g=RC.getContext('2d');g.save();g.translate(vw/2,vh/2);g.rotate(rot*Math.PI/180);g.drawImage(frame,-cw/2,-ch/2);g.restore();src=RC}
    x.fillStyle='#000';x.fillRect(0,0,W,H);bgDraw(x,W,H);
    const sw=c.rot%180!==0,bw=sw?H:W,bh=sw?W:H,k=Math.min(bw/vw,bh/vh);
    x.save();if(TFX.w<1){x.beginPath();x.rect(0,0,W*TFX.w,H);x.clip()}x.globalAlpha=TFX.a;x.translate(W/2+TFX.x/100*W,H/2);x.translate(JIT.x/100*W,JIT.y/100*H);x.rotate(JIT.r*Math.PI/180);x.transform(1,0,Math.tan(JIT.k*Math.PI/180),1,0,0);x.scale(JIT.s,JIT.s);x.scale(TFX.s,TFX.s);x.translate(((c.zx||0)+KB(c).x)/100*W,((c.zy||0)+KB(c).y)/100*H);x.scale((c.zm||1)*KB(c).m,(c.zm||1)*KB(c).m);x.rotate(c.rot*Math.PI/180);x.rotate((c.ang||0)*Math.PI/180);x.scale(angFill(c),angFill(c));x.scale(c.flip?-1:1,1);x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.filter=cssFx(c)+(RES<=360?' contrast(1.05) saturate(1.06)':'');
    if(c.mk||c.lut)mkDraw(x,src,c,bw,bh,vw,vh,k);else x.drawImage(src,-vw*k/2,-vh*k/2,vw*k,vh*k);
    x.restore();x.filter='none';
    const fx=c.fx||{};if(fx.vig>0){const g=x.createRadialGradient(W/2,H/2,Math.min(W,H)*.25,W/2,H/2,Math.max(W,H)*.75);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,'+fx.vig+')');x.fillStyle=g;x.fillRect(0,0,W,H)}
    if(fx.grn>0){x.save();x.globalAlpha=fx.grn*.5;x.fillStyle=x.createPattern(NOISE,'repeat');x.fillRect(0,0,W,H);x.restore()}
    ovs.filter(function(o){return T>=o.from&&T<o.to}).forEach(function(o){const el=OE[o.id];if(!el)return;const st=ovState(o,T),w=W*st.sc;x.save();x.globalCompositeOperation=o.bm?(o.bm==='plus-lighter'?'lighter':o.bm):'source-over';x.translate(W*st.x/100,H*st.y/100);x.rotate(st.rot*Math.PI/180);
      if(o.kind==='emoji'||o.kind==='text'){txDraw(x,o,w,T)}
      else{const m=(o.ck&&o.ck.on)?el.querySelector('canvas'):el.querySelector('img,video'),iw=m.naturalWidth||m.videoWidth||m.width||1,ih=m.naturalHeight||m.videoHeight||m.height||1;{const a=o.ts?txAnim(o,T):null;if(a){x.globalAlpha*=a.op;x.translate(0,a.dy*w);x.scale(a.sc,a.sc)}}x.drawImage(m,-w/2,-w*ih/iw/2,w,w*ih/iw)}x.restore()});
    if(window.fadeDraw)fadeDraw(x,W,H);
  }

  /* ---------------- audio: decode -> resample (speed) -> gain/fades -> + music -> encode ---------------- */
  function planes(ad){var n=ad.numberOfFrames,L=new Float32Array(n),R=L;ad.copyTo(L,{planeIndex:0,format:'f32-planar'});
    if(ad.numberOfChannels>1){R=new Float32Array(n);ad.copyTo(R,{planeIndex:1,format:'f32-planar'})}return[L,R]}
  async function makeAudio(aenc,SRC,tot,SR){
    var music=[];
    for(var q=0;q<aud.length;q++){var o=aud[q];
      try{var ab=await new OfflineAudioContext(2,1,SR).decodeAudioData(await(await fetch(o.url)).arrayBuffer());
        music.push({from:o.from,to:o.to,in:o.in||0,vol:o.vol==null?1:o.vol,L:ab.getChannelData(0),R:ab.numberOfChannels>1?ab.getChannelData(1):ab.getChannelData(0),len:ab.length})}
      catch(e){throw new Error('Muuziqaa decode hin danda\'amne: '+(o.name||''))}}
    var BLK=4800,oL=new Float32Array(BLK),oR=new Float32Array(BLK),fill=0,emitted=0,gi=0;
    function flushBlock(){if(!fill)return;var n=fill,d=new Float32Array(n*2);d.set(oL.subarray(0,n),0);d.set(oR.subarray(0,n),n);
      var ad=new AudioData({format:'f32-planar',sampleRate:SR,numberOfFrames:n,numberOfChannels:2,timestamp:Math.round(emitted*1e6/SR),data:d});
      aenc.encode(ad);ad.close();emitted+=n;fill=0}
    function emit(l,r,g){var T=gi/SR,pf=1;
      if(FADE.i>0&&T<FADE.i)pf=Math.min(pf,T/FADE.i);if(FADE.o>0&&T>tot-FADE.o)pf=Math.min(pf,Math.max(0,(tot-T)/FADE.o));
      l*=g;r*=g;
      for(var m=0;m<music.length;m++){var mu=music[m];if(T>=mu.from&&T<mu.to){var k=Math.floor((T-mu.from+mu.in)*SR);if(k>=0&&k<mu.len){l+=mu.L[k]*mu.vol;r+=mu.R[k]*mu.vol}}}
      l*=pf;r*=pf;oL[fill]=l>1?1:l<-1?-1:l;oR[fill]=r>1?1:r<-1?-1:r;fill++;gi++;if(fill===BLK)flushBlock()}
    var A=0;
    for(var i=0;i<clips.length;i++){
      var c=clips[i],L=len(c),startIdx=gi,endIdx=Math.round((A+L)*SR),S=SRC[c.url],vol=c.vol==null?1:c.vol;
      A+=L;
      var gainOf=function(off){var g=vol;if(c.afi>0&&off<c.afi)g*=off/c.afi;if(c.afo>0&&off>L-c.afo)g*=Math.max(0,(L-off)/c.afo);return g};
      if(S.at&&vol>0){
        var base=0,bufL=new Float32Array(0),bufR=new Float32Array(0),started=false,step=1,srcStart=0,srate=S.sr,errA=null;
        var consume=function(ad){
          var pl=planes(ad),tsU=ad.timestamp,asr=ad.sampleRate;ad.close();
          if(!started){srate=asr||S.sr;base=Math.round(tsU*srate/1e6);started=true;step=(c.speed||1)*srate/SR;srcStart=c.in*srate}
          var nl=new Float32Array(bufL.length+pl[0].length),nr=new Float32Array(nl.length);nl.set(bufL);nl.set(pl[0],bufL.length);nr.set(bufR);nr.set(pl[1],bufR.length);bufL=nl;bufR=nr;
          var end=base+bufL.length;
          while(gi<endIdx){var p=srcStart+(gi-startIdx)*step,i0=Math.floor(p);if(i0+1>=end)break;var a=i0-base;
            if(a<0){emit(0,0,0);continue}var fr=p-i0;
            emit(bufL[a]+(bufL[a+1]-bufL[a])*fr,bufR[a]+(bufR[a+1]-bufR[a])*fr,gainOf((gi-startIdx)/SR))}
          var keep=Math.max(0,Math.floor(srcStart+(gi-startIdx)*step)-1-base);if(keep>0){bufL=bufL.slice(keep);bufR=bufR.slice(keep);base+=keep}};
        var adec=new AudioDecoder({output:function(ad){try{consume(ad)}catch(e){errA=e}},error:function(e){errA=e}});
        adec.configure(S.acfg);
        var as=S.as,inU=c.in*1e6-100000,outU=(c.in+L*(c.speed||1))*1e6+100000,first=0;
        for(var j=0;j<as.length;j++){if(us(as[j].cts,as[j].timescale)>=inU){first=Math.max(0,j-2);break}}
        var rd=reader(S.blob,as);
        for(var j=first;j<as.length&&!errA;j++){var s=as[j];if(us(s.cts,s.timescale)>outU)break;
          var u8=await rd(j);adec.decode(new EncodedAudioChunk({type:'key',timestamp:us(s.cts,s.timescale),duration:us(s.duration,s.timescale),data:u8}));
          if(adec.decodeQueueSize>30||(j&63)===0)await yieldNow();if(XO.cancel)throw CANCEL}
        if(!errA)await adec.flush();try{adec.close()}catch(e){}
        if(errA)throw errA;
      }
      while(gi<endIdx)emit(0,0,0);   /* silence if the clip has no sound (or the data ended early) */
    }
    var totalIdx=Math.round(tot*SR);while(gi<totalIdx)emit(0,0,0);
    flushBlock();
  }

  /* ---------------- main ---------------- */
  async function turbo(S0,fps0,bpp,M,args){
    var ev=function(n){return Math.round(n/2)*2},fps=M==='eco'?Math.min(fps0,24):M==='bal'?Math.min(fps0,30):fps0,
      W=ratio>=1?ev(S0*ratio):ev(S0),H=ratio>=1?ev(S0):ev(S0/ratio),br=Math.round(W*H*fps*bpp*(MULT[S0]||1)),tot=total(),N=Math.max(1,Math.round(tot*fps)),
      saved={t:t,TFX:TFX},stage='start',T0=performance.now(),openEnc=[],venc=null,aenc=null,prev=null,ready=[],cancelled=false;
    XO.mode='eco';xoShow(W+'×'+H+' · '+fps+' fps · ⚡ Turbo');
    $('#xact').innerHTML='<button class="xb" id="xcancel">'+L('x_cancel')+'</button>';
    $('#xcancel').onclick=function(){cancelled=true;XO.cancel=true};
    try{
      stage='libraries';await loadLibs();
      stage='opening video';var SRC={};
      for(var i=0;i<clips.length;i++){if(!SRC[clips[i].url])SRC[clips[i].url]=await openSource(clips[i].url);if(XO.cancel)throw CANCEL}
      stage='video decoder';
      for(var u in SRC){var S=SRC[u],ok=null;
        for(var hw of['prefer-hardware','no-preference']){try{var r=await VideoDecoder.isConfigSupported(Object.assign({hardwareAcceleration:hw},S.vcfg));if(r&&r.supported){ok=Object.assign({hardwareAcceleration:hw},S.vcfg);break}}catch(e){}}
        if(!ok)throw new Error('Bilbila kun codec viidiyoo ('+S.vcfg.codec+') decode gochuu hin danda\'u');S.dcfg=ok}
      stage='video encoder';
      var mbps=Math.ceil(W/16)*Math.ceil(H/16)*fps,lv=mbps<=245760?'28':mbps<=522240?'2A':mbps<=589824?'32':mbps<=983040?'33':'34',
        cands=[];
      ['prefer-hardware','no-preference'].forEach(function(hw){['6400','4D00','42E0'].forEach(function(pf){cands.push({codec:'avc1.'+pf+lv,width:W,height:H,bitrate:br,framerate:fps,hardwareAcceleration:hw,avc:{format:'avc'}})})});
      var vconf=null;for(var q=0;q<cands.length&&!vconf;q++){try{var rr=await VideoEncoder.isConfigSupported(cands[q]);if(rr&&rr.supported)vconf=cands[q]}catch(e){}}
      if(!vconf)throw new Error('H.264 encoder '+W+'×'+H+' hin jiru');
      /* audio config */
      stage='audio encoder';var SR=48000,hasAudio=aud.length>0||clips.some(function(c){return SRC[c.url].at&&(c.vol==null||c.vol>0)}),aconf=null,acodec='aac';
      if(hasAudio){
        var ac=[{codec:'mp4a.40.2',sampleRate:SR,numberOfChannels:2,bitrate:128000},{codec:'opus',sampleRate:SR,numberOfChannels:2,bitrate:128000}];
        for(var z=0;z<ac.length&&!aconf;z++){try{var ra=await AudioEncoder.isConfigSupported(ac[z]);if(ra&&ra.supported){aconf=ac[z];acodec=z?'opus':'aac'}}catch(e){}}
        if(!aconf)throw new Error('Audio encoder (AAC/Opus) hin jiru');
      }
      stage='output file';
      var target,wr=null,fh=null,est=br*tot/8;
      if(est>2e8){try{var root=await navigator.storage.getDirectory();fh=await root.getFileHandle('onelly-turbo.mp4',{create:true});wr=await fh.createWritable();target=new Mp4Muxer.FileSystemWritableFileStreamTarget(wr)}catch(e){wr=null}}
      if(!wr)target=new Mp4Muxer.ArrayBufferTarget();
      var muxer=new Mp4Muxer.Muxer({target:target,video:{codec:'avc',width:W,height:H},audio:aconf?{codec:acodec,numberOfChannels:2,sampleRate:SR}:undefined,fastStart:wr?false:'in-memory',firstTimestampBehavior:'offset'});
      /* 1) audio first (fast): encoded chunks wait in memory and are interleaved with the video while muxing */
      var aChunks=[],ai=0,aerr=null;
      if(aconf){stage='audio';xoSet(.01);
        aenc=new AudioEncoder({output:function(ch,meta){aChunks.push([ch,meta])},error:function(e){aerr=e}});aenc.configure(aconf);
        await makeAudio(aenc,SRC,tot,SR);await aenc.flush();if(aerr)throw aerr;try{aenc.close()}catch(e){}aenc=null}
      /* 2) video */
      stage='video';
      var cv=document.createElement('canvas');cv.width=W;cv.height=H;var x=cv.getContext('2d',{alpha:false}),verr=null,merr=null,deq=null;
      venc=new VideoEncoder({output:function(ch,meta){try{while(ai<aChunks.length&&aChunks[ai][0].timestamp<=ch.timestamp){muxer.addAudioChunk(aChunks[ai][0],aChunks[ai][1]);ai++}muxer.addVideoChunk(ch,meta)}catch(e){merr=e}},error:function(e){verr=e}});
      venc.ondequeue=function(){if(deq){var f=deq;deq=null;f()}};
      venc.configure(vconf);
      var kf=Math.max(1,Math.round(fps*2)),A=0,count=0;
      Object.assign(JIT,{x:0,y:0,r:0,k:0,h:0,s:1,on:0});
      for(var ci=0;ci<clips.length;ci++){
        var c=clips[ci],Lc=len(c),S=SRC[c.url],gS=Math.max(0,Math.ceil(A*fps-1e-6)),gE=ci===clips.length-1?N:Math.ceil((A+Lc)*fps-1e-6),vs=S.vs;
        if(gE<=gS){A+=Lc;continue}
        var sStart=srcAt(c,0)*1e6,sEnd=srcAt(c,Lc)*1e6,k0=0;
        for(var j=0;j<vs.length;j++){if(vs[j].is_sync&&us(vs[j].cts,vs[j].timescale)<=sStart+1000)k0=j;if(us(vs[j].cts,vs[j].timescale)>sStart+1000)break}
        var done=false,err=null,sigOut=Sig(),sigRoom=Sig(),stopFeed=false;ready=[];prev=null;
        var dec=new VideoDecoder({output:function(f){ready.push(f);sigOut.fire()},error:function(e){err=e;sigOut.fire();sigRoom.fire()}});
        dec.ondequeue=function(){sigRoom.fire()};dec.configure(S.dcfg);openEnc.push(dec);
        var rd=reader(S.blob,vs);
        var feedP=(async function(dec,rd,vs,k0,sEnd){
          try{for(var i=k0;i<vs.length&&!stopFeed&&!err;i++){var s=vs[i];if(us(s.dts,s.timescale)>sEnd+250000)break;
              while(!stopFeed&&!err&&(dec.decodeQueueSize>4||ready.length>2))await sigRoom.wait();
              if(stopFeed||err)break;
              var u8=await rd(i);dec.decode(new EncodedVideoChunk({type:s.is_sync?'key':'delta',timestamp:us(s.cts,s.timescale),duration:us(s.duration,s.timescale),data:u8}))}
            if(!stopFeed&&!err)await dec.flush()}
          catch(e){if(!err)err=e}
          done=true;sigOut.fire()})(dec,rd,vs,k0,sEnd);
        try{
          for(var g=gS;g<gE;g++){
            if(XO.cancel)throw CANCEL;if(verr)throw verr;if(merr)throw merr;
            var Tm=g/fps,off=Math.max(0,Math.min(Lc,Tm-A)),sUs=srcAt(c,off)*1e6;
            for(;;){if(err)throw err;
              if(ready.length){if(!prev||ready[0].timestamp<=sUs+1500){if(prev)prev.close();prev=ready.shift();sigRoom.fire();continue}break}
              if(done)break;await sigOut.wait()}
            if(!prev)throw new Error('Fireemiin decode hin ta\'ine');
            t=Tm;TFX=Object.assign({},trFxAt());
            drawFrame(x,W,H,S0,c,prev,S,Tm);
            var vf=new VideoFrame(cv,{timestamp:Math.round(g*1e6/fps),duration:Math.round(1e6/fps)});
            venc.encode(vf,{keyFrame:g%kf===0});vf.close();count++;
            while(venc.encodeQueueSize>4&&!verr&&!merr){await new Promise(function(r){deq=r;setTimeout(function(){if(deq===r){deq=null;r()}},30)})}
            if(count%6===0){xoSet(Math.min(.99,.02+.97*g/N));if(count%18===0)xoFrame(cv);await yieldNow()}
          }
        }finally{stopFeed=true;sigRoom.fire();sigOut.fire();try{if(prev)prev.close()}catch(e){}prev=null;ready.forEach(function(f){try{f.close()}catch(e){}});ready=[];try{dec.close()}catch(e){}await feedP}
        A+=Lc;
      }
      stage='finishing';
      await venc.flush();if(verr)throw verr;if(merr)throw merr;
      while(ai<aChunks.length){muxer.addAudioChunk(aChunks[ai][0],aChunks[ai][1]);ai++}
      muxer.finalize();var blob;
      if(wr){await wr.close();blob=await fh.getFile()}else blob=new Blob([target.buffer],{type:'video/mp4'});
      var secs=(performance.now()-T0)/1000;
      finish(blob,tot,secs);
    }catch(e){
      cleanup();restore();busy=false;
      if(e===CANCEL||cancelled){xoHide();return}
      xoHide();
      var why=(e&&(e.message||e.name))||String(e);
      console.error('Turbo export failed at '+stage,e);
      if(confirm('⚡ Turbo export hin milkoofne ('+stage+'):\n'+why+'\n\nOK = Standard export (suuta)\nCancel = dhaabi'))prevRun.apply(window,args);
      return;
    }
    restore();busy=false;
    function restore(){t=saved.t;TFX=saved.TFX;try{show(saved.t,false)}catch(_){}}
    function cleanup(){try{if(prev)prev.close()}catch(_){}ready.forEach(function(f){try{f.close()}catch(_){}});openEnc.forEach(function(d){try{d.close()}catch(_){}});try{venc&&venc.close()}catch(_){}try{aenc&&aenc.close()}catch(_){}}
  }

  function finish(blob,tot,secs){
    xoRelease();gameToggle(false);var o=$('#xo'),mb=blob.size/1e6,url=URL.createObjectURL(blob);
    XO.blob=blob;XO.shown=1;xoSet(1);o.className='done';
    $('#xpct').textContent='✓';$('#xst').textContent=L('x_done');$('#xeta').textContent='';$('#xtip').textContent='';
    $('#xinfo').textContent=(mb<10?mb.toFixed(1):Math.round(mb))+' MB · ⚡ '+secs.toFixed(1)+' s · '+(tot/secs).toFixed(1)+'× realtime';
    var file=new File([blob],'onelly-edit.mp4',{type:'video/mp4'}),canShare=navigator.canShare&&navigator.canShare({files:[file]});
    $('#xact').innerHTML='<a class="xb main" download="onelly-edit.mp4" href="'+url+'">'+L('x_save')+'</a>'+(canShare?'<button class="xb" id="xshare">'+L('x_share')+'</button>':'')+'<button class="xb" id="xclose">'+L('x_close')+'</button>';
    $('#xclose').onclick=xoHide;if(canShare)$('#xshare').onclick=function(){navigator.share({files:[file]}).catch(function(){})};
    if(navigator.vibrate)navigator.vibrate([40,60,40]);confetti();
  }

  window.runExport=function(S,fps,bpp,M,A,G){
    if(A||G||busy||isNative()||!window.VideoDecoder||!window.VideoEncoder||!window.EncodedVideoChunk||!window.AudioEncoder||!window.AudioDecoder)
      return prevRun.apply(this,arguments);
    var args=arguments,un=unsupported();
    if(un.length&&!confirm('⚡ Turbo cannot do yet:\n'+un.join(', ')+'\n\nOK = Turbo WITHOUT these (fast)\nCancel = Standard export (slow, with them)'))
      return prevRun.apply(this,args);
    busy=true;turbo(S,fps,bpp,M,args);
  };
})();
