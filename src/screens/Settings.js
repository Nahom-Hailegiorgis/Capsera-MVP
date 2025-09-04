// Settings Screen - User management, language settings, and app configuration
import {
  getUsers,
  changeUserPin,
  deleteUser,
  getErrorMessage,
  verifyCurrentUserPin,
} from "../utils/storage.js";
import { batchTranslate } from "../api/netlifyProxy.js";
import { getDatabaseInfo, clearAllData } from "../utils/idb.js";
import {
  getSyncQueueStatus,
  clearFailedQueueItems,
  forceSyncQueue,
} from "../utils/syncQueue.js";

export class Settings {
  constructor() {
    this.users = [];
    this.currentLanguage = localStorage.getItem("capsera_language") || "en";
    this.translations = {};
    this.isDeveloperMode = false;
  }

  async render(container) {
    console.log("Rendering Settings screen");

    await this.loadUsers();
    await this.loadTranslations();

    container.innerHTML = `
      <div class="settings-screen">
        <h1>⚙️ Settings</h1>
        
        <div class="settings-sections">
          <!-- Language Settings -->
          <div class="settings-section card">
            <div class="card-header">
              <h2>🌍 Language Settings</h2>
              <p>Translate the app interface to your preferred language</p>
            </div>
            
            <div class="language-selection">
              <div class="form-group">
                <label for="language-search">Search Languages:</label>
                <input type="text" id="language-search" placeholder="Type any language name..." class="language-search-input">
              </div>
              
              <div class="quick-languages">
                <h4>Quick Select:</h4>
                <div class="language-buttons">
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "hi"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="hi">Hindi</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "bn"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="bn">Bengali</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "te"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="te">Telugu</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "mr"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="mr">Marathi</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "ta"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="ta">Tamil</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "gu"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="gu">Gujarati</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "ur"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="ur">Urdu</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "ml"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="ml">Malayalam</button>
                  <button class="btn btn-small language-btn ${
                    this.currentLanguage === "en"
                      ? "btn-primary"
                      : "btn-secondary"
                  }" data-lang="en">English</button>
                </div>
              </div>
              
              <div id="language-status" class="language-status"></div>
            </div>
          </div>

          <!-- User Management -->
          <div class="settings-section card">
            <div class="card-header">
              <h2>👤 User Management</h2>
              <p>Manage local users on this device</p>
            </div>
            
            <div class="users-list" id="users-list">
              ${
                this.users.length === 0
                  ? `
                <div class="empty-state">
                  <p>No users found</p>
                  <p><a href="#/submit">Create your first user</a> to get started!</p>
                </div>
              `
                  : `
                <div class="users-container">
                  ${this.users
                    .map((user) => this.renderUserItem(user))
                    .join("")}
                </div>
              `
              }
            </div>
          </div>

          <!-- App Information -->
          <div class="settings-section card">
            <div class="card-header">
              <h2>📱 App Information</h2>
            </div>
            
            <div class="app-info">
              <div class="info-row">
                <strong>Version:</strong> ${window.ENV?.APP_VERSION || "1.0.0"}
              </div>
              <div class="info-row">
                <strong>Storage:</strong> IndexedDB + Local Cache
              </div>
              <div class="info-row">
                <strong>Network Status:</strong> 
                <span class="${
                  navigator.onLine ? "status-online" : "status-offline"
                }">
                  ${navigator.onLine ? "Online" : "Offline"}
                </span>
              </div>
            </div>
            
            <div class="sync-status" id="sync-status">
              <div class="loading"><div class="spinner"></div>Loading sync status...</div>
            </div>
          </div>

          <!-- Developer Tools -->
          <div class="settings-section card">
            <div class="card-header">
              <h2>🔧 Developer Tools</h2>
              <button class="btn btn-small btn-secondary" id="toggle-dev-mode">
                ${this.isDeveloperMode ? "Hide" : "Show"} Developer Tools
              </button>
            </div>
            
            <div id="developer-tools" class="developer-tools" style="display: ${
              this.isDeveloperMode ? "block" : "none"
            };">
              <div class="dev-section">
                <h4>Database Info</h4>
                <div id="db-info">Loading...</div>
                <button class="btn btn-small btn-secondary" id="refresh-db-info">Refresh</button>
              </div>
              
              <div class="dev-section">
                <h4>Clear Data</h4>
                <p class="warning-text">⚠️ These actions cannot be undone!</p>
                <button class="btn btn-small btn-danger" id="clear-failed-queue">Clear Failed Queue Items</button>
                <button class="btn btn-small btn-danger" id="clear-all-data">Clear All App Data</button>
              </div>
              
              <div class="dev-section">
                <h4>Manual Sync</h4>
                <button class="btn btn-small btn-primary" id="force-sync">Force Sync Queue</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.setupEventListeners();
    await this.loadSyncStatus();
    if (this.isDeveloperMode) {
      await this.loadDatabaseInfo();
    }
  }

  setupEventListeners() {
    // Language search
    const languageSearch = document.getElementById("language-search");
    if (languageSearch) {
      languageSearch.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
          const language = e.target.value.trim();
          if (language) {
            this.changeLanguage(language);
          }
        }
      });
    }

    // Quick language buttons
    const languageButtons = document.querySelectorAll(".language-btn");
    languageButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const lang = btn.dataset.lang;
        this.changeLanguage(lang);
      });
    });

    // User management buttons
    document.addEventListener("click", async (e) => {
      if (e.target.classList.contains("change-pin-btn")) {
        const userId = e.target.dataset.userId;
        await this.showChangePinModal(userId);
      }

      if (e.target.classList.contains("delete-user-btn")) {
        const userId = e.target.dataset.userId;
        await this.showDeleteUserModal(userId);
      }
    });

    // Developer tools toggle
    const toggleDevMode = document.getElementById("toggle-dev-mode");
    if (toggleDevMode) {
      toggleDevMode.addEventListener("click", () => {
        this.isDeveloperMode = !this.isDeveloperMode;
        const devTools = document.getElementById("developer-tools");
        if (devTools) {
          devTools.style.display = this.isDeveloperMode ? "block" : "none";
        }
        toggleDevMode.textContent = `${
          this.isDeveloperMode ? "Hide" : "Show"
        } Developer Tools`;

        if (this.isDeveloperMode) {
          this.loadDatabaseInfo();
        }
      });
    }

    // Developer tool buttons
    const refreshDbInfo = document.getElementById("refresh-db-info");
    if (refreshDbInfo) {
      refreshDbInfo.addEventListener("click", () => this.loadDatabaseInfo());
    }

    const clearFailedQueue = document.getElementById("clear-failed-queue");
    if (clearFailedQueue) {
      clearFailedQueue.addEventListener("click", () => this.clearFailedQueue());
    }

    const clearAllData = document.getElementById("clear-all-data");
    if (clearAllData) {
      clearAllData.addEventListener("click", () =>
        this.showClearAllDataModal()
      );
    }

    const forceSync = document.getElementById("force-sync");
    if (forceSync) {
      forceSync.addEventListener("click", () => this.forceSync());
    }
  }

  async loadUsers() {
    try {
      this.users = await getUsers();
      console.log(`Loaded ${this.users.length} users for settings`);
    } catch (error) {
      console.error("Failed to load users in settings:", error);
      this.users = [];
    }
  }

  renderUserItem(user) {
    return `
      <div class="user-item">
        <div class="user-info">
          <h4>${this.escapeHtml(user.name)}</h4>
          <div class="user-meta">
            <span>Created: ${new Date(
              user.createdAt
            ).toLocaleDateString()}</span>
          </div>
        </div>
        <div class="user-actions">
          <button class="btn btn-small btn-secondary change-pin-btn" data-user-id="${
            user.id
          }">
            Change PIN / Forgot PIN
          </button>
          <button class="btn btn-small btn-danger delete-user-btn" data-user-id="${
            user.id
          }">
            Delete
          </button>
        </div>
      </div>
    `;
  }

  async changeLanguage(targetLanguage) {
    const statusDiv = document.getElementById("language-status");

    if (statusDiv) {
      statusDiv.innerHTML =
        '<div class="loading"><div class="spinner"></div>Translating interface...</div>';
    }

    try {
      // Basic UI strings to translate
      const uiStrings = [
        "Global Ideas",
        "My Submissions",
        "Submit Ideas",
        "Settings",
        "Loading",
        "Save",
        "Cancel",
        "Delete",
        "Create",
        "Submit",
        "Back",
        "Next",
        "Previous",
        "Score",
        "Project",
        "Draft",
        "User",
        "Name",
        "Email",
        "Phone",
      ];

      // Get translations
      const translations = await batchTranslate(uiStrings, targetLanguage);

      // Store translations
      this.translations = translations;
      localStorage.setItem(
        "capsera_translations",
        JSON.stringify(translations)
      );
      localStorage.setItem("capsera_language", targetLanguage);
      this.currentLanguage = targetLanguage;

      // Apply translations to current page
      this.applyTranslations();

      if (statusDiv) {
        statusDiv.innerHTML = `<div class="success-message">✅ Language changed to ${targetLanguage}</div>`;
        setTimeout(() => {
          statusDiv.innerHTML = "";
        }, 3000);
      }

      // Update language button states
      document.querySelectorAll(".language-btn").forEach((btn) => {
        if (btn.dataset.lang === targetLanguage) {
          btn.className = "btn btn-small language-btn btn-primary";
        } else {
          btn.className = "btn btn-small language-btn btn-secondary";
        }
      });
    } catch (error) {
      console.error("Failed to change language:", error);
      if (statusDiv) {
        statusDiv.innerHTML = `<div class="error-message">❌ Failed to translate to ${targetLanguage}</div>`;
      }
    }
  }

  async loadTranslations() {
    try {
      const stored = localStorage.getItem("capsera_translations");
      if (stored) {
        this.translations = JSON.parse(stored);
      }
    } catch (error) {
      console.warn("Failed to load stored translations:", error);
      this.translations = {};
    }
  }

  applyTranslations() {
    // Apply translations to common UI elements
    if (Object.keys(this.translations).length === 0) return;

    // Translate navigation links
    document.querySelectorAll(".nav-link").forEach((link) => {
      const text = link.textContent.trim();
      if (this.translations[text]) {
        link.textContent = this.translations[text];
      }
    });

    // Translate buttons and common elements
    document.querySelectorAll("button, label").forEach((element) => {
      const text = element.textContent.trim();
      if (this.translations[text]) {
        element.textContent = this.translations[text];
      }
    });
  }

  async showChangePinModal(userId) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return;

    const modal = this.createModal(
      `Change PIN for ${user.name}`,
      `
      <form id="change-pin-form">
        <div class="form-group">
          <label for="safety-code">Safety Code *</label>
          <input type="password" id="safety-code" name="safetyCode" required placeholder="Enter your safety code">
          <small>You created this when setting up your account</small>
        </div>
        
        <div class="form-group">
          <label for="new-pin">New PIN (4+ characters) *</label>
          <input type="password" id="new-pin" name="newPin" required placeholder="Enter new PIN">
        </div>
        
        <div class="form-group">
          <label for="confirm-pin">Confirm New PIN *</label>
          <input type="password" id="confirm-pin" name="confirmPin" required placeholder="Confirm new PIN">
        </div>
        
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Change PIN</button>
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').style.display='none'">Cancel</button>
        </div>
        
        <div id="change-pin-error" class="error-message" style="display: none;"></div>
      </form>
    `
    );

    const form = document.getElementById("change-pin-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleChangePIN(userId, e);
      });
    }
  }

  async handleChangePIN(userId, event) {
    const formData = new FormData(event.target);
    const safetyCode = formData.get("safetyCode");
    const newPin = formData.get("newPin");
    const confirmPin = formData.get("confirmPin");

    const errorDiv = document.getElementById("change-pin-error");

    try {
      // Validate inputs
      if (!safetyCode || !newPin || !confirmPin) {
        throw new Error("All fields are required");
      }

      if (newPin !== confirmPin) {
        throw new Error("PINs do not match");
      }

      if (newPin.length < 4) {
        throw new Error("PIN must be at least 4 characters");
      }

      // Change PIN
      await changeUserPin(userId, safetyCode, newPin);

      // Close modal and show success
      document.getElementById("modal-overlay").style.display = "none";
      this.showMessage("PIN changed successfully!", "success");
    } catch (error) {
      console.error("Failed to change PIN:", error);
      if (errorDiv) {
        errorDiv.textContent = getErrorMessage(error.message);
        errorDiv.style.display = "block";
      }
    }
  }

  async showDeleteUserModal(userId) {
    const user = this.users.find((u) => u.id === userId);
    if (!user) return;

    const modal = this.createModal(
      `Delete User: ${user.name}`,
      `
      <div class="warning-box">
        <p><strong>⚠️ Warning:</strong> This will permanently delete the user and all associated projects and drafts.</p>
        <p>This action cannot be undone!</p>
      </div>
      
      <form id="delete-user-form">
        <div class="form-group">
          <label for="delete-pin">Enter user's PIN to confirm deletion *</label>
          <input type="password" id="delete-pin" name="pin" required placeholder="User's PIN">
        </div>
        
        <div class="form-actions">
          <button type="submit" class="btn btn-danger">Delete User</button>
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').style.display='none'">Cancel</button>
        </div>
        
        <div id="delete-user-error" class="error-message" style="display: none;"></div>
      </form>
    `
    );

    const form = document.getElementById("delete-user-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleDeleteUser(userId, e);
      });
    }
  }

  async handleDeleteUser(userId, event) {
    const formData = new FormData(event.target);
    const pin = formData.get("pin");

    const errorDiv = document.getElementById("delete-user-error");

    try {
      if (!pin) {
        throw new Error("PIN is required");
      }

      // Delete user
      await deleteUser(userId, pin);

      // Refresh users list
      await this.loadUsers();

      // Close modal and show success
      document.getElementById("modal-overlay").style.display = "none";
      this.showMessage("User deleted successfully!", "success");

      // Re-render users section
      const usersList = document.getElementById("users-list");
      if (usersList) {
        usersList.innerHTML =
          this.users.length === 0
            ? `
          <div class="empty-state">
            <p>No users found</p>
            <p><a href="#/submit">Create your first user</a> to get started!</p>
          </div>
        `
            : `
          <div class="users-container">
            ${this.users.map((user) => this.renderUserItem(user)).join("")}
          </div>
        `;
      }
    } catch (error) {
      console.error("Failed to delete user:", error);
      if (errorDiv) {
        errorDiv.textContent = getErrorMessage(error.message);
        errorDiv.style.display = "block";
      }
    }
  }

  async loadSyncStatus() {
    const statusDiv = document.getElementById("sync-status");
    if (!statusDiv) return;

    try {
      const status = await getSyncQueueStatus();

      statusDiv.innerHTML = `
        <div class="sync-info">
          <h4>Sync Queue Status</h4>
          <div class="status-grid">
            <div class="status-item">
              <strong>Total Items:</strong> ${status.totalItems}
            </div>
            <div class="status-item">
              <strong>Ready to Sync:</strong> ${status.readyToRetry}
            </div>
            <div class="status-item">
              <strong>Pending:</strong> ${status.pendingItems}
            </div>
            <div class="status-item">
              <strong>Failed:</strong> ${status.failedItems}
            </div>
          </div>
        </div>
      `;
    } catch (error) {
      console.error("Failed to load sync status:", error);
      statusDiv.innerHTML =
        '<div class="error-message">Failed to load sync status</div>';
    }
  }

  async loadDatabaseInfo() {
    const dbInfoDiv = document.getElementById("db-info");
    if (!dbInfoDiv) return;

    try {
      const info = await getDatabaseInfo();

      dbInfoDiv.innerHTML = `
        <div class="db-stats">
          <div class="stat-item">
            <strong>Database:</strong> ${info.name} v${info.version}
          </div>
          ${Object.entries(info.stores)
            .map(
              ([storeName, count]) => `
            <div class="stat-item">
              <strong>${storeName}:</strong> ${count} records
            </div>
          `
            )
            .join("")}
        </div>
      `;
    } catch (error) {
      console.error("Failed to load database info:", error);
      dbInfoDiv.innerHTML =
        '<div class="error-message">Failed to load database info</div>';
    }
  }

  async clearFailedQueue() {
    try {
      const clearedCount = await clearFailedQueueItems();
      this.showMessage(`Cleared ${clearedCount} failed queue items`, "success");
      await this.loadSyncStatus();
    } catch (error) {
      console.error("Failed to clear failed queue:", error);
      this.showMessage("Failed to clear failed queue items", "error");
    }
  }

  async forceSync() {
    try {
      const success = forceSyncQueue();
      if (success) {
        this.showMessage("Sync queue processing started", "info");
      } else {
        this.showMessage("Sync already in progress", "warning");
      }

      // Refresh sync status after a delay
      setTimeout(() => this.loadSyncStatus(), 2000);
    } catch (error) {
      console.error("Failed to force sync:", error);
      this.showMessage("Failed to start sync", "error");
    }
  }

  async showClearAllDataModal() {
    const modal = this.createModal(
      "Clear All App Data",
      `
      <div class="warning-box">
        <p><strong>⚠️ DANGER:</strong> This will permanently delete ALL app data including:</p>
        <ul>
          <li>All users and their projects</li>
          <li>All drafts and submissions</li>
          <li>All cached translations</li>
          <li>All sync queue items</li>
        </ul>
        <p><strong>This action cannot be undone!</strong></p>
      </div>
      
      <div class="form-group">
        <label for="confirm-clear">Type "DELETE EVERYTHING" to confirm:</label>
        <input type="text" id="confirm-clear" placeholder="Type exactly: DELETE EVERYTHING">
      </div>
      
      <div class="form-actions">
        <button class="btn btn-danger" id="confirm-clear-btn">Delete All Data</button>
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').style.display='none'">Cancel</button>
      </div>
    `
    );

    const confirmBtn = document.getElementById("confirm-clear-btn");
    const confirmInput = document.getElementById("confirm-clear");

    if (confirmBtn && confirmInput) {
      confirmBtn.addEventListener("click", async () => {
        if (confirmInput.value === "DELETE EVERYTHING") {
          await this.clearAllAppData();
        } else {
          alert('Please type "DELETE EVERYTHING" exactly to confirm');
        }
      });
    }
  }

  async clearAllAppData() {
    try {
      await clearAllData();
      localStorage.clear();
      sessionStorage.clear();

      // Close modal
      document.getElementById("modal-overlay").style.display = "none";

      // Show success and reload
      alert("All app data cleared successfully! The app will now reload.");
      window.location.reload();
    } catch (error) {
      console.error("Failed to clear all data:", error);
      this.showMessage("Failed to clear all data", "error");
    }
  }

  createModal(title, content) {
    const modalOverlay = document.getElementById("modal-overlay");
    const modalContent = document.getElementById("modal-content");

    if (!modalOverlay || !modalContent) return null;

    modalContent.innerHTML = `
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').style.display='none'">×</button>
      </div>
      <div class="modal-body">
        ${content}
      </div>
    `;

    modalOverlay.style.display = "flex";
    return modalOverlay;
  }

  showMessage(message, type = "info") {
    const messageDiv = document.createElement("div");
    messageDiv.className = `temp-message temp-message-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      padding: 10px 15px;
      background: ${
        type === "success"
          ? "#28a745"
          : type === "error"
          ? "#dc3545"
          : type === "warning"
          ? "#ffc107"
          : "#17a2b8"
      };
      color: ${type === "warning" ? "#000" : "#fff"};
      border-radius: 4px;
      z-index: 1001;
      font-size: 14px;
      max-width: 300px;
    `;

    document.body.appendChild(messageDiv);

    setTimeout(() => {
      if (messageDiv.parentNode) {
        messageDiv.remove();
      }
    }, 4000);
  }

  escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async refresh() {
    console.log("Refreshing Settings screen");
    await this.loadUsers();
    await this.loadSyncStatus();
    if (this.isDeveloperMode) {
      await this.loadDatabaseInfo();
    }
  }

  async destroy() {
    console.log("Settings screen destroyed");
  }
}
