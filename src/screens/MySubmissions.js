// My Submissions Screen - View and manage user's projects and drafts
import {
  getCurrentUser,
  getUsers,
  setCurrentUser,
  verifyCurrentUserPin,
  deleteUser,
} from "../utils/storage.js";
import {
  getProjectsByUser,
  getDraftsByProject,
  softDeleteProject,
} from "../utils/idb.js";

export class MySubmissions {
  constructor() {
    this.currentUser = null;
    this.allUsers = [];
    this.userProjects = [];
    this.expandedProjects = new Set();
    this.expandedDrafts = new Set();
  }

  async render(container) {
    console.log("Rendering My Submissions screen");

    // Load initial data
    await this.loadUsers();
    this.currentUser = getCurrentUser();

    container.innerHTML = `
      <div class="my-submissions-screen">
        <h1>📝 My Submissions</h1>
        
        <div class="user-selection-section">
          <div class="form-group">
            <label for="user-select">Select User:</label>
            <div class="dropdown-container">
              <div class="dropdown-button" id="user-select-btn">
                <span id="current-user-name">${
                  this.currentUser ? this.currentUser.name : "No user selected"
                }</span>
                <span>▼</span>
              </div>
              <div class="dropdown-content" id="user-dropdown">
                ${this.allUsers
                  .map(
                    (user) => `
                  <div class="dropdown-item" data-user-id="${user.id}">
                    ${this.escapeHtml(user.name)}
                  </div>
                `
                  )
                  .join("")}
                ${
                  this.allUsers.length === 0
                    ? '<div class="dropdown-item disabled">No users found</div>'
                    : ""
                }
              </div>
            </div>
          </div>
          
          ${
            !this.currentUser
              ? `
            <div class="no-user-message">
              <p>Please select a user or <a href="#/settings">create a new user in Settings</a> to view submissions.</p>
            </div>
          `
              : ""
          }
        </div>

        ${
          this.currentUser
            ? `
          <div class="projects-section">
            <div class="section-header">
              <h2>Projects for ${this.escapeHtml(this.currentUser.name)}</h2>
              <a href="#/submit" class="btn btn-primary">Create New Project</a>
            </div>
            
            <div id="projects-list" class="projects-list">
              <div class="loading">
                <div class="spinner"></div>
                Loading projects...
              </div>
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;

    this.setupEventListeners();

    if (this.currentUser) {
      await this.loadUserProjects();
    }
  }

  setupEventListeners() {
    // User dropdown toggle
    const dropdownBtn = document.getElementById("user-select-btn");
    const dropdown = document.getElementById("user-dropdown");

    if (dropdownBtn && dropdown) {
      dropdownBtn.addEventListener("click", () => {
        dropdown.classList.toggle("show");
      });

      // User selection
      dropdown.addEventListener("click", async (e) => {
        const userItem = e.target.closest(".dropdown-item");
        if (userItem && !userItem.classList.contains("disabled")) {
          const userId = userItem.dataset.userId;
          await this.selectUser(userId);
          dropdown.classList.remove("show");
        }
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown-container")) {
        if (dropdown) dropdown.classList.remove("show");
      }
    });
  }

  async loadUsers() {
    try {
      this.allUsers = await getUsers();
      console.log(`Loaded ${this.allUsers.length} users`);
    } catch (error) {
      console.error("Failed to load users:", error);
      this.allUsers = [];
    }
  }

  async selectUser(userId) {
    const user = this.allUsers.find((u) => u.id === userId);
    if (!user) return;

    this.currentUser = user;
    setCurrentUser(user);

    // Update UI
    const userNameSpan = document.getElementById("current-user-name");
    if (userNameSpan) {
      userNameSpan.textContent = user.name;
    }

    // Re-render to show projects section
    const container = document.querySelector(".my-submissions-screen");
    if (container) {
      await this.render(container.parentElement);
    }
  }

  async loadUserProjects() {
    if (!this.currentUser) return;

    const projectsList = document.getElementById("projects-list");
    if (!projectsList) return;

    try {
      this.userProjects = await getProjectsByUser(this.currentUser.id);
      console.log(
        `Loaded ${this.userProjects.length} projects for user ${this.currentUser.name}`
      );

      await this.renderProjectsList();
    } catch (error) {
      console.error("Failed to load user projects:", error);
      projectsList.innerHTML = `
        <div class="error-message">
          <p>❌ Failed to load projects</p>
          <p>Please try again later.</p>
        </div>
      `;
    }
  }

