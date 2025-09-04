// Offline sync queue manager for Capsera
import {
  addToSyncQueue,
  getSyncQueue,
  removeFromSyncQueue,
  updateSyncQueueItem,
  isIndexedDBAvailable,
} from "./idb.js";
import { insertFinalProject, insertFeedback } from "../api/supabaseClient.js";

// Sync queue management with exponential backoff
const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second
const MAX_DELAY = 30000; // 30 seconds

let isProcessing = false;
let syncQueueFallback = []; // Fallback array if IndexedDB unavailable

// Add item to sync queue
export async function enqueue(type, payload) {
  console.log("Enqueueing sync item:", type);

  try {
    if (isIndexedDBAvailable()) {
      return await addToSyncQueue(type, payload);
    } else {
      // Fallback to in-memory array (will be lost on page refresh)
      const queueItem = {
        id: crypto.randomUUID(),
        type,
        payload,
        createdAt: new Date().toISOString(),
        retries: 0,
      };

      syncQueueFallback.push(queueItem);
      console.log("Added to fallback sync queue:", queueItem.id);
      return queueItem;
    }
  } catch (error) {
    console.error("Failed to enqueue sync item:", error);
    throw error;
  }
}

// Get all pending sync queue items
async function getQueueItems() {
  try {
    if (isIndexedDBAvailable()) {
      return await getSyncQueue();
    } else {
      return [...syncQueueFallback];
    }
  } catch (error) {
    console.error("Failed to get queue items:", error);
    return [];
  }
}

// Remove item from sync queue
async function removeQueueItem(id) {
  try {
    if (isIndexedDBAvailable()) {
      return await removeFromSyncQueue(id);
    } else {
      const index = syncQueueFallback.findIndex((item) => item.id === id);
      if (index >= 0) {
        syncQueueFallback.splice(index, 1);
        console.log("Removed from fallback sync queue:", id);
        return true;
      }
      return false;
    }
  } catch (error) {
    console.error("Failed to remove queue item:", error);
    return false;
  }
}

// Update queue item (mainly for retry count)
async function updateQueueItem(id, updates) {
  try {
    if (isIndexedDBAvailable()) {
      return await updateSyncQueueItem(id, updates);
    } else {
      const item = syncQueueFallback.find((item) => item.id === id);
      if (item) {
        Object.assign(item, updates);
        console.log("Updated fallback sync queue item:", id);
        return item;
      }
      return null;
    }
  } catch (error) {
    console.error("Failed to update queue item:", error);
    return null;
  }
}

// Calculate delay for exponential backoff
function getRetryDelay(retryCount) {
  const delay = Math.min(BASE_DELAY * Math.pow(2, retryCount), MAX_DELAY);
  // Add some jitter to avoid thundering herd
  const jitter = Math.random() * 0.3 * delay;
  return delay + jitter;
}

// Process a single queue item
async function processQueueItem(item) {
  console.log(
    `Processing queue item: ${item.type} (attempt ${item.retries + 1})`
  );

  try {
    let success = false;

    switch (item.type) {
      case "finalSubmit":
        console.log("Submitting final project to Supabase...");
        await insertFinalProject(item.payload);
        success = true;
        break;

      case "feedback":
        console.log("Submitting feedback to Supabase...");
        await insertFeedback(item.payload);
        success = true;
        break;

      default:
        console.warn("Unknown sync queue item type:", item.type);
        success = true; // Remove unknown items
        break;
    }

    if (success) {
      await removeQueueItem(item.id);
      console.log(`Successfully processed queue item: ${item.id}`);
      return true;
    }

    return false;
  } catch (error) {
    console.error(`Failed to process queue item ${item.id}:`, error);

    // Update retry count
    const newRetryCount = item.retries + 1;

    if (newRetryCount >= MAX_RETRIES) {
      console.warn(`Max retries reached for queue item ${item.id}, removing`);
      await removeQueueItem(item.id);
      return false;
    }

    // Update item with new retry count and next attempt time
    const nextAttemptDelay = getRetryDelay(newRetryCount);
    const nextAttemptTime = new Date(
      Date.now() + nextAttemptDelay
    ).toISOString();

    await updateQueueItem(item.id, {
      retries: newRetryCount,
      nextAttemptAt: nextAttemptTime,
      lastError: error.message,
    });

    console.log(
      `Will retry queue item ${item.id} in ${Math.round(
        nextAttemptDelay / 1000
      )}s`
    );
    return false;
  }
}

// Check if online
function isOnline() {
  return navigator.onLine !== false; // Default to true if navigator.onLine is undefined
}

// Process all pending queue items
export async function processSyncQueue() {
  if (isProcessing) {
    console.log("Sync queue already being processed");
    return;
  }

  if (!isOnline()) {
    console.log("Offline - skipping sync queue processing");
    return;
  }

  isProcessing = true;
  console.log("Starting sync queue processing...");

  try {
    const queueItems = await getQueueItems();

    if (queueItems.length === 0) {
      console.log("Sync queue is empty");
      return;
    }

    console.log(`Processing ${queueItems.length} queue items`);

    let successCount = 0;
    let failCount = 0;

    for (const item of queueItems) {
      // Check if item should be processed now (for retry delays)
      if (item.nextAttemptAt && new Date() < new Date(item.nextAttemptAt)) {
        console.log(`Skipping queue item ${item.id} - retry delay not reached`);
        continue;
      }

      try {
        const success = await processQueueItem(item);
        if (success) {
          successCount++;
        } else {
          failCount++;
        }

        // Small delay between processing items to avoid overwhelming the server
        if (queueItems.length > 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`Error processing queue item ${item.id}:`, error);
        failCount++;
      }
    }

    console.log(
      `Sync queue processing completed: ${successCount} success, ${failCount} failed`
    );

    // Emit custom event for UI updates
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("syncQueueProcessed", {
          detail: {
            successCount,
            failCount,
            totalProcessed: successCount + failCount,
          },
        })
      );
    }
  } catch (error) {
    console.error("Error during sync queue processing:", error);
  } finally {
    isProcessing = false;
  }
}

