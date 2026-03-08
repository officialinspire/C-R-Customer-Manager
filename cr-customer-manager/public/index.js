const $ = (id) => document.getElementById(id);

const DEFAULT_FORM = {
  id: null,
  invoice_number: "",
  sold_to: "",
  directions: "",
  email: "",
  order_date: "",
  home_phone: "",
  cell_phone: "",
  installation_date: "",
  installed_by: "",
  salesperson: "",
  tax_rate: 0,
  deposit: 0,
  installation_instructions: "",
  notes: "",
  raw_text: "",
  source_path: "",
  source_filename: "",
  ocr_status: "pending_review",
  ocr_confidence: 0,
  field_confidence: {},
  low_confidence_fields: [],
  heard_ad: 0,
  heard_radio: 0,
  heard_friend: 0,
  heard_internet: 0,
  heard_walkin: 0,
  install_lvg_rm: 0,
  install_din_rm: 0,
  install_bdrm1: 0,
  install_bdrm2: 0,
  install_bdrm3: 0,
  install_bdrm4: 0,
  install_hall: 0,
  install_stairs: 0,
  install_closet: 0,
  install_basement: 0,
  install_fam_rm: 0,
  payment_cash: 0,
  payment_check: 0,
  payment_charge: 0,
  payment_financing: 0,
  buyer_name: "",
  buyer_date: "",
  manufacturer: "",
  size: "",
  style: "",
  color: "",
  pad: "",
  rug_pad: "",
  unit_price: 0,
  amount: 0,
  items: [{ description: "Carpet / Rug", qty: 1, unit_price: 0, amount: 0 }],
  form: null
};

const REVIEW_FIELDS = [
  "invoice_number", "sold_to", "directions", "email", "order_date", "home_phone", "cell_phone", "installation_date", "installed_by", "salesperson"
];

const REVIEW_FIELD_MAP = {
  email: "customer_email"
};

const INSTALL_ROOM_FIELDS = [
  ["install_lvg_rm", "Living room"],
  ["install_din_rm", "Dining room"],
  ["install_bdrm1", "Bedroom 1"],
  ["install_bdrm2", "Bedroom 2"],
  ["install_bdrm3", "Bedroom 3"],
  ["install_bdrm4", "Bedroom 4"],
  ["install_hall", "Hall"],
  ["install_stairs", "Stairs"],
  ["install_closet", "Closet"],
  ["install_basement", "Basement"],
  ["install_fam_rm", "Family room"]
];

let installerMode = false;
let overlayMode = false;

let current = null;
let statusTimer = null;
let dirty = false;

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const message = typeof body === "string" ? body : body?.error || res.statusText;
    const err = new Error(`${res.status} ${message}`.trim().slice(0, 500));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function money(n) {
  const v = Number(n || 0);
  return (Math.round(v * 100) / 100).toFixed(2);
}

function normalizeInvoiceNumber(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return raw.toUpperCase();
  return `CR ${digits.slice(0, 5).padStart(5, "0")}`;
}

function setStatus(type, text, persist = false) {
  const statusEl = $("status");
  clearTimeout(statusTimer);
  statusEl.textContent = text;
  statusEl.className = `pill status-${type}`;
  if (!persist) {
    statusTimer = setTimeout(() => {
      const base = current?.id ? (dirty ? "unsaved changes" : "loaded") : "new";
      setStatus(dirty ? "warn" : "ok", base, true);
    }, 2200);
  }
}

function markDirty() {
  dirty = true;
  setStatus("warn", current?.id ? "unsaved changes" : "new", true);
}

function summarizeMaterials(items = []) {
  const rows = items
    .filter((it) => String(it?.description || "").trim() || Number(it?.amount) > 0 || Number(it?.qty) > 0)
    .map((it) => {
      const description = String(it.description || "Material").trim() || "Material";
      const qty = Number(it.qty || 0);
      const detail = [it.color, it.style, it.size].map((v) => String(v || "").trim()).filter(Boolean).join(" • ");
      const qtyText = qty > 0 ? `${qty}x ` : "";
      return `${qtyText}${description}${detail ? ` (${detail})` : ""}`;
    });
  return rows.length ? rows.join("; ") : "—";
}

function summarizeRooms(formData = {}) {
  const selected = INSTALL_ROOM_FIELDS
    .filter(([key]) => Number(formData?.[key] || formData?.form?.[key] || 0) === 1)
    .map(([, label]) => label);

  if (selected.length) return selected.join(", ");
  const fallback = String(formData.installation_instructions || "").trim();
  return fallback || "—";
}

