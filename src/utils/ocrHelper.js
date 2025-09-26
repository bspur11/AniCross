// src/utils/ocrHelper.js

function clamp(x, lo=0, hi=255){ return Math.max(lo, Math.min(hi, x)); }

async function loadImage(blob){
  return new Promise((res, rej)=>{
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(blob);
  });
}

/** median filter to knock out glitter dots (k=3 default) */
function medianFilterGray(px, w, h, k=3){
  const half = (k|0)>>1, out = new Uint8ClampedArray(px.length);
  for (let y=0; y<h; y++){
    for (let x=0; x<w; x++){
      const vals = [];
      for (let j=-half;j<=half;j++) for (let i=-half;i<=half;i++){
        const xx = Math.max(0, Math.min(w-1, x+i));
        const yy = Math.max(0, Math.min(h-1, y+j));
        vals.push(px[(yy*w+xx)*4]); // gray replicated to RGB
      }
      vals.sort((a,b)=>a-b);
      const m = vals[(vals.length>>1)];
      const p = (y*w+x)*4;
      out[p]=out[p+1]=out[p+2]=m; out[p+3]=255;
    }
  }
  return out;
}

/** Crop + grayscale + (optional) median + contrast/offset + (optional) threshold -> Blob
 * rect is normalized {x,y,w,h} in [0,1]
 */
export async function cropPreprocessToBlob(sourceBlob, rect, {
  maxSide=1600, medianK=3, multiplier=1.2, offset=-40, threshold=160,
  mime='image/png', quality=0.92
} = {}){
  const img = await loadImage(sourceBlob);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const W = Math.round(img.width*scale), H = Math.round(img.height*scale);

  const sx = Math.round(rect.x*W), sy = Math.round(rect.y*H);
  const sw = Math.round(rect.w*W), sh = Math.round(rect.h*H);

  const c = document.createElement('canvas'); c.width=sw; c.height=sh;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  let id = ctx.getImageData(0,0,sw,sh);
  let px = id.data;

  // grayscale
  for (let i=0;i<px.length;i+=4){
    const y = 0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2];
    px[i]=px[i+1]=px[i+2]=y;
  }

  // median to kill glitter
  if (medianK && medianK>1) {
    const med = medianFilterGray(px, sw, sh, medianK);
    px.set(med);
  }

  // contrast/offset + optional binarize
  for (let i=0;i<px.length;i+=4){
    let y = clamp(px[i]*multiplier + offset);
    if (threshold!=null) y = y>=threshold ? 255 : 0;
    px[i]=px[i+1]=px[i+2]=y;
  }
  ctx.putImageData(id,0,0);

  const blob = await new Promise(res=>c.toBlob(res, mime, quality));
  if (blob) return blob;

  const dataUrl = c.toDataURL(mime, quality);
  const bin = atob(dataUrl.split(',')[1]);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Recognize multiple zones with their own PSM/whitelist */
export async function recognizeZones(worker, sourceBlob, zones){
  const results = {};
  for (const z of zones){
    const prep = await cropPreprocessToBlob(sourceBlob, z.rect, {
      maxSide: z.maxSide ?? 1600,
      medianK: z.medianK ?? 3,
      multiplier: z.multiplier ?? 1.2,
      offset: z.offset ?? -40,
      threshold: z.threshold ?? 160,
    });
    await worker.setParameters({
      tessedit_pageseg_mode: String(z.psm ?? 7),
      tessedit_char_whitelist: z.whitelist ?? '',
      tessedit_do_invert: '0',
    });
    const { data } = await worker.recognize(prep);
    results[z.name] = {
      text: (data?.text || '').trim(),
      confidence: typeof data?.confidence === 'number' ? data.confidence : 0,
    };
  }

  return results;
}

// put this at the very end of ocrHelper.js
export const zones = [
    
    // top-right number bubble “424”
    { name:'code',  rect:{ x:0.80, y:0.05, w:0.20, h:0.2 }, psm:7, whitelist:'0123456789', medianK:2, threshold:70, multiplier:1.15, offset:-10 },
    // main name “Isabelle”
    { name:'name',  rect:{ x:0.32, y:0.83,  w:0.42, h:0.3 }, psm:7, whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -', medianK:3, threshold:null, multiplier:1.2, offset:-20 },
    // small left name “Marie”
    { name:'left',  rect:{ x:0.04, y:0.83,  w:0.22, h:0.08 }, psm:7, whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -', medianK:3, threshold:null, multiplier:1.2, offset:-20 },
    // small right name “Canela”
    { name:'right', rect:{ x:0.72, y:0.85,  w:0.20, h:0.08 }, psm:7, whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -', medianK:3, threshold:null, multiplier:1.2, offset:-20 },
    // bottom date “12/20”
    { name:'date',  rect:{ x:0.43, y:0.92,  w:0.21, h:0.08 }, psm:7, whitelist:'0123456789/',                            medianK:3, threshold:180, multiplier:1.2, offset:-30 },
  ];

