// Storage utilities for user management and authentication
import {
  createUser,
  getUserByName,
  getAllUsers,
  updateUser,
  softDeleteUser,
  isIndexedDBAvailable,
} from "./idb.js";

// Current active user (stored in memory)
let currentUser = null;

// Hash a string using Web Crypto API
export async function hashString(input) {
  if (!input) {
    throw new Error("ERR_EMPTY_INPUT");
  }

  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (error) {
    console.error("Hashing failed:", error);
    throw new Error("ERR_HASH_FAILED");
  }
}

// Fallback localStorage operations (only if IndexedDB unavailable)
const STORAGE_PREFIX = "capsera_";

function getFromLocalStorage(key) {
  try {
    const data = localStorage.getItem(STORAGE_PREFIX + key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error("LocalStorage read error:", error);
    return null;
  }
}

function setToLocalStorage(key, data) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
    return true;
  } catch (error) {
    console.error("LocalStorage write error:", error);
    return false;
  }
}

function removeFromLocalStorage(key) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + key);
    return true;
  } catch (error) {
    console.error("LocalStorage remove error:", error);
    return false;
  }
}

// User creation function
export async function createNewUser(name, pin, safetyCode) {
  if (!name || !name.trim()) {
    throw new Error("ERR_EMPTY_NAME");
  }

  if (!pin || pin.length < 4) {
    throw new Error("ERR_PIN_TOO_SHORT");
  }

  if (!safetyCode || !safetyCode.trim()) {
    throw new Error("ERR_EMPTY_SAFETY_CODE");
  }

  const trimmedName = name.trim();

  try {
    // Hash pin and safety code
    const pinHash = await hashString(pin);
    const safetyCodeHash = await hashString(safetyCode);

    if (isIndexedDBAvailable()) {
      // Use IndexedDB
      const user = await createUser({
        name: trimmedName,
        pinHash,
        safetyCodeHash,
      });

      currentUser = user;
      console.log("User created successfully in IndexedDB:", user.name);
      return user;
    } else {
      // Fallback to localStorage
      const users = getFromLocalStorage("users") || {};

      // Check uniqueness among non-deleted users
      const existingUser = Object.values(users).find(
        (u) => u.name === trimmedName && !u.deleted
      );
      if (existingUser) {
        throw new Error("ERR_USER_EXISTS");
      }

      const user = {
        id: crypto.randomUUID(),
        name: trimmedName,
        pinHash,
        safetyCodeHash,
        createdAt: new Date().toISOString(),
        deleted: false,
        deletedAt: null,
      };

      users[user.id] = user;
      setToLocalStorage("users", users);

      currentUser = user;
      console.log("User created successfully in localStorage:", user.name);
      return user;
    }
  } catch (error) {
    console.error("Failed to create user:", error);
    throw error;
  }
}

// User login function
export async function loginUser(name, pin) {
  if (!name || !name.trim()) {
    throw new Error("ERR_EMPTY_NAME");
  }

  if (!pin) {
    throw new Error("ERR_EMPTY_PIN");
  }

  const trimmedName = name.trim();

  try {
    const pinHash = await hashString(pin);

    if (isIndexedDBAvailable()) {
      // Use IndexedDB
      const user = await getUserByName(trimmedName);

      if (!user) {
        throw new Error("ERR_USER_NOT_FOUND");
      }

      if (user.deleted) {
        throw new Error("ERR_USER_DELETED");
      }

      if (user.pinHash !== pinHash) {
        throw new Error("ERR_PIN_MISMATCH");
      }

      currentUser = user;
      console.log("User logged in successfully:", user.name);
      return user;
    } else {
      // Fallback to localStorage
      const users = getFromLocalStorage("users") || {};
      const user = Object.values(users).find(
        (u) => u.name === trimmedName && !u.deleted
      );

      if (!user) {
        throw new Error("ERR_USER_NOT_FOUND");
      }

      if (user.pinHash !== pinHash) {
        throw new Error("ERR_PIN_MISMATCH");
      }

      currentUser = user;
      console.log("User logged in successfully:", user.name);
      return user;
    }
  } catch (error) {
    console.error("Failed to login user:", error);
    throw error;
  }
}

