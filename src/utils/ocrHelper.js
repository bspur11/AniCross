// src/utils/ocrHelper.js

console.log("OCRHELPER build A10");
console.log("OCRHELPER build A12");

function clamp(x, lo = 0, hi = 255) {
  return Math.max(lo, Math.min(hi, x));
}

async function loadImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = rej;
    img.src = url;
  });
}

/** median filter to knock out glitter dots (k=3 default) */
function medianFilterGray(px, w, h, k = 3) {
  const half = (k | 0) >> 1;
  const out = new Uint8ClampedArray(px.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const vals = [];
      for (let j = -half; j <= half; j++) {
        for (let i = -half; i <= half; i++) {
          const xx = Math.max(0, Math.min(w - 1, x + i));
          const yy = Math.max(0, Math.min(h - 1, y + j));
          vals.push(px[(yy * w + xx) * 4]); // gray replicated into RGB
        }
      }
      vals.sort((a, b) => a - b);
      const m = vals[vals.length >> 1];
      const p = (y * w + x) * 4;
      out[p] = out[p + 1] = out[p + 2] = m;
      out[p + 3] = 255;
    }
  }
  return out;
}

/** Crop + grayscale + (optional) median + contrast/offset + (optional) threshold -> Blob
 * rect is normalized {x,y,w,h} in [0,1]
 */
export async function cropPreprocessToBlob(
  sourceBlob,
  rect,
  {
    maxSide = 1600,
    medianK = 3,
    multiplier = 1.2,
    offset = -40,
    threshold = 160,
    invert = false, // NEW
    mime = "image/png",
    quality = 0.92,
  } = {}
) {
  const img = await loadImage(sourceBlob);

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  const W = Math.round(naturalW * scale);
  const H = Math.round(naturalH * scale);

  const sx = Math.round(rect.x * W);
  const sy = Math.round(rect.y * H);
  const sw = Math.round(rect.w * W);
  const sh = Math.round(rect.h * H);

  const c = document.createElement("canvas");
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext("2d");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  const id = ctx.getImageData(0, 0, sw, sh);
  const px = id.data;

  // grayscale
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = y;
  }

  // optional median
  if (medianK && medianK > 1) {
    const med = medianFilterGray(px, sw, sh, medianK);
    px.set(med);
  }

  // contrast/offset + optional binarize + optional invert
  for (let i = 0; i < px.length; i += 4) {
    let y = clamp(px[i] * multiplier + offset);
    if (threshold != null) y = y >= threshold ? 255 : 0;
    if (invert) y = 255 - y; // ✅ apply invert here
    px[i] = px[i + 1] = px[i + 2] = y;
  }

  // TEMP TEST: FORCE INVERT so thumbs MUST flip
  for (let i = 0; i < px.length; i += 4) {
    px[i] = 255 - px[i];
    px[i + 1] = px[i];
    px[i + 2] = px[i];
  }
  // END TEMP TEST

  ctx.putImageData(id, 0, 0);

  const blob = await new Promise((res) => c.toBlob(res, mime, quality));
  if (blob) return blob;

  const dataUrl = c.toDataURL(mime, quality);
  const bin = atob(dataUrl.split(",")[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/** Recognize multiple zones with their own PSM/whitelist */
export async function recognizeZones(worker, sourceBlob, zones) {
  const results = {};
  for (const z of zones) {
    const prep = await cropPreprocessToBlob(sourceBlob, z.rect, {
      maxSide: z.maxSide ?? 1600,
      medianK: z.medianK ?? 3,
      multiplier: z.multiplier ?? 1.2,
      offset: z.offset ?? -40,
      threshold: z.threshold ?? 160,
      invert: !!z.invert, // ✅ send invert to preprocessor
    });

    console.log("zone params", z.name, {
      rect: z.rect,
      psm: z.psm,
      invert: z.invert,
      thr: z.threshold,
      mult: z.multiplier,
      off: z.offset,
      mk: z.medianK,
    });

    await worker.setParameters({
      tessedit_pageseg_mode: String(z.psm ?? 7),
      tessedit_char_whitelist: z.whitelist ?? "",
      preserve_interword_spaces: "1",
      tessedit_do_invert: "0", // ✅ avoid double invert
    });
    const { data } = await worker.recognize(prep);
    results[z.name] = {
      text: (data?.text || "").trim(),
      confidence: typeof data?.confidence === "number" ? data.confidence : 0,
    };
  }
  return results;
}

// keep your exported zones here (normalized 0..1)
export const zones = [
  // top-right number bubble
  {
    name: "code",
    rect: { x: 0.79, y: 0.03, w: 0.15, h: 0.08 },
    psm: 8,
    whitelist: "0123456789",
    medianK: 2,
    threshold: null,
    multiplier: 1.15,
    offset: -10,
    invert: false,
  },

  // big center name — this sits just above the very bottom band
  {
    name: "name",
    rect: { x: 0.3, y: 0.82, w: 0.36, h: 0.08 },
    psm: 7,
    whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -",
    medianK: 2,
    threshold: 182,
    multiplier: 1.1,
    offset: 0,
    invert: true,
  },

  // small left name (“Marie”) — near bottom-left
  {
    name: "left",
    rect: { x: 0.06, y: 0.85, w: 0.18, h: 0.04 },
    psm: 7,
    whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -",
    medianK: 2,
    threshold: 182,
    multiplier: 1.1,
    offset: 0,
    invert: true,
  },

  // small right name (“Canela”) — near bottom-right
  {
    name: "right",
    rect: { x: 0.72, y: 0.86, w: 0.22, h: 0.05 },
    psm: 7,
    whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -",
    medianK: 2,
    threshold: 182,
    multiplier: 1.1,
    offset: 0,
    invert: true,
  },

  // bottom date “12/20” — centered, very bottom
  {
    name: "date",
    rect: { x: 0.44, y: 0.93, w: 0.2, h: 0.06 },
    psm: 7,
    whitelist: "0123456789/",
    medianK: 2,
    threshold: 170,
    multiplier: 1.1,
    offset: 0,
    invert: true,
  },
];

// rect: { x: 0.79, y: 0.05, w: 0.16, h: 0.11 },
// rect: { x: 1.73, y: 0.12, w: 0.29, h: 0.1 }
