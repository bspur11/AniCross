import './style.css';
import { createWorker } from 'tesseract.js';
import { recognizeZones, cropPreprocessToBlob } from './utils/ocrHelper.js';

window.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileInput');
  const preview   = document.getElementById('preview');
  const runBtn    = document.getElementById('runBtn');
  const autoBtn   = document.getElementById('autoBtn');
  const statusEl  = document.getElementById('status');
  const outputEl  = document.getElementById('output');
  const overlay   = document.getElementById('overlay');

  let imageFile = null;

  // ONE set of zones (normalized 0–1). Tweaked for your sample:
  const zones = [
    // top-right number bubble “424”
    { name:'code',  rect:{ x:0.78, y:0.045, w:0.18, h:0.12 }, psm:7, whitelist:'0123456789', medianK:3, threshold:170, multiplier:1.2, offset:-30 },
    // main name “Isabelle”
    { name:'name',  rect:{ x:0.15, y:0.61,  w:0.70, h:0.13 }, psm:7, whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -', medianK:3, threshold:null, multiplier:1.2, offset:-20 },
    // small left name “Marie”
    { name:'left',  rect:{ x:0.06, y:0.74,  w:0.30, h:0.08 }, psm:7, whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -', medianK:3, threshold:null, multiplier:1.2, offset:-20 },
    // small right name “Canela”
    { name:'right', rect:{ x:0.64, y:0.74,  w:0.30, h:0.08 }, psm:7, whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz -', medianK:3, threshold:null, multiplier:1.2, offset:-20 },
    // bottom date “12/20”
    { name:'date',  rect:{ x:0.45, y:0.88,  w:0.18, h:0.08 }, psm:7, whitelist:'0123456789/',                            medianK:3, threshold:180, multiplier:1.2, offset:-30 },
  ];

  function renderOverlay() {
    if (!overlay || !preview.complete) return;
    // get visible size of the <img>
    const w = preview.clientWidth;
    const h = preview.clientHeight;
    overlay.innerHTML = '';
    zones.forEach(z => {
      const box = document.createElement('div');
      box.className = 'zbox';
      box.dataset.name = z.name;
      box.style.left   = `${z.rect.x * w}px`;
      box.style.top    = `${z.rect.y * h}px`;
      box.style.width  = `${z.rect.w * w}px`;
      box.style.height = `${z.rect.h * h}px`;
      overlay.appendChild(box);
    });
  }

  fileInput?.addEventListener('change', () => {
    imageFile = fileInput.files?.[0] || null;
    if (!imageFile) return;
    preview.src = URL.createObjectURL(imageFile);
    outputEl.textContent = '';
    statusEl.textContent = 'Ready…';
    preview.onload = renderOverlay; // draw boxes when image is loaded
  });

  // (kept) quick full-frame OCR
  runBtn?.addEventListener('click', async () => {
    if (!imageFile) { statusEl.textContent = 'Please select an image first.'; return; }
    statusEl.textContent = 'Starting OCR…';
    const worker = await createWorker('eng');
    try {
      const { data } = await worker.recognize(imageFile);
      outputEl.textContent = `// OCR\n${data?.text || ''}`;
      statusEl.textContent = 'Done';
    } catch (e) { console.error(e); statusEl.textContent = 'OCR error – see console'; }
    finally { await worker.terminate(); }
  });

  // ZONE OCR on the Auto button
  autoBtn?.addEventListener('click', async () => {
    if (!imageFile) { statusEl.textContent = 'Pick an image first.'; return; }
    statusEl.textContent = 'Reading zones…';
    const worker = await createWorker('eng');
    try {
      // (optional) show the preprocessed crops as thumbnails for debugging
      const thumbs = await Promise.all(zones.map(async z => {
        const b = await cropPreprocessToBlob(imageFile, z.rect, {
          maxSide: 1600, medianK: z.medianK, multiplier: z.multiplier, offset: z.offset, threshold: z.threshold
        });
        return { name: z.name, url: URL.createObjectURL(b) };
      }));
      // OCR the zones
      const res = await recognizeZones(worker, imageFile, zones);
      outputEl.innerHTML =
`code: ${res.code?.text || ''}  (conf ${Math.round(res.code?.confidence||0)})
name: ${res.name?.text || ''}
left: ${res.left?.text || ''}   right: ${res.right?.text || ''}
date: ${res.date?.text || ''}

[debug thumbs below]`;
      // append thumbs
      thumbs.forEach(t => {
        const img = new Image(); img.src = t.url; img.style.maxWidth = '140px'; img.style.marginRight='10px';
        const label = document.createElement('div'); label.textContent = t.name; label.style.fontSize='12px';
        outputEl.appendChild(document.createElement('br'));
        outputEl.appendChild(label);
        outputEl.appendChild(img);
      });
      statusEl.textContent = 'Done (zones)';
      renderOverlay();
    } catch (e) {
      console.error(e);
      statusEl.textContent = 'Zone OCR error';
    } finally {
      await worker.terminate();
    }
  });
});
