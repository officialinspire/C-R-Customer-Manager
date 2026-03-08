import fs from "fs";
import Jimp from "jimp";
import { createWorker } from "tesseract.js";

let _workerPromise = null;

const OCR_CONFIGS = {
  numeric: {
    tessedit_char_whitelist: "0123456789CR- ",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1"
  },
  date: {
    tessedit_char_whitelist: "0123456789/-TODAYtoday ",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1"
  },
  phone: {
    tessedit_char_whitelist: "0123456789()-. ",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1"
  },
  email: {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@.-_+",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "0"
  },
  text: {
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1"
  },
  block: {
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1"
  }
};

// ROI map is intentionally documented for easy tuning against real-world photo variance.
// Coordinates are percentages of width/height after normalization.
const ROI_DEFINITIONS = [
  { key: "invoice_number", type: "numeric", label: "Top-right invoice number", x: 0.64, y: 0.01, w: 0.34, h: 0.09 },
  { key: "sold_to", type: "text", label: "Customer name line", x: 0.05, y: 0.16, w: 0.43, h: 0.13 },
  { key: "directions", type: "text", label: "Address / directions block", x: 0.52, y: 0.16, w: 0.43, h: 0.13 },
  { key: "email", type: "email", label: "Customer email", x: 0.52, y: 0.275, w: 0.43, h: 0.05 },

  { key: "date", type: "date", label: "Order date", x: 0.05, y: 0.315, w: 0.1, h: 0.055 },
  { key: "home_phone", type: "phone", label: "Home phone", x: 0.15, y: 0.315, w: 0.18, h: 0.055 },
  { key: "cell_phone", type: "phone", label: "Cell phone", x: 0.33, y: 0.315, w: 0.16, h: 0.055 },
  { key: "installation_date", type: "date", label: "Installation date", x: 0.49, y: 0.315, w: 0.18, h: 0.055 },
  { key: "installed_by", type: "text", label: "Installed by", x: 0.68, y: 0.315, w: 0.14, h: 0.055 },
  { key: "salesperson", type: "text", label: "Salesperson", x: 0.82, y: 0.315, w: 0.14, h: 0.055 },

  { key: "manufacturer", type: "text", label: "Manufacturer", x: 0.15, y: 0.365, w: 0.52, h: 0.045 },
  { key: "size", type: "text", label: "Size", x: 0.15, y: 0.41, w: 0.52, h: 0.045 },
  { key: "style", type: "text", label: "Style", x: 0.15, y: 0.455, w: 0.52, h: 0.045 },
  { key: "color", type: "text", label: "Color", x: 0.15, y: 0.5, w: 0.52, h: 0.045 },
  { key: "pad", type: "text", label: "Pad", x: 0.15, y: 0.545, w: 0.52, h: 0.045 },
  { key: "rug_pad", type: "text", label: "Rug pad", x: 0.15, y: 0.59, w: 0.52, h: 0.045 },

  { key: "unit_amount_block", type: "numeric", label: "Unit/amount values", x: 0.67, y: 0.355, w: 0.3, h: 0.26 },
  { key: "totals_block", type: "numeric", label: "Totals block", x: 0.7, y: 0.695, w: 0.28, h: 0.255 }
];

function envPercent(name) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : 0;
}

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

function calculateOtsuThreshold(img) {
  const histogram = new Array(256).fill(0);
  const { width, height } = img.bitmap;
  img.scan(0, 0, width, height, function (_, __, idx) {
    histogram[this.bitmap.data[idx]]++;
  });

  const total = width * height;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;

    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}

function detectSkewAngle(img) {
  const { width, height } = img.bitmap;
  let bestAngle = 0;
  let maxScore = 0;

  for (let angle = -10; angle <= 10; angle += 0.5) {
    let score = 0;
    const rad = (angle * Math.PI) / 180;

    for (let y = height * 0.3; y < height * 0.7; y += 5) {
      let blackCount = 0;
      for (let x = 0; x < width; x += 2) {
        const newY = Math.round(y + x * Math.tan(rad));
        if (newY >= 0 && newY < height) {
          const idx = (newY * width + x) * 4;
          if (img.bitmap.data[idx] < 128) blackCount++;
        }
      }
      score += blackCount * blackCount;
    }

    if (score > maxScore) {
      maxScore = score;
      bestAngle = angle;
    }
  }

  return bestAngle;
}

async function preprocessBase(imagePath) {
  const img = await Jimp.read(imagePath);
  if (img.bitmap.width !== 1700) img.resize(1700, Jimp.AUTO);

  img.greyscale();
  img.convolute([
    [0, -1, 0],
    [-1, 5, -1],
    [0, -1, 0]
  ]);
  img.contrast(0.45);
  img.normalize();

  const skewAngle = detectSkewAngle(img);
  if (Math.abs(skewAngle) > 0.3) img.rotate(-skewAngle, false);

  const threshold = calculateOtsuThreshold(img);
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (_, __, idx) {
    const b = this.bitmap.data[idx] > threshold ? 255 : 0;
    this.bitmap.data[idx] = b;
    this.bitmap.data[idx + 1] = b;
    this.bitmap.data[idx + 2] = b;
  });

  return img;
}

