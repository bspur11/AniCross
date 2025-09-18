// AniCross OCR main
import './style.css';
import { createWorker } from 'tesseract.js';

window.addEventListener('DOMContentLoaded', () => {
  const fileInput  = document.getElementById('fileInput');
  const preview    = document.getElementById('preview');
  const runBtn     = document.getElementById('runBtn');
  const statusEl   = document.getElementById('status');
  const outputEl   = document.getElementById('output');
  const workCanvas = document.getElementById('workCanvas');

  let imageFile = null;

  // --- 1) Scale big photos -> return a BLOB (cloneable) ---
  async function fileToScaledBlob(file, maxSide = 1600, mime = 'image/png', quality = 0.92) {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = URL.createObjectURL(file);
    });

    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    workCanvas.width = w;
    workCanvas.height = h;
    const ctx = workCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise((res) => workCanvas.toBlob(res, mime, quality));
    // Fallback if toBlob returns null (rare)
    if (!blob) {
      const dataUrl = workCanvas.toDataURL(mime, quality);
      const bin = atob(dataUrl.split(',')[1]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    return blob;
  }

  // Preview
  fileInput.addEventListener('change', () => {
    imageFile = fileInput.files?.[0] || null;
    if (!imageFile) return;
    preview.src = URL.createObjectURL(imageFile);
    outputEl.textContent = '';
    statusEl.textContent = 'Ready to OCR…';
  });

  // Run OCR
  runBtn.addEventListener('click', async () => {
  if (!imageFile) { statusEl.textContent = 'Please select an image first.'; return; }
  outputEl.textContent = '';
  statusEl.textContent = 'Preparing image…';

  const sourceBlob = await fileToScaledBlob(imageFile); // ← Blob, not a canvas/element

  statusEl.textContent = 'Starting OCR engine…';
  const worker = await createWorker('eng'); // v5 API: no loadLanguage/initialize

  await worker.setParameters({
    tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-/().,% ',
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
    tessedit_pageseg_mode: '6',
  });

  try {
    // IMPORTANT: do NOT pass { logger } here — it will be sent to the worker and explode
    const { data } = await worker.recognize(sourceBlob);
    const { text, confidence } = data;
    outputEl.textContent = `// ! OCR Result\n// * avg confidence: ${Math.round(confidence ?? 0)}\n\n${text || ''}`;
    statusEl.textContent = 'Done';
  } catch (err) {
    console.error(err);
    statusEl.textContent = 'OCR error – see console';
  } finally {
    await worker.terminate();
  }
});

