import fs from "fs";
import Jimp from "jimp";
import { createWorker } from "tesseract.js";

let _workerPromise = null;

// Field-specific Tesseract configurations for maximum accuracy
const OCR_CONFIGS = {
  // Numeric fields (invoice numbers, amounts)
  numeric: {
    tessedit_char_whitelist: "0123456789CR- ",
    tessedit_pageseg_mode: "7", // Single text line
    preserve_interword_spaces: "1"
  },
  // Date fields
  date: {
    tessedit_char_whitelist: "0123456789/-TODAYtoday ",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1"
  },
  // Phone fields
  phone: {
    tessedit_char_whitelist: "0123456789()-. ",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "1"
  },
  // Email fields
  email: {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@.-_+",
    tessedit_pageseg_mode: "7",
    preserve_interword_spaces: "0"
  },
  // General text fields (names, addresses)
  text: {
    tessedit_pageseg_mode: "6", // Uniform block of text
    preserve_interword_spaces: "1"
  },
  // Multi-line text blocks
  block: {
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1"
  }
};

async function getWorker() {
  if (_workerPromise) return _workerPromise;
  _workerPromise = (async () => {
    const w = await createWorker("eng");
    // Set default parameters
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

// Calculate optimal threshold using Otsu's method (histogram-based adaptive thresholding)
function calculateOtsuThreshold(img) {
  const histogram = new Array(256).fill(0);
  const { width, height } = img.bitmap;

  // Build histogram
  img.scan(0, 0, width, height, function (x, y, idx) {
    const gray = this.bitmap.data[idx]; // Already greyscale, so R=G=B
    histogram[gray]++;
  });

  const total = width * height;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    wB += histogram[t];
    if (wB === 0) continue;

    wF = total - wB;
    if (wF === 0) break;

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

// Advanced morphological operations for noise reduction
function morphologicalOpen(img, kernelSize = 2) {
  // Erosion followed by dilation - removes small noise
  const { width, height } = img.bitmap;
  const temp = img.clone();

  // Erosion
  for (let y = kernelSize; y < height - kernelSize; y++) {
    for (let x = kernelSize; x < width - kernelSize; x++) {
      let minVal = 255;
      for (let ky = -kernelSize; ky <= kernelSize; ky++) {
        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          minVal = Math.min(minVal, temp.bitmap.data[idx]);
        }
      }
      const idx = (y * width + x) * 4;
      img.bitmap.data[idx] = minVal;
      img.bitmap.data[idx + 1] = minVal;
      img.bitmap.data[idx + 2] = minVal;
    }
  }

  // Dilation
  const temp2 = img.clone();
  for (let y = kernelSize; y < height - kernelSize; y++) {
    for (let x = kernelSize; x < width - kernelSize; x++) {
      let maxVal = 0;
      for (let ky = -kernelSize; ky <= kernelSize; ky++) {
        for (let kx = -kernelSize; kx <= kernelSize; kx++) {
          const idx = ((y + ky) * width + (x + kx)) * 4;
          maxVal = Math.max(maxVal, temp2.bitmap.data[idx]);
        }
      }
      const idx = (y * width + x) * 4;
      img.bitmap.data[idx] = maxVal;
      img.bitmap.data[idx + 1] = maxVal;
      img.bitmap.data[idx + 2] = maxVal;
    }
  }
}

// Detect and correct skew angle for rotated images
function detectSkewAngle(img) {
  const { width, height } = img.bitmap;
  const maxAngle = 10; // Check +/- 10 degrees
  const step = 0.5;
  let bestAngle = 0;
  let maxScore = 0;

  // Sample horizontal lines to detect skew
  for (let angle = -maxAngle; angle <= maxAngle; angle += step) {
    let score = 0;
    const rad = (angle * Math.PI) / 180;

    // Check middle section of image
    for (let y = height * 0.3; y < height * 0.7; y += 5) {
      let blackCount = 0;
      for (let x = 0; x < width; x += 2) {
        const newY = Math.round(y + x * Math.tan(rad));
        if (newY >= 0 && newY < height) {
          const idx = (newY * width + x) * 4;
          if (img.bitmap.data[idx] < 128) blackCount++;
        }
      }
      score += blackCount * blackCount; // Favor strong horizontal lines
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

  // Normalize width so ROI % cropping stays consistent
  const targetW = 1700;
  if (img.bitmap.width !== targetW) img.resize(targetW, Jimp.AUTO);

  // Convert to greyscale
  img.greyscale();

  // Unsharp masking for better edge detection (sharpen text)
  img.convolute([
    [0, -1, 0],
    [-1, 5, -1],
    [0, -1, 0]
  ]);

  // Enhance contrast
  img.contrast(0.45);
  img.normalize();

  // Detect and correct skew
  const skewAngle = detectSkewAngle(img);
  if (Math.abs(skewAngle) > 0.3) {
    img.rotate(-skewAngle, false); // Deskew the image
  }

  // Adaptive binarization using Otsu's method
  const threshold = calculateOtsuThreshold(img);
  img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
    const v = this.bitmap.data[idx];
    const b = v > threshold ? 255 : 0;
    this.bitmap.data[idx] = b;
    this.bitmap.data[idx + 1] = b;
    this.bitmap.data[idx + 2] = b;
  });

  // Morphological opening to remove noise
  morphologicalOpen(img, 1);

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

async function ocrRegion(worker, baseImg, r, fieldType = "text") {
  const x = clamp(r.x, 0, baseImg.bitmap.width - 1);
  const y = clamp(r.y, 0, baseImg.bitmap.height - 1);
  const w = clamp(r.w, 1, baseImg.bitmap.width - x);
  const h = clamp(r.h, 1, baseImg.bitmap.height - y);

  // Add padding to avoid edge text being cut off
  const padding = 4;
  const paddedX = Math.max(0, x - padding);
  const paddedY = Math.max(0, y - padding);
  const paddedW = Math.min(baseImg.bitmap.width - paddedX, w + padding * 2);
  const paddedH = Math.min(baseImg.bitmap.height - paddedY, h + padding * 2);

  let crop = baseImg.clone().crop(paddedX, paddedY, paddedW, paddedH);

  // Apply field-specific preprocessing
  if (fieldType === "numeric" || fieldType === "date" || fieldType === "phone") {
    // Enhance contrast more aggressively for numbers
    crop.contrast(0.3);
  } else {
    crop.contrast(0.2);
  }

  // Scale up small regions for better OCR
  if (paddedW < 200 || paddedH < 50) {
    const scale = Math.max(200 / paddedW, 50 / paddedH, 2);
    crop.resize(Math.round(paddedW * scale), Math.round(paddedH * scale), Jimp.RESIZE_BICUBIC);
  }

  // Additional sharpening for better character recognition
  crop.convolute([
    [0, -1, 0],
    [-1, 5, -1],
    [0, -1, 0]
  ]);

  // Get field-specific OCR configuration
  const config = OCR_CONFIGS[fieldType] || OCR_CONFIGS.text;

  // Apply field-specific Tesseract parameters
  await worker.setParameters(config);

  const buf = await crop.getBufferAsync(Jimp.MIME_PNG);

  // Try OCR with confidence threshold
  let result = await worker.recognize(buf);
  let text = (result.data.text || "").trim();
  let confidence = result.data.confidence || 0;

  // If confidence is low, try with different preprocessing
  if (confidence < 70 && (fieldType === "numeric" || fieldType === "date" || fieldType === "phone")) {
    // Retry with inverted image (in case of unusual lighting)
    const inverted = crop.clone().invert();
    const invertedBuf = await inverted.getBufferAsync(Jimp.MIME_PNG);
    const result2 = await worker.recognize(invertedBuf);
    const text2 = (result2.data.text || "").trim();
    const confidence2 = result2.data.confidence || 0;

    if (confidence2 > confidence) {
      text = text2;
      confidence = confidence2;
    }
  }

  // Reset to default parameters for next region
  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1"
  });

  return { text, confidence };
}

function cleanLine(t) {
  return String(t || "")
    .replace(/\r/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Map each field to its OCR type for optimized processing
const FIELD_TYPES = {
  invoice_number: "numeric",
  sold_to: "text",
  directions: "text",
  email: "email",
  date: "date",
  home_phone: "phone",
  cell_phone: "phone",
  installation_date: "date",
  installed_by: "text",
  salesperson: "text",
  manufacturer: "text",
  size: "text",
  style: "text",
  color: "text",
  pad: "text",
  rug_pad: "text",
  unit_amount_block: "numeric",
  totals_block: "numeric"
};

export async function ocrImageToText(imagePath) {
  if (!fs.existsSync(imagePath)) throw new Error(`OCR file not found: ${imagePath}`);

  const baseImg = await preprocessBase(imagePath);
  const w = baseImg.bitmap.width;
  const h = baseImg.bitmap.height;
  const rois = roiBoxes(w, h);

  const worker = await getWorker();

  const out = {};
  const confidences = {};

  // Process each field with its specific OCR type
  for (const [key, rect] of Object.entries(rois)) {
    const fieldType = FIELD_TYPES[key] || "text";
    const result = await ocrRegion(worker, baseImg, rect, fieldType);
    out[key] = cleanLine(result.text);
    confidences[key] = result.confidence;
  }

  // Log low-confidence fields for debugging
  const lowConfFields = Object.entries(confidences)
    .filter(([_, conf]) => conf < 70)
    .map(([field, conf]) => `${field}(${Math.round(conf)}%)`);

  if (lowConfFields.length > 0) {
    console.warn(`⚠️  Low confidence OCR fields: ${lowConfFields.join(", ")}`);
  }

  // Calculate average confidence
  const avgConfidence = Object.values(confidences).reduce((a, b) => a + b, 0) / Object.values(confidences).length;
  console.log(`📊 Average OCR confidence: ${Math.round(avgConfidence)}%`);

  // Return LABELED text (critical for robust parsing) with confidence metadata
  const ocrText = [
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
    `Totals Block: ${out.totals_block}`,
    ``,
    `[OCR_METADATA]`,
    `Average Confidence: ${Math.round(avgConfidence)}%`,
    `Low Confidence Fields: ${lowConfFields.join(", ") || "None"}`
  ].join("\n");

  return ocrText;
}
