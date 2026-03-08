const $ = (id) => document.getElementById(id);

const EMPTY_FORM_SCHEMA = {
  form_version: "paper-v1",
  header_invoice_number: "",
  customer_name: "",
  service_address: "",
  customer_email: "",
  order_date: "",
  home_phone: "",
  cell_phone: "",
  installation_date: "",
  installed_by: "",
  salesperson: "",
  manufacturer: "",
  size: "",
  style: "",
  color: "",
  pad: "",
  rug_pad: "",
  install_area_notes: "",
  merchandise_total: 0,
  sales_tax: 0,
  total_sale: 0,
  deposit: 0,
  balance: 0,
  payment_method: "",
  hear_about: [],
  install_areas: [],
  buyer_signature_name: "",
  buyer_signature_date: ""
};

let current = null;
let statusTimer = null;

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
  if (!res.ok) {
    const err = new Error(typeof body === "string" ? body : body.error || `${res.status} ${res.statusText}`);
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

function normalizeInvoiceNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^0-9]/g, "");
  return digits ? `CR ${digits}` : raw.toUpperCase().replace(/\s+/g, " ");
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(kind, text, timeoutMs = 0) {
  const statusEl = $("status");
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
  if (statusTimer) clearTimeout(statusTimer);
  if (timeoutMs > 0) {
    statusTimer = setTimeout(() => {
      statusEl.textContent = current?.id ? "loaded" : "new";
      statusEl.dataset.kind = "neutral";
    }, timeoutMs);
  }
}

function ensureErrorSlot(id) {
  const input = $(id);
  let slot = input.parentElement.querySelector(`.error-msg[data-for="${id}"]`);
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "error-msg";
    slot.dataset.for = id;
    input.parentElement.appendChild(slot);
  }
  return slot;
}

function setFieldError(id, message) {
  const input = $(id);
  const slot = ensureErrorSlot(id);
  slot.textContent = message || "";
  input.classList.toggle("input-error", !!message);
}

function clearErrors() {
  document.querySelectorAll(".error-msg").forEach((el) => { el.textContent = ""; });
  document.querySelectorAll(".input-error").forEach((el) => el.classList.remove("input-error"));
}

