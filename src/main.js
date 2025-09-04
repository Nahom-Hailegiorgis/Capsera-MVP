// Main application entry point for Capsera PWA
import { initRouter } from "./router.js";
import { openCapseraDB } from "./utils/idb.js";
import { setupAutoSync, registerBackgroundSync } from "./utils/syncQueue.js";

// Application state
let app = {
  isOnline: navigator.onLine !== false,
  isInitialized: false,
  currentUser: null,
  serviceWorkerRegistration: null,
};

// Initialize the application
async function initializeApp() {
  console.log("Initializing Capsera PWA...");

  try {
    // Initialize IndexedDB
    console.log("Opening IndexedDB...");
    await openCapseraDB();
    console.log("IndexedDB initialized successfully");

    // Setup offline sync queue
    console.log("Setting up sync queue...");
    setupAutoSync();

    // Initialize router
    console.log("Initializing router...");
    await initRouter();

    // Register service worker
    await registerServiceWorker();

    // Setup online/offline event listeners
    setupNetworkListeners();

    // Setup sync queue event listeners
    setupSyncQueueListeners();

    app.isInitialized = true;
    console.log("Capsera PWA initialized successfully");

    // Dispatch app ready event
    window.dispatchEvent(new CustomEvent("capseraReady"));
  } catch (error) {
    console.error("Failed to initialize app:", error);
    showErrorMessage("Failed to initialize app. Please refresh the page.");
  }
}

// Register service worker for offline functionality
async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.register(
        "/service-worker.js"
      );
      app.serviceWorkerRegistration = registration;

      console.log(
        "Service Worker registered successfully:",
        registration.scope
      );

      // Listen for updates
      registration.addEventListener("updatefound", () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New version available
              showUpdateAvailable();
            }
          });
        }
      });

      // Register background sync if supported
      registerBackgroundSync();
    } catch (error) {
      console.warn("Service Worker registration failed:", error);
    }
  } else {
    console.warn("Service Workers not supported in this browser");
  }
}

// Setup network status listeners
function setupNetworkListeners() {
  function updateOnlineStatus() {
    const wasOnline = app.isOnline;
    app.isOnline = navigator.onLine !== false;

    const statusElement = document.querySelector(".network-status");
    if (statusElement) {
      statusElement.textContent = app.isOnline ? "Online" : "Offline";
      statusElement.className = `network-status ${
        app.isOnline ? "status-online" : "status-offline"
      }`;
    }

    if (!wasOnline && app.isOnline) {
      console.log("Network connection restored");
      showNetworkMessage("Connection restored - syncing data...", "success");
    } else if (wasOnline && !app.isOnline) {
      console.log("Network connection lost");
      showNetworkMessage(
        "Working offline - changes will sync when online",
        "warning"
      );
    }

    // Dispatch network change event
    window.dispatchEvent(
      new CustomEvent("networkStatusChanged", {
        detail: { isOnline: app.isOnline, wasOnline },
      })
    );
  }

  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);

  // Initial status
  updateOnlineStatus();
}

// Setup sync queue event listeners
function setupSyncQueueListeners() {
  window.addEventListener("syncQueueProcessed", (event) => {
    const { successCount, failCount, totalProcessed } = event.detail;

    if (totalProcessed > 0) {
      const message =
        `Synced ${successCount} items` +
        (failCount > 0 ? ` (${failCount} failed)` : "");
      showNetworkMessage(message, failCount > 0 ? "warning" : "success");
    }
  });

  // Listen for manual sync triggers
  window.addEventListener("forceSyncQueue", () => {
    if (app.serviceWorkerRegistration && app.serviceWorkerRegistration.active) {
      app.serviceWorkerRegistration.active.postMessage({ type: "SYNC_QUEUE" });
    }
  });
}

