// Submit Idea Screen - Create and manage project drafts
import {
  getCurrentUser,
  getUsers,
  setCurrentUser,
  createNewUser,
  loginUser,
  getErrorMessage,
} from "../utils/storage.js";
import {
  createProject,
  getProjectsByUser,
  getProjectById,
  createDraft,
  getDraftsByProject,
  updateDraft,
} from "../utils/idb.js";
import { postOpenAI } from "../api/netlifyProxy.js";
import { enqueueFinalSubmit } from "../utils/syncQueue.js";
import { formatProjectForSubmission } from "../api/supabaseClient.js";

export class SubmitIdea {
  constructor() {
    this.currentUser = null;
    this.allUsers = [];
    this.userProjects = [];
    this.selectedProject = null;
    this.currentDraft = null;
    this.isSubmitting = false;
    this.draftQuestions = this.getDraftQuestions();
  }

  async render(container) {
    console.log("Rendering Submit Idea screen");

    // Load initial data
    await this.loadUsers();
    this.currentUser = getCurrentUser();

    // Check for URL parameters (continuing existing project)
    const urlParams = new URLSearchParams(
      window.location.hash.split("?")[1] || ""
    );
    const projectId = urlParams.get("project");

    container.innerHTML = `
      <div class="submit-idea-screen">
        <div class="greeting-section">
          <h1>💡 Submit Your Ideas</h1>
          <p class="greeting-text">Turn your innovative ideas into reality with AI-powered feedback!</p>
          ${
            this.currentUser
              ? `<p class="user-greeting">Hi <strong>${this.escapeHtml(
                  this.currentUser.name
                )}</strong>! 👋</p>`
              : ""
          }
        </div>

        <div class="selection-section">
          <div class="selection-row">
            <div class="dropdown-group">
              <label>Select User:</label>
              <div class="dropdown-container">
                <div class="dropdown-button" id="user-select-btn">
                  <span id="current-user-name">${
                    this.currentUser
                      ? this.escapeHtml(this.currentUser.name)
                      : "No user selected"
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
                </div>
              </div>
              <button class="btn btn-secondary btn-small" id="create-user-btn">Create New User</button>
            </div>

            ${
              this.currentUser
                ? `
              <div class="dropdown-group">
                <label>Select Project:</label>
                <div class="dropdown-container">
                  <div class="dropdown-button" id="project-select-btn">
                    <span id="current-project-name">${
                      this.selectedProject
                        ? this.escapeHtml(this.selectedProject.name)
                        : "No project selected"
                    }</span>
                    <span>▼</span>
                  </div>
                  <div class="dropdown-content" id="project-dropdown">
                    <div class="loading">Loading projects...</div>
                  </div>
                </div>
                <button class="btn btn-secondary btn-small" id="create-project-btn">Create New Project</button>
              </div>
            `
                : ""
            }
          </div>
        </div>

        ${
          !this.currentUser
            ? `
          <div class="no-selection-message">
            <p>Please select or create a user to start submitting ideas.</p>
          </div>
        `
            : !this.selectedProject
            ? `
          <div class="no-selection-message">
            <p>Please select or create a project to continue.</p>
          </div>
        `
            : `
          <div class="draft-section">
            <div id="draft-content">
              <div class="loading">
                <div class="spinner"></div>
                Loading draft...
              </div>
            </div>
          </div>
        `
        }
      </div>
    `;

    this.setupEventListeners();

    if (this.currentUser) {
      await this.loadUserProjects();

      // Handle project from URL parameter
      if (projectId) {
        await this.selectProjectById(projectId);
      }
    }
  }

