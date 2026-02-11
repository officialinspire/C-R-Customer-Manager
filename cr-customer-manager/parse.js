// Fix common OCR misreads
function fixOCRErrors(text, fieldType = "text") {
  let fixed = text;

  if (fieldType === "numeric") {
    // Common number misreads
    fixed = fixed.replace(/[Oo]/g, "0"); // O -> 0
    fixed = fixed.replace(/[lI|]/g, "1"); // l, I, | -> 1
    fixed = fixed.replace(/[Ss$]/g, "5"); // S, $ -> 5
    fixed = fixed.replace(/[Zz]/g, "2"); // Z -> 2
    fixed = fixed.replace(/[Bb]/g, "8"); // B -> 8 (in some cases)
    fixed = fixed.replace(/[Gg]/g, "9"); // G -> 9 (in some cases)
    fixed = fixed.replace(/[^\d\sCR-]/g, ""); // Remove non-numeric except CR and dash
  } else if (fieldType === "phone") {
    // Phone number specific fixes
    fixed = fixed.replace(/[Oo]/g, "0");
    fixed = fixed.replace(/[lI|]/g, "1");
    fixed = fixed.replace(/[Ss$]/g, "5");
    fixed = fixed.replace(/[^\d()\-. ]/g, ""); // Keep only valid phone chars
  } else if (fieldType === "date") {
    // Date specific fixes
    fixed = fixed.replace(/[Oo]/g, "0");
    fixed = fixed.replace(/[lI|]/g, "1");
    fixed = fixed.replace(/[Ss$]/g, "5");
    // Preserve "today" keyword
    if (!/today/i.test(fixed)) {
      fixed = fixed.replace(/[^\d/\-todayTODAY ]/g, "");
    }
  }

  return fixed;
}

function cleanupText(t) {
  return (t || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lineAfterLabel(text, labelRegex, fieldType = "text") {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (labelRegex.test(line)) {
      // Check if value is on same line after colon
      const same = line.split(/:\s*/).slice(1).join(": ").trim();
      if (same) return fixOCRErrors(same, fieldType);

      // Look ahead up to 6 lines for the value
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (lines[j]) return fixOCRErrors(lines[j], fieldType);
      }
    }
  }
  return "";
}

// Enhanced extraction with fuzzy label matching
function extractWithFuzzyLabel(text, possibleLabels, fieldType = "text") {
  for (const labelPattern of possibleLabels) {
    const result = lineAfterLabel(text, labelPattern, fieldType);
    if (result) return result;
  }
  return "";
}

function pickPhoneNear(text, labelRegex) {
  const lines = text.split("\n").map((l) => l.trim());

  // Try to find phone near label with OCR error correction
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const joined = [lines[i], lines[i + 1] || "", lines[i + 2] || ""].join(" ");
      const corrected = fixOCRErrors(joined, "phone");

      // Multiple phone format patterns
      const patterns = [
        /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/, // Standard US format
        /(\d{3}[\s.-]?\d{4})/, // 7-digit format
        /(\d{10})/ // 10 digits no separator
      ];

      for (const pattern of patterns) {
        const m = corrected.match(pattern);
        if (m) return formatPhone(m[1]);
      }
    }
  }

  // Fallback: search entire text
  const corrected = fixOCRErrors(text, "phone");
  const patterns = [
    /(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/,
    /(\d{3}[\s.-]?\d{4})/,
    /(\d{10})/
  ];

  for (const pattern of patterns) {
    const m = corrected.match(pattern);
    if (m) return formatPhone(m[1]);
  }

  return "";
}

// Format phone number consistently
function formatPhone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return phone;
}

function normalizeToday(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (/^(n\/a|na|none)$/i.test(v)) return "";
  if (/^today$/i.test(v)) {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yy = d.getFullYear();
    return `${yy}-${mm}-${dd}`;
  }
  return v;
}

function pickDateNear(text, labelRegex) {
  const lines = text.split("\n").map((l) => l.trim());

  // Multiple date format patterns
  const datePatterns = [
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/, // MM/DD/YYYY or MM-DD-YYYY
    /(\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2})/, // YYYY/MM/DD or YYYY-MM-DD
    /(\d{1,2}\s+\d{1,2}\s+\d{2,4})/ // MM DD YYYY with spaces
  ];

  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const joined = [lines[i], lines[i + 1] || ""].join(" ");
      const corrected = fixOCRErrors(joined, "date");

      // Check for "today" keyword
      const todayMatch = corrected.match(/\b(today)\b/i);
      if (todayMatch) return "TODAY";

      // Try each date pattern
      for (const pattern of datePatterns) {
        const m = corrected.match(pattern);
        if (m) return m[1].replace(/\s+/g, "/"); // Normalize spaces to slashes
      }
    }
  }

  // Fallback: search entire text
  const corrected = fixOCRErrors(text, "date");

  const todayMatch = corrected.match(/\b(today)\b/i);
  if (todayMatch) return "TODAY";

  for (const pattern of datePatterns) {
    const m = corrected.match(pattern);
    if (m) return m[1].replace(/\s+/g, "/");
  }

  return "";
}