function buildRoiBoxes(w, h) {
  const shiftX = envPercent("OCR_ROI_X_SHIFT");
  const shiftY = envPercent("OCR_ROI_Y_SHIFT");
  const expand = envPercent("OCR_ROI_EXPAND");

  const toPx = (x, y, ww, hh) => {
    const tuned = {
      x: x + shiftX,
      y: y + shiftY,
      w: ww + expand,
      h: hh + expand
    };
    return {
      x: Math.round(tuned.x * w),
      y: Math.round(tuned.y * h),
      w: Math.round(tuned.w * w),
      h: Math.round(tuned.h * h)
    };
  };

  const boxes = {};
  for (const roi of ROI_DEFINITIONS) {
    boxes[roi.key] = {
      ...roi,
      ...toPx(roi.x, roi.y, roi.w, roi.h)
    };
  }
  return boxes;
}

async function ocrRegion(worker, baseImg, roi) {
  const x = clamp(roi.x, 0, baseImg.bitmap.width - 1);
  const y = clamp(roi.y, 0, baseImg.bitmap.height - 1);
  const w = clamp(roi.w, 1, baseImg.bitmap.width - x);
  const h = clamp(roi.h, 1, baseImg.bitmap.height - y);

  const padding = 4;
  const crop = baseImg
    .clone()
    .crop(Math.max(0, x - padding), Math.max(0, y - padding), Math.min(baseImg.bitmap.width - x, w + padding * 2), Math.min(baseImg.bitmap.height - y, h + padding * 2));

  crop.contrast(["numeric", "date", "phone"].includes(roi.type) ? 0.3 : 0.2);
  crop.convolute([
    [0, -1, 0],
    [-1, 5, -1],
    [0, -1, 0]
  ]);

  if (crop.bitmap.width < 200 || crop.bitmap.height < 50) {
    const scale = Math.max(200 / crop.bitmap.width, 50 / crop.bitmap.height, 2);
    crop.resize(Math.round(crop.bitmap.width * scale), Math.round(crop.bitmap.height * scale), Jimp.RESIZE_BICUBIC);
  }

  await worker.setParameters(OCR_CONFIGS[roi.type] || OCR_CONFIGS.text);
  const buf = await crop.getBufferAsync(Jimp.MIME_PNG);
  let result = await worker.recognize(buf);

  if ((result?.data?.confidence || 0) < 70 && ["numeric", "date", "phone"].includes(roi.type)) {
    const inverted = crop.clone().invert();
    const retry = await worker.recognize(await inverted.getBufferAsync(Jimp.MIME_PNG));
    if ((retry?.data?.confidence || 0) > (result?.data?.confidence || 0)) {
      result = retry;
    }
  }

  await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" });

  return {
    text: String(result?.data?.text || "").replace(/\r/g, "\n").replace(/[^\S\n]+/g, " ").trim(),
    confidence: Number(result?.data?.confidence || 0)
  };
}

function buildLabeledText(fields, averageConfidence, lowConfidenceFields) {
  return [
    `INVOICE # CR ${fields.invoice_number?.text || ""}`,
    `Sold to: ${fields.sold_to?.text || ""}`,
    `Directions: ${fields.directions?.text || ""}`,
    `Customer Email: ${fields.email?.text || ""}`,
    `Date: ${fields.date?.text || ""}`,
    `Home Phone: ${fields.home_phone?.text || ""}`,
    `Cell Phone: ${fields.cell_phone?.text || ""}`,
    `Installation Date: ${fields.installation_date?.text || ""}`,
    `Installed By: ${fields.installed_by?.text || ""}`,
    `Salesperson: ${fields.salesperson?.text || ""}`,
    `Manufacturer: ${fields.manufacturer?.text || ""}`,
    `Size: ${fields.size?.text || ""}`,
    `Style: ${fields.style?.text || ""}`,
    `Color: ${fields.color?.text || ""}`,
    `Pad: ${fields.pad?.text || ""}`,
    `Rug Pad: ${fields.rug_pad?.text || ""}`,
    `Unit/Amount Block: ${fields.unit_amount_block?.text || ""}`,
    `Totals Block: ${fields.totals_block?.text || ""}`,
    "",
    "[OCR_METADATA]",
    `Average Confidence: ${Math.round(averageConfidence)}%`,
    `Low Confidence Fields: ${lowConfidenceFields.join(", ") || "None"}`
  ].join("\n");
}

export async function ocrImage(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`OCR file not found: ${imagePath}`);

  const baseImg = await preprocessBase(imagePath);
  const rois = buildRoiBoxes(baseImg.bitmap.width, baseImg.bitmap.height);
  const worker = await getWorker();

  const fields = {};
  for (const [key, roi] of Object.entries(rois)) {
    const result = await ocrRegion(worker, baseImg, roi);
    fields[key] = {
      text: result.text,
      confidence: result.confidence,
      label: roi.label,
      type: roi.type
    };
  }

  const confidences = Object.values(fields).map((f) => f.confidence || 0);
  const averageConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  const lowConfidenceFields = Object.entries(fields)
    .filter(([, v]) => (v.confidence || 0) < 70)
    .map(([key, v]) => `${key}(${Math.round(v.confidence)}%)`);

  const rawText = buildLabeledText(fields, averageConfidence, lowConfidenceFields);

  return {
    rawText,
    averageConfidence,
    lowConfidenceFields,
    fields,
    rois: Object.fromEntries(Object.entries(rois).map(([k, v]) => [k, { label: v.label, x: v.x, y: v.y, w: v.w, h: v.h }]))
  };
}

export async function ocrImageToText(imagePath) {
  const out = await ocrImage(imagePath);
  return out.rawText;
}
