export async function openCacheDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('cr-crm-cache', 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains('invoices')) {
        const invoiceStore = db.createObjectStore('invoices', { keyPath: 'id' });
        invoiceStore.createIndex('updated_at', 'updated_at', { unique: false });
      }

      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('failed to open IndexedDB cache'));
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('indexedDB transaction aborted'));
  });
}

export async function cacheInvoices(db, invoices) {
  const list = Array.isArray(invoices) ? invoices : [];
  const tx = db.transaction(['invoices', 'meta'], 'readwrite');
  const invoiceStore = tx.objectStore('invoices');
  const metaStore = tx.objectStore('meta');

  list.forEach((invoice) => {
    invoiceStore.put(invoice);
  });

  metaStore.put({ key: 'last_sync', value: new Date().toISOString() });

  await txDone(tx);
}

export async function getCachedInvoices(db, query = '') {
  const tx = db.transaction('invoices', 'readonly');
  const store = tx.objectStore('invoices');
  const request = store.getAll();

  const invoices = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('failed to read cached invoices'));
  });

  await txDone(tx);

  const q = String(query || '').trim().toLowerCase();
  if (!q) return invoices;

  const fields = ['invoice_number', 'sold_to', 'directions', 'home_phone', 'cell_phone'];
  return invoices.filter((invoice) => fields.some((field) => String(invoice?.[field] || '').toLowerCase().includes(q)));
}

export async function getCachedInvoice(db, id) {
  const tx = db.transaction('invoices', 'readonly');
  const store = tx.objectStore('invoices');
  const request = store.get(id);

  const invoice = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('failed to read cached invoice'));
  });

  await txDone(tx);
  return invoice;
}

export async function getLastSync(db) {
  const tx = db.transaction('meta', 'readonly');
  const store = tx.objectStore('meta');
  const request = store.get('last_sync');

  const value = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error || new Error('failed to read cache metadata'));
  });

  await txDone(tx);
  return value;
}
