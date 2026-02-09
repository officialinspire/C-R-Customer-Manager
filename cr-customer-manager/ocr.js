import fs from "fs";
import Jimp from "jimp";
import { createWorker } from "tesseract.js";

let _workerPromise = null;

async function getWorker() {
  if (_workerPromise) return _workerPromise;
  _workerPromise = (async () => {
    const w = await createWorker("eng");
    await w.setParameters({
      tessedit_pageseg_mode: "6",
      preserve_interword_spaces: "1"
    });
    return w;
  })();
  return _workerPromise;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

async function preprocessBase(imagePath) {
  const img = await Jimp.read(imagePath);

  // Normalize width so ROI % cropping stays consistent.
  const targetW = 1700;
  if (img.bitmap.width !== targetW) img.resize(targetW, Jimp.AUTO);

  // High-contrast form + handwriting.
  img.greyscale();
  img.contrast(0.45);
  img.normalize();

  // Binarize
  const thresh = 185;
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
    const v = this.bitmap.data[idx];
    const b = v > thresh ? 255 : 0;
    this.bitmap.data[idx] = b;
    this.bitmap.data[idx + 1] = b;
    this.bitmap.data[idx + 2] = b;
  });

  return img;
}

function roiBoxes(w, h) {
  const box = (x, y, ww, hh) => ({
    x: Math.round(x * w),
    y: Math.round(y * h),
    w: Math.round(ww * w),
    h: Math.round(hh * h)
  });

  // These are tuned for the C&R form photo you shared.
  return {
    invoice_number: box(0.64, 0.01, 0.34, 0.09),

    sold_to: box(0.05, 0.16, 0.43, 0.13),
    directions: box(0.52, 0.16, 0.43, 0.13),
    email: box(0.52, 0.275, 0.43, 0.05),

    date: box(0.05, 0.315, 0.10, 0.055),
    home_phone: box(0.15, 0.315, 0.18, 0.055),
    cell_phone: box(0.33, 0.315, 0.16, 0.055),
    installation_date: box(0.49, 0.315, 0.18, 0.055),
    installed_by: box(0.68, 0.315, 0.14, 0.055),
    salesperson: box(0.82, 0.315, 0.14, 0.055),

    manufacturer: box(0.15, 0.365, 0.52, 0.045),
    size: box(0.15, 0.410, 0.52, 0.045),
    style: box(0.15, 0.455, 0.52, 0.045),
    color: box(0.15, 0.500, 0.52, 0.045),
    pad: box(0.15, 0.545, 0.52, 0.045),
    rug_pad: box(0.15, 0.590, 0.52, 0.045),

    unit_amount_block: box(0.67, 0.355, 0.30, 0.26),
    totals_block: box(0.70, 0.695, 0.28, 0.255)
  };
}

async function ocrRegion(worker, baseImg, r) {
  const x = clamp(r.x, 0, baseImg.bitmap.width - 1);
  const y = clamp(r.y, 0, baseImg.bitmap.height - 1);
  const w = clamp(r.w, 1, baseImg.bitmap.width - x);
  const h = clamp(r.h, 1, baseImg.bitmap.height - y);

  const crop = baseImg.clone().crop(x, y, w, h);
  crop.contrast(0.2);

  const buf = await crop.getBufferAsync(Jimp.MIME_PNG);
  const { data } = await worker.recognize(buf);
  return (data.text || "").trim();
}

function cleanLine(t) {
  return String(t || "")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function ocrImageToText(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`OCR file not found: ${imagePath}`);

  const baseImg = await preprocessBase(imagePath);
  const w = baseImg.bitmap.width;
  const h = baseImg.bitmap.height;
  const rois = roiBoxes(w, h);

  const worker = await getWorker();

  const out = {};
  for (const [key, rect] of Object.entries(rois)) {
    out[key] = cleanLine(await ocrRegion(worker, baseImg, rect));
  }

  // Return LABELED text (critical for robust parsing)
  return [
    `INVOICE # CR ${out.invoice_number}`,
    `Sold to: ${out.sold_to}`,
    `Directions: ${out.directions}`,
    `Customer Email: ${out.email}`,
    `Date: ${out.date}`,
    `Home Phone: ${out.home_phone}`,
    `Cell Phone: ${out.cell_phone}`,
    `Installation Date: ${out.installation_date}`,
    `Installed By: ${out.installed_by}`,
    `Salesperson: ${out.salesperson}`,
    `Manufacturer: ${out.manufacturer}`,
    `Size: ${out.size}`,
    `Style: ${out.style}`,
    `Color: ${out.color}`,
    `Pad: ${out.pad}`,
    `Rug Pad: ${out.rug_pad}`,
    `Unit/Amount Block: ${out.unit_amount_block}`,
    `Totals Block: ${out.totals_block}`
  ].join("\n");
}