  getDraftQuestions() {
    return {
      1: [
        {
          key: "target_users",
          label: "Who does this product help?",
          type: "textarea",
          required: true,
          placeholder: "Describe your target users and their needs...",
        },
        {
          key: "current_solutions",
          label: "What are people using now that works? How is it limited?",
          type: "textarea",
          required: true,
          placeholder: "Explain existing solutions and their limitations...",
        },
        {
          key: "product_advantages",
          label: "How is your product better?",
          type: "textarea",
          required: true,
          placeholder: "Describe what makes your solution superior...",
        },
        {
          key: "core_problem",
          label: "What is the core problem you are solving?",
          type: "textarea",
          required: true,
          placeholder: "Define the main problem clearly and specifically...",
        },
        {
          key: "solution_description",
          label: "What is your solution (describe features & user flow)?",
          type: "textarea",
          required: true,
          placeholder:
            "Detail your solution, key features, and how users interact with it...",
        },
        {
          key: "discovery_method",
          label: "How did you find Capsera?",
          type: "textarea",
          required: true,
          placeholder: "Tell us how you discovered this platform...",
        },
        {
          key: "product_image",
          label:
            "Would you like to upload an image? (optional, for physical products)",
          type: "text",
          required: false,
          placeholder: "Image URL or description...",
        },
      ],
      2: [
        {
          key: "market_validation",
          label:
            "Did you conduct any market validation or customer interviews? If yes, summarize results. If no, why not?",
          type: "textarea",
          required: true,
          placeholder: "Describe your market research and customer feedback...",
        },
        {
          key: "competitor_research",
          label: "How thoroughly did you research competitors?",
          type: "textarea",
          required: true,
          placeholder: "Explain your competitive analysis and findings...",
        },
        {
          key: "mvp_development",
          label:
            "Did you develop an MVP (website/app)? If yes, provide link; if no, optional reason.",
          type: "textarea",
          required: true,
          placeholder: "Share your MVP link or explain development status...",
        },
        {
          key: "draft_improvements",
          label:
            "What changes did you make in this draft compared to Draft 1? (reference specific previous feedback)",
          type: "textarea",
          required: true,
          placeholder: "Describe improvements based on previous AI feedback...",
        },
      ],
      3: [
        {
          key: "investor_pitch",
          label: "Pitch your idea like you're talking to an investor",
          type: "textarea",
          required: true,
          placeholder:
            "Example: \"Our app helps busy parents find healthy meal options in 30 seconds. We've validated this with 100+ interviews and have 500 beta users with 40% weekly retention. We're seeking $100K to hire developers and reach 10,000 users by year-end.\" Now write your pitch...",
          rows: 6,
        },
        {
          key: "research_evidence",
          label: "What research have you done? (evidence, links)",
          type: "textarea",
          required: true,
          placeholder:
            "Provide specific research, data, links, and evidence supporting your idea...",
        },
        {
          key: "mvp_link",
          label: "Did you develop an MVP? If yes, link.",
          type: "text",
          required: false,
          placeholder: "https://your-mvp-link.com",
        },
      ],
    };
  }

  setupEventListeners() {
    // User dropdown
    const userDropdownBtn = document.getElementById("user-select-btn");
    const userDropdown = document.getElementById("user-dropdown");

    if (userDropdownBtn && userDropdown) {
      userDropdownBtn.addEventListener("click", () => {
        userDropdown.classList.toggle("show");
      });

      userDropdown.addEventListener("click", async (e) => {
        const userItem = e.target.closest(".dropdown-item");
        if (userItem && !userItem.classList.contains("disabled")) {
          const userId = userItem.dataset.userId;
          await this.selectUser(userId);
          userDropdown.classList.remove("show");
        }
      });
    }

    // Project dropdown (will be set up after user selection)
    const projectDropdownBtn = document.getElementById("project-select-btn");
    const projectDropdown = document.getElementById("project-dropdown");

    if (projectDropdownBtn && projectDropdown) {
      projectDropdownBtn.addEventListener("click", () => {
        projectDropdown.classList.toggle("show");
      });

      projectDropdown.addEventListener("click", async (e) => {
        const projectItem = e.target.closest(".dropdown-item");
        if (projectItem && !projectItem.classList.contains("disabled")) {
          const projectId = projectItem.dataset.projectId;
          await this.selectProject(projectId);
          projectDropdown.classList.remove("show");
        }
      });
    }

    // Create buttons
    const createUserBtn = document.getElementById("create-user-btn");
    const createProjectBtn = document.getElementById("create-project-btn");

    if (createUserBtn) {
      createUserBtn.addEventListener("click", () => this.showCreateUserModal());
    }

    if (createProjectBtn) {
      createProjectBtn.addEventListener("click", () =>
        this.showCreateProjectModal()
      );
    }

    // Close dropdowns when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown-container")) {
        document
          .querySelectorAll(".dropdown-content.show")
          .forEach((dropdown) => {
            dropdown.classList.remove("show");
          });
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

    // Reset project selection
    this.selectedProject = null;

    // Re-render to show project dropdown
    const container = document.querySelector(".submit-idea-screen");
    if (container) {
      await this.render(container.parentElement);
    }
  }