function toISODate(mdyOrToday) {
  const v = normalizeToday(mdyOrToday);
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;

  const m = String(v).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return "";
  let mm = parseInt(m[1], 10),
    dd = parseInt(m[2], 10),
    yy = parseInt(m[3], 10);
  if (yy < 100) yy += 2000;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function toMoneyNum(s) {
  let cleaned = String(s || "")
    .replace(/,/g, "")
    .replace(/[$]/g, "");

  // Fix common OCR errors in numbers
  cleaned = fixOCRErrors(cleaned, "numeric");

  const m = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : 0;
}

function pickUnitAndAmount(unitAmountBlock) {
  let t = String(unitAmountBlock || "").replace(/,/g, " ");

  // Apply OCR error correction for numeric content
  t = fixOCRErrors(t, "numeric");

  // Extract all numbers with decimal support
  const nums = [...t.matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));

  if (nums.length === 0) return { unit_price: 0, amount: 0 };

  // Filter for reasonable price values (>= 10)
  const big = nums.filter((n) => n >= 10);

  if (big.length === 1) {
    // Only one price found, use it for both
    return { unit_price: big[0], amount: big[0] };
  } else if (big.length >= 2) {
    // Two or more prices: first is unit price, second is total amount
    return { unit_price: big[0], amount: big[1] };
  } else if (nums.length > 0) {
    // Fallback to any number found
    return { unit_price: nums[0], amount: nums[0] };
  }

  return { unit_price: 0, amount: 0 };
}

export function extractFromOCR(rawText) {
  const text = cleanupText(rawText);

  // Enhanced invoice number extraction with OCR error correction
  let invoice_number = "";
  const invPatterns = [
    /INVOICE\s*#\s*CR\s*([A-Z0-9\- ]{3,})/i,
    /\bCR\s*#?\s*([0-9]{4,})\b/i,
    /INVOICE\s*[#:]?\s*([0-9]{4,})/i
  ];

  for (const pattern of invPatterns) {
    const match = text.match(pattern);
    if (match) {
      let num = String(match[1]).trim().replace(/^CR\s*/i, "");
      num = fixOCRErrors(num, "numeric");
      invoice_number = `CR ${num}`;
      break;
    }
  }

  // Extract text fields with fuzzy label matching
  const sold_to = extractWithFuzzyLabel(text, [
    /sold\s*to/i,
    /customer\s*name/i,
    /bill\s*to/i
  ]);

  const directions = extractWithFuzzyLabel(text, [
    /directions/i,
    /address/i,
    /location/i
  ]);

  const email = extractWithFuzzyLabel(text, [
    /customer\s*email/i,
    /e[\s-]?mail/i,
    /email\s*address/i
  ], "email").toLowerCase();

  // Extract dates with validation
  const order_date = toISODate(pickDateNear(text, /\b(order\s*)?date\b/i));
  const installation_date = toISODate(pickDateNear(text, /install(ation)?\s*date/i));

  // Extract phone numbers
  const home_phone = pickPhoneNear(text, /home\s*phone/i);
  const cell_phone = pickPhoneNear(text, /cell\s*phone/i);

  // Extract personnel fields
  const installed_by = extractWithFuzzyLabel(text, [
    /installed\s*by/i,
    /installer/i
  ]);

  const salesperson = extractWithFuzzyLabel(text, [
    /salesperson/i,
    /sales\s*rep/i,
    /sold\s*by/i
  ]);

  // Extract item details
  const manufacturer = extractWithFuzzyLabel(text, [
    /manufacturer/i,
    /brand/i,
    /maker/i
  ]);

  const size = extractWithFuzzyLabel(text, [
    /\bsize\b/i,
    /dimensions/i
  ]);

  const style = extractWithFuzzyLabel(text, [
    /\bstyle\b/i,
    /type/i,
    /pattern/i
  ]);

  const color = extractWithFuzzyLabel(text, [
    /\bcolor\b/i,
    /colour/i
  ]);

  const pad = extractWithFuzzyLabel(text, [
    /\bpad\b(?!\s*:)/i,
    /padding/i
  ]);

  const rug_pad = extractWithFuzzyLabel(text, [
    /rug\s*pad/i,
    /carpet\s*pad/i
  ]);

  // Extract pricing information
  const unitAmountBlock = lineAfterLabel(text, /unit[\s\/]*amount\s*block/i);
  const { unit_price, amount } = pickUnitAndAmount(unitAmountBlock);

  const defaultItem = {
    line_no: 1,
    description: "Carpet / Rug",
    manufacturer,
    size,
    style,
    color,
    pad,
    rug_pad,
    qty: 1,
    unit_price: toMoneyNum(unit_price),
    amount: toMoneyNum(amount)
  };

  // Validate critical fields and log warnings
  const criticalFields = { invoice_number, sold_to, order_date };
  const missingCritical = Object.entries(criticalFields)
    .filter(([_, val]) => !val)
    .map(([key, _]) => key);

  if (missingCritical.length > 0) {
    console.warn(`⚠️  Missing critical fields: ${missingCritical.join(", ")}`);
  }

  return {
    invoice_number,
    sold_to,
    directions,
    email,
    order_date,
    home_phone,
    cell_phone,
    installation_date,
    installed_by,
    salesperson,
    items: [defaultItem]
  };
}