// Change user pin (requires safety code)
export async function changeUserPin(userId, safetyCode, newPin) {
  if (!userId) {
    throw new Error("ERR_EMPTY_USER_ID");
  }

  if (!safetyCode) {
    throw new Error("ERR_EMPTY_SAFETY_CODE");
  }

  if (!newPin || newPin.length < 4) {
    throw new Error("ERR_PIN_TOO_SHORT");
  }

  try {
    const safetyCodeHash = await hashString(safetyCode);
    const newPinHash = await hashString(newPin);

    if (isIndexedDBAvailable()) {
      // Use IndexedDB
      const user = await getUserById(userId);

      if (!user) {
        throw new Error("ERR_USER_NOT_FOUND");
      }

      if (user.deleted) {
        throw new Error("ERR_USER_DELETED");
      }

      if (user.safetyCodeHash !== safetyCodeHash) {
        throw new Error("ERR_SAFETY_CODE_MISMATCH");
      }

      const updatedUser = await updateUser(userId, { pinHash: newPinHash });

      if (currentUser && currentUser.id === userId) {
        currentUser = updatedUser;
      }

      console.log("Pin changed successfully for user:", user.name);
      return updatedUser;
    } else {
      // Fallback to localStorage
      const users = getFromLocalStorage("users") || {};
      const user = users[userId];

      if (!user || user.deleted) {
        throw new Error("ERR_USER_NOT_FOUND");
      }

      if (user.safetyCodeHash !== safetyCodeHash) {
        throw new Error("ERR_SAFETY_CODE_MISMATCH");
      }

      user.pinHash = newPinHash;
      users[userId] = user;
      setToLocalStorage("users", users);

      if (currentUser && currentUser.id === userId) {
        currentUser = user;
      }

      console.log("Pin changed successfully for user:", user.name);
      return user;
    }
  } catch (error) {
    console.error("Failed to change pin:", error);
    throw error;
  }
}

// Get all non-deleted users
export async function getUsers() {
  try {
    if (isIndexedDBAvailable()) {
      return await getAllUsers();
    } else {
      const users = getFromLocalStorage("users") || {};
      return Object.values(users).filter((u) => !u.deleted);
    }
  } catch (error) {
    console.error("Failed to get users:", error);
    return [];
  }
}

// Delete user (requires pin verification)
export async function deleteUser(userId, pin) {
  if (!userId) {
    throw new Error("ERR_EMPTY_USER_ID");
  }

  if (!pin) {
    throw new Error("ERR_EMPTY_PIN");
  }

  try {
    const pinHash = await hashString(pin);

    if (isIndexedDBAvailable()) {
      // Use IndexedDB
      const user = await getUserById(userId);

      if (!user) {
        throw new Error("ERR_USER_NOT_FOUND");
      }

      if (user.deleted) {
        throw new Error("ERR_USER_ALREADY_DELETED");
      }

      if (user.pinHash !== pinHash) {
        throw new Error("ERR_PIN_MISMATCH");
      }

      const deletedUser = await softDeleteUser(userId);

      if (currentUser && currentUser.id === userId) {
        currentUser = null;
      }

      console.log("User deleted successfully:", user.name);
      return deletedUser;
    } else {
      // Fallback to localStorage
      const users = getFromLocalStorage("users") || {};
      const user = users[userId];

      if (!user || user.deleted) {
        throw new Error("ERR_USER_NOT_FOUND");
      }

      if (user.pinHash !== pinHash) {
        throw new Error("ERR_PIN_MISMATCH");
      }

      user.deleted = true;
      user.deletedAt = new Date().toISOString();
      users[userId] = user;
      setToLocalStorage("users", users);

      // Also clear user's projects from localStorage
      const projects = getFromLocalStorage("projects") || {};
      Object.values(projects).forEach((project) => {
        if (project.userId === userId) {
          project.deleted = true;
          project.deletedAt = new Date().toISOString();
        }
      });
      setToLocalStorage("projects", projects);

      // Clear user's drafts
      const drafts = getFromLocalStorage("drafts") || {};
      Object.keys(drafts).forEach((draftId) => {
        const draft = drafts[draftId];
        const project = projects[draft.projectId];
        if (project && project.userId === userId) {
          delete drafts[draftId];
        }
      });
      setToLocalStorage("drafts", drafts);

      if (currentUser && currentUser.id === userId) {
        currentUser = null;
      }

      console.log("User deleted successfully:", user.name);
      return user;
    }
  } catch (error) {
    console.error("Failed to delete user:", error);
    throw error;
  }
}