// Get sync queue status for UI
export async function getSyncQueueStatus() {
  try {
    const queueItems = await getQueueItems();

    const status = {
      totalItems: queueItems.length,
      pendingItems: 0,
      failedItems: 0,
      readyToRetry: 0,
      isProcessing,
      isOnline: isOnline(),
    };

    const now = new Date();

    queueItems.forEach((item) => {
      if (item.retries >= MAX_RETRIES) {
        status.failedItems++;
      } else if (item.nextAttemptAt && now < new Date(item.nextAttemptAt)) {
        status.pendingItems++;
      } else {
        status.readyToRetry++;
      }
    });

    return status;
  } catch (error) {
    console.error("Failed to get sync queue status:", error);
    return {
      totalItems: 0,
      pendingItems: 0,
      failedItems: 0,
      readyToRetry: 0,
      isProcessing: false,
      isOnline: isOnline(),
      error: error.message,
    };
  }
}

// Clear all failed items from queue (manual cleanup)
export async function clearFailedQueueItems() {
  try {
    const queueItems = await getQueueItems();
    let clearedCount = 0;

    for (const item of queueItems) {
      if (item.retries >= MAX_RETRIES) {
        await removeQueueItem(item.id);
        clearedCount++;
      }
    }

    console.log(`Cleared ${clearedCount} failed queue items`);
    return clearedCount;
  } catch (error) {
    console.error("Failed to clear failed queue items:", error);
    return 0;
  }
}

// Manual retry for a specific item (reset retry count)
export async function retryQueueItem(itemId) {
  try {
    const updated = await updateQueueItem(itemId, {
      retries: 0,
      nextAttemptAt: null,
      lastError: null,
    });

    if (updated) {
      console.log("Reset retry count for queue item:", itemId);
      // Process immediately if online
      if (isOnline()) {
        processSyncQueue();
      }
      return true;
    }

    return false;
  } catch (error) {
    console.error("Failed to retry queue item:", error);
    return false;
  }
}

// Set up automatic sync queue processing on network state changes
export function setupAutoSync() {
  if (typeof window === "undefined") return;

  // Listen for online/offline events
  window.addEventListener("online", () => {
    console.log("Network came online - processing sync queue");
    setTimeout(() => processSyncQueue(), 1000); // Small delay to ensure connection is stable
  });

  window.addEventListener("offline", () => {
    console.log("Network went offline - sync queue processing will pause");
  });

  // Initial sync if online
  if (isOnline()) {
    setTimeout(() => processSyncQueue(), 2000); // Initial delay to let app initialize
  }

  // Periodic sync check (every 5 minutes when online)
  setInterval(() => {
    if (isOnline() && !isProcessing) {
      processSyncQueue();
    }
  }, 5 * 60 * 1000);

  console.log("Auto-sync setup completed");
}

// Register with service worker for background sync (if available)
export function registerBackgroundSync() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.ready
    .then((registration) => {
      if ("sync" in registration) {
        // Register for background sync
        registration.sync
          .register("sync-queue")
          .then(() => {
            console.log("Background sync registered");
          })
          .catch((error) => {
            console.warn("Background sync registration failed:", error);
          });
      } else {
        console.log("Background sync not supported");
      }
    })
    .catch((error) => {
      console.warn("Service worker not ready:", error);
    });
}

// Force sync queue processing (for manual triggers)
export function forceSyncQueue() {
  if (isProcessing) {
    console.log("Sync already in progress");
    return false;
  }

  console.log("Force processing sync queue...");
  processSyncQueue();
  return true;
}

// Get detailed queue information for debugging
export async function getQueueDetails() {
  try {
    const queueItems = await getQueueItems();

    return queueItems.map((item) => ({
      id: item.id,
      type: item.type,
      createdAt: item.createdAt,
      retries: item.retries,
      nextAttemptAt: item.nextAttemptAt,
      lastError: item.lastError,
      payloadSize: JSON.stringify(item.payload).length,
    }));
  } catch (error) {
    console.error("Failed to get queue details:", error);
    return [];
  }
}

// Enqueue final project submission
export async function enqueueFinalSubmit(projectData) {
  console.log("Enqueuing final project submission");
  return await enqueue("finalSubmit", projectData);
}

// Enqueue feedback submission
export async function enqueueFeedback(feedbackData) {
  console.log("Enqueuing feedback submission");
  return await enqueue("feedback", feedbackData);
}

// Clear all queue items (for development/testing)
export async function clearAllQueue() {
  try {
    const queueItems = await getQueueItems();
    let clearedCount = 0;

    for (const item of queueItems) {
      await removeQueueItem(item.id);
      clearedCount++;
    }

    // Also clear fallback array
    syncQueueFallback.length = 0;

    console.log(`Cleared all ${clearedCount} queue items`);
    return clearedCount;
  } catch (error) {
    console.error("Failed to clear queue:", error);
    return 0;
  }
}

// Export processSyncQueue for service worker use
export { processSyncQueue as processQueue };

console.log("Sync queue utilities loaded");
