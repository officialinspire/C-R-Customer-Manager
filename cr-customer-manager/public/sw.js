/*
 * C&R CRM Service Worker
 *
 * Offline-first strategy:
 * - App shell assets: cache-first
 * - API requests: network-first with offline fallbacks
 * - Mutating API requests: queued in IndexedDB and replayed via Background Sync
 */

const SHELL_CACHE_NAME = 'cr-crm-shell-v1';
const SHELL_ASSETS = ['/', '/styles.css', '/index.js', '/manifest.json'];

const DB_NAME = 'cr-sync-queue';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

/**
 * Open (or create) the IndexedDB database used to persist queued API mutations.
 */
function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create an object store keyed by `id` if it doesn't already exist.
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Save a request payload into the queue for later sync.
 */
async function queueRequest(entry) {
  const db = await openQueueDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.put(entry);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Read all queued items.
 */
async function getAllQueuedRequests() {
  const db = await openQueueDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Remove a queued request by id after successful replay.
 */
async function removeQueuedRequest(id) {
  const db = await openQueueDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Create a standard JSON Response helper.
 */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

/**
 * Check if the request targets the invoices endpoints where we provide a specific
 * offline response for GET requests.
 */
function isInvoiceReadEndpoint(url, method) {
  if (method !== 'GET') {
    return false;
  }

  // Matches:
  // - /api/invoices
  // - /api/invoices/:id
  return /^\/api\/invoices(?:\/[^/]+)?\/?$/.test(url.pathname);
}

/**
 * Cache app shell assets immediately during install.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
});

/**
 * Activate the worker and take control of uncontrolled clients immediately.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * Fetch strategy dispatcher:
 * - Non-GET requests not handled here unless API mutation fallback queues them.
 * - API requests: network-first
 * - App shell requests (same-origin, non-API): cache-first
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // We only apply custom strategies to same-origin traffic.
  if (url.origin !== self.location.origin) {
    return;
  }

  // API strategy: network-first with offline handling.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApiRequest(request, url));
    return;
  }

  // App shell strategy: cache-first on same-origin GET requests.
  if (request.method === 'GET') {
    event.respondWith(handleAppShellRequest(request));
  }
});

/**
 * Cache-first strategy for shell assets.
 * 1) Return cached response when available
 * 2) Otherwise fetch from network
 * 3) If network fails and no cache exists, return a minimal offline response
 */
async function handleAppShellRequest(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    return await fetch(request);
  } catch (_error) {
    return new Response('Offline. Please reconnect and try again.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/**
 * Network-first strategy for API requests.
 *
 * - Online: return network response
 * - Offline GET /api/invoices or /api/invoices/:id: return explicit offline JSON message
 * - Offline POST/DELETE /api/*: queue for background sync and acknowledge queued status
 */
async function handleApiRequest(request, url) {
  try {
    return await fetch(request);
  } catch (_error) {
    // Offline GET support for invoice reads.
    if (isInvoiceReadEndpoint(url, request.method)) {
      return jsonResponse({
        offline: true,
        error: 'You are offline. Data may be stale.',
      });
    }

    // Queue mutating requests for retry when back online.
    if (request.method === 'POST' || request.method === 'DELETE') {
      const body = request.method === 'POST' ? await request.clone().text() : null;
      const timestamp = Date.now();

      await queueRequest({
        id: timestamp,
        url: request.url,
        method: request.method,
        body,
        timestamp,
      });

      // Register a background sync task if available.
      if (self.registration && self.registration.sync) {
        try {
          await self.registration.sync.register('cr-sync-queue');
        } catch (_syncError) {
          // If registration fails, request remains persisted and can be retried later.
        }
      }

      return jsonResponse({
        queued: true,
        message: 'Saved locally. Will sync when online.',
      });
    }

    return jsonResponse(
      { offline: true, error: 'Request failed while offline.' },
      503
    );
  }
}

/**
 * Background Sync replay:
 * - Process all queued entries
 * - Re-send each request
 * - Remove successfully replayed entries
 * - Keep failed entries for the next sync attempt
 */
self.addEventListener('sync', (event) => {
  if (event.tag === 'cr-sync-queue') {
    event.waitUntil(replayQueuedRequests());
  }
});

async function replayQueuedRequests() {
  const queuedItems = await getAllQueuedRequests();

  for (const item of queuedItems) {
    try {
      const init = {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (item.body && item.method !== 'DELETE') {
        init.body = item.body;
      }

      const response = await fetch(item.url, init);

      if (response.ok) {
        await removeQueuedRequest(item.id);
      }
    } catch (_error) {
      // Keep request in queue for a future sync attempt.
    }
  }
}

/**
 * Allow clients to request immediate activation of a waiting service worker.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