function validateForm() {
  clearErrors();
  const errors = {};
  const invoice = normalizeInvoiceNumber($("invoice_number").value);
  const email = $("email").value.trim();
  const deposit = Number($("deposit").value || 0);
  const total = Number($("total").value || 0);

  if (!$("sold_to").value.trim()) errors.sold_to = "Customer name is required.";
  if (!$("directions").value.trim()) errors.directions = "Address/directions are required.";
  if (invoice && !/^CR\s\d{4,}$/.test(invoice)) errors.invoice_number = "Invoice format should look like CR 24512.";
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Email format looks invalid.";
  if (deposit < 0) errors.deposit = "Deposit cannot be negative.";
  if (deposit > total) errors.deposit = "Deposit cannot exceed total.";

  Object.entries(errors).forEach(([id, msg]) => setFieldError(id, msg));
  return Object.keys(errors).length === 0;
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
    <td class="num"><input class="input" data-k="qty" type="number" step="0.01" value="${it.qty ?? 1}"></td>
    <td class="num"><input class="input" data-k="unit_price" type="number" step="0.01" value="${it.unit_price ?? 0}"></td>
    <td class="num"><input class="input" data-k="amount" type="number" step="0.01" value="${money(it.amount ?? 0)}" readonly></td>
    <td class="num"><button class="xbtn" title="Remove">×</button></td>
  `;
  tr.querySelector(".xbtn").addEventListener("click", () => {
    tr.remove();
    recompute();
  });
  tr.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", recompute));
  return tr;
}

function updateInstallerPanel() {
  $("i_sold_to").textContent = $("sold_to").value.trim() || "—";
  $("i_directions").textContent = $("directions").value.trim() || "—";
  $("i_phones").textContent = [$("home_phone").value.trim(), $("cell_phone").value.trim()].filter(Boolean).join(" / ") || "—";
  $("i_install_date").textContent = $("installation_date").value || "—";
  $("i_installed_by").textContent = $("installed_by").value.trim() || "—";
  $("i_instructions").textContent = $("installation_instructions").value.trim() || "—";
}

function recompute() {
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
      description: get("description"),
      manufacturer: get("manufacturer"),
      size: get("size"),
      style: get("style"),
      color: get("color"),
      pad: get("pad"),
      rug_pad: get("rug_pad"),
      qty,
      unit_price: unit,
      amount
    };
  });

  const fallbackSubtotal = Number(current?.form?.merchandise_total || 0);
  const subtotal = current.items.length
    ? current.items.reduce((a, it) => a + (Number(it.amount) || 0), 0)
    : fallbackSubtotal;
  const taxRate = Number($("tax_rate").value || 0) / 100;
  const salesTax = Math.round(subtotal * taxRate * 100) / 100;
  const total = Math.round((subtotal + salesTax) * 100) / 100;
  const deposit = Number($("deposit").value || 0);
  const balance = Math.round((total - deposit) * 100) / 100;

  $("subtotal").value = money(subtotal);
  $("sales_tax").value = money(salesTax);
  $("total").value = money(total);
  $("balance").value = money(balance);

  updateInstallerPanel();
}

function readForm() {
  const form = { ...EMPTY_FORM_SCHEMA, ...(current?.form || {}) };
  const normalizedInvoice = normalizeInvoiceNumber($("invoice_number").value);
  $("invoice_number").value = normalizedInvoice;
  const firstItem = current?.items?.[0] || {};

  return {
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
    merchandise_total: Number($("subtotal").value || 0),
    sales_tax: Number($("sales_tax").value || 0),
    total_sale: Number($("total").value || 0),
    balance: Number($("balance").value || 0),
    manufacturer: firstItem.manufacturer || "",
    size: firstItem.size || "",
    style: firstItem.style || "",
    color: firstItem.color || "",
    pad: firstItem.pad || "",
    rug_pad: firstItem.rug_pad || "",
    unit_price: Number(firstItem.unit_price || 0),
    amount: Number(firstItem.amount || 0),
    installation_instructions: $("installation_instructions").value,
    notes: $("notes").value,
    raw_text: $("raw_text").value,
    source_path: $("source_path").value,
    items: current?.items || [],
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
      manufacturer: firstItem.manufacturer || "",
      size: firstItem.size || "",
      style: firstItem.style || "",
      color: firstItem.color || "",
      pad: firstItem.pad || "",
      rug_pad: firstItem.rug_pad || "",
      install_area_notes: $("installation_instructions").value,
      merchandise_total: Number($("subtotal").value || 0),
      sales_tax: Number($("sales_tax").value || 0),
      total_sale: Number($("total").value || 0),
      deposit: Number($("deposit").value || 0),
      balance: Number($("balance").value || 0)
    }
  };
}

function fillForm(inv) {
  current = { ...inv, form: { ...EMPTY_FORM_SCHEMA, ...(inv.form || {}) } };

  $("invoice_number").value = normalizeInvoiceNumber(inv.invoice_number || "");
  $("sold_to").value = inv.sold_to || "";
  $("directions").value = inv.directions || "";
  $("email").value = inv.email || inv.customer_email || "";
  $("order_date").value = inv.order_date || "";
  $("home_phone").value = inv.home_phone || "";
  $("cell_phone").value = inv.cell_phone || "";
  $("installation_date").value = inv.installation_date || "";
  $("installed_by").value = inv.installed_by || "";
  $("salesperson").value = inv.salesperson || "";

  $("tax_rate").value = inv.tax_rate ?? 0;
  $("deposit").value = inv.deposit ?? 0;

  $("installation_instructions").value = inv.installation_instructions || "";
  $("notes").value = inv.notes || "";
  $("source_path").value = inv.source_path || "";
  $("raw_text").value = inv.raw_text || "";

  const body = $("itemsBody");
  body.innerHTML = "";
  (inv.items?.length ? inv.items : [{ description: "Carpet / Rug", qty: 1, unit_price: 0 }]).forEach((it) => {
    body.appendChild(itemRow(it));
  });

  clearErrors();
  setStatus("neutral", inv.id ? "loaded" : "new");
  recompute();
}

async function refreshList(q = "") {
  const field = $("qField").value;
  const rows = await api(`/api/invoices${q ? `?q=${encodeURIComponent(q)}&field=${encodeURIComponent(field)}` : ""}`);
  const wrap = $("results");
  wrap.innerHTML = "";
  rows.forEach((r) => {
    const el = document.createElement("div");
    el.className = "result";
    el.innerHTML = `
      <div class="t">${escapeHtml(normalizeInvoiceNumber(r.invoice_number) || "(no invoice #)")} — ${escapeHtml(r.sold_to || "")}</div>
      <div class="m">${escapeHtml(r.installation_date || "")} • $${money(r.total || 0)}</div>
    `;
    el.addEventListener("click", async () => {
      const inv = await api(`/api/invoices/${r.id}`);
      fillForm(inv);
    });
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
  if (!validateForm()) {
    setStatus("error", "Please fix the highlighted errors.", 2500);
    return;
  }

  const btnSave = $("btnSave");
  btnSave.disabled = true;

  try {
    setStatus("working", "saving...");
    recompute();
    const payload = readForm();
    const saved = await api("/api/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    await refreshList($("q").value.trim());
    fillForm(saved);
    setStatus("success", "✓ saved", 1800);
  } catch (e) {
    if (e.status === 409 && e.body?.code === "DUPLICATE_INVOICE_NUMBER") {
      setFieldError("invoice_number", e.body.error);
      setStatus("error", "Duplicate invoice number.", 2600);
      return;
    }
    setStatus("error", `Save failed: ${e.message}`, 2600);
  } finally {
    btnSave.disabled = false;
  }
}

async function del() {
  if (!current?.id) return;
  if (!confirm("Delete this invoice? This action cannot be undone.")) return;

  const btnDelete = $("btnDelete");
  btnDelete.disabled = true;

  try {
    setStatus("working", "deleting...");
    await api(`/api/invoices/${current.id}`, { method: "DELETE" });
    newInvoice();
    await refreshList($("q").value.trim());
    setStatus("success", "✓ deleted", 1600);
  } catch (e) {
    setStatus("error", `Delete failed: ${e.message}`, 2600);
  } finally {
    btnDelete.disabled = false;
  }
}

function newInvoice() {
  fillForm({
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
    merchandise_total: 0,
    sales_tax: 0,
    total_sale: 0,
    balance: 0,
    installation_instructions: "",
    notes: "",
    raw_text: "",
    source_path: "",
    source_filename: "",
    items: [{ description: "Carpet / Rug", qty: 1, unit_price: 0, amount: 0 }],
    form: { ...EMPTY_FORM_SCHEMA }
  });
  setStatus("info", "✨ new invoice", 1600);
}

function openPdf() {
  if (!current?.id) return;
  window.open(`/api/invoices/${current.id}/pdf`, "_blank");
}

function openScan() {
  const p = $("source_path").value.trim();
  if (!p) return;
  window.open(p, "_blank");
}

async function uploadScan(file) {
  try {
    setStatus("working", "processing scan...");
    const fd = new FormData();
    fd.append("scan", file);
    const saved = await api("/api/upload", { method: "POST", body: fd });
    await refreshList($("q").value.trim());
    fillForm(saved);
    setStatus("success", "✓ scan processed", 2200);
  } catch (e) {
    setStatus("error", `Scan error: ${e.message}`, 2600);
  }
}

async function rerunOcr() {
  if (!current?.id) {
    setStatus("error", "Save invoice before re-scan.", 2200);
    return;
  }
  if (!current.source_path && !current.source_filename) {
    setStatus("error", "No source scan available for this invoice.", 2200);
    return;
  }

  try {
    setStatus("working", "re-scanning...");
    const saved = await api(`/api/invoices/${current.id}/rescan`, { method: "POST" });
    fillForm(saved);
    await refreshList($("q").value.trim());
    setStatus("success", "✓ re-scan complete", 2200);
  } catch (e) {
    setStatus("error", `Re-scan failed: ${e.message}`, 2600);
  }
}

function toggleInstaller(on) {
  $("installerPanel").classList.toggle("hidden", !on);
  document.querySelector(".content .panel").classList.toggle("hidden", on);
}

async function init() {
  $("q").addEventListener("input", () => refreshList($("q").value.trim()));
  $("qField").addEventListener("change", () => refreshList($("q").value.trim()));
  $("btnNew").addEventListener("click", newInvoice);
  $("btnSave").addEventListener("click", save);
  $("btnDelete").addEventListener("click", del);
  $("btnPdf").addEventListener("click", openPdf);
  $("btnPdf2").addEventListener("click", openPdf);
  $("btnOpenScan").addEventListener("click", openScan);
  $("btnOpenScan2").addEventListener("click", openScan);

  $("btnAddItem").addEventListener("click", () => {
    $("itemsBody").appendChild(itemRow({ description: "", qty: 1, unit_price: 0, amount: 0 }));
    recompute();
  });

  ["invoice_number","sold_to","directions","email","order_date","home_phone","cell_phone","installation_date","installed_by","salesperson","installation_instructions","notes","tax_rate","deposit"]
    .forEach((id) => $(id).addEventListener("input", recompute));

  $("invoice_number").addEventListener("blur", () => {
    $("invoice_number").value = normalizeInvoiceNumber($("invoice_number").value);
  });

  $("fileScan").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) uploadScan(f);
    e.target.value = "";
  });

  $("btnRerunOcr").addEventListener("click", rerunOcr);
  $("btnInstaller").addEventListener("click", () => toggleInstaller(true));
  $("btnBack").addEventListener("click", () => toggleInstaller(false));

  await checkHealth();
  await refreshList("");
  newInvoice();
}

init().catch((e) => setStatus("error", e.message || "Init failed"));
