/*
  C&R CRM Service Worker
  ----------------------
  Offline-first behavior for app shell assets, plus resilient handling for API calls.

  Features implemented:
  1) App shell pre-caching during install.
  2) Cache-first strategy for same-origin non-API GET requests.
  3) Network-first strategy for /api/ with offline fallbacks.
  4) Queueing write API requests (POST/DELETE) in IndexedDB when offline.
  5) Background Sync replay from queue when connectivity returns.
  6) SKIP_WAITING message support for immediate service worker activation.
*/

const SHELL_CACHE_NAME = 'cr-crm-shell-v1';
const APP_SHELL_ASSETS = ['/', '/styles.css', '/index.js', '/manifest.json'];

const QUEUE_DB_NAME = 'cr-sync-queue-db';
const QUEUE_STORE_NAME = 'cr-sync-queue';
const SYNC_TAG = 'cr-sync-queue';

/**
 * Install event:
 * - Pre-cache core shell assets so the app can load while offline.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_ASSETS))
  );
});

/**
 * Activate event:
 * - Remove outdated shell caches.
 * - Immediately take control of open pages.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== SHELL_CACHE_NAME) {
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Fetch event routing:
 * - API requests (/api/) => network-first strategy.
 * - Same-origin non-API GET requests => cache-first strategy.
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isApiRequest = isSameOrigin && requestUrl.pathname.startsWith('/api/');

  if (isApiRequest) {
    event.respondWith(handleApiRequest(event));
    return;
  }

  // Cache-first only for same-origin GET app shell/resource requests.
  if (isSameOrigin && request.method === 'GET') {
    event.respondWith(handleShellRequest(request));
  }
});

/**
 * Cache-first handler for app shell/static files:
 * 1) Try cache.
 * 2) Fallback to network.
 * 3) If both fail, return a minimal offline response.
 */
async function handleShellRequest(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const networkResponse = await fetch(request);

    // Cache successful same-origin GET responses for future offline use.
    if (networkResponse && networkResponse.ok) {
      const cache = await caches.open(SHELL_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    return new Response(
      '<!doctype html><html><body><h1>Offline</h1><p>The app is currently unavailable offline.</p></body></html>',
      {
        status: 503,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      }
    );
  }
}

/**
 * Network-first handler for API requests:
 * - Try network first.
 * - On network failure:
 *   - GET /api/invoices or /api/invoices/:id => return explicit offline JSON hint.
 *   - POST/DELETE /api/* => queue request in IndexedDB for later replay.
 */
async function handleApiRequest(event) {
  const { request } = event;
  const requestUrl = new URL(request.url);

  try {
    return await fetch(request);
  } catch (error) {
    const isGet = request.method === 'GET';
    const isInvoiceList = requestUrl.pathname === '/api/invoices';
    const isInvoiceById = /^\/api\/invoices\/[^/]+$/.test(requestUrl.pathname);

    if (isGet && (isInvoiceList || isInvoiceById)) {
      return jsonResponse({
        offline: true,
        error: 'You are offline. Data may be stale.',
      });
    }

    const isQueueableMutation = request.method === 'POST' || request.method === 'DELETE';

    if (isQueueableMutation) {
      await queueApiRequest(request);

      // Best effort: ask browser to schedule background sync if available.
      if (self.registration && self.registration.sync) {
        try {
          await self.registration.sync.register(SYNC_TAG);
        } catch (syncError) {
          // Ignore registration failures; queue remains persisted.
        }
      }

      return jsonResponse({
        queued: true,
        message: 'Saved locally. Will sync when online.',
      });
    }

    return jsonResponse(
      {
        offline: true,
        error: 'Request failed while offline.',
      },
      503
    );
  }
}

/**
 * Message event:
 * - Supports immediate activation command from the app.
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * Background Sync event:
 * - Replays queued API write requests.
 * - Removes successful entries from queue.
 * - Leaves failed entries for next retry.
 */
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueuedRequests());
  }
});

/**
 * Replay queued requests sequentially to preserve order.
 */
async function replayQueuedRequests() {
  const queuedItems = await getAllQueuedRequests();

  for (const item of queuedItems) {
    try {
      const response = await fetch(item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: item.body,
      });

      if (response && response.ok) {
        await removeQueuedRequest(item.id);
      }
      // Non-2xx responses are treated as failures and kept in queue.
    } catch (error) {
      // Keep request in queue for the next sync attempt.
    }
  }
}

/**
 * Queue a failed API mutation in IndexedDB.
 * Required fields: { id, url, method, body, timestamp }
 */
async function queueApiRequest(request) {
  let bodyText = '';

  // Read body for storage only when meaningful (POST typically has a payload).
  if (request.method !== 'DELETE') {
    bodyText = await request.clone().text();
  }

  const timestamp = Date.now();
  const queueEntry = {
    id: timestamp,
    url: request.url,
    method: request.method,
    body: bodyText,
    timestamp,
  };

  await withQueueStore('readwrite', (store) => store.put(queueEntry));
}

/**
 * Return all queued requests.
 */
async function getAllQueuedRequests() {
  return withQueueStore('readonly', (store) => store.getAll());
}

/**
 * Remove a queued request by id.
 */
async function removeQueuedRequest(id) {
  return withQueueStore('readwrite', (store) => store.delete(id));
}

/**
 * Open IndexedDB (or create it on first use).
 */
function openQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(QUEUE_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE_NAME)) {
        db.createObjectStore(QUEUE_STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Utility wrapper for IndexedDB transactions.
 */
async function withQueueStore(mode, operation) {
  const db = await openQueueDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(QUEUE_STORE_NAME, mode);
    const store = transaction.objectStore(QUEUE_STORE_NAME);

    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }

    transaction.oncomplete = () => {
      if (request && 'result' in request) {
        resolve(request.result);
      } else {
        resolve(undefined);
      }
      db.close();
    };

    transaction.onerror = () => {
      reject(transaction.error);
      db.close();
    };
  });
}

/**
 * Helper to build JSON responses.
 */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