  async loadUserProjects() {
    if (!this.currentUser) return;

    try {
      this.userProjects = await getProjectsByUser(this.currentUser.id);
      console.log(
        `Loaded ${this.userProjects.length} projects for user ${this.currentUser.name}`
      );

      this.updateProjectDropdown();
    } catch (error) {
      console.error("Failed to load user projects:", error);
      this.userProjects = [];
    }
  }

  updateProjectDropdown() {
    const projectDropdown = document.getElementById("project-dropdown");
    if (!projectDropdown) return;

    if (this.userProjects.length === 0) {
      projectDropdown.innerHTML =
        '<div class="dropdown-item disabled">No projects found</div>';
      return;
    }

    projectDropdown.innerHTML = this.userProjects
      .map(
        (project) => `
      <div class="dropdown-item" data-project-id="${project.id}">
        ${this.escapeHtml(project.name)}
      </div>
    `
      )
      .join("");
  }

  async selectProject(projectId) {
    const project = this.userProjects.find((p) => p.id === projectId);
    if (!project) return;

    this.selectedProject = project;

    // Update UI
    const projectNameSpan = document.getElementById("current-project-name");
    if (projectNameSpan) {
      projectNameSpan.textContent = project.name;
    }

    // Load draft content
    await this.loadDraftContent();
  }

  async selectProjectById(projectId) {
    if (!this.currentUser) return;

    try {
      const project = await getProjectById(projectId);
      if (project && project.userId === this.currentUser.id) {
        this.selectedProject = project;

        // Update UI if elements exist
        const projectNameSpan = document.getElementById("current-project-name");
        if (projectNameSpan) {
          projectNameSpan.textContent = project.name;
        }

        await this.loadDraftContent();
      }
    } catch (error) {
      console.error("Failed to load project by ID:", error);
    }
  }

  async loadDraftContent() {
    if (!this.selectedProject) return;

    const draftContentDiv = document.getElementById("draft-content");
    if (!draftContentDiv) return;

    try {
      // Get existing drafts for this project
      const drafts = await getDraftsByProject(this.selectedProject.id);
      const sortedDrafts = drafts.sort((a, b) => a.draftNumber - b.draftNumber);

      // Determine next draft number
      const nextDraftNumber = sortedDrafts.length + 1;

      if (nextDraftNumber > 3) {
        // Project is completed
        this.renderCompletedProject(sortedDrafts);
      } else {
        // Show next draft form
        this.renderDraftForm(nextDraftNumber, sortedDrafts);
      }
    } catch (error) {
      console.error("Failed to load draft content:", error);
      draftContentDiv.innerHTML = `
        <div class="error-message">
          <p>Failed to load draft content. Please try again.</p>
        </div>
      `;
    }
  }