// Check if a username is available (not taken by non-deleted users)
export async function isUsernameAvailable(name) {
  if (!name || !name.trim()) {
    return false;
  }

  const trimmedName = name.trim();

  try {
    if (isIndexedDBAvailable()) {
      const user = await getUserByName(trimmedName);
      return !user; // Available if no user found
    } else {
      const users = getFromLocalStorage("users") || {};
      const existingUser = Object.values(users).find(
        (u) => u.name === trimmedName && !u.deleted
      );
      return !existingUser; // Available if no user found
    }
  } catch (error) {
    console.error("Failed to check username availability:", error);
    return false;
  }
}

// Get current active user
export function getCurrentUser() {
  return currentUser;
}

// Set current active user
export function setCurrentUser(user) {
  currentUser = user;
}

// Clear current user (logout)
export function logoutCurrentUser() {
  currentUser = null;
  console.log("User logged out");
}

// Verify pin for current user
export async function verifyCurrentUserPin(pin) {
  if (!currentUser) {
    throw new Error("ERR_NO_CURRENT_USER");
  }

  if (!pin) {
    throw new Error("ERR_EMPTY_PIN");
  }

  try {
    const pinHash = await hashString(pin);
    return currentUser.pinHash === pinHash;
  } catch (error) {
    console.error("Failed to verify pin:", error);
    return false;
  }
}

// Get user by ID (works with both storage types)
export async function getUserById(id) {
  try {
    if (isIndexedDBAvailable()) {
      return await getUserById(id);
    } else {
      const users = getFromLocalStorage("users") || {};
      return users[id];
    }
  } catch (error) {
    console.error("Failed to get user by ID:", error);
    return null;
  }
}

// Error message translations for UI
export function getErrorMessage(errorCode) {
  const errorMessages = {
    ERR_EMPTY_NAME: "Name cannot be empty",
    ERR_EMPTY_PIN: "PIN cannot be empty",
    ERR_PIN_TOO_SHORT: "PIN must be at least 4 characters",
    ERR_EMPTY_SAFETY_CODE: "Safety code cannot be empty",
    ERR_EMPTY_USER_ID: "User ID is required",
    ERR_EMPTY_INPUT: "Input cannot be empty",
    ERR_USER_EXISTS: "A user with this name already exists",
    ERR_USER_NOT_FOUND: "User not found or has been deleted",
    ERR_USER_DELETED: "This user has been deleted",
    ERR_USER_ALREADY_DELETED: "User is already deleted",
    ERR_PIN_MISMATCH: "Incorrect PIN",
    ERR_SAFETY_CODE_MISMATCH: "Incorrect safety code",
    ERR_NO_CURRENT_USER: "No user is currently logged in",
    ERR_HASH_FAILED: "Failed to process security data",
  };

  return errorMessages[errorCode] || "An unknown error occurred";
}

// Initialize storage on module load
console.log(
  "Storage utilities loaded. IndexedDB available:",
  isIndexedDBAvailable()
);
