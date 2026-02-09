const $ = (id) => document.getElementById(id);

let current = null;

async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText} ${txt}`.slice(0, 400));
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res.text();
}

function money(n) {
  const v = Number(n || 0);
  return (Math.round(v * 100) / 100).toFixed(2);
}

function recompute() {
  if (!current) return;

  // amounts per row
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

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readForm() {
  return {
    id: current?.id || null,
    invoice_number: $("invoice_number").value.trim(),
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

    raw_text: $("raw_text").value,
    source_path: $("source_path").value,

    items: current?.items || []
  };
}

function fillForm(inv) {
  current = inv;

  $("invoice_number").value = inv.invoice_number || "";
  $("sold_to").value = inv.sold_to || "";
  $("directions").value = inv.directions || "";
  $("email").value = inv.email || "";
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

  $("status").textContent = inv.id ? "loaded" : "new";
  recompute();

  // Installer panel mirror
  $("i_sold_to").textContent = inv.sold_to || "—";
  $("i_directions").textContent = inv.directions || "—";
  $("i_phones").textContent = [inv.home_phone, inv.cell_phone].filter(Boolean).join(" / ") || "—";
  $("i_install_date").textContent = inv.installation_date || "—";
  $("i_installed_by").textContent = inv.installed_by || "—";
  $("i_instructions").textContent = inv.installation_instructions || "—";
}

async function refreshList(q = "") {
  const rows = await api(`/api/invoices${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  const wrap = $("results");
  wrap.innerHTML = "";
  rows.forEach((r) => {
    const el = document.createElement("div");
    el.className = "result";
    el.innerHTML = `
      <div class="t">${escapeHtml(r.invoice_number || "(no invoice #)")} — ${escapeHtml(r.sold_to || "")}</div>
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
  recompute();
  const payload = readForm();
  const saved = await api("/api/invoices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  await refreshList($("q").value.trim());
  fillForm(saved);
}

async function del() {
  if (!current?.id) return;
  if (!confirm("Delete this invoice?")) return;
  await api(`/api/invoices/${current.id}`, { method: "DELETE" });
  current = null;
  newInvoice();
  await refreshList($("q").value.trim());
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
    installation_instructions: "",
    notes: "",
    raw_text: "",
    source_path: "",
    items: [{ description: "Carpet / Rug", qty: 1, unit_price: 0, amount: 0 }]
  });
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
  const fd = new FormData();
  fd.append("scan", file);
  const saved = await api("/api/upload", { method: "POST", body: fd });
  await refreshList($("q").value.trim());
  fillForm(saved);
}

function toggleInstaller(on) {
  $("installerPanel").classList.toggle("hidden", !on);
  document.querySelector(".content .panel").classList.toggle("hidden", on);
}

async function init() {
  // bind
  $("q").addEventListener("input", () => refreshList($("q").value.trim()));
  $("btnNew").addEventListener("click", newInvoice);
  $("btnSave").addEventListener("click", () => save().catch(alert));
  $("btnDelete").addEventListener("click", () => del().catch(alert));
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

  $("fileScan").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) uploadScan(f).catch(alert);
    e.target.value = "";
  });

  $("btnRerunOcr").addEventListener("click", async () => {
    // simplest: re-upload the original scan isn't available; this button is a placeholder.
    alert("Re-run OCR currently works via Manual Upload Scan or dropping a scan into /inbox.");
  });

  $("btnInstaller").addEventListener("click", () => toggleInstaller(true));
  $("btnBack").addEventListener("click", () => toggleInstaller(false));

  await checkHealth();
  await refreshList("");
  newInvoice();
}

init().catch((e) => alert(e.message));