function summarizePayment(formData = {}) {
  const total = Number((formData.total_sale ?? formData.total ?? $("total").value) || 0);
  const deposit = Number(formData.deposit || 0);
  const balance = Number((formData.balance ?? $("balance").value) || 0);
  const methods = [
    ["payment_cash", "cash"],
    ["payment_check", "check"],
    ["payment_charge", "charge"],
    ["payment_financing", "financing"]
  ]
    .filter(([key]) => Number(formData?.[key] || formData?.form?.[key] || 0) === 1)
    .map(([, label]) => label);

  const hasPaymentInfo = total > 0 || deposit > 0 || balance > 0 || methods.length;
  if (!hasPaymentInfo) return "Not set";

  const methodText = methods.length ? ` via ${methods.join("/")}` : "";
  return `Total $${money(total)} • Deposit $${money(deposit)} • Balance $${money(balance)}${methodText}`;
}

function buildInstallerViewModel(formData = {}) {
  const instructions = [String(formData.installation_instructions || "").trim(), String(formData.notes || "").trim()]
    .filter(Boolean)
    .join("\n\n");

  return {
    soldTo: String(formData.sold_to || "").trim() || "—",
    directions: String(formData.directions || "").trim() || "—",
    phones: [String(formData.home_phone || "").trim(), String(formData.cell_phone || "").trim()].filter(Boolean).join(" / ") || "—",
    installDate: String(formData.installation_date || "").trim() || "—",
    installedBy: String(formData.installed_by || "").trim() || "—",
    materials: summarizeMaterials(formData.items || []),
    rooms: summarizeRooms(formData),
    payment: summarizePayment(formData),
    notes: instructions || "—"
  };
}

function renderInstallerView(model) {
  $("i_sold_to").textContent = model.soldTo;
  $("i_directions").textContent = model.directions;
  $("i_phones").textContent = model.phones;
  $("i_install_date").textContent = model.installDate;
  $("i_installed_by").textContent = model.installedBy;
  $("i_materials").textContent = model.materials;
  $("i_rooms").textContent = model.rooms;
  $("i_payment").textContent = model.payment;
  $("i_notes").textContent = model.notes;
}

function syncInstallerPanelFromForm() {
  renderInstallerView(buildInstallerViewModel(readForm()));
}

function setFieldError(fieldId, msg) {
  const input = $(fieldId);
  const errId = `${fieldId}_err`;
  let err = $(errId);
  if (!input && !err) return;
  if (!err && input) {
    err = document.createElement("div");
    err.id = errId;
    err.className = "field-error";
    input.insertAdjacentElement("afterend", err);
  }
  if (input && fieldId !== "itemsBody") input.classList.toggle("invalid", !!msg);
  if (err) err.textContent = msg || "";
}

function clearErrors() {
  document.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  document.querySelectorAll(".field-error").forEach((el) => {
    el.textContent = "";
  });
}

function validateForm() {
  if (!current) return true;
  clearErrors();
  const errors = {};
  const soldTo = $("sold_to").value.trim();
  if (!soldTo) errors.sold_to = "Customer name is required.";

  const invRaw = $("invoice_number").value;
  const normalized = normalizeInvoiceNumber(invRaw);
  if (invRaw.trim() && !/^CR\s\d{5}$/.test(normalized)) errors.invoice_number = "Invoice number should be in CR ##### format.";

  const deposit = Number($("deposit").value || 0);
  const total = Number($("total").value || 0);
  if (deposit < 0) errors.deposit = "Deposit cannot be negative.";
  if (deposit > total) errors.deposit = "Deposit cannot be greater than total.";

  const items = current?.items || [];
  if (!items.length) {
    errors.itemsBody = "At least one item is required.";
  } else if (!items.some((item) => item.description || Number(item.amount) > 0 || Number(item.qty) > 0)) {
    errors.itemsBody = "Add an item description or amount before saving.";
  }

  Object.entries(errors).forEach(([field, message]) => setFieldError(field, message));
  return Object.keys(errors).length === 0;
}

