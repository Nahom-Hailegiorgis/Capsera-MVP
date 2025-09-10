// Capsera PWA Service Worker
// Provides offline functionality and caching

const CACHE_NAME = "capsera-v1.0.0";
const STATIC_CACHE_NAME = "capsera-static-v1.0.0";
const DATA_CACHE_NAME = "capsera-data-v1.0.0";

// Files to cache for offline use (App Shell)
const STATIC_FILES = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.json",
  // Supabase client from CDN
  "https://cdnjs.cloudflare.com/ajax/libs/supabase-js/2.38.4/supabase.min.js",
];

// API endpoints to cache
const API_ENDPOINTS = ["projects_final", "feedback"];

// Install event - cache static resources
self.addEventListener("install", (event) => {
  console.log("[ServiceWorker] Install");

  event.waitUntil(
    caches
      .open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log("[ServiceWorker] Pre-caching app shell");
        return cache.addAll(STATIC_FILES);
      })
      .catch((error) => {
        console.error("[ServiceWorker] Pre-caching failed:", error);
      })
  );

  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[ServiceWorker] Activate");

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (
            cacheName !== STATIC_CACHE_NAME &&
            cacheName !== DATA_CACHE_NAME &&
            cacheName !== CACHE_NAME
          ) {
            console.log("[ServiceWorker] Removing old cache:", cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );

  // Claim all clients immediately
  self.clients.claim();
});

// Fetch event - implement caching strategies
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Handle different types of requests
  if (isStaticFile(url)) {
    // Cache First strategy for static files
    event.respondWith(cacheFirst(request));
  } else if (isAPIRequest(url)) {
    // Network First strategy for API calls with cache fallback
    event.respondWith(networkFirst(request));
  } else {
    // Network First for everything else
    event.respondWith(networkFirst(request));
  }
});

// Cache First Strategy - for static files
async function cacheFirst(request) {
  try {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    const networkResponse = await fetch(request);

    // Cache the response for future use
    if (networkResponse.status === 200) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.error("[ServiceWorker] Cache first failed:", error);

    // Try to serve from cache anyway
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    // Return offline page or error response
    return new Response("Offline - resource not available", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// Network First Strategy - for API calls and dynamic content
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);

    // Cache successful API responses
    if (isAPIRequest(new URL(request.url)) && networkResponse.status === 200) {
      const cache = await caches.open(DATA_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }

    return networkResponse;
  } catch (error) {
    console.log(
      "[ServiceWorker] Network first failed, trying cache:",
      error.message
    );

    // Try to serve from cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      // Add offline indicator header
      const response = cachedResponse.clone();
      response.headers.append("X-Served-By", "ServiceWorker-Cache");
      return response;
    }

    // Handle specific offline scenarios
    if (isAPIRequest(new URL(request.url))) {
      return handleOfflineAPI(request);
    }

    // Return offline page for navigation requests
    if (request.mode === "navigate") {
      const cache = await caches.open(STATIC_CACHE_NAME);
      const offlineResponse = await cache.match("/index.html");
      return offlineResponse || new Response("Offline", { status: 503 });
    }

    return new Response("Offline", {
      status: 503,
      statusText: "Service Unavailable",
    });
  }
}

// Handle offline API requests
function handleOfflineAPI(request) {
  const url = new URL(request.url);

  // Return cached data or empty results for Supabase requests
  if (isSupabaseAPI(url)) {
    return new Response(
      JSON.stringify({
        data: [],
        error: null,
        status: 200,
        statusText: "OK (Cached)",
        offline: true,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Served-By": "ServiceWorker-Offline",
        },
      }
    );
  }

  // Generic offline response for other APIs
  return new Response(
    JSON.stringify({
      error: "Offline - data not available",
      offline: true,
    }),
    {
      status: 503,
      headers: {
        "Content-Type": "application/json",
        "X-Served-By": "ServiceWorker-Offline",
      },
    }
  );
}

// Helper function to identify static files
function isStaticFile(url) {
  const staticExtensions = [
    ".html",
    ".css",
    ".js",
    ".json",
    ".png",
    ".jpg",
    ".svg",
    ".ico",
  ];
  const pathname = url.pathname;

  // Check if it's a root request or has a static extension
  return (
    pathname === "/" ||
    staticExtensions.some((ext) => pathname.endsWith(ext)) ||
    pathname.includes("cdnjs.cloudflare.com")
  );
}

// Helper function to identify API requests
function isAPIRequest(url) {
  return (
    url.pathname.includes("/rest/v1/") ||
    url.pathname.includes("/functions/v1/") ||
    isSupabaseAPI(url) ||
    url.hostname.includes("supabase.co")
  );
}

// Helper function to identify Supabase API requests
function isSupabaseAPI(url) {
  return (
    url.hostname.includes("supabase.co") &&
    (url.pathname.includes("/rest/v1/") ||
      url.pathname.includes("/functions/v1/"))
  );
}

// Background Sync for offline actions
self.addEventListener("sync", (event) => {
  console.log("[ServiceWorker] Background sync:", event.tag);

  if (event.tag === "submit-feedback") {
    event.waitUntil(syncFeedback());
  } else if (event.tag === "submit-project") {
    event.waitUntil(syncProjects());
  }
});

