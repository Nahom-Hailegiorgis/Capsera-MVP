// IndexedDB wrapper using idb library for Capsera
import { openDB } from "idb";

const DB_NAME = "CapseraDB";
const DB_VERSION = 1;

let db = null;

// Initialize and open the database with required object stores
export async function openCapseraDB() {
  if (db) return db;

  try {
    db = await openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        console.log("Upgrading IndexedDB schema...");

        // Users store
        if (!db.objectStoreNames.contains("users")) {
          const usersStore = db.createObjectStore("users", { keyPath: "id" });
          usersStore.createIndex("name", "name", { unique: false });
          usersStore.createIndex("deleted", "deleted", { unique: false });
          console.log("Created users store");
        }

        // Projects store
        if (!db.objectStoreNames.contains("projects")) {
          const projectsStore = db.createObjectStore("projects", {
            keyPath: "id",
          });
          projectsStore.createIndex("userId", "userId", { unique: false });
          projectsStore.createIndex("name", "name", { unique: false });
          projectsStore.createIndex("deleted", "deleted", { unique: false });
          console.log("Created projects store");
        }

        // Drafts store
        if (!db.objectStoreNames.contains("drafts")) {
          const draftsStore = db.createObjectStore("drafts", { keyPath: "id" });
          draftsStore.createIndex("projectId", "projectId", { unique: false });
          draftsStore.createIndex("draftNumber", "draftNumber", {
            unique: false,
          });
          console.log("Created drafts store");
        }

        // Translations cache store
        if (!db.objectStoreNames.contains("translations")) {
          const translationsStore = db.createObjectStore("translations", {
            keyPath: "hash",
          });
          translationsStore.createIndex("text", "text", { unique: false });
          translationsStore.createIndex("lang", "lang", { unique: false });
          console.log("Created translations store");
        }

        // Sync queue store
        if (!db.objectStoreNames.contains("syncQueue")) {
          const syncStore = db.createObjectStore("syncQueue", {
            keyPath: "id",
          });
          syncStore.createIndex("type", "type", { unique: false });
          syncStore.createIndex("createdAt", "createdAt", { unique: false });
          console.log("Created syncQueue store");
        }

        // Generic cache store for expensive operations (AI results, etc.)
        if (!db.objectStoreNames.contains("cache")) {
          const cacheStore = db.createObjectStore("cache", { keyPath: "key" });
          cacheStore.createIndex("type", "type", { unique: false });
          cacheStore.createIndex("createdAt", "createdAt", { unique: false });
          console.log("Created cache store");
        }
      },
    });

    console.log("IndexedDB initialized successfully");
    return db;
  } catch (error) {
    console.error("Failed to initialize IndexedDB:", error);
    throw error;
  }
}

// Helper to ensure database is open before operations
async function ensureDB() {
  if (!db) {
    db = await openCapseraDB();
  }
  return db;
}

// Generic CRUD operations
export async function getRecord(storeName, key) {
  const db = await ensureDB();
  return await db.get(storeName, key);
}

export async function getAllRecords(storeName) {
  const db = await ensureDB();
  return await db.getAll(storeName);
}

export async function getRecordsByIndex(storeName, indexName, value) {
  const db = await ensureDB();
  return await db.getAllFromIndex(storeName, indexName, value);
}

export async function addRecord(storeName, record) {
  const db = await ensureDB();
  return await db.add(storeName, record);
}

export async function putRecord(storeName, record) {
  const db = await ensureDB();
  return await db.put(storeName, record);
}

export async function deleteRecord(storeName, key) {
  const db = await ensureDB();
  return await db.delete(storeName, key);
}

export async function clearStore(storeName) {
  const db = await ensureDB();
  return await db.clear(storeName);
}

// Users operations
export async function createUser(userData) {
  const users = await getAllRecords("users");

  // Check for name uniqueness among non-deleted users
  const existingUser = users.find(
    (u) => u.name === userData.name && !u.deleted
  );
  if (existingUser) {
    throw new Error("ERR_USER_EXISTS");
  }

  const user = {
    id: crypto.randomUUID(),
    name: userData.name,
    pinHash: userData.pinHash,
    safetyCodeHash: userData.safetyCodeHash,
    createdAt: new Date().toISOString(),
    deleted: false,
    deletedAt: null,
  };

  await addRecord("users", user);
  return user;
}

export async function getUserByName(name) {
  const users = await getAllRecords("users");
  return users.find((u) => u.name === name && !u.deleted);
}

export async function getUserById(id) {
  return await getRecord("users", id);
}

export async function getAllUsers() {
  const users = await getAllRecords("users");
  return users.filter((u) => !u.deleted);
}

export async function updateUser(id, updates) {
  const user = await getRecord("users", id);
  if (!user) {
    throw new Error("ERR_USER_NOT_FOUND");
  }

  const updatedUser = { ...user, ...updates };
  await putRecord("users", updatedUser);
  return updatedUser;
}

export async function softDeleteUser(id) {
  const user = await getRecord("users", id);
  if (!user) {
    throw new Error("ERR_USER_NOT_FOUND");
  }

  user.deleted = true;
  user.deletedAt = new Date().toISOString();
  await putRecord("users", user);

  // Also soft delete all user's projects and drafts
  await clearUserData(id);
  return user;
}

export async function hardDeleteUser(id) {
  await deleteRecord("users", id);
  await clearUserData(id);
}

// Projects operations
export async function createProject(projectData) {
  const projects = await getRecordsByIndex(
    "projects",
    "userId",
    projectData.userId
  );

  // Check for name uniqueness within user's non-deleted projects
  const existingProject = projects.find(
    (p) => p.name === projectData.name && !p.deleted
  );
  if (existingProject) {
    throw new Error("ERR_PROJECT_EXISTS");
  }

  const project = {
    id: crypto.randomUUID(),
    userId: projectData.userId,
    name: projectData.name,
    createdAt: new Date().toISOString(),
    deleted: false,
    deletedAt: null,
  };

  await addRecord("projects", project);
  return project;
}