function recompute(mark = false) {
  if (!current) return;

  const rows = [...document.querySelectorAll("#itemsBody tr")];
  current.items = rows.map((tr, idx) => {
    const get = (name) => tr.querySelector(`[data-k="${name}"]`).value;
    const getNum = (name) => Number(get(name) || 0);
    const qty = getNum("qty");
    const unit = getNum("unit_price");
    const amount = Math.round(qty * unit * 100) / 100;
    tr.querySelector(`[data-k="amount"]`).value = money(amount);
    return {
      line_no: idx + 1,
      description: get("description").trim(),
      manufacturer: get("manufacturer").trim(),
      size: get("size").trim(),
      style: get("style").trim(),
      color: get("color").trim(),
      pad: get("pad").trim(),
      rug_pad: get("rug_pad").trim(),
      qty,
      unit_price: unit,
      amount
    };
  });

  const subtotal = current.items.reduce((a, it) => a + (Number(it.amount) || 0), 0);
  const taxRate = Number($("tax_rate").value || 0) / 100;
  const salesTax = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + salesTax) * 100) / 100;
  const deposit = Number($("deposit").value || 0);
  const balance = Math.round((total - deposit) * 100) / 100;

  $("subtotal").value = money(subtotal);
  $("sales_tax").value = money(salesTax);
  $("total").value = money(total);
  $("balance").value = money(balance);

  syncInstallerPanelFromForm();
  if (mark) markDirty();
}

function itemRow(it = {}) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="input" data-k="description" value="${escapeHtml(it.description || "")}"></td>
    <td><input class="input" data-k="manufacturer" value="${escapeHtml(it.manufacturer || "")}"></td>
    <td><input class="input" data-k="size" value="${escapeHtml(it.size || "")}"></td>
    <td><input class="input" data-k="style" value="${escapeHtml(it.style || "")}"></td>
    <td><input class="input" data-k="color" value="${escapeHtml(it.color || "")}"></td>
    <td><input class="input" data-k="pad" value="${escapeHtml(it.pad || "")}"></td>
    <td><input class="input" data-k="rug_pad" value="${escapeHtml(it.rug_pad || "")}"></td>
    <td class="num"><input class="input" data-k="qty" type="number" step="0.01" min="0" value="${it.qty ?? 1}"></td>
    <td class="num"><input class="input" data-k="unit_price" type="number" step="0.01" min="0" value="${it.unit_price ?? 0}"></td>
    <td class="num"><input class="input" data-k="amount" type="number" step="0.01" value="${money(it.amount ?? 0)}" readonly></td>
    <td class="num"><button class="xbtn" title="Remove">×</button></td>
  `;
  tr.querySelector(".xbtn").addEventListener("click", () => {
    tr.remove();
    recompute(true);
  });
  tr.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => recompute(true)));
  return tr;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readForm() {
  const form = current?.form || {};
  const normalizedInvoice = normalizeInvoiceNumber($("invoice_number").value.trim());

  return {
    ...DEFAULT_FORM,
    ...current,
    id: current?.id || null,
    invoice_number: normalizedInvoice,
    sold_to: $("sold_to").value.trim(),
    directions: $("directions").value.trim(),
    email: $("email").value.trim(),
    order_date: $("order_date").value,
    home_phone: $("home_phone").value.trim(),
    cell_phone: $("cell_phone").value.trim(),
    installation_date: $("installation_date").value,
    installed_by: $("installed_by").value.trim(),
    salesperson: $("salesperson").value.trim(),
    tax_rate: Number($("tax_rate").value || 0),
    deposit: Number($("deposit").value || 0),
    installation_instructions: $("installation_instructions").value,
    notes: $("notes").value,
    raw_text: $("raw_text")?.value ?? current?.raw_text ?? "",
    source_path: $("source_path").value,
    items: current?.items || [],
    ocr_status: "reviewed",
    form: {
      ...form,
      form_version: "paper-v1",
      header_invoice_number: normalizedInvoice,
      customer_name: $("sold_to").value.trim(),
      service_address: $("directions").value.trim(),
      customer_email: $("email").value.trim(),
      order_date: $("order_date").value,
      home_phone: $("home_phone").value.trim(),
      cell_phone: $("cell_phone").value.trim(),
      installation_date: $("installation_date").value,
      installed_by: $("installed_by").value.trim(),
      salesperson: $("salesperson").value.trim(),
      install_area_notes: $("installation_instructions").value,
      merchandise_total: Number($("subtotal").value || 0),
      sales_tax: Number($("sales_tax").value || 0),
      total_sale: Number($("total").value || 0),
      deposit: Number($("deposit").value || 0),
      balance: Number($("balance").value || 0)
    }
  };
}

function applyReviewHighlights() {
  document.querySelectorAll(".review-flag").forEach((el) => el.classList.remove("review-flag"));
  const low = new Set(current?.low_confidence_fields || []);
  REVIEW_FIELDS.forEach((key) => {
    const input = $(key);
    if (!input) return;
    const canonicalKey = REVIEW_FIELD_MAP[key] || key;
    const isLow = low.has(canonicalKey);
    const empty = !String(input.value || "").trim();
    if (isLow || empty) input.classList.add("review-flag");
  });
}

function fillReviewPanel(inv) {
  const low = inv.low_confidence_fields || [];
  $("reviewStatus").textContent = `${inv.ocr_status || "pending_review"} • OCR ${Math.round(inv.ocr_confidence || 0)}%`;
  $("reviewSource").textContent = inv.source_filename || "(scan)";
  $("reviewImage").src = inv.source_path || "";
  $("reviewImage").classList.toggle("hidden", !inv.source_path);

  const rows = REVIEW_FIELDS.map((field) => {
    const canonicalKey = REVIEW_FIELD_MAP[field] || field;
    const value = inv[field] || inv[canonicalKey] || "";
    const conf = inv.field_confidence?.[canonicalKey];
    const lowFlag = low.includes(canonicalKey) || !String(value).trim();
    return `<tr class="${lowFlag ? "low" : ""}"><td>${escapeHtml(field)}</td><td>${escapeHtml(String(value))}</td><td>${conf ?? "—"}</td></tr>`;
  }).join("");
  $("reviewTableBody").innerHTML = rows;
  $("reviewPanel").classList.toggle("hidden", false);
}

function fillForm(inv) {
  current = { ...DEFAULT_FORM, ...inv, items: inv.items?.length ? inv.items : DEFAULT_FORM.items.slice() };
  current.form = inv.form || null;
  dirty = false;

  $("invoice_number").value = current.invoice_number || "";
  $("sold_to").value = current.sold_to || "";
  $("directions").value = current.directions || "";
  $("email").value = current.email || current.customer_email || "";
  $("order_date").value = current.order_date || "";
  $("home_phone").value = current.home_phone || "";
  $("cell_phone").value = current.cell_phone || "";
  $("installation_date").value = current.installation_date || "";
  $("installed_by").value = current.installed_by || "";
  $("salesperson").value = current.salesperson || "";

  $("tax_rate").value = current.tax_rate ?? 0;
  $("deposit").value = current.deposit ?? 0;
  $("installation_instructions").value = current.installation_instructions || "";
  $("notes").value = current.notes || "";
  $("source_path").value = current.source_path || "";
  $("raw_text").value = current.raw_text || "";

  const body = $("itemsBody");
  body.innerHTML = "";
  current.items.forEach((it) => body.appendChild(itemRow(it)));

  clearErrors();
  recompute(false);
  applyReviewHighlights();
  if (current.ocr_status === "pending_review") fillReviewPanel(current);
  else $("reviewPanel").classList.add("hidden");

  setStatus("ok", current.id ? "loaded" : "new", true);
}

async function refreshList(q = "") {
  const rows = await api(`/api/invoices${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const wrap = $("results");
  wrap.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "result empty";
    empty.textContent = q ? "No invoices matched your search." : "No invoices yet. Create a new one or upload a scan.";
    wrap.appendChild(empty);
    return;
  }

  rows.forEach((r) => {
    const el = document.createElement("div");
    el.className = "result";
    el.innerHTML = `
      <div class="t">${escapeHtml(r.invoice_number || "(no invoice #)")} — ${escapeHtml(r.sold_to || "")}</div>
      <div class="m">${escapeHtml(r.installation_date || "")} • ${escapeHtml(r.home_phone || r.cell_phone || "")} • ${escapeHtml(r.directions || "")} • $${money(r.total || 0)}</div>
    `;
    el.addEventListener("click", async () => fillForm(await api(`/api/invoices/${r.id}`)));
    wrap.appendChild(el);
  });
}

