function fixOCRErrors(text, fieldType = "text") {
  let fixed = String(text || "");

  if (["numeric", "phone", "date"].includes(fieldType)) {
    fixed = fixed.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/[Ss$]/g, "5");
  }
  if (fieldType === "numeric") {
    fixed = fixed.replace(/[Zz]/g, "2").replace(/[Bb]/g, "8").replace(/[Gg]/g, "9").replace(/[^\d\sCR\-.]/g, "");
  }
  if (fieldType === "phone") {
    fixed = fixed.replace(/[^\d()\-. ]/g, "");
  }
  if (fieldType === "date" && !/today/i.test(fixed)) {
    fixed = fixed.replace(/[^\d/\- ]/g, "");
  }

  return fixed.trim();
}

function cleanupText(t) {
  return String(t || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lineAfterLabel(text, labelRegex, fieldType = "text") {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!labelRegex.test(line)) continue;
    const same = line.split(/:\s*/).slice(1).join(": ").trim();
    if (same) return fixOCRErrors(same, fieldType);
    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
      if (lines[j]) return fixOCRErrors(lines[j], fieldType);
    }
  }
  return "";
}

function extractWithFuzzyLabel(text, labels, fieldType = "text") {
  for (const pattern of labels) {
    const v = lineAfterLabel(text, pattern, fieldType);
    if (v) return v;
  }
  return "";
}

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return phone;
}

function pickPhoneNear(text, labelRegex) {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;
    const corrected = fixOCRErrors([lines[i], lines[i + 1] || "", lines[i + 2] || ""].join(" "), "phone");
    const m = corrected.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\d{10}|\d{3}[\s.-]?\d{4})/);
    if (m) return formatPhone(m[1]);
  }
  const all = fixOCRErrors(text, "phone");
  const m = all.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\d{10}|\d{3}[\s.-]?\d{4})/);
  return m ? formatPhone(m[1]) : "";
}

function pickDateNear(text, labelRegex) {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (!labelRegex.test(lines[i])) continue;
    const corrected = fixOCRErrors([lines[i], lines[i + 1] || ""].join(" "), "date");
    if (/\btoday\b/i.test(corrected)) return "TODAY";
    const m = corrected.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}\s+\d{1,2}\s+\d{2,4})/);
    if (m) return m[1].replace(/\s+/g, "/");
  }

  const corrected = fixOCRErrors(text, "date");
  if (/\btoday\b/i.test(corrected)) return "TODAY";
  const m = corrected.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2}|\d{1,2}\s+\d{1,2}\s+\d{2,4})/);
  return m ? m[1].replace(/\s+/g, "/") : "";
}

function normalizeToday(s) {
  const v = String(s || "").trim();
  if (!v || /^(n\/a|na|none)$/i.test(v)) return "";
  if (/^today$/i.test(v)) {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return v;
}

function toISODate(v) {
  const n = normalizeToday(v);
  if (!n) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(n)) return n;
  const m = n.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!m) return "";
  let yy = Number(m[3]);
  if (yy < 100) yy += 2000;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return "";
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function toMoneyNum(s) {
  const cleaned = fixOCRErrors(String(s || "").replace(/[$,]/g, ""), "numeric");
  const m = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : 0;
}

