// ! ocrHelper.js
// * Auto-tune OCR by trying small adjustments to contrast/offset/threshold
// * Works with Tesseract.js v5; send a Blob (not DOM elements) to the worker.

function clamp(x, lo = 0, hi = 255) { return Math.max(lo, Math.min(hi, x)); }

// ! getConfidence
// * Robustly read confidence; fall back to averaging word confidences if needed.
function getConfidence(data) {
  if (typeof data.confidence === 'number') return data.confidence;
  if (Array.isArray(data.words) && data.words.length) {
    const sum = data.words.reduce((s, w) => s + (w.confidence ?? 0), 0);
    return sum / data.words.length;
  }
  return 0;
}

// ! loadImage
// * Load a Blob/File into an HTMLImageElement
function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// ! preprocessToBlob
// * Draw, grayscale, apply linear contrast/offset, optional threshold -> Blob
async function preprocessToBlob(blob, { maxSide = 1600, multiplier = 1.0, offset = 0, threshold = null, mime = 'image/png', quality = 0.92 } = {}) {
  const img = await loadImage(blob);

  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  // Use a hidden canvas passed in by caller if available, else make one
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);

  const id = ctx.getImageData(0, 0, w, h);
  const px = id.data;

  // Grayscale + contrast/offset + optional threshold
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    let y = 0.299 * r + 0.587 * g + 0.114 * b;              // grayscale
    y = clamp(y * multiplier + offset);                     // linear adjust
    if (threshold != null) y = y >= threshold ? 255 : 0;    // binarize
    px[i] = px[i + 1] = px[i + 2] = y;
    // alpha unchanged
  }

  ctx.putImageData(id, 0, 0);

  const outBlob = await new Promise((res) => canvas.toBlob(res, mime, quality));
  if (outBlob) return outBlob;

  // Fallback if toBlob returns null
  const dataUrl = canvas.toDataURL(mime, quality);
  const bin = atob(dataUrl.split(',')[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

// ! scoreText
// * Simple heuristic: OCR confidence + digit weight + length bonus + uppercase bias
function scoreText(text, confidence) {
  const digits = (text.match(/\d/g) || []).length;
  const uppers = (text.match(/[A-Z]/g) || []).length;
  const lenBonus = Math.min(text.length / 200, 1); // cap bonus
  return (confidence || 0) + digits * 0.3 + uppers * 0.05 + lenBonus * 2;
}

// ! autoTuneOcr
// * Try a small grid of params, pick the best by score. Runs with a single worker.
export async function autoTuneOcr(worker, sourceBlob, config = {}) {
  const {
    maxSide = 1600,
    multipliers = [1.0, 1.2, 1.4, 1.6, 1.8],
    offsets = [-60, -40, -20, 0, 20],
    thresholds = [null, 120, 140, 160],
    stopScore = 95,              // early stop if score exceeds this
    update = () => {},           // optional progress callback (pure data)
  } = config;

  let best = { text: '', params: null, confidence: 0, score: -Infinity };

  const total =
    multipliers.length * offsets.length * thresholds.length;

  let k = 0;
  for (const m of multipliers) {
    for (const o of offsets) {
      for (const t of thresholds) {
        k += 1;
        update({ step: k, total, params: { m, o, t } });

        const prep = await preprocessToBlob(sourceBlob, { maxSide, multiplier: m, offset: o, threshold: t });
        const { data } = await worker.recognize(prep); // v5 recognize
        const confidence = getConfidence(data);
        const text = data?.text || '';
        const score = scoreText(text, confidence);

        if (score > best.score) {
          best = {
            text,
            confidence,
            score,
            params: { multiplier: m, offset: o, threshold: t },
          };
        }

        if (best.score >= stopScore) {
          return { ...best, tried: k, total };
        }
      }
    }
  }
  return { ...best, tried: k, total };
}