async function checkHealth() {
  try {
    await api("/api/health");
    $("dbStatus").textContent = "db: ok";
  } catch {
    $("dbStatus").textContent = "db: error";
  }
}

async function save() {
  recompute(false);
  if (!validateForm()) return setStatus("bad", "fix validation errors", true);

  const btnSave = $("btnSave");
  try {
    setStatus("warn", "saving...", true);
    btnSave.disabled = true;
    const saved = await api("/api/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(readForm())
    });
    await refreshList($("q").value.trim());
    fillForm(saved);
    $("reviewPanel").classList.add("hidden");
    setStatus("ok", "saved", false);
  } catch (e) {
    if (e.status === 409) {
      setFieldError("invoice_number", "That invoice number already exists. Use another number.");
      return setStatus("bad", "duplicate invoice #", true);
    }
    setStatus("bad", "save failed", true);
    throw e;
  } finally {
    btnSave.disabled = false;
  }
}

async function del() {
  if (!current?.id) return;
  if (!confirm("Delete this invoice? This action cannot be undone.")) return;
  const btnDelete = $("btnDelete");
  try {
    setStatus("bad", "deleting...", true);
    btnDelete.disabled = true;
    await api(`/api/invoices/${current.id}`, { method: "DELETE" });
    newInvoice();
    await refreshList($("q").value.trim());
    setStatus("ok", "deleted", false);
  } finally {
    btnDelete.disabled = false;
  }
}