function pickUnitAndAmount(t) {
  const nums = [...fixOCRErrors(String(t || ""), "numeric").matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
  const big = nums.filter((n) => n >= 10);
  if (big.length >= 2) return { unit_price: big[0], amount: big[1] };
  if (big.length === 1) return { unit_price: big[0], amount: big[0] };
  if (nums.length) return { unit_price: nums[0], amount: nums[0] };
  return { unit_price: 0, amount: 0 };
}

function fromOcrField(fields, key, fallback = "") {
  const text = String(fields?.[key]?.text || "").trim();
  return text || fallback;
}

function scoreField(value, confidence, expected = "text") {
  let score = Number.isFinite(confidence) ? confidence : 0;
  if (!value) score = Math.min(score, 35);

  if (expected === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) score -= 30;
  if (expected === "phone" && value && value.replace(/\D/g, "").length < 7) score -= 25;
  if (expected === "date" && value && !toISODate(value)) score -= 25;
  if (expected === "invoice" && value && !/\d{3,}/.test(value)) score -= 20;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function extractFromOCR(rawText, ocrMeta = {}) {
  const text = cleanupText(rawText);
  const fields = ocrMeta.fields || {};

  let invoice_number = fromOcrField(fields, "invoice_number", "");
  if (!invoice_number) {
    const m = text.match(/INVOICE\s*#\s*CR\s*([A-Z0-9\- ]{3,})|\bCR\s*#?\s*([0-9]{4,})\b|INVOICE\s*[#:]?\s*([0-9]{4,})/i);
    invoice_number = m ? String(m[1] || m[2] || m[3] || "") : "";
  }
  invoice_number = invoice_number ? `CR ${fixOCRErrors(invoice_number.replace(/^CR\s*/i, ""), "numeric")}` : "";

  const sold_to = fromOcrField(fields, "sold_to") || extractWithFuzzyLabel(text, [/sold\s*to/i, /customer\s*name/i, /bill\s*to/i]);
  const directions = fromOcrField(fields, "directions") || extractWithFuzzyLabel(text, [/directions/i, /address/i, /location/i]);
  const customer_email = (fromOcrField(fields, "email") || extractWithFuzzyLabel(text, [/customer\s*email/i, /e[\s-]?mail/i], "email")).toLowerCase();

  const order_date = toISODate(fromOcrField(fields, "date") || pickDateNear(text, /\b(order\s*)?date\b/i));
  const installation_date = toISODate(fromOcrField(fields, "installation_date") || pickDateNear(text, /install(ation)?\s*date/i));
  const home_phone = formatPhone(fromOcrField(fields, "home_phone") || pickPhoneNear(text, /home\s*phone/i));
  const cell_phone = formatPhone(fromOcrField(fields, "cell_phone") || pickPhoneNear(text, /cell\s*phone/i));

  const installed_by = fromOcrField(fields, "installed_by") || extractWithFuzzyLabel(text, [/installed\s*by/i, /installer/i]);
  const salesperson = fromOcrField(fields, "salesperson") || extractWithFuzzyLabel(text, [/salesperson/i, /sales\s*rep/i, /sold\s*by/i]);

  const manufacturer = fromOcrField(fields, "manufacturer") || extractWithFuzzyLabel(text, [/manufacturer/i, /brand/i]);
  const size = fromOcrField(fields, "size") || extractWithFuzzyLabel(text, [/\bsize\b/i, /dimensions/i]);
  const style = fromOcrField(fields, "style") || extractWithFuzzyLabel(text, [/\bstyle\b/i, /pattern/i]);
  const color = fromOcrField(fields, "color") || extractWithFuzzyLabel(text, [/\bcolor\b/i, /colour/i]);
  const pad = fromOcrField(fields, "pad") || extractWithFuzzyLabel(text, [/\bpad\b/i, /padding/i]);
  const rug_pad = fromOcrField(fields, "rug_pad") || extractWithFuzzyLabel(text, [/rug\s*pad/i, /carpet\s*pad/i]);

  const { unit_price, amount } = pickUnitAndAmount(fromOcrField(fields, "unit_amount_block") || lineAfterLabel(text, /unit[\s\/]*amount\s*block/i));

  const field_confidence = {
    invoice_number: scoreField(invoice_number, fields?.invoice_number?.confidence, "invoice"),
    sold_to: scoreField(sold_to, fields?.sold_to?.confidence),
    directions: scoreField(directions, fields?.directions?.confidence),
    customer_email: scoreField(customer_email, fields?.email?.confidence, "email"),
    order_date: scoreField(order_date, fields?.date?.confidence, "date"),
    home_phone: scoreField(home_phone, fields?.home_phone?.confidence, "phone"),
    cell_phone: scoreField(cell_phone, fields?.cell_phone?.confidence, "phone"),
    installation_date: scoreField(installation_date, fields?.installation_date?.confidence, "date"),
    installed_by: scoreField(installed_by, fields?.installed_by?.confidence),
    salesperson: scoreField(salesperson, fields?.salesperson?.confidence),
    manufacturer: scoreField(manufacturer, fields?.manufacturer?.confidence),
    size: scoreField(size, fields?.size?.confidence),
    style: scoreField(style, fields?.style?.confidence),
    color: scoreField(color, fields?.color?.confidence),
    pad: scoreField(pad, fields?.pad?.confidence),
    rug_pad: scoreField(rug_pad, fields?.rug_pad?.confidence),
    amount: scoreField(String(amount || ""), fields?.unit_amount_block?.confidence, "numeric")
  };

  const low_confidence_fields = Object.entries(field_confidence)
    .filter(([, v]) => v < 65)
    .map(([k]) => k);

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

  const form = {
    form_version: "paper-v1",
    header_invoice_number: invoice_number,
    customer_name: sold_to,
    service_address: directions,
    customer_email,
    order_date,
    home_phone,
    cell_phone,
    installation_date,
    installed_by,
    salesperson,
    manufacturer,
    size,
    style,
    color,
    pad,
    rug_pad,
    install_area_notes: "",
    merchandise_total: toMoneyNum(amount),
    sales_tax: 0,
    total_sale: toMoneyNum(amount),
    deposit: 0,
    balance: toMoneyNum(amount),
    payment_method: "",
    hear_about: [],
    install_areas: [],
    buyer_signature_name: "",
    buyer_signature_date: ""
  };

  return {
    invoice_number,
    sold_to,
    directions,
    customer_email,
    email: customer_email,
    order_date,
    home_phone,
    cell_phone,
    installation_date,
    installed_by,
    salesperson,
    manufacturer,
    size,
    style,
    color,
    pad,
    rug_pad,
    unit_price: toMoneyNum(unit_price),
    amount: toMoneyNum(amount),
    items: [defaultItem],
    form,
    field_confidence,
    low_confidence_fields
  };
}