export async function getProjectsByUser(userId) {
  const projects = await getRecordsByIndex("projects", "userId", userId);
  return projects.filter((p) => !p.deleted);
}

export async function getProjectById(id) {
  return await getRecord("projects", id);
}

export async function softDeleteProject(id) {
  const project = await getRecord("projects", id);
  if (!project) {
    throw new Error("ERR_PROJECT_NOT_FOUND");
  }

  project.deleted = true;
  project.deletedAt = new Date().toISOString();
  await putRecord("projects", project);

  // Also soft delete all project's drafts
  const drafts = await getRecordsByIndex("drafts", "projectId", id);
  for (const draft of drafts) {
    await deleteRecord("drafts", draft.id);
  }

  return project;
}

// Drafts operations
export async function createDraft(draftData) {
  const draft = {
    id: crypto.randomUUID(),
    projectId: draftData.projectId,
    draftNumber: draftData.draftNumber,
    answers: draftData.answers,
    score: draftData.score || null,
    aiFeedback: draftData.aiFeedback || null,
    createdAt: new Date().toISOString(),
    previousDraftId: draftData.previousDraftId || null,
  };

  await addRecord("drafts", draft);
  return draft;
}

export async function getDraftsByProject(projectId) {
  return await getRecordsByIndex("drafts", "projectId", projectId);
}

export async function getDraftById(id) {
  return await getRecord("drafts", id);
}

export async function updateDraft(id, updates) {
  const draft = await getRecord("drafts", id);
  if (!draft) {
    throw new Error("ERR_DRAFT_NOT_FOUND");
  }

  const updatedDraft = { ...draft, ...updates };
  await putRecord("drafts", updatedDraft);
  return updatedDraft;
}

// Translations cache operations
export async function getTranslation(text, lang) {
  const hash = await generateHash(text + lang);
  return await getRecord("translations", hash);
}

export async function cacheTranslation(text, lang, translatedText) {
  const hash = await generateHash(text + lang);
  const translation = {
    hash,
    text,
    lang,
    translatedText,
    createdAt: new Date().toISOString(),
  };

  await putRecord("translations", translation);
  return translation;
}

// Sync queue operations
export async function addToSyncQueue(type, payload) {
  const queueItem = {
    id: crypto.randomUUID(),
    type,
    payload,
    createdAt: new Date().toISOString(),
    retries: 0,
  };

  await addRecord("syncQueue", queueItem);
  return queueItem;
}

export async function getSyncQueue() {
  return await getAllRecords("syncQueue");
}

export async function removeFromSyncQueue(id) {
  return await deleteRecord("syncQueue", id);
}

export async function updateSyncQueueItem(id, updates) {
  const item = await getRecord("syncQueue", id);
  if (!item) return null;

  const updatedItem = { ...item, ...updates };
  await putRecord("syncQueue", updatedItem);
  return updatedItem;
}

// Generic cache operations for AI results, etc.
export async function getCacheItem(key) {
  return await getRecord("cache", key);
}

export async function setCacheItem(key, data, type = "generic") {
  const cacheItem = {
    key,
    data,
    type,
    createdAt: new Date().toISOString(),
  };

  await putRecord("cache", cacheItem);
  return cacheItem;
}

export async function clearExpiredCache(maxAgeMs = 24 * 60 * 60 * 1000) {
  const db = await ensureDB();
  const tx = db.transaction("cache", "readwrite");
  const store = tx.objectStore("cache");
  const cursor = await store.openCursor();

  const cutoffTime = new Date(Date.now() - maxAgeMs);
  let deletedCount = 0;

  while (cursor) {
    const itemDate = new Date(cursor.value.createdAt);
    if (itemDate < cutoffTime) {
      await cursor.delete();
      deletedCount++;
    }
    cursor.continue();
  }

  console.log(`Cleared ${deletedCount} expired cache items`);
  return deletedCount;
}

// Helper function to clear all data for a user (called when user is deleted)
export async function clearUserData(userId) {
  console.log(`Clearing all data for user: ${userId}`);

  // Get all user's projects
  const projects = await getRecordsByIndex("projects", "userId", userId);

  for (const project of projects) {
    // Soft delete project
    project.deleted = true;
    project.deletedAt = new Date().toISOString();
    await putRecord("projects", project);

    // Delete all drafts for this project
    const drafts = await getRecordsByIndex("drafts", "projectId", project.id);
    for (const draft of drafts) {
      await deleteRecord("drafts", draft.id);
    }
  }

  console.log(`Cleared data for ${projects.length} projects`);
}

// Utility function to generate consistent hash for cache keys
export async function generateHash(input) {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Database maintenance functions
export async function getDatabaseInfo() {
  const db = await ensureDB();
  const stores = {};

  for (const storeName of db.objectStoreNames) {
    const count = await db.count(storeName);
    stores[storeName] = count;
  }

  return {
    name: DB_NAME,
    version: DB_VERSION,
    stores,
  };
}

export async function clearAllData() {
  const db = await ensureDB();
  const storeNames = Array.from(db.objectStoreNames);

  for (const storeName of storeNames) {
    await clearStore(storeName);
  }

  console.log("All IndexedDB data cleared");
}

// Fallback to localStorage if IndexedDB is not available
export function isIndexedDBAvailable() {
  return "indexedDB" in window && window.indexedDB !== null;
}

// Initialize database on module load
console.log("Initializing IndexedDB...");
openCapseraDB().catch(console.error);