// Sync feedback submissions when back online
async function syncFeedback() {
  try {
    // Get pending feedback from IndexedDB or localStorage
    const pendingFeedback = JSON.parse(
      localStorage.getItem("pending_feedback") || "[]"
    );

    if (pendingFeedback.length === 0) {
      return;
    }

    // Try to submit each pending feedback
    const results = await Promise.allSettled(
      pendingFeedback.map(async (feedback) => {
        const response = await fetch("/rest/v1/feedback", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Add auth headers if needed
          },
          body: JSON.stringify(feedback),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return feedback;
      })
    );

    // Remove successfully submitted feedback
    const successfulSubmissions = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const remainingFeedback = pendingFeedback.filter(
      (feedback) => !successfulSubmissions.includes(feedback)
    );

    localStorage.setItem("pending_feedback", JSON.stringify(remainingFeedback));

    console.log(
      `[ServiceWorker] Synced ${successfulSubmissions.length} feedback submissions`
    );
  } catch (error) {
    console.error("[ServiceWorker] Feedback sync failed:", error);
  }
}

// Sync project submissions when back online
async function syncProjects() {
  try {
    // Get pending projects from localStorage
    const pendingProjects = JSON.parse(
      localStorage.getItem("pending_projects") || "[]"
    );

    if (pendingProjects.length === 0) {
      return;
    }

    // Try to submit each pending project
    const results = await Promise.allSettled(
      pendingProjects.map(async (project) => {
        const response = await fetch("/rest/v1/projects_final", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Add auth headers if needed
          },
          body: JSON.stringify(project),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return project;
      })
    );

    // Remove successfully submitted projects
    const successfulSubmissions = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);

    const remainingProjects = pendingProjects.filter(
      (project) => !successfulSubmissions.includes(project)
    );

    localStorage.setItem("pending_projects", JSON.stringify(remainingProjects));

    console.log(
      `[ServiceWorker] Synced ${successfulSubmissions.length} project submissions`
    );
  } catch (error) {
    console.error("[ServiceWorker] Project sync failed:", error);
  }
}

// Handle push notifications (for future use)
self.addEventListener("push", (event) => {
  if (!event.data) {
    return;
  }

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: "/icon-192.png",
    badge: "/badge-72.png",
    tag: data.tag || "default",
    data: data.data || {},
    actions: data.actions || [],
  };

  event.waitUntil(self.registration.showNotification(data.title, options));
});

// Handle notification clicks
self.addEventListener("notificationclick", (event) => {
  const notification = event.notification;
  const action = event.action;

  notification.close();

  event.waitUntil(clients.openWindow("/"));
});

// Message handling for communication with main app
self.addEventListener("message", (event) => {
  const { type, data } = event.data;

  switch (type) {
    case "SKIP_WAITING":
      self.skipWaiting();
      break;

    case "GET_VERSION":
      event.ports[0].postMessage({
        type: "VERSION",
        version: CACHE_NAME,
      });
      break;

    case "CLEAR_CACHE":
      clearAllCaches().then(() => {
        event.ports[0].postMessage({
          type: "CACHE_CLEARED",
        });
      });
      break;

    case "CACHE_FEEDBACK":
      // Store feedback for later sync
      cacheFeedbackForSync(data);
      break;

    case "CACHE_PROJECT":
      // Store project for later sync
      cacheProjectForSync(data);
      break;

    default:
      console.log("[ServiceWorker] Unknown message type:", type);
  }
});

// Cache feedback for background sync
function cacheFeedbackForSync(feedback) {
  const pending = JSON.parse(localStorage.getItem("pending_feedback") || "[]");
  pending.push({
    ...feedback,
    timestamp: Date.now(),
    id: Math.random().toString(36).substring(2),
  });
  localStorage.setItem("pending_feedback", JSON.stringify(pending));
}

// Cache project for background sync
function cacheProjectForSync(project) {
  const pending = JSON.parse(localStorage.getItem("pending_projects") || "[]");
  pending.push({
    ...project,
    timestamp: Date.now(),
    id: Math.random().toString(36).substring(2),
  });
  localStorage.setItem("pending_projects", JSON.stringify(pending));
}

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys();
  await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
  console.log("[ServiceWorker] All caches cleared");
}

// Periodic sync for data updates (experimental)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "update-global-ideas") {
    event.waitUntil(updateGlobalIdeas());
  }
});

// Update global ideas in background
async function updateGlobalIdeas() {
  try {
    console.log("[ServiceWorker] Updating global ideas in background");

    // Fetch fresh data
    const response = await fetch(
      "/rest/v1/projects_final?order=ai_score.desc&limit=20"
    );
    if (response.ok) {
      const cache = await caches.open(DATA_CACHE_NAME);
      await cache.put("/rest/v1/projects_final", response.clone());

      // Notify clients about update
      const clients = await self.clients.matchAll();
      clients.forEach((client) => {
        client.postMessage({
          type: "CACHE_UPDATED",
          data: "global-ideas",
        });
      });
    }
  } catch (error) {
    console.error("[ServiceWorker] Background update failed:", error);
  }
}

// Error handling for unhandled errors
self.addEventListener("error", (event) => {
  console.error("[ServiceWorker] Error:", event.error);
});

// Handle unhandled promise rejections
self.addEventListener("unhandledrejection", (event) => {
  console.error("[ServiceWorker] Unhandled promise rejection:", event.reason);
  event.preventDefault();
});

// Log service worker status
console.log("[ServiceWorker] Service Worker loaded");
console.log("[ServiceWorker] Cache version:", CACHE_NAME);
console.log("[ServiceWorker] Static files to cache:", STATIC_FILES.length);