function newInvoice() {
  toggleInstaller(false);
  toggleOverlay(false);
  fillForm({ ...DEFAULT_FORM, id: null, form: null, items: DEFAULT_FORM.items.map((it) => ({ ...it })) });
  $("reviewPanel").classList.add("hidden");
  setStatus("ok", "new", true);
}

function openPdf() {
  if (current?.id) window.open(`/api/invoices/${current.id}/pdf`, "_blank");
}

function openScan() {
  const p = $("source_path").value.trim();
  if (p) window.open(p, "_blank");
}

async function rescanCurrentInvoice() {
  if (!current?.id) return setStatus("bad", "save invoice before re-scan", false);
  setStatus("warn", "re-scanning...", true);
  const scanned = await api(`/api/invoices/${current.id}/rescan`, { method: "POST" });
  fillForm(scanned);
  setStatus("ok", "review OCR draft", true);
}

async function uploadScan(file) {
  try {
    setStatus("warn", "processing scan for review...", true);
    const fd = new FormData();
    fd.append("scan", file);
    const draft = await api("/api/upload", { method: "POST", body: fd });
    fillForm(draft);
    setStatus("warn", "review OCR fields before saving", true);
  } catch (e) {
    if (e.status === 422) {
      setStatus("bad", "OCR failed; scan saved for retry", true);
      return;
    }
    setStatus("bad", "scan upload failed", true);
    throw e;
  }
}


function setOverlayButtonState() {
  const btn = $("btnOverlay");
  btn.setAttribute("aria-pressed", String(overlayMode));
  btn.textContent = overlayMode ? "📄 Standard Editor Mode" : "🧾 Form Overlay Mode";
}

function toggleOverlay(on) {
  overlayMode = !!on;
  $("editorPanel").classList.toggle("overlay-mode", overlayMode);
  setOverlayButtonState();
}

function toggleInstaller(on) {
  installerMode = !!on;
  $("installerPanel").classList.toggle("hidden", !installerMode);
  $("editorPanel").classList.toggle("hidden", installerMode);
  $("btnInstaller").textContent = installerMode ? "📝 Full Editor" : "📱 Installer View";

  const overlayBtn = $("btnOverlay");
  overlayBtn.disabled = installerMode;
  overlayBtn.classList.toggle("disabled", installerMode);
}

async function init() {
  $("q").addEventListener("input", () => refreshList($("q").value.trim()));
  $("btnNew").addEventListener("click", newInvoice);
  $("btnSave").addEventListener("click", () => save().catch(alert));
  $("btnDelete").addEventListener("click", () => del().catch(alert));
  $("btnPdf").addEventListener("click", openPdf);
  $("btnPdf2")?.addEventListener("click", openPdf);
  $("btnOpenScan").addEventListener("click", openScan);
  $("btnOpenScan2")?.addEventListener("click", openScan);
  $("btnRerunOcr").addEventListener("click", () => rescanCurrentInvoice().catch(alert));

  $("btnAddItem").addEventListener("click", () => {
    $("itemsBody").appendChild(itemRow({ description: "", qty: 1, unit_price: 0, amount: 0 }));
    recompute(true);
  });

  ["invoice_number", "sold_to", "directions", "email", "order_date", "home_phone", "cell_phone", "installation_date", "installed_by", "salesperson", "installation_instructions", "notes", "tax_rate", "deposit"]
    .forEach((id) => $(id).addEventListener("input", () => {
      recompute(true);
      applyReviewHighlights();
    }));

  $("invoice_number").addEventListener("blur", () => {
    $("invoice_number").value = normalizeInvoiceNumber($("invoice_number").value);
    recompute(true);
    applyReviewHighlights();
  });

  $("fileScan").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) uploadScan(f).catch(alert);
    e.target.value = "";
  });

  $("btnInstaller").addEventListener("click", () => toggleInstaller(!installerMode));
  $("btnOverlay").addEventListener("click", () => toggleOverlay(!overlayMode));
  $("btnBack")?.addEventListener("click", () => toggleInstaller(false));

  setOverlayButtonState();

  await checkHealth();
  await refreshList("");
  newInvoice();
}

init().catch((e) => alert(e.message));