// Show network status messages
function showNetworkMessage(message, type = "info") {
  // Remove existing network messages
  const existingMessages = document.querySelectorAll(".network-message");
  existingMessages.forEach((msg) => msg.remove());

  const messageDiv = document.createElement("div");
  messageDiv.className = `network-message network-message-${type}`;
  messageDiv.textContent = message;
  messageDiv.style.cssText = `
    position: fixed;
    top: 60px;
    right: 20px;
    padding: 10px 15px;
    background: ${
      type === "success"
        ? "#28a745"
        : type === "warning"
        ? "#ffc107"
        : "#17a2b8"
    };
    color: ${type === "warning" ? "#000" : "#fff"};
    border-radius: 4px;
    z-index: 1001;
    font-size: 14px;
    max-width: 300px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  `;

  document.body.appendChild(messageDiv);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    if (messageDiv.parentNode) {
      messageDiv.remove();
    }
  }, 5000);
}

// Show update available notification
function showUpdateAvailable() {
  const updateDiv = document.createElement("div");
  updateDiv.className = "update-available";
  updateDiv.innerHTML = `
    <div style="position: fixed; bottom: 20px; left: 20px; background: var(--primary); color: var(--primary-dark); padding: 15px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 1002; max-width: 300px;">
      <div style="font-weight: 600; margin-bottom: 8px;">Update Available</div>
      <div style="font-size: 14px; margin-bottom: 10px;">A new version of Capsera is available.</div>
      <button id="update-app-btn" style="background: var(--primary-dark); color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Update Now</button>
      <button id="dismiss-update-btn" style="background: transparent; color: var(--primary-dark); border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-left: 8px;">Later</button>
    </div>
  `;

  document.body.appendChild(updateDiv);

  document.getElementById("update-app-btn").addEventListener("click", () => {
    window.location.reload();
  });

  document
    .getElementById("dismiss-update-btn")
    .addEventListener("click", () => {
      updateDiv.remove();
    });
}

// Show error messages
function showErrorMessage(message) {
  const errorDiv = document.createElement("div");
  errorDiv.className = "error-message";
  errorDiv.innerHTML = `
    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #dc3545; color: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 1003; max-width: 400px; text-align: center;">
      <div style="font-weight: 600; margin-bottom: 10px;">Error</div>
      <div style="margin-bottom: 15px;">${message}</div>
      <button id="dismiss-error-btn" style="background: rgba(255,255,255,0.2); color: white; border: 1px solid white; padding: 8px 16px; border-radius: 4px; cursor: pointer;">OK</button>
    </div>
  `;

  document.body.appendChild(errorDiv);

  document.getElementById("dismiss-error-btn").addEventListener("click", () => {
    errorDiv.remove();
  });
}

// Add network status indicator to navigation
function addNetworkStatusToNav() {
  const nav = document.querySelector(".nav");
  if (nav && !nav.querySelector(".network-status")) {
    const statusSpan = document.createElement("span");
    statusSpan.className = `network-status ${
      app.isOnline ? "status-online" : "status-offline"
    }`;
    statusSpan.textContent = app.isOnline ? "Online" : "Offline";
    statusSpan.style.cssText = `
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 10px;
      background: rgba(255,255,255,0.2);
      margin-left: 10px;
    `;

    const brand = nav.querySelector(".nav-brand");
    if (brand) {
      brand.appendChild(statusSpan);
    }
  }
}

// Utility function to get current app state
export function getAppState() {
  return { ...app };
}

// Utility function to check if app is ready
export function isAppReady() {
  return app.isInitialized;
}

// Export main initialization function
export { initializeApp };

// Global error handler
window.addEventListener("error", (event) => {
  console.error("Global error:", event.error);

  if (!app.isInitialized) {
    showErrorMessage(
      "An error occurred during app initialization. Please refresh the page."
    );
  }
});

// Global unhandled promise rejection handler
window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);

  // Prevent default browser behavior
  event.preventDefault();

  // Show user-friendly error for critical failures
  if (
    event.reason?.message?.includes("IndexedDB") ||
    event.reason?.message?.includes("database")
  ) {
    showErrorMessage(
      "Database error occurred. Please try refreshing the page."
    );
  }
});

// DOM Content Loaded - Start app initialization
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, starting app initialization...");

  // Add network status to nav once DOM is ready
  setTimeout(addNetworkStatusToNav, 100);

  // Initialize the app
  initializeApp();
});

// Export app instance for debugging
window.CapseraApp = app;

console.log("Capsera main.js loaded");
