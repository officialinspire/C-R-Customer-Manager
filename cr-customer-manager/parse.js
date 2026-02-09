function cleanupText(t) {
  return (t || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function lineAfterLabel(text, labelRegex) {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (labelRegex.test(line)) {
      const same = line.split(/:\s*/).slice(1).join(": ").trim();
      if (same) return same;
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        if (lines[j]) return lines[j];
      }
    }
  }
  return "";
}

function pickPhoneNear(text, labelRegex) {
  const lines = text.split("\n").map((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const joined = [lines[i], lines[i + 1] || "", lines[i + 2] || ""].join(" ");
      const m = joined.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
      if (m) return m[1];
    }
  }
  const m = text.match(/(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/);
  return m ? m[1] : "";
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
  const dateRe = /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/;
  for (let i = 0; i < lines.length; i++) {
    if (labelRegex.test(lines[i])) {
      const joined = [lines[i], lines[i + 1] || ""].join(" ");
      const m = joined.match(dateRe);
      if (m) return m[1];
      const t = joined.match(/\b(today)\b/i);
      if (t) return "TODAY";
    }
  }
  const m = text.match(dateRe);
  if (m) return m[1];
  const t = text.match(/\b(today)\b/i);
  return t ? "TODAY" : "";
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
  const m = String(s || "").replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : 0;
}

function pickUnitAndAmount(unitAmountBlock) {
  const t = String(unitAmountBlock || "").replace(/,/g, " ");
  const nums = [...t.matchAll(/(\d+(?:\.\d{1,2})?)/g)].map((m) => Number(m[1]));
  if (nums.length === 0) return { unit_price: 0, amount: 0 };
  const big = nums.filter((n) => n >= 10);
  if (big.length === 1) return { unit_price: big[0], amount: big[0] };
  if (big.length >= 2) return { unit_price: big[0], amount: big[1] };
  return { unit_price: nums[0], amount: nums[0] };
}

export function extractFromOCR(rawText) {
  const text = cleanupText(rawText);

  const invMatch =
    text.match(/INVOICE\s*#\s*CR\s*([A-Z0-9\- ]{3,})/i) ||
    text.match(/\bCR\s*([0-9]{5,})\b/i);
  const invoice_number = invMatch ? `CR ${String(invMatch[1]).trim().replace(/^CR\s*/i, "")}` : "";

  const sold_to = lineAfterLabel(text, /sold\s*to/i);
  const directions = lineAfterLabel(text, /directions/i);
  const email = lineAfterLabel(text, /customer\s*email/i);

  const order_date = toISODate(pickDateNear(text, /\bdate\b/i));
  const installation_date = toISODate(pickDateNear(text, /installation\s*date/i));

  const home_phone = pickPhoneNear(text, /home\s*phone/i);
  const cell_phone = pickPhoneNear(text, /cell\s*phone/i);

  const installed_by = lineAfterLabel(text, /installed\s*by/i);
  const salesperson = lineAfterLabel(text, /salesperson/i);

  const manufacturer = lineAfterLabel(text, /manufacturer/i);
  const size = lineAfterLabel(text, /\bsize\b/i);
  const style = lineAfterLabel(text, /\bstyle\b/i);
  const color = lineAfterLabel(text, /\bcolor\b/i);
  const pad = lineAfterLabel(text, /\bpad\b/i);
  const rug_pad = lineAfterLabel(text, /rug\s*pad/i);

  const unitAmountBlock = lineAfterLabel(text, /unit\/amount\s*block/i);
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
