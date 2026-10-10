/** Scapi: original approved artwork + continuous facial controls. No runtime dependencies. */
export const SCAPI_STATES = Object.freeze(['idle','listening','thinking','happy','concerned','wink','success','error']);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const layerCache=new Map();
const poses={idle:[0,0,0,0],listening:[0,0,0,0],thinking:[-1.2,-2,.18,0],happy:[0,0,0,1],concerned:[-.6,0,.28,0],wink:[0,0,0,0],success:[0,0,0,1],error:[-.6,0,.28,0]};
/** @param {HTMLCanvasElement} canvas */
export function createScapi(canvas,options={}){
 const {assetUrl=new URL('./assets/scapi-reference.webp',import.meta.url).href,onReady,onError}=options;
 const ctx=canvas.getContext('2d'); if(!ctx) throw new Error('Scapi needs Canvas 2D.');
 let destroyed=false,ready=false,frame=0,last=0,elapsed=0,visible=true,state='idle',gaze='front',speed=1,forcedReduced=false,effectsEnabled=options.effects!==false,effectStart=0;
 let accents={thinking:0,success:0,error:0};
 let bodyLayer=null, eyeLayers=[];
 let pose={r:0,gx:0,gy:0,l:1,rEye:1,h:0,concern:0,wink:0},nextBlink=4.3,blinkStart=-100,winkUntil=0;
 const media=matchMedia('(prefers-reduced-motion: reduce)'),img=new Image();
 const W=420,H=360;
 const reduced=()=>forcedReduced||media.matches;
 function size(){const dpr=Math.min(devicePixelRatio||1,2);canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw();}
 function prepareLayers(){
  const cached=layerCache.get(img.src);if(cached){bodyLayer=cached.body;eyeLayers=cached.eyes;return;}
  // Derive transparency from the approved orange silhouette, not a redrawn shape.
  bodyLayer=document.createElement('canvas');bodyLayer.width=420;bodyLayer.height=340;
  const bc=bodyLayer.getContext('2d');bc.drawImage(img,60,140,420,340,0,0,420,340);
  const pixels=bc.getImageData(0,0,420,340),d=pixels.data;
  const orange=(x,y)=>{const i=(y*420+x)*4;return d[i]>85&&d[i]-d[i+1]>44&&d[i+1]-d[i+2]>12;};
  for(let y=0;y<340;y++){
   let lo=420,hi=-1;if(y>=14&&y<317){for(let x=23;x<378;x++)if(orange(x,y)){lo=Math.min(lo,x);hi=x;}}
   for(let x=0;x<420;x++){const i=(y*420+x)*4;if(x<lo||x>hi||(y>293&&!orange(x,y)))d[i+3]=0;}
  }
  // Smooth the mask in space, keeping the original color/shading intact.
  const mask=document.createElement('canvas');mask.width=420;mask.height=340;
  const mc=mask.getContext('2d');mc.putImageData(pixels,0,0);
  const alphaCanvas=document.createElement('canvas');alphaCanvas.width=420;alphaCanvas.height=340;
  const ac=alphaCanvas.getContext('2d');ac.filter='blur(0.65px)';ac.drawImage(mask,0,0);ac.filter='none';
  bc.clearRect(0,0,420,340);bc.drawImage(img,60,140,420,340,0,0,420,340);
  bc.globalCompositeOperation='destination-in';bc.drawImage(alphaCanvas,0,0);bc.globalCompositeOperation='source-over';
  eyeLayers=[[194,330,31,38],[309,332,30,38]].map(([cx,cy,rx,ry])=>{
   const pad=10,w=(rx+pad)*2,h=(ry+pad)*2;
   const blank=document.createElement('canvas');blank.width=w;blank.height=h;const ec=blank.getContext('2d');
   ec.drawImage(img,cx-w/2,cy-h/2,w,h,0,0,w,h);const patch=ec.getImageData(0,0,w,h),v=patch.data;
   const original=new Uint8ClampedArray(v),middle=Math.floor(w/2);
   const top=(3*w+middle)*4,bottom=((h-4)*w+middle)*4;
   // A sampled cream eyelid surface, confined to the original pupil aperture.
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const nx=(x-w/2)/(rx+2),ny=(y-h/2)/(ry+2),radius=Math.sqrt(nx*nx+ny*ny);
    const blend=clamp((1.12-radius)/.10,0,1);if(!blend)continue;
    const i=(y*w+x)*4,f=clamp(y/(h-1),0,1);
    for(let k=0;k<3;k++){const skin=original[top+k]*(1-f)+original[bottom+k]*f;v[i+k]=original[i+k]*(1-blend)+skin*blend;}
   }ec.putImageData(patch,0,0);
   const happy=document.createElement('canvas');happy.width=w;happy.height=h;const hc=happy.getContext('2d');
   hc.drawImage(img,cx-w/2,cy+422-h/2,w,h,0,0,w,h);
   const hp=hc.getImageData(0,0,w,h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const edge=Math.max(Math.abs((x-w/2)/(w/2)),Math.abs((y-h/2)/(h/2)));hp.data[(y*w+x)*4+3]=255*clamp((1-edge)/.20,0,1);
   }hc.putImageData(hp,0,0);return {blank,happy,w,h};
  });
  if(layerCache.size>=4)layerCache.delete(layerCache.keys().next().value);
  layerCache.set(img.src,{body:bodyLayer,eyes:eyeLayers});
 }
 function eye(cx,cy,rx,ry,open,happy,concern,index){
  if(open>.998&&Math.abs(pose.gx)<.02&&Math.abs(pose.gy)<.02&&happy<.002&&concern<.002)return;
  const layer=eyeLayers[index];ctx.save();ctx.translate(cx,cy);
  ctx.drawImage(layer.blank,-layer.w/2,-layer.h/2);
  const aperture=clamp(open,0,1);
  if(aperture>.035){ctx.save();ctx.beginPath();ctx.ellipse(0,0,rx,ry*aperture,0,0,Math.PI*2);ctx.clip();ctx.translate(pose.gx,pose.gy);
   ctx.globalAlpha=1-happy;ctx.drawImage(img,cx-rx-4,cy-ry-4,rx*2+8,ry*2+8,-rx-4,-ry-4,rx*2+8,ry*2+8);ctx.restore();}
  if(happy>.002){ctx.globalAlpha=happy;ctx.drawImage(layer.happy,-layer.w/2,-layer.h/2);ctx.globalAlpha=1;}
  else if(aperture<.09){ctx.strokeStyle='rgba(104,61,31,.3)';ctx.lineWidth=1.2;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-rx*.72,0);ctx.quadraticCurveTo(0,3,rx*.72,0);ctx.stroke();}
  ctx.restore();
 }
 function softMaterial(x,y,r,light,base,shade){
  const g=ctx.createRadialGradient(x-r*.35,y-r*.45,r*.08,x,y,r*1.15);
  g.addColorStop(0,light);g.addColorStop(.52,base);g.addColorStop(1,shade);return g;
 }
 function tear(x,y,amount){
  ctx.save();ctx.translate(x,y);ctx.scale(1.35,1.35);ctx.globalAlpha=amount;
  ctx.shadowColor='rgba(78,105,118,.15)';ctx.shadowBlur=3;ctx.shadowOffsetY=1.5;
  ctx.fillStyle=softMaterial(0,4,10,'#effbfc','#b4d7e4','#7c9fae');
  ctx.beginPath();ctx.moveTo(0,-10);ctx.bezierCurveTo(-2,-5,-7,0,-7,5);ctx.bezierCurveTo(-7,14,7,14,7,5);ctx.bezierCurveTo(7,0,2,-5,0,-10);ctx.fill();
  ctx.shadowColor='transparent';ctx.fillStyle='rgba(255,255,255,.65)';ctx.beginPath();ctx.ellipse(-2.5,3.5,1.8,3.5,.35,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 function warning(alpha){
  ctx.save();ctx.translate(371,293);ctx.scale(1.25,1.25);ctx.globalAlpha=alpha;
  ctx.shadowColor='rgba(66,37,25,.14)';ctx.shadowBlur=7;ctx.shadowOffsetY=3;
  ctx.fillStyle=softMaterial(-2,-2,25,'#ffe2bf','#ffb36f','#e78849');
  ctx.beginPath();ctx.moveTo(-3,-21);ctx.quadraticCurveTo(0,-27,4,-20);ctx.lineTo(21,10);ctx.quadraticCurveTo(25,17,16,17);ctx.lineTo(-17,17);ctx.quadraticCurveTo(-25,17,-21,10);ctx.closePath();ctx.fill();
  ctx.shadowColor='transparent';ctx.fillStyle='#fff6eb';
  ctx.beginPath();ctx.roundRect(-2.2,-9,4.4,12,2.2);ctx.fill();ctx.beginPath();ctx.arc(0,8,2.3,0,Math.PI*2);ctx.fill();ctx.restore();
 }
 function popper(alpha,t){
  ctx.save();ctx.translate(365,274);ctx.scale(1.25,1.25);ctx.rotate(-.2);ctx.globalAlpha=alpha;
  ctx.shadowColor='rgba(73,37,19,.13)';ctx.shadowBlur=6;ctx.shadowOffsetY=3;
  ctx.fillStyle=softMaterial(-2,1,26,'#ffe5c6','#ffb36f','#df813e');
  ctx.beginPath();ctx.moveTo(-3,27);ctx.quadraticCurveTo(-6,29,-7,24);ctx.lineTo(-18,-14);ctx.quadraticCurveTo(-17,-19,-11,-17);ctx.lineTo(19,-3);ctx.quadraticCurveTo(22,1,16,4);ctx.closePath();ctx.fill();
  ctx.shadowColor='transparent';ctx.save();ctx.clip();ctx.strokeStyle='rgba(255,241,218,.9)';ctx.lineWidth=6;
  ctx.beginPath();ctx.moveTo(-20,0);ctx.quadraticCurveTo(-2,11,19,13);ctx.moveTo(-16,14);ctx.lineTo(5,23);ctx.stroke();ctx.restore();
  ctx.fillStyle=softMaterial(0,-8,18,'#fff0d9','#ffd2a1','#cc713b');ctx.beginPath();ctx.ellipse(0,-8,18,5,.4,0,Math.PI*2);ctx.fill();ctx.restore();
  if(reduced()||t>1.8||t<0)return;
  const colors=['#ffb36f','#e3b964','#93bbb3','#d3a09b'];
  for(let i=0;i<11;i++){
   const angle=-2.5+i*.17,velocity=40+(i%4)*10,progress=t+.16;
   const x=365+Math.cos(angle)*velocity*progress,y=264+Math.sin(angle)*velocity*progress+24*t*t;
   ctx.save();ctx.translate(x,y);ctx.rotate(i*1.8+t*(i%2?1.8:-1.8));ctx.globalAlpha=alpha*clamp((1.8-t)/.5,0,1);
   ctx.fillStyle=colors[i%4];ctx.beginPath();ctx.roundRect(-2.8,-4.8,5.6,9.6,1.6);ctx.fill();ctx.restore();
  }
 }
 function thought(alpha){
  // Soft thought beads replace the thin steam strokes that looked like hairs.
  ctx.save();ctx.globalAlpha=alpha;
  const bob=reduced()?0:Math.sin(elapsed*Math.PI*2/3.5)*1.3;
  for(const [x,y,r] of [[246,43,4.6],[261,30,7.2],[283,15,11.7]]){
   ctx.fillStyle=softMaterial(x,y+bob,r,'#fff8ed','#e9dfd0','#c2b5a2');
   ctx.shadowColor='rgba(81,61,41,.08)';ctx.shadowBlur=3;ctx.shadowOffsetY=1;
   ctx.beginPath();ctx.arc(x,y+bob,r,0,Math.PI*2);ctx.fill();
  }ctx.restore();
 }
 function drawAccents(){
  if(accents.thinking>.002)thought(accents.thinking*.9);
  if(accents.success>.002)popper(accents.success,elapsed-effectStart);
  if(accents.error>.002)warning(accents.error);
 }
 function draw(){if(!ready||destroyed)return;const dpr=canvas.width/W;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.clearRect(0,0,W,H);
  // Independent soft contact shadow, never baked background from the concept board.
  const shadow=ctx.createRadialGradient(210,330,0,210,330,140);shadow.addColorStop(0,'rgba(0,0,0,.17)');shadow.addColorStop(1,'rgba(0,0,0,0)');ctx.save();ctx.translate(0,278);ctx.scale(1,.16);ctx.fillStyle=shadow;ctx.fillRect(45,180,330,300);ctx.restore();
  const breathe=reduced()?0:Math.sin(elapsed*Math.PI*2/5.5)*.55;
  const lift=!reduced()&&(state==='happy'||state==='success')?Math.sin(elapsed*Math.PI*2/2.8)*.7:0;
  ctx.save();ctx.translate(210,318+breathe+lift);ctx.rotate(pose.r*Math.PI/180);ctx.translate(-250,-450);
  ctx.drawImage(bodyLayer,60,140);
  eye(194,330,31,38,pose.l,pose.h,pose.concern,0);eye(309,332,30,38,pose.rEye,Math.max(pose.h,pose.wink),pose.concern,1);
  if(accents.error>.002){
   // One small tear, not an ongoing distressed crying loop.
   const t=reduced()?0:clamp((elapsed-effectStart)/1.5,0,1);
   const travel=t<1?Math.sin(t*Math.PI)*9:0;
   tear(326,370+travel,accents.error*.8);
  }
  ctx.restore();drawAccents();
 }
 function tick(now){frame=0;if(destroyed||!ready||!visible||document.hidden)return;
  const dt=last?Math.min((now-last)/1000,.05):0;last=now;elapsed+=dt/speed;
  if(!reduced()&&elapsed>=nextBlink){blinkStart=elapsed;nextBlink=elapsed+4.6+Math.random()*2.2;}
  const t=(elapsed-blinkStart)/.22;
  const blink=!reduced()&&t>=0&&t<=1?Math.sin(t*Math.PI)**2:0;
  const p=poses[state]||poses.idle;
  const g=gaze==='left'?[-2.8,0]:gaze==='right'?[2.8,0]:gaze==='up'?[0,-2]:[0,0];
  const happy=p[3],wink=state==='wink'&&elapsed<winkUntil;
  const goal={r:reduced()?0:p[0],gx:g[0]+(state==='thinking'?p[1]:0),gy:g[1],l:1-blink,rEye:wink?0:1-blink,h:happy,wink:wink?1:0,concern:(state==='concerned'||state==='error')?1:0};
  if(state==='thinking')goal.l=goal.rEye=Math.min(goal.l,.86);
  if(state==='concerned'||state==='error')goal.l=goal.rEye=Math.min(goal.l,.9);
  const alpha=1-Math.exp(-dt*22/speed);
  let changing=false;for(const k of Object.keys(pose)){pose[k]+= (goal[k]-pose[k])*alpha;if(Math.abs(goal[k]-pose[k])<.001)pose[k]=goal[k];else changing=true;}
  for(const k of Object.keys(accents)){const target=effectsEnabled&&state===k?1:0;accents[k]+=(target-accents[k])*alpha;if(Math.abs(target-accents[k])<.001)accents[k]=target;else changing=true;}
  if(state==='wink'&&elapsed>=winkUntil)state='idle';
  draw();if(!reduced()||changing||state==='wink')frame=requestAnimationFrame(tick);
 }
 function start(){if(!frame&&!destroyed&&ready&&visible&&!document.hidden){last=0;frame=requestAnimationFrame(tick);}}
 function stop(){cancelAnimationFrame(frame);frame=0;last=0;}
 function motionChange(){stop();if(reduced()){pose.r=0;pose.l=pose.rEye=1;blinkStart=-100;}nextBlink=elapsed+4.3;start();draw();}
 const onVisibility=()=>{document.hidden?stop():start();};
 const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;visible?start():stop();});observer.observe(canvas);
 const resize=new ResizeObserver(size);resize.observe(canvas);
 media.addEventListener('change',motionChange);document.addEventListener('visibilitychange',onVisibility);
 img.onload=()=>{if(destroyed)return;try{prepareLayers();ready=true;size();start();onReady?.();}catch(error){onError?.(error);}};img.onerror=()=>onError?.(new Error('Scapi artwork could not load.'));img.src=assetUrl;
 const api={
  setState(value){if(!SCAPI_STATES.includes(value))throw new Error(`Unknown Scapi state: ${value}`);if(state!==value||value==='success'||value==='error')effectStart=elapsed;state=value;if(value==='wink')winkUntil=elapsed+.65;start();},
  setGaze(value){if(!['front','left','right','up'].includes(value))throw new Error(`Unknown gaze: ${value}`);gaze=value;start();},
  setReducedMotion(value){forcedReduced=!!value;motionChange();},
  setEffects(value){effectsEnabled=!!value;start();},
  setSpeed(value){speed=clamp(Number(value)||1,.25,4);},
  getSnapshot(){return {ready,state,gaze,reducedMotion:reduced(),running:!!frame,pose:{...pose},effects:{...accents}};},
  destroy(){destroyed=true;stop();observer.disconnect();resize.disconnect();media.removeEventListener('change',motionChange);document.removeEventListener('visibilitychange',onVisibility);img.onload=img.onerror=null;}
 };api.setState(options.state||'idle');api.setGaze(options.gaze||'front');forcedReduced=!!options.reducedMotion;return api;
}