  renderDraftForm(draftNumber, previousDrafts) {
    const draftContentDiv = document.getElementById("draft-content");
    if (!draftContentDiv) return;

    const questions = this.draftQuestions[draftNumber];
    const isFirstDraft = draftNumber === 1;
    const isFinalDraft = draftNumber === 3;

    let html = `
      <div class="draft-form-container">
        <div class="draft-header">
          <h2>Draft ${draftNumber} ${isFinalDraft ? "(Final)" : ""}</h2>
          <p class="draft-description">
            ${this.getDraftDescription(draftNumber)}
          </p>
        </div>

        ${
          !isFirstDraft
            ? `
          <div class="previous-drafts-section">
            <h3>Previous Drafts (for reference)</h3>
            <div class="previous-drafts-container">
              ${previousDrafts
                .map((draft) => this.renderPreviousDraftSummary(draft))
                .join("")}
            </div>
          </div>
        `
            : ""
        }

        ${
          draftNumber === 2
            ? `
          <div class="instruction-box">
            <h4>Before Draft 2:</h4>
            <p><strong>Conduct customer interviews</strong> - try to talk to at least 3 potential users and note what they say. Draft 2 will ask whether you did interviews and what you learned.</p>
          </div>
        `
            : ""
        }

        <form id="draft-form" class="draft-form">
          ${questions.map((question) => this.renderQuestion(question)).join("")}
          
          <div class="form-actions">
            <button type="submit" class="btn btn-primary" id="submit-draft-btn">
              ${
                isFinalDraft
                  ? "Submit Final Draft"
                  : `Submit Draft ${draftNumber}`
              }
            </button>
            <button type="button" class="btn btn-secondary" id="save-draft-btn">
              Save as Draft
            </button>
          </div>
          
          <div id="submission-status" class="submission-status"></div>
        </form>
      </div>
    `;

    draftContentDiv.innerHTML = html;
    this.setupDraftFormListeners(draftNumber, previousDrafts);
  }