  async renderProjectsList() {
    const projectsList = document.getElementById("projects-list");
    if (!projectsList) return;

    if (this.userProjects.length === 0) {
      projectsList.innerHTML = `
        <div class="empty-state">
          <p>📝 No projects yet</p>
          <p>Start by <a href="#/submit">creating your first project</a>!</p>
        </div>
      `;
      return;
    }

    let html = '<div class="projects-container">';

    for (const project of this.userProjects) {
      const drafts = await getDraftsByProject(project.id);
      const isExpanded = this.expandedProjects.has(project.id);

      html += this.renderProjectItem(project, drafts, isExpanded);
    }

    html += "</div>";
    projectsList.innerHTML = html;

    // Add event listeners
    this.setupProjectEventListeners();
  }

  renderProjectItem(project, drafts, isExpanded) {
    const sortedDrafts = drafts.sort((a, b) => a.draftNumber - b.draftNumber);
    const finalDraft = sortedDrafts.find((d) => d.draftNumber === 3);
    const isFinal = finalDraft && finalDraft.score !== null;

    return `
      <div class="project-card card">
        <div class="project-header" data-project-id="${project.id}">
          <div class="project-info">
            <h3>${this.escapeHtml(project.name)}</h3>
            <div class="project-meta">
              <span class="created-date">Created: ${new Date(
                project.createdAt
              ).toLocaleDateString()}</span>
              <span class="draft-count">${drafts.length} draft${
      drafts.length !== 1 ? "s" : ""
    }</span>
              ${isFinal ? '<span class="final-badge">FINAL</span>' : ""}
            </div>
          </div>
          <div class="project-actions">
            <button class="btn btn-small btn-secondary expand-btn" data-project-id="${
              project.id
            }">
              ${isExpanded ? "▲" : "▼"} ${isExpanded ? "Collapse" : "Expand"}
            </button>
            <button class="btn btn-small btn-danger delete-project-btn" data-project-id="${
              project.id
            }">
              Delete
            </button>
          </div>
        </div>
        
        ${
          isExpanded
            ? `
          <div class="project-content">
            <div class="drafts-list">
              ${sortedDrafts
                .map((draft) => this.renderDraftItem(draft, project.id))
                .join("")}
            </div>
            
            ${
              !isFinal && drafts.length > 0
                ? `
              <div class="continue-project">
                <a href="#/submit?project=${
                  project.id
                }" class="btn btn-primary">
                  Continue Project (Draft ${drafts.length + 1})
                </a>
              </div>
            `
                : ""
            }
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  renderDraftItem(draft, projectId) {
    const isExpanded = this.expandedDrafts.has(draft.id);
    const scoreClass =
      draft.score >= 85
        ? "score-high"
        : draft.score >= 70
        ? "score-medium"
        : "score-low";

    return `
      <div class="draft-item">
        <div class="draft-header" data-draft-id="${draft.id}">
          <div class="draft-info">
            <span class="draft-number">Draft ${draft.draftNumber}</span>
            ${
              draft.score !== null
                ? `
              <span class="score-badge ${scoreClass}">${draft.score}/100</span>
            `
                : ""
            }
            <span class="draft-date">${new Date(
              draft.createdAt
            ).toLocaleDateString()}</span>
          </div>
          <button class="btn btn-small btn-secondary expand-draft-btn" data-draft-id="${
            draft.id
          }">
            ${isExpanded ? "▲" : "▼"}
          </button>
        </div>
        
        ${
          isExpanded
            ? `
          <div class="draft-content">
            ${
              draft.aiFeedback
                ? `
              <div class="ai-feedback">
                <h4>AI Feedback</h4>
                
                ${
                  draft.aiFeedback.pros
                    ? `
                  <div class="feedback-section feedback-pros">
                    <h5>✅ Strengths</h5>
                    <ul>
                      ${draft.aiFeedback.pros
                        .map((pro) => `<li>${this.escapeHtml(pro)}</li>`)
                        .join("")}
                    </ul>
                  </div>
                `
                    : ""
                }
                
                ${
                  draft.aiFeedback.cons
                    ? `
                  <div class="feedback-section feedback-cons">
                    <h5>⚠️ Areas for Improvement</h5>
                    <ul>
                      ${draft.aiFeedback.cons
                        .map((con) => `<li>${this.escapeHtml(con)}</li>`)
                        .join("")}
                    </ul>
                  </div>
                `
                    : ""
                }
                
                ${
                  draft.aiFeedback.nextSteps
                    ? `
                  <div class="feedback-section feedback-next-steps">
                    <h5>🎯 Next Steps</h5>
                    <ul>
                      ${draft.aiFeedback.nextSteps
                        .map((step) => `<li>${this.escapeHtml(step)}</li>`)
                        .join("")}
                    </ul>
                  </div>
                `
                    : ""
                }
                
                ${
                  draft.aiFeedback.whyScore
                    ? `
                  <div class="feedback-section">
                    <h5>📊 Why This Score</h5>
                    <p>${this.escapeHtml(draft.aiFeedback.whyScore)}</p>
                  </div>
                `
                    : ""
                }
              </div>
            `
                : ""
            }
            
            <div class="draft-answers">
              <h4>Responses</h4>
              ${Object.entries(draft.answers)
                .map(
                  ([question, answer]) => `
                <div class="answer-item">
                  <strong>${this.formatQuestionKey(question)}:</strong>
                  <p>${this.escapeHtml(answer)}</p>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
  }

  setupProjectEventListeners() {
    const projectsList = document.getElementById("projects-list");
    if (!projectsList) return;

    // Project expand/collapse
    projectsList.addEventListener("click", async (e) => {
      if (e.target.classList.contains("expand-btn")) {
        const projectId = e.target.dataset.projectId;
        await this.toggleProject(projectId);
      }

      if (e.target.classList.contains("expand-draft-btn")) {
        const draftId = e.target.dataset.draftId;
        this.toggleDraft(draftId);
      }

      if (e.target.classList.contains("delete-project-btn")) {
        const projectId = e.target.dataset.projectId;
        await this.deleteProject(projectId);
      }
    });
  }

  async toggleProject(projectId) {
    if (this.expandedProjects.has(projectId)) {
      this.expandedProjects.delete(projectId);
    } else {
      this.expandedProjects.add(projectId);
    }

    await this.renderProjectsList();
  }

  toggleDraft(draftId) {
    if (this.expandedDrafts.has(draftId)) {
      this.expandedDrafts.delete(draftId);
    } else {
      this.expandedDrafts.add(draftId);
    }

    // Re-render just the projects list
    this.renderProjectsList();
  }

  async deleteProject(projectId) {
    const project = this.userProjects.find((p) => p.id === projectId);
    if (!project) return;

    // Show PIN confirmation modal
    const confirmed = await this.showPinConfirmation(
      `Delete Project: ${project.name}`,
      "This will permanently delete the project and all its drafts. Enter your PIN to confirm:"
    );

    if (confirmed) {
      try {
        await softDeleteProject(projectId);
        console.log(`Project ${project.name} deleted`);

        // Reload projects
        await this.loadUserProjects();

        this.showMessage("Project deleted successfully", "success");
      } catch (error) {
        console.error("Failed to delete project:", error);
        this.showMessage("Failed to delete project", "error");
      }
    }
  }

  async showPinConfirmation(title, message) {
    return new Promise((resolve) => {
      const modal = this.createModal(
        title,
        `
        <p>${message}</p>
        <div class="form-group">
          <input type="password" id="pin-input" placeholder="Enter your PIN" class="pin-input">
        </div>
        <div class="modal-actions">
          <button class="btn btn-danger" id="confirm-pin-btn">Confirm Delete</button>
          <button class="btn btn-secondary" id="cancel-pin-btn">Cancel</button>
        </div>
        <div id="pin-error" class="error-message" style="display: none;"></div>
      `
      );

      const pinInput = document.getElementById("pin-input");
      const confirmBtn = document.getElementById("confirm-pin-btn");
      const cancelBtn = document.getElementById("cancel-pin-btn");
      const errorDiv = document.getElementById("pin-error");

      const cleanup = () => {
        modal.style.display = "none";
      };

      confirmBtn.addEventListener("click", async () => {
        const pin = pinInput.value;
        if (!pin) {
          errorDiv.textContent = "Please enter your PIN";
          errorDiv.style.display = "block";
          return;
        }

        try {
          const isValid = await verifyCurrentUserPin(pin);
          if (isValid) {
            cleanup();
            resolve(true);
          } else {
            errorDiv.textContent = "Incorrect PIN";
            errorDiv.style.display = "block";
            pinInput.value = "";
          }
        } catch (error) {
          errorDiv.textContent = "Error verifying PIN";
          errorDiv.style.display = "block";
        }
      });

      cancelBtn.addEventListener("click", () => {
        cleanup();
        resolve(false);
      });

      // Focus on PIN input
      setTimeout(() => pinInput.focus(), 100);
    });
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
    // Create temporary message element
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
          : "#17a2b8"
      };
      color: white;
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
    }, 3000);
  }

  formatQuestionKey(key) {
    // Convert camelCase/snake_case to readable format
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase())
      .trim();
  }

  escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async refresh() {
    console.log("Refreshing My Submissions screen");
    await this.loadUsers();
    if (this.currentUser) {
      await this.loadUserProjects();
    }
  }

  async destroy() {
    console.log("My Submissions screen destroyed");
  }
}
