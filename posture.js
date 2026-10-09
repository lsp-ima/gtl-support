// 姿勢写真をそろえて並べるための処理(カルテの比較と Private Lounge の再生ページで共用)
// 1) 背景の縦の線(壁の角・ドア枠)から写真の傾きを測って水平に直す。体は使わない
// 2) 骨格からくるぶし・耳を取り、大きさと足元の位置をそろえて切り出す
// 3) くるぶしから真上の基準線と、耳・肩・股関節・膝・くるぶしの点を重ねる
(function(){
  const OUT_W=450, OUT_H=800, BODY_PX=600, BASE_Y=740;

  function loadImg(url){
    return new Promise((ok,ng)=>{ const im=new Image(); im.crossOrigin='anonymous'; im.onload=()=>ok(im); im.onerror=()=>ng(new Error('画像を開けません')); im.src=url; });
  }
  function toCanvas(src,w,h,rot){
    const c=document.createElement('canvas'); c.width=w; c.height=h; const g=c.getContext('2d');
    if(rot){ g.translate(w/2,h/2); g.rotate(rot); g.translate(-w/2,-h/2); }
    g.drawImage(src,0,0,w,h); return c;
  }
  // 縦に近い強いエッジの向きを集計して、いちばん多い傾きを返す(度。右に傾いていれば正)
  function estimateTilt(c, skip){
    const w=c.width, h=c.height, d=c.getContext('2d').getImageData(0,0,w,h).data, gray=new Float32Array(w*h);
    for(let i=0;i<w*h;i++) gray[i]=d[i*4]*.299+d[i*4+1]*.587+d[i*4+2]*.114;
    const BINS=97, MAXDEG=12, hist=new Float32Array(BINS); let total=0;
    for(let y=1;y<h-1;y++) for(let x=1;x<w-1;x++){
      if(skip && x>skip.x0 && x<skip.x1 && y>skip.y0 && y<skip.y1) continue;
      const i=y*w+x;
      const gx=(gray[i-w+1]+2*gray[i+1]+gray[i+w+1])-(gray[i-w-1]+2*gray[i-1]+gray[i+w-1]);
      const gy=(gray[i+w-1]+2*gray[i+w]+gray[i+w+1])-(gray[i-w-1]+2*gray[i-w]+gray[i-w+1]);
      const m=Math.hypot(gx,gy); if(m<120) continue;
      let a=Math.atan2(gy,gx)*180/Math.PI; if(a>90) a-=180; if(a<-90) a+=180;   // 縦の線なら勾配は横向き(≒0°)
      if(Math.abs(a)>MAXDEG) continue;
      const b=Math.round((a+MAXDEG)/(2*MAXDEG)*(BINS-1)); hist[b]+=m; total+=m;
    }
    if(!total) return {deg:0, ok:false};
    const sm=hist.map((v,i)=>(hist[i-1]||0)*.5+v+(hist[i+1]||0)*.5);
    let best=0; for(let i=1;i<BINS;i++) if(sm[i]>sm[best]) best=i;
    const mean=total/BINS, deg=best/(BINS-1)*2*MAXDEG-MAXDEG;
    return {deg, ok: sm[best] > mean*3};
  }
  function bbox(p,w,h){
    const xs=[],ys=[]; p.forEach(q=>{ if(q.visibility>.3){ xs.push(q.x*w); ys.push(q.y*h); } });
    if(!xs.length) return null;
    const x0=Math.min(...xs), x1=Math.max(...xs), y0=Math.min(...ys), y1=Math.max(...ys), mx=(x1-x0)*.6+20, my=(y1-y0)*.12+20;
    return {x0:x0-mx, x1:x1+mx, y0:y0-my, y1:y1+my};
  }

  async function align(url, lm){
    const im=await loadImg(url);
    const k=Math.min(1, 900/Math.max(im.naturalWidth, im.naturalHeight));
    const W=Math.round(im.naturalWidth*k), H=Math.round(im.naturalHeight*k);
    const c0=toCanvas(im,W,H,0);
    const p0=(lm.detect(c0).landmarks||[])[0];
    const t=estimateTilt(c0, p0 && bbox(p0,W,H));
    const tilt = t.ok && Math.abs(t.deg)>=0.3 ? t.deg : 0;
    const c1 = tilt ? toCanvas(im,W,H,-tilt*Math.PI/180) : c0;
    const p=tilt ? (lm.detect(c1).landmarks||[])[0] : p0;
    const out=document.createElement('canvas'); out.width=OUT_W; out.height=OUT_H;
    const g=out.getContext('2d'); g.fillStyle='#f4efe7'; g.fillRect(0,0,OUT_W,OUT_H);
    if(!p){ const s=Math.min(OUT_W/W,OUT_H/H); g.drawImage(c1,(OUT_W-W*s)/2,(OUT_H-H*s)/2,W*s,H*s); return {canvas:out, tilt, found:false}; }

    const P=i=>({x:p[i].x*W, y:p[i].y*H, v:p[i].visibility});
    const side = Math.abs(P(11).x-P(12).x) < Math.abs(P(11).y-P(27).y)*0.12;   // 肩幅が狭ければ横向き
    const L = (p[7].visibility+p[11].visibility+p[23].visibility+p[25].visibility+p[27].visibility) >= (p[8].visibility+p[12].visibility+p[24].visibility+p[26].visibility+p[28].visibility);
    const pick = side ? (L?[7,11,23,25,27]:[8,12,24,26,28]) : null;
    const mid=(a,b)=>({x:(P(a).x+P(b).x)/2, y:(P(a).y+P(b).y)/2});
    const ankle = side ? P(pick[4]) : mid(27,28);
    const heelY = Math.max(P(29).y, P(30).y, P(31).y, P(32).y);
    const ear = side ? P(pick[0]) : mid(7,8);
    const s = BODY_PX / Math.max(40, heelY - ear.y);
    const ox = OUT_W/2 - ankle.x*s, oy = BASE_Y - heelY*s;
    g.drawImage(c1, ox, oy, W*s, H*s);
    const T=q=>({x:q.x*s+ox, y:q.y*s+oy});

    // 基準線(くるぶしから真上)と床の線
    g.lineWidth=2; g.strokeStyle='rgba(185,92,80,.9)'; g.setLineDash([8,6]);
    g.beginPath(); g.moveTo(OUT_W/2,0); g.lineTo(OUT_W/2,OUT_H); g.stroke();
    g.beginPath(); g.moveTo(0,BASE_Y); g.lineTo(OUT_W,BASE_Y); g.stroke(); g.setLineDash([]);
    // 耳・肩・股関節・膝・くるぶし
    const pts = side ? pick.map(i=>T(P(i))) : [[7,8],[11,12],[23,24],[25,26],[27,28]].map(([a,b])=>T(mid(a,b)));
    g.lineWidth=3; g.strokeStyle='rgba(30,90,200,.95)';
    g.beginPath(); pts.forEach((q,i)=>i?g.lineTo(q.x,q.y):g.moveTo(q.x,q.y)); g.stroke();
    if(!side){ // 正面は肩と骨盤の左右の傾きも
      [[11,12],[23,24]].forEach(([a,b])=>{ const A=T(P(a)),B=T(P(b)); g.beginPath(); g.moveTo(A.x,A.y); g.lineTo(B.x,B.y); g.stroke(); });
    }
    g.fillStyle='#3fd25a'; pts.forEach(q=>{ g.beginPath(); g.arc(q.x,q.y,6,0,7); g.fill(); });
    return {canvas:out, tilt, found:true, side};
  }
  window.Posture={align};
})();