  renderCompletedProject(drafts) {
    const draftContentDiv = document.getElementById("draft-content");
    if (!draftContentDiv) return;

    const finalDraft = drafts.find((d) => d.draftNumber === 3);

    draftContentDiv.innerHTML = `
      <div class="completed-project">
        <div class="completion-header">
          <h2>🎉 Project Completed!</h2>
          <p>You have successfully completed all 3 drafts for this project.</p>
        </div>

        <div class="final-score-section">
          <h3>Final Score</h3>
          ${
            finalDraft && finalDraft.score !== null
              ? `
            <div class="score-display">
              <span class="score-badge ${
                finalDraft.score >= 85
                  ? "score-high"
                  : finalDraft.score >= 70
                  ? "score-medium"
                  : "score-low"
              }">
                ${finalDraft.score}/100
              </span>
            </div>
          `
              : `
            <p>Score pending...</p>
          `
          }
        </div>

        <div class="project-summary">
          <h3>Project Journey</h3>
          ${drafts
            .map(
              (draft) => `
            <div class="draft-summary">
              <h4>Draft ${draft.draftNumber} 
                ${
                  draft.score !== null
                    ? `<span class="score-badge ${
                        draft.score >= 85
                          ? "score-high"
                          : draft.score >= 70
                          ? "score-medium"
                          : "score-low"
                      }">${draft.score}</span>`
                    : ""
                }
              </h4>
              <p>Completed: ${new Date(
                draft.createdAt
              ).toLocaleDateString()}</p>
            </div>
          `
            )
            .join("")}
        </div>

        <div class="next-steps">
          <h3>What's Next?</h3>
          <p>Your final submission is now part of the global ideas pool. You can:</p>
          <ul>
            <li><a href="#/">View it in Global Ideas</a></li>
            <li><a href="#/my">Check detailed feedback in My Submissions</a></li>
            <li><a href="#/submit">Start a new project</a></li>
          </ul>
        </div>
      </div>
    `;
  }

  renderPreviousDraftSummary(draft) {
    return `
      <div class="previous-draft">
        <h4>Draft ${draft.draftNumber} 
          ${
            draft.score !== null
              ? `<span class="score-badge ${
                  draft.score >= 85
                    ? "score-high"
                    : draft.score >= 70
                    ? "score-medium"
                    : "score-low"
                }">${draft.score}</span>`
              : ""
          }
        </h4>
        <div class="draft-answers-preview">
          ${Object.entries(draft.answers)
            .slice(0, 2)
            .map(
              ([key, value]) => `
            <p><strong>${this.formatQuestionKey(
              key
            )}:</strong> ${this.truncateText(value, 100)}</p>
          `
            )
            .join("")}
          ${
            Object.keys(draft.answers).length > 2
              ? "<p><em>...and more</em></p>"
              : ""
          }
        </div>
      </div>
    `;
  }

  renderQuestion(question) {
    const inputId = `question-${question.key}`;

    if (question.type === "textarea") {
      return `
        <div class="form-group">
          <label for="${inputId}">${question.label} ${
        question.required ? "*" : ""
      }</label>
          <textarea 
            id="${inputId}" 
            name="${question.key}" 
            ${question.required ? "required" : ""}
            rows="${question.rows || 4}"
            placeholder="${question.placeholder || ""}"
          ></textarea>
        </div>
      `;
    } else {
      return `
        <div class="form-group">
          <label for="${inputId}">${question.label} ${
        question.required ? "*" : ""
      }</label>
          <input 
            type="${question.type}" 
            id="${inputId}" 
            name="${question.key}" 
            ${question.required ? "required" : ""}
            placeholder="${question.placeholder || ""}"
          >
        </div>
      `;
    }
  }

  setupDraftFormListeners(draftNumber, previousDrafts) {
    const form = document.getElementById("draft-form");
    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleDraftSubmission(draftNumber, previousDrafts, false);
    });

    const saveDraftBtn = document.getElementById("save-draft-btn");
    if (saveDraftBtn) {
      saveDraftBtn.addEventListener("click", (e) => {
        e.preventDefault();
        this.handleDraftSubmission(draftNumber, previousDrafts, true);
      });
    }
  }

  async handleDraftSubmission(draftNumber, previousDrafts, saveOnly = false) {
    if (this.isSubmitting) return;

    this.isSubmitting = true;

    const submitBtn = document.getElementById("submit-draft-btn");
    const saveDraftBtn = document.getElementById("save-draft-btn");
    const statusDiv = document.getElementById("submission-status");

    // Update UI
    if (submitBtn) submitBtn.disabled = true;
    if (saveDraftBtn) saveDraftBtn.disabled = true;
    if (statusDiv)
      statusDiv.innerHTML =
        '<div class="loading"><div class="spinner"></div>Processing...</div>';

    try {
      // Collect form data
      const formData = new FormData(document.getElementById("draft-form"));
      const answers = {};

      for (const [key, value] of formData.entries()) {
        answers[key] = value.trim();
      }

      // Create draft record
      const draftData = {
        projectId: this.selectedProject.id,
        draftNumber,
        answers,
        previousDraftId:
          previousDrafts.length > 0
            ? previousDrafts[previousDrafts.length - 1].id
            : null,
      };

      const draft = await createDraft(draftData);
      console.log(`Draft ${draftNumber} created:`, draft.id);

      if (saveOnly) {
        if (statusDiv) {
          statusDiv.innerHTML =
            '<div class="success-message">✅ Draft saved successfully!</div>';
        }
      } else {
        // Get AI feedback
        await this.processAIFeedback(draft, previousDrafts);

        // Handle final submission if this is draft 3
        if (draftNumber === 3) {
          await this.handleFinalSubmission(draft, previousDrafts);
        }
      }

      // Refresh the view
      setTimeout(() => {
        this.loadDraftContent();
      }, 2000);
    } catch (error) {
      console.error("Failed to submit draft:", error);
      if (statusDiv) {
        statusDiv.innerHTML = `<div class="error-message">❌ ${
          error.message || "Failed to submit draft"
        }</div>`;
      }
    } finally {
      this.isSubmitting = false;
      if (submitBtn) submitBtn.disabled = false;
      if (saveDraftBtn) saveDraftBtn.disabled = false;
    }
  }

  async processAIFeedback(draft, previousDrafts) {
    const statusDiv = document.getElementById("submission-status");
    if (statusDiv) {
      statusDiv.innerHTML =
        '<div class="loading"><div class="spinner"></div>Getting AI feedback...</div>';
    }

    try {
      // Prepare prompt for OpenAI
      const prompt = this.buildAIPrompt(draft, previousDrafts);

      // Get previous scores for context
      const previousScores = previousDrafts
        .map((d) => d.score)
        .filter((s) => s !== null);

      // Call OpenAI API
      const aiResult = await postOpenAI(prompt, draft.draftNumber, {
        previousScores,
        detailed: draft.draftNumber === 3,
      });

      // Update draft with AI feedback
      await updateDraft(draft.id, {
        score: aiResult.score,
        aiFeedback: aiResult.aiFeedback,
      });

      console.log(
        `AI feedback received for draft ${draft.draftNumber}: ${aiResult.score}/100`
      );

      if (statusDiv) {
        statusDiv.innerHTML = `
          <div class="success-message">
            ✅ Draft submitted successfully! 
            <br>Score: <span class="score-badge ${
              aiResult.score >= 85
                ? "score-high"
                : aiResult.score >= 70
                ? "score-medium"
                : "score-low"
            }">${aiResult.score}/100</span>
          </div>
        `;
      }
    } catch (error) {
      console.error("Failed to get AI feedback:", error);

      // Update draft without AI feedback (user can still continue)
      await updateDraft(draft.id, {
        score: null,
        aiFeedback: null,
      });

      if (statusDiv) {
        statusDiv.innerHTML =
          '<div class="warning-message">⚠️ Draft saved but AI feedback unavailable. You can continue to the next draft.</div>';
      }
    }
  }

  async handleFinalSubmission(finalDraft, previousDrafts) {
    console.log("Handling final submission...");

    try {
      // Prepare final project data
      const allDrafts = [...previousDrafts, finalDraft];
      const projectData = formatProjectForSubmission(
        this.selectedProject,
        allDrafts,
        this.currentUser
      );

      // Queue for submission to Supabase
      await enqueueFinalSubmit(projectData);

      console.log("Final project queued for submission");
    } catch (error) {
      console.error("Failed to queue final submission:", error);
      // Don't block the user - they can still see their completed project
    }
  }

  buildAIPrompt(draft, previousDrafts) {
    let prompt = `Draft ${draft.draftNumber} Submission:\n\n`;

    // Add current draft answers
    Object.entries(draft.answers).forEach(([key, value]) => {
      prompt += `${this.formatQuestionKey(key)}: ${value}\n\n`;
    });

    // Add context from previous drafts if available
    if (previousDrafts.length > 0) {
      prompt += "\n--- Previous Drafts for Context ---\n";
      previousDrafts.forEach((prevDraft) => {
        prompt += `\nDraft ${prevDraft.draftNumber} (Score: ${
          prevDraft.score || "N/A"
        }):\n`;
        Object.entries(prevDraft.answers).forEach(([key, value]) => {
          prompt += `${this.formatQuestionKey(key)}: ${value.substring(
            0,
            200
          )}...\n`;
        });
      });
    }

    return prompt;
  }

  getDraftDescription(draftNumber) {
    const descriptions = {
      1: "Start with your initial idea. Focus on clearly describing the problem and your proposed solution.",
      2: "Build on your first draft with market research and validation. Show how you've improved your idea.",
      3: "Final pitch-ready version. Include all research, evidence, and present like you're talking to an investor.",
    };
    return descriptions[draftNumber] || "";
  }

  showCreateUserModal() {
    const modal = this.createModal(
      "Create New User",
      `
      <form id="create-user-form">
        <div class="form-group">
          <label for="new-user-name">Name *</label>
          <input type="text" id="new-user-name" name="name" required placeholder="Your name">
        </div>
        
        <div class="form-group">
          <label for="new-user-pin">PIN (4+ characters) *</label>
          <input type="password" id="new-user-pin" name="pin" required placeholder="Create a PIN">
        </div>
        
        <div class="form-group">
          <label for="new-user-safety">Safety Code *</label>
          <input type="password" id="new-user-safety" name="safetyCode" required placeholder="Safety code for PIN recovery">
        </div>
        
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create User</button>
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').style.display='none'">Cancel</button>
        </div>
        
        <div id="create-user-error" class="error-message" style="display: none;"></div>
      </form>
    `
    );

    const form = document.getElementById("create-user-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleCreateUser(e);
      });
    }
  }

  async handleCreateUser(event) {
    const formData = new FormData(event.target);
    const name = formData.get("name").trim();
    const pin = formData.get("pin");
    const safetyCode = formData.get("safetyCode");

    const errorDiv = document.getElementById("create-user-error");

    try {
      const newUser = await createNewUser(name, pin, safetyCode);
      console.log("New user created:", newUser.name);

      // Update local state
      await this.loadUsers();
      await this.selectUser(newUser.id);

      // Close modal
      document.getElementById("modal-overlay").style.display = "none";
    } catch (error) {
      console.error("Failed to create user:", error);
      if (errorDiv) {
        errorDiv.textContent = getErrorMessage(error.message);
        errorDiv.style.display = "block";
      }
    }
  }

  showCreateProjectModal() {
    if (!this.currentUser) {
      alert("Please select a user first");
      return;
    }

    const modal = this.createModal(
      "Create New Project",
      `
      <form id="create-project-form">
        <div class="form-group">
          <label for="new-project-name">Project Name *</label>
          <input type="text" id="new-project-name" name="name" required placeholder="Enter project name">
        </div>
        
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Create Project</button>
          <button type="button" class="btn btn-secondary" onclick="this.closest('.modal-overlay').style.display='none'">Cancel</button>
        </div>
        
        <div id="create-project-error" class="error-message" style="display: none;"></div>
      </form>
    `
    );

    const form = document.getElementById("create-project-form");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        await this.handleCreateProject(e);
      });
    }
  }

  async handleCreateProject(event) {
    const formData = new FormData(event.target);
    const name = formData.get("name").trim();

    const errorDiv = document.getElementById("create-project-error");

    if (!name) {
      if (errorDiv) {
        errorDiv.textContent = "Project name is required";
        errorDiv.style.display = "block";
      }
      return;
    }

    try {
      const newProject = await createProject({
        userId: this.currentUser.id,
        name,
      });

      console.log("New project created:", newProject.name);

      // Update local state
      await this.loadUserProjects();
      await this.selectProject(newProject.id);

      // Close modal
      document.getElementById("modal-overlay").style.display = "none";
    } catch (error) {
      console.error("Failed to create project:", error);
      if (errorDiv) {
        errorDiv.textContent = getErrorMessage(error.message);
        errorDiv.style.display = "block";
      }
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

  formatQuestionKey(key) {
    return key
      .replace(/([A-Z])/g, " $1")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase())
      .trim();
  }

  truncateText(text, maxLength) {
    if (!text) return "";
    return text.length > maxLength
      ? text.substring(0, maxLength) + "..."
      : text;
  }

  escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async refresh() {
    console.log("Refreshing Submit Idea screen");
    await this.loadUsers();
    if (this.currentUser) {
      await this.loadUserProjects();
      if (this.selectedProject) {
        await this.loadDraftContent();
      }
    }
  }

  async destroy() {
    console.log("Submit Idea screen destroyed");
  }
}
