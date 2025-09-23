// ! AniCross OCR main
import './style.css';
import { createWorker } from 'tesseract.js';
import { autoTuneOcr } from './utils/ocrHelper.js';

window.addEventListener('DOMContentLoaded', () => {
  const fileInput  = document.getElementById('fileInput');
  const preview    = document.getElementById('preview');
  const runBtn     = document.getElementById('runBtn');
  const autoBtn    = document.getElementById('autoBtn');
  const statusEl   = document.getElementById('status');
  const outputEl   = document.getElementById('output');
  const workCanvas = document.getElementById('workCanvas');

  let imageFile = null;

  console.log('autoBtn present:', !!document.getElementById('autoBtn'));


  async function fileToScaledBlob(file, maxSide = 1600, mime = 'image/png', quality = 0.92) {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    workCanvas.width = w; workCanvas.height = h;
    const ctx = workCanvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => workCanvas.toBlob(res, mime, quality));
    if (blob) return blob;
    const dataUrl = workCanvas.toDataURL(mime, quality);
    const bin = atob(dataUrl.split(',')[1]); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  fileInput.addEventListener('change', () => {
    imageFile = fileInput.files?.[0] || null;
    if (!imageFile) return;
    preview.src = URL.createObjectURL(imageFile);
    outputEl.textContent = '';
    statusEl.textContent = 'Ready to OCR…';
  });

  // ! Simple OCR (one shot)
  runBtn?.addEventListener('click', async () => {
    if (!imageFile) { statusEl.textContent = 'Please select an image first.'; return; }
    outputEl.textContent = ''; statusEl.textContent = 'Starting OCR…';

    const sourceBlob = await fileToScaledBlob(imageFile);
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-/().,% ',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '6',
    });

    try {
      const { data } = await worker.recognize(sourceBlob);
      outputEl.textContent = `// ! OCR Result\n// * avg confidence: ${Math.round(data?.confidence ?? 0)}\n\n${data?.text || ''}`;
      statusEl.textContent = 'Done';
    } catch (e) { console.error(e); statusEl.textContent = 'OCR error – see console'; }
    finally { await worker.terminate(); }
  });

  // ! Auto-Tune OCR (grid search)
  autoBtn?.addEventListener('click', async () => {
    if (!imageFile) { statusEl.textContent = 'Please select an image first.'; return; }
    outputEl.textContent = '';
    statusEl.textContent = 'Auto-tuning… (this may take a bit)';

    const sourceBlob = await fileToScaledBlob(imageFile);
    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-/().,% ',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '6',
    });

    try {
      const result = await autoTuneOcr(worker, sourceBlob, {
        maxSide: 1600,
        multipliers: [1.0, 1.2, 1.4, 1.6, 1.8],
        offsets: [-60, -40, -20, 0, 20],
        thresholds: [null, 120, 140, 160],
        stopScore: 96,
        update: ({ step, total, params }) => {
          statusEl.textContent = `Trying ${step}/${total} — m:${params.m} o:${params.o} t:${params.t ?? 'none'}`;
        },
      });

      outputEl.textContent =
`// ! Auto-tuned OCR
// * confidence: ${Math.round(result.confidence)}
// * params: multiplier=${result.params.multiplier}, offset=${result.params.offset}, threshold=${result.params.threshold ?? 'none'}
${result.text || ''}`;

      statusEl.textContent = `Best of ${result.tried}/${result.total} trials`;
    } catch (e) { console.error(e); statusEl.textContent = 'Auto-tune error – see console'; }
    finally { await worker.terminate(); }
  });
});
