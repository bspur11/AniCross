import "./style.css";
import { createWorker } from "tesseract.js";
import {
  recognizeZones,
  cropPreprocessToBlob,
  zones,
} from "./utils/ocrHelper.js";

console.log("MAIN build A12");

console.log(
  "MAIN build A10, zones:",
  zones.map((z) => z.name)
);

zones.forEach((z) => {
  for (const k of ["x", "y", "w", "h"]) {
    if (z.rect[k] < 0 || z.rect[k] > 1) {
      console.warn("Bad rect (must be 0..1):", z.name, z.rect);
    }
  }
});

window.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const preview = document.getElementById("preview");
  const runBtn = document.getElementById("runBtn");
  const autoBtn = document.getElementById("autoBtn");
  const statusEl = document.getElementById("status");
  const outputEl = document.getElementById("output");
  const overlay = document.getElementById("overlay");

  let imageFile = null;

  console.log(Array.isArray(zones), zones.length); // true 5
  console.log("name rect:", zones.find((z) => z.name === "name").rect);

  function renderOverlay() {
    if (!overlay || !preview.complete) return;

    // Anchor overlay to the image's actual displayed box
    overlay.style.left = preview.offsetLeft + "px";
    overlay.style.top = preview.offsetTop + "px";
    overlay.style.width = preview.clientWidth + "px";
    overlay.style.height = preview.clientHeight + "px";

    const w = preview.clientWidth;
    const h = preview.clientHeight;

    overlay.innerHTML = "";
    zones.forEach((z) => {
      const box = document.createElement("div");
      box.className = "zbox";
      box.dataset.name = z.name;
      box.style.left = `${z.rect.x * w}px`;
      box.style.top = `${z.rect.y * h}px`;
      box.style.width = `${z.rect.w * w}px`;
      box.style.height = `${z.rect.h * h}px`;
      overlay.appendChild(box);
    });

    const W = preview.naturalWidth,
      H = preview.naturalHeight;
    zones.forEach((z) => {
      console.log(z.name, {
        x: Math.round(z.rect.x * W),
        y: Math.round(z.rect.y * H),
        w: Math.round(z.rect.w * W),
        h: Math.round(z.rect.h * H),
      });
    });

    // Debug: confirm overlay and image sizes match
    console.log(
      "overlay@",
      overlay.style.left,
      overlay.style.top,
      overlay.style.width,
      overlay.style.height,
      "img@",
      w,
      h
    );
  }

  fileInput?.addEventListener("change", () => {
    imageFile = fileInput.files?.[0] || null;
    if (!imageFile) return;
    preview.src = URL.createObjectURL(imageFile);
    outputEl.textContent = "";
    statusEl.textContent = "Ready…";
    // preview.onload = () => renderOverlay(); // draw boxes when image is loaded

    preview.onload = () => {
      console.log(
        "preview display:",
        preview.clientWidth,
        preview.clientHeight
      );
      console.log(
        "preview natural:",
        preview.naturalWidth,
        preview.naturalHeight
      );
      renderOverlay();
    };
  });

  // (kept) quick full-frame OCR
  runBtn?.addEventListener("click", async () => {
    if (!imageFile) {
      statusEl.textContent = "Please select an image first.";
      return;
    }
    statusEl.textContent = "Starting OCR…";
    const worker = await createWorker("eng");
    try {
      const { data } = await worker.recognize(imageFile);
      outputEl.textContent = `// OCR\n${data?.text || ""}`;
      statusEl.textContent = "Done";
    } catch (e) {
      console.error(e);
      statusEl.textContent = "OCR error – see console";
    } finally {
      await worker.terminate();
    }
  });

  // ZONE OCR on the Auto button
  autoBtn?.addEventListener("click", async () => {
    if (!imageFile) {
      statusEl.textContent = "Pick an image first.";
      return;
    }
    statusEl.textContent = "Reading zones…";
    const worker = await createWorker("eng");
    try {
      // (optional) show the preprocessed crops as thumbnails for debugging
      const thumbs = await Promise.all(
        zones.map(async (z) => {
          const b = await cropPreprocessToBlob(imageFile, z.rect, {
            maxSide: 1600,
            medianK: z.medianK,
            multiplier: z.multiplier,
            offset: z.offset,
            threshold: z.threshold,
            invert: z.invert, // ✅ important
          });

          return { name: z.name, url: URL.createObjectURL(b) };
        })
      );
      // OCR the zones
      const res = await recognizeZones(worker, imageFile, zones);
      outputEl.innerHTML = `code: ${res.code?.text || ""}  (conf ${Math.round(res.code?.confidence || 0)})
name: ${res.name?.text || ""}
left: ${res.left?.text || ""}   right: ${res.right?.text || ""}
date: ${res.date?.text || ""}

[debug thumbs below]`;
      // append thumbs
      thumbs.forEach((t) => {
        const img = new Image();
        img.src = t.url;
        img.style.maxWidth = "140px";
        img.style.marginRight = "10px";
        const label = document.createElement("div");
        label.textContent = t.name;
        label.style.fontSize = "12px";
        outputEl.appendChild(document.createElement("br"));
        outputEl.appendChild(label);
        outputEl.appendChild(img);
      });
      statusEl.textContent = "Done (zones)";
      renderOverlay();
    } catch (e) {
      console.error(e);
      statusEl.textContent = "Zone OCR error";
    } finally {
      await worker.terminate();
    }
  });
});
