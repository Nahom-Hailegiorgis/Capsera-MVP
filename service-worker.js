const CACHE_NAME = "capsera-v1";
const STATIC_CACHE = "capsera-static-v1";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/src/main.js",
  "/src/router.js",
  "/src/styles.css",
  "/src/utils/idb.js",
  "/src/utils/storage.js",
  "/src/utils/syncQueue.js",
  "/src/api/supabaseClient.js",
  "/src/api/netlifyProxy.js",
  "/src/screens/GlobalIdeas.js",
  "/src/screens/MySubmissions.js",
  "/src/screens/SubmitIdea.js",
  "/src/screens/Settings.js",
  "/manifest.webmanifest",
];

// Install event - cache static assets
self.addEventListener("install", (event) => {
  console.log("Service Worker installing...");
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener("activate", (event) => {
  console.log("Service Worker activating...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== STATIC_CACHE) {
            console.log("Deleting old cache:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - cache first for static assets, network first for API calls
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // API calls - network first
  if (url.pathname.startsWith("/api/") || url.hostname.includes("supabase")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // Clone and cache successful API responses (except POST/PUT)
          if (response.ok && event.request.method === "GET") {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache for API calls if network fails
          return caches.match(event.request);
        })
    );
    return;
  }

  // Static assets - cache first
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((response) => {
        // Don't cache non-successful responses
        if (!response.ok) {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseClone);
        });

        return response;
      });
    })
  );
});

// Background sync for offline queue processing
self.addEventListener("sync", (event) => {
  console.log("Background sync triggered:", event.tag);
  if (event.tag === "sync-queue") {
    event.waitUntil(processSyncQueue());
  }
});

// Process sync queue when background sync is available
async function processSyncQueue() {
  try {
    // Import and use syncQueue from the main app
    const { processSyncQueue } = await import("./src/utils/syncQueue.js");
    await processSyncQueue();
    console.log("Background sync completed successfully");
  } catch (error) {
    console.error("Background sync failed:", error);
    throw error; // Re-throw to retry later
  }
}

// Message handler for manual sync triggers
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SYNC_QUEUE") {
    event.waitUntil(processSyncQueue());
  }
});
