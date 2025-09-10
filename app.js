// Capsera PWA - Main Application Logic
// Mobile-first offline-capable idea submission app

class CapseraApp {
  constructor() {
    this.currentScreen = "global";
    this.currentUser = null;
    this.currentProject = null;
    this.supabase = null;
    this.translations = {};
    this.currentLanguage = "en";

    this.init();
  }

  async init() {
    // Initialize Supabase client
    if (window.ENV && window.ENV.SUPABASE_URL && window.supabase) {
      this.supabase = window.supabase.createClient(
        window.ENV.SUPABASE_URL,
        window.ENV.SUPABASE_ANON_KEY
      );
    }

    // Load saved settings
    this.loadSettings();

    // Setup event listeners
    this.setupEventListeners();

    // Show initial screen
    this.showScreen("global");

    // Load global ideas
    this.loadGlobalIdeas();
  }

  // Local Storage Management
  getUsers() {
    const data = localStorage.getItem("capsera_users");
    return data ? JSON.parse(data) : [];
  }

  saveUsers(users) {
    localStorage.setItem("capsera_users", JSON.stringify(users));
  }

  getProjects() {
    const data = localStorage.getItem("capsera_projects");
    return data ? JSON.parse(data) : [];
  }

  saveProjects(projects) {
    localStorage.setItem("capsera_projects", JSON.stringify(projects));
  }

  loadSettings() {
    const settings = localStorage.getItem("capsera_settings");
    if (settings) {
      const parsed = JSON.parse(settings);
      this.currentLanguage = parsed.language || "en";
      this.translations = parsed.translations || {};
    }
  }

  saveSettings() {
    const settings = {
      language: this.currentLanguage,
      translations: this.translations,
    };
    localStorage.setItem("capsera_settings", JSON.stringify(settings));
  }

  // User Management
  createUser(name, pin, safetyCode) {
    const users = this.getUsers();

    // Check for duplicate active usernames
    if (users.find((u) => u.name === name && !u.deleted)) {
      throw new Error("Username already exists");
    }

    const newUser = {
      id: "u" + Date.now(),
      name: name,
      pin: this.hashPin(pin),
      safetyCode: safetyCode,
      deleted: false,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);
    this.saveUsers(users);
    return newUser;
  }

  deleteUser(userId, pin) {
    const users = this.getUsers();
    const user = users.find((u) => u.id === userId);

    if (!user || !this.verifyPin(pin, user.pin)) {
      throw new Error("Invalid pin");
    }

    // Soft delete user
    user.deleted = true;

    // Cascade delete: remove all local projects for this user
    const projects = this.getProjects();
    projects.forEach((p) => {
      if (p.userId === userId) {
        p.deleted = true;
      }
    });

    this.saveUsers(users);
    this.saveProjects(projects);

    // Mark final projects in Supabase as deleted_local_user
    this.markFinalProjectsDeleted(user.name);
  }

  async markFinalProjectsDeleted(userName) {
    if (!this.supabase) return;

    try {
      await this.supabase
        .from("projects_final")
        .update({ deleted_local_user: true })
        .eq("local_user_name", userName);
    } catch (error) {
      console.error("Error marking projects deleted:", error);
    }
  }

  changeUserPin(userId, safetyCode, newPin) {
    const users = this.getUsers();
    const user = users.find((u) => u.id === userId);

    if (!user || user.safetyCode !== safetyCode) {
      throw new Error("Invalid safety code");
    }

    user.pin = this.hashPin(newPin);
    this.saveUsers(users);
  }

  hashPin(pin) {
    // Simple hash for MVP - in production use proper bcrypt
    return btoa(pin + "capsera_salt").replace(/[^a-zA-Z0-9]/g, "");
  }

  verifyPin(inputPin, hashedPin) {
    return this.hashPin(inputPin) === hashedPin;
  }

  // Project Management
  createProject(userId, name) {
    const projects = this.getProjects();

    // Check for duplicate active project names for this user
    if (
      projects.find((p) => p.userId === userId && p.name === name && !p.deleted)
    ) {
      throw new Error("Project name already exists");
    }

    const newProject = {
      id: "p" + Date.now(),
      userId: userId,
      name: name,
      deleted: false,
      drafts: [],
      createdAt: new Date().toISOString(),
    };

    projects.push(newProject);
    this.saveProjects(projects);
    return newProject;
  }

  // Draft Management
  saveDraft(projectId, draftNumber, answers) {
    const projects = this.getProjects();
    const project = projects.find((p) => p.id === projectId);

    if (!project) throw new Error("Project not found");

    // Find existing draft or create new one
    let draft = project.drafts.find((d) => d.draftNumber === draftNumber);
    if (!draft) {
      draft = {
        draftNumber: draftNumber,
        answers: {},
        aiScore: null,
        aiFeedback: null,
        createdAt: new Date().toISOString(),
      };
      project.drafts.push(draft);
    }

    draft.answers = answers;
    draft.updatedAt = new Date().toISOString();

    this.saveProjects(projects);
    return draft;
  }

  async gradeDraft(projectId, draftNumber) {
    const projects = this.getProjects();
    const project = projects.find((p) => p.id === projectId);
    const draft = project.drafts.find((d) => d.draftNumber === draftNumber);

    if (!draft) throw new Error("Draft not found");

    // Get AI feedback (stub implementation)
    const feedback = await this.getAIFeedback(
      draft.answers,
      draftNumber,
      project.drafts
    );

    draft.aiScore = feedback.score;
    draft.aiFeedback = feedback.feedback;
    draft.gradedAt = new Date().toISOString();

    this.saveProjects(projects);

    // If this is draft 3 (final), submit to Supabase
    if (draftNumber === 3) {
      await this.submitFinalProject(project, draft);
    }

    return feedback;
  }

  async submitFinalProject(project, finalDraft) {
    if (!this.supabase) return;

    const user = this.getUsers().find((u) => u.id === project.userId);
    if (!user) return;

    try {
      const payload = {
        local_user_name: user.name,
        project_name: project.name,
        project_payload: {
          drafts: project.drafts,
          finalAnswers: finalDraft.answers,
          projectId: project.id,
        },
        ai_score: finalDraft.aiScore,
        ai_feedback: finalDraft.aiFeedback,
        contact_email: finalDraft.answers.contact_email || null,
      };

      await this.supabase.from("projects_final").insert([payload]);
    } catch (error) {
      console.error("Error submitting final project:", error);
    }
  }

  // AI Feedback System (Stub)
  async getAIFeedback(answers, draftNumber, allDrafts) {
    // Simulate OpenAI API call
    // In production, this would call Netlify function with process.env.OPENAI_API_KEY

    const previousDraft = allDrafts.find(
      (d) => d.draftNumber === draftNumber - 1
    );
    const previousScore = previousDraft ? previousDraft.aiScore : null;

    // Check for empty/spam submissions
    const answerValues = Object.values(answers).join(" ").trim();
    const isLowEffort =
      answerValues.length < 10 || /^[a-z1-9\s]{1,3}$/i.test(answerValues);

    let score, feedback;

    if (isLowEffort) {
      score = Math.floor(Math.random() * 20) + 50; // 50-70 for low effort
      feedback = this.generateLowEffortFeedback();
    } else {
      score = Math.floor(Math.random() * 30) + 70; // 70-100 for normal effort
      feedback = this.generateNormalFeedback(score, draftNumber, previousScore);
    }

    // Check for AI-generated content patterns
    if (this.detectAIContent(answerValues)) {
      feedback +=
        "\n\n💡 **Note:** This looks quite AI-like — check your environment and consider more real-world validation.";
    }

    return { score, feedback };
  }

  detectAIContent(text) {
    const aiPatterns = [
      /as an ai/i,
      /leverage synergies/i,
      /paradigm shift/i,
      /game-changer/i,
      /revolutionary platform/i,
    ];
    return aiPatterns.some((pattern) => pattern.test(text));
  }

  generateLowEffortFeedback() {
    return `**Feedback (Score: Low)**

**Areas for Improvement:**
• Your responses need more detail and thought
• Consider spending more time on each question
• Add specific examples and real-world context
• Research your target market thoroughly

**Next Steps:**
• Conduct at least 3 customer interviews
• Research 5 direct competitors
• Write detailed answers (50+ words each)
• Consider creating a simple prototype

Keep going! Every successful entrepreneur started with a first draft. 🚀`;
  }

  generateNormalFeedback(score, draftNumber, previousScore) {
    let feedback = `**Feedback (Score: ${score}/100)**\n\n`;

    if (previousScore && score > previousScore) {
      feedback += `🎉 **Great improvement!** Your score increased from ${previousScore} to ${score}!\n\n`;
    }

    if (score >= 80) {
      feedback += `**Strengths:**
• Strong problem identification
• Clear value proposition
• Good market understanding
• Solid execution plan

**Next Steps:**
• Build an MVP if you haven't already
• Get 10+ customer interviews
• Consider seeking mentorship
• Research funding opportunities`;
    } else {
      feedback += `**Strengths:**
• Good foundation for your idea
• Clear passion for the problem
• Willingness to iterate and improve

**Areas for Growth:**
• Deepen your market research
• Get more customer validation
• Refine your business model
• Consider competitive advantages

**Next Steps:**
• Conduct customer interviews
• Research competitors thoroughly
• Create a simple prototype
• Validate your assumptions`;
    }

    if (draftNumber === 1) {
      feedback +=
        "\n\n📋 **Important:** Before moving to Draft 2, conduct customer interviews to validate your assumptions!";
    }

    feedback += "\n\nKeep iterating - you're building something meaningful! 💪";
    return feedback;
  }

  // Screen Management
  showScreen(screenName) {
    // Hide all screens
    document.querySelectorAll(".screen").forEach((screen) => {
      screen.style.display = "none";
    });

    // Show target screen
    const targetScreen = document.getElementById(`screen-${screenName}`);
    if (targetScreen) {
      targetScreen.style.display = "block";
    }

    // Update navigation
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.remove("active");
    });
    document
      .querySelector(`[data-screen="${screenName}"]`)
      ?.classList.add("active");

    this.currentScreen = screenName;

    // Load screen-specific data
    this.loadScreenData(screenName);
  }

  loadScreenData(screenName) {
    switch (screenName) {
      case "global":
        this.loadGlobalIdeas();
        break;
      case "submissions":
        this.loadMySubmissions();
        break;
      case "submit":
        this.loadSubmitScreen();
        break;
      case "settings":
        this.loadSettingsScreen();
        break;
    }
  }

  // Screen: Global Ideas
  async loadGlobalIdeas() {
    const container = document.getElementById("global-ideas-list");
    if (!container) return;

    container.innerHTML = '<div class="loading">Loading top ideas...</div>';

    if (!this.supabase) {
      container.innerHTML = '<div class="error">Database not connected</div>';
      return;
    }

    try {
      const { data, error } = await this.supabase
        .from("projects_final")
        .select("local_user_name, project_name, ai_score, submitted_at")
        .order("ai_score", { ascending: false })
        .limit(20);

      if (error) throw error;

      if (!data || data.length === 0) {
        container.innerHTML =
          '<div class="empty">No ideas submitted yet. Be the first!</div>';
        return;
      }

      let html = '<div class="ideas-table">';
      data.forEach((idea, index) => {
        const date = new Date(idea.submitted_at).toLocaleDateString();
        html += `
          <div class="idea-row" onclick="app.showIdeaPreview('${
            idea.project_name
          }')">
            <div class="idea-rank">#${index + 1}</div>
            <div class="idea-details">
              <div class="idea-name">${this.escapeHtml(idea.project_name)}</div>
              <div class="idea-meta">${this.escapeHtml(
                idea.local_user_name
              )} • ${date}</div>
            </div>
            <div class="idea-score">${idea.ai_score}/100</div>
          </div>
        `;
      });
      html += "</div>";

      container.innerHTML = html;
    } catch (error) {
      console.error("Error loading global ideas:", error);
      container.innerHTML = '<div class="error">Failed to load ideas</div>';
    }
  }

  showIdeaPreview(projectName) {
    // Show blurred overlay - no sneak peeks!
    const overlay = document.createElement("div");
    overlay.className = "idea-preview-overlay";
    overlay.innerHTML = `
      <div class="preview-modal">
        <h3>🔒 No Sneak Peeks!</h3>
        <p>Submit your own amazing idea to see what others are building.</p>
        <button onclick="this.parentElement.parentElement.remove()">Got it!</button>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  async submitFeedback(formData) {
    if (!this.supabase) {
      alert("Database not available");
      return;
    }

    try {
      const feedback = {
        username: formData.username || "Anonymous",
        contact: formData.contact || null,
        message: formData.message,
        context: {
          page: "global_ideas",
          language: this.currentLanguage,
          timestamp: new Date().toISOString(),
        },
      };

      await this.supabase.from("feedback").insert([feedback]);

      this.showMessage("Thank you for your feedback!", "success");
      document.getElementById("feedback-form").reset();
    } catch (error) {
      console.error("Error submitting feedback:", error);
      this.showMessage("Failed to submit feedback. Please try again.", "error");
    }
  }

  // Screen: My Submissions
  loadMySubmissions() {
    const container = document.getElementById("my-submissions-list");
    if (!container) return;

    const users = this.getUsers().filter((u) => !u.deleted);
    const projects = this.getProjects().filter((p) => !p.deleted);

    if (projects.length === 0) {
      container.innerHTML =
        '<div class="empty">No submissions yet. Go to Submit Ideas to get started!</div>';
      return;
    }

    let html = "";
    users.forEach((user) => {
      const userProjects = projects.filter((p) => p.userId === user.id);
      if (userProjects.length === 0) return;

      html += `<div class="user-section">
        <h3>${this.escapeHtml(user.name)}'s Projects</h3>
        <div class="projects-list">`;

      userProjects.forEach((project) => {
        html += this.renderProjectSummary(project);
      });

      html += "</div></div>";
    });

    container.innerHTML = html;
  }

  renderProjectSummary(project) {
    const drafts = project.drafts.sort((a, b) => a.draftNumber - b.draftNumber);
    const finalDraft = drafts.find((d) => d.draftNumber === 3);
    const status = finalDraft ? "Final" : `Draft ${drafts.length}`;

    let html = `
      <div class="project-summary">
        <div class="project-header" onclick="app.toggleProjectDetails('${
          project.id
        }')">
          <div class="project-info">
            <div class="project-name">${this.escapeHtml(project.name)}</div>
            <div class="project-status">${status}</div>
          </div>
          <div class="expand-arrow">▼</div>
        </div>
        <div class="project-details" id="project-details-${
          project.id
        }" style="display: none;">
    `;

    drafts.forEach((draft) => {
      const scoreText = draft.aiScore ? `${draft.aiScore}/100` : "Not graded";
      html += `
        <div class="draft-item" onclick="app.toggleDraftDetails('${
          project.id
        }', ${draft.draftNumber})">
          <div class="draft-header">
            <span>Draft ${draft.draftNumber} - ${scoreText}</span>
            <span class="draft-arrow">▶</span>
          </div>
          <div class="draft-details" id="draft-${project.id}-${
        draft.draftNumber
      }" style="display: none;">
            ${
              draft.aiFeedback
                ? `<div class="ai-feedback">${this.formatFeedback(
                    draft.aiFeedback
                  )}</div>`
                : '<div class="no-feedback">No feedback yet</div>'
            }
          </div>
        </div>
      `;
    });

    html += "</div></div>";
    return html;
  }

  toggleProjectDetails(projectId) {
    const details = document.getElementById(`project-details-${projectId}`);
    const arrow = details.previousElementSibling.querySelector(".expand-arrow");

    if (details.style.display === "none") {
      details.style.display = "block";
      arrow.textContent = "▲";
    } else {
      details.style.display = "none";
      arrow.textContent = "▼";
    }
  }

  toggleDraftDetails(projectId, draftNumber) {
    const details = document.getElementById(
      `draft-${projectId}-${draftNumber}`
    );
    const arrow = details.previousElementSibling.querySelector(".draft-arrow");

    if (details.style.display === "none") {
      details.style.display = "block";
      arrow.textContent = "▼";
    } else {
      details.style.display = "none";
      arrow.textContent = "▶";
    }
  }

  // Screen: Submit Ideas
  loadSubmitScreen() {
    this.populateUserDropdown();
    this.populateProjectDropdown();
    this.updateSubmitGreeting();
  }

  populateUserDropdown() {
    const select = document.getElementById("user-select");
    if (!select) return;

    const users = this.getUsers().filter((u) => !u.deleted);
    select.innerHTML = '<option value="">Select User</option>';

    users.forEach((user) => {
      const option = document.createElement("option");
      option.value = user.id;
      option.textContent = user.name;
      if (this.currentUser === user.id) option.selected = true;
      select.appendChild(option);
    });
  }

  populateProjectDropdown() {
    const select = document.getElementById("project-select");
    if (!select) return;

    select.innerHTML = '<option value="">Select Project</option>';

    if (!this.currentUser) return;

    const projects = this.getProjects().filter(
      (p) => p.userId === this.currentUser && !p.deleted
    );
    projects.forEach((project) => {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      if (this.currentProject === project.id) option.selected = true;
      select.appendChild(option);
    });
  }

  updateSubmitGreeting() {
    const greeting = document.getElementById("submit-greeting");
    if (!greeting) return;

    if (this.currentUser) {
      const user = this.getUsers().find((u) => u.id === this.currentUser);
      greeting.innerHTML = `<h2>Hi ${this.escapeHtml(user.name)}! 👋</h2>
        <p>Ready to turn your idea into reality? Follow our 3-draft process:</p>
        <div class="process-steps">
          <div class="step">📝 Draft 1: Initial Concept</div>
          <div class="step">🗣️ Draft 2: Customer Validation</div>
          <div class="step">🚀 Draft 3: Final Pitch</div>
        </div>`;
    } else {
      greeting.innerHTML = "<p>Select or create a user to get started!</p>";
    }
  }

  onUserSelect(userId) {
    this.currentUser = userId;
    this.currentProject = null;
    this.populateProjectDropdown();
    this.updateSubmitGreeting();
    this.hideSubmissionForm();
  }

  onProjectSelect(projectId) {
    this.currentProject = projectId;
    if (projectId) {
      this.showSubmissionForm();
    } else {
      this.hideSubmissionForm();
    }
  }

  showSubmissionForm() {
    const form = document.getElementById("submission-form");
    if (!form) return;

    const project = this.getProjects().find(
      (p) => p.id === this.currentProject
    );
    if (!project) return;

    // Determine next draft number
    const maxDraft = Math.max(0, ...project.drafts.map((d) => d.draftNumber));
    const nextDraft = maxDraft + 1;

    if (nextDraft > 3) {
      form.innerHTML =
        '<div class="final-message">This project is complete! All 3 drafts have been submitted.</div>';
      return;
    }

    form.innerHTML = this.generateDraftForm(nextDraft, project);
    form.style.display = "block";
  }

  hideSubmissionForm() {
    const form = document.getElementById("submission-form");
    if (form) form.style.display = "none";
  }

  generateDraftForm(draftNumber, project) {
    let questions, title, instructions;

    switch (draftNumber) {
      case 1:
        title = "Draft 1: Initial Concept";
        instructions =
          "Tell us about your amazing idea! Be honest and detailed.";
        questions = [
          {
            id: "problem",
            label: "What problem does your product solve?",
            type: "textarea",
            required: true,
          },
          {
            id: "target",
            label: "Who does this product help?",
            type: "textarea",
            required: true,
          },
          {
            id: "current_solutions",
            label: "What do people currently use and how is that limited?",
            type: "textarea",
            required: true,
          },
          {
            id: "better_how",
            label: "How is your product better?",
            type: "textarea",
            required: true,
          },
          {
            id: "discovery",
            label: "How did you find Capsera?",
            type: "text",
            required: false,
          },
        ];
        break;

      case 2:
        title = "Draft 2: Market Validation";
        instructions =
          "Time to validate! Show us your market research and customer insights.";
        questions = [
          {
            id: "interviews",
            label: "Did you conduct customer interviews? How many?",
            type: "textarea",
            required: true,
          },
          {
            id: "interview_results",
            label: "What did you learn from customer interviews?",
            type: "textarea",
            required: true,
          },
          {
            id: "competitors",
            label: "Who are your main competitors? How did you research them?",
            type: "textarea",
            required: true,
          },
          {
            id: "mvp_status",
            label:
              "Did you build an MVP? If yes, share the link. If no, why not?",
            type: "textarea",
            required: true,
          },
          {
            id: "market_size",
            label: "How big is your target market?",
            type: "textarea",
            required: false,
          },
        ];
        break;

      case 3:
        title = "Draft 3: Final Pitch";
        instructions =
          "Time for your investor pitch! Reference your previous drafts and show your progress.";
        questions = [
          {
            id: "elevator_pitch",
            label: "Give us your 30-second elevator pitch",
            type: "textarea",
            required: true,
          },
          {
            id: "business_model",
            label: "How will you make money?",
            type: "textarea",
            required: true,
          },
          {
            id: "traction",
            label: "What traction do you have? (users, revenue, partnerships)",
            type: "textarea",
            required: true,
          },
          {
            id: "funding_ask",
            label: "How much funding do you need and what for?",
            type: "textarea",
            required: true,
          },
          {
            id: "mvp_link",
            label: "Link to your MVP or prototype",
            type: "url",
            required: false,
          },
          {
            id: "contact_email",
            label: "Email for mentor/funder contact (optional)",
            type: "email",
            required: false,
          },
        ];
        break;
    }

    let html = `
      <div class="draft-form">
        <h3>${title}</h3>
        <p>${instructions}</p>
        <form onsubmit="app.submitDraft(event, ${draftNumber})">
    `;

    questions.forEach((q) => {
      html += `
        <div class="form-group">
          <label for="${q.id}">${q.label} ${q.required ? "*" : ""}</label>
          ${
            q.type === "textarea"
              ? `<textarea id="${q.id}" name="${q.id}" ${
                  q.required ? "required" : ""
                }></textarea>`
              : `<input type="${q.type}" id="${q.id}" name="${q.id}" ${
                  q.required ? "required" : ""
                }>`
          }
        </div>
      `;
    });

    html += `
          <button type="submit" class="btn-primary">Submit Draft ${draftNumber}</button>
        </form>
      </div>
    `;

    // Add previous drafts sidebar for draft 3
    if (draftNumber === 3) {
      html += this.generatePreviousDraftsSidebar(project);
    }

    return html;
  }

  generatePreviousDraftsSidebar(project) {
    let html = '<div class="previous-drafts-sidebar"><h4>Previous Drafts</h4>';

    project.drafts.forEach((draft) => {
      if (draft.draftNumber < 3) {
        html += `
          <div class="previous-draft">
            <h5>Draft ${draft.draftNumber} (Score: ${
          draft.aiScore || "N/A"
        })</h5>
            <div class="draft-summary">
              ${Object.entries(draft.answers)
                .slice(0, 2)
                .map(
                  ([key, value]) =>
                    `<p><strong>${key}:</strong> ${this.truncate(
                      value,
                      100
                    )}</p>`
                )
                .join("")}
            </div>
          </div>
        `;
      }
    });

    html += "</div>";
    return html;
  }

  async submitDraft(event, draftNumber) {
    event.preventDefault();

    const formData = new FormData(event.target);
    const answers = {};

    for (let [key, value] of formData.entries()) {
      answers[key] = value.trim();
    }

    try {
      // Save draft locally
      this.saveDraft(this.currentProject, draftNumber, answers);

      // Show loading
      const submitBtn = event.target.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = "Grading...";
      submitBtn.disabled = true;

      // Get AI feedback
      const feedback = await this.gradeDraft(this.currentProject, draftNumber);

      // Show feedback
      this.showDraftFeedback(feedback, draftNumber);

      // Reset form
      submitBtn.textContent = originalText;
      submitBtn.disabled = false;

      // If draft 1, show interview instructions
      if (draftNumber === 1) {
        this.showInterviewInstructions();
      }
    } catch (error) {
      console.error("Error submitting draft:", error);
      this.showMessage("Error submitting draft. Please try again.", "error");
    }
  }

  showDraftFeedback(feedback, draftNumber) {
    const modal = document.createElement("div");
    modal.className = "feedback-modal-overlay";
    modal.innerHTML = `
      <div class="feedback-modal">
        <h3>Draft ${draftNumber} Feedback</h3>
        <div class="score-display">Score: ${feedback.score}/100</div>
        <div class="feedback-content">${this.formatFeedback(
          feedback.feedback
        )}</div>
        <button onclick="this.parentElement.parentElement.remove(); app.loadSubmitScreen();">Continue</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  showInterviewInstructions() {
    const modal = document.createElement("div");
    modal.className = "interview-modal-overlay";
    modal.innerHTML = `
      <div class="interview-modal">
        <h3>📋 Next Step: Customer Interviews!</h3>
        <p>Before Draft 2, you need to validate your idea with real customers:</p>
        <ul>
          <li>Interview at least 3-5 potential customers</li>
          <li>Ask about their current problems and solutions</li>
          <li>Show them your idea and get honest feedback</li>
          <li>Take detailed notes on their responses</li>
        </ul>
        <p><strong>Remember:</strong> The goal is to learn, not to sell!</p>
        <button onclick="this.parentElement.parentElement.remove();">Got it!</button>
      </div>
    `;
    document.body.appendChild(modal);
  }

  // User Creation Modal
  showCreateUserModal() {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal">
        <h3>Create New User</h3>
        <form onsubmit="app.handleCreateUser(event)">
          <div class="form-group">
            <label for="new-username">Username *</label>
            <input type="text" id="new-username" required>
          </div>
          <div class="form-group">
            <label for="new-pin">PIN (4+ digits) *</label>
            <input type="password" id="new-pin" minlength="4" required>
          </div>
          <div class="form-group">
            <label for="new-safety-code">Safety Code (for PIN recovery) *</label>
            <input type="text" id="new-safety-code" required>
            <small>Remember this - you'll need it to reset your PIN</small>
          </div>
          <div class="modal-buttons">
            <button type="button" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn-primary">Create User</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }

  handleCreateUser(event) {
    event.preventDefault();

    const name = document.getElementById("new-username").value.trim();
    const pin = document.getElementById("new-pin").value;
    const safetyCode = document.getElementById("new-safety-code").value.trim();

    try {
      const user = this.createUser(name, pin, safetyCode);
      this.currentUser = user.id;
      this.populateUserDropdown();
      this.updateSubmitGreeting();

      // Close modal
      document.querySelector(".modal-overlay").remove();
      this.showMessage("User created successfully!", "success");
    } catch (error) {
      this.showMessage(error.message, "error");
    }
  }

  // Project Creation Modal
  showCreateProjectModal() {
    if (!this.currentUser) {
      this.showMessage("Please select a user first", "error");
      return;
    }

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal">
        <h3>Create New Project</h3>
        <form onsubmit="app.handleCreateProject(event)">
          <div class="form-group">
            <label for="new-project-name">Project Name *</label>
            <input type="text" id="new-project-name" required>
          </div>
          <div class="modal-buttons">
            <button type="button" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn-primary">Create Project</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }

  handleCreateProject(event) {
    event.preventDefault();

    const name = document.getElementById("new-project-name").value.trim();

    try {
      const project = this.createProject(this.currentUser, name);
      this.currentProject = project.id;
      this.populateProjectDropdown();
      this.showSubmissionForm();

      // Close modal
      document.querySelector(".modal-overlay").remove();
      this.showMessage("Project created successfully!", "success");
    } catch (error) {
      this.showMessage(error.message, "error");
    }
  }

  // Screen: Settings
  loadSettingsScreen() {
    this.loadTranslationSection();
    this.loadUsersManagement();
  }

  loadTranslationSection() {
    const container = document.getElementById("translation-section");
    if (!container) return;

    const languages = [
      { code: "hi", name: "Hindi" },
      { code: "bn", name: "Bengali" },
      { code: "te", name: "Telugu" },
      { code: "mr", name: "Marathi" },
      { code: "ta", name: "Tamil" },
      { code: "gu", name: "Gujarati" },
      { code: "ur", name: "Urdu" },
      { code: "ml", name: "Malayalam" },
    ];

    let html = `
      <div class="current-language">
        Current Language: <strong>${
          this.currentLanguage === "en" ? "English" : this.currentLanguage
        }</strong>
      </div>
      <div class="quick-languages">
    `;

    languages.forEach((lang) => {
      html += `<button class="lang-btn" onclick="app.translateApp('${lang.code}')">${lang.name}</button>`;
    });

    html += `
      </div>
      <div class="custom-language">
        <input type="text" id="custom-lang" placeholder="Enter language name">
        <button onclick="app.translateCustom()">Translate</button>
      </div>
      <button onclick="app.translateApp('en')" class="reset-lang">Reset to English</button>
    `;

    container.innerHTML = html;
  }

  async translateApp(languageCode) {
    if (languageCode === "en") {
      // Reset to English
      this.currentLanguage = "en";
      this.translations = {};
      this.saveSettings();
      this.showMessage("Reset to English", "success");
      return;
    }

    try {
      // Stub for Google Translate API
      // In production, this would call Netlify function with process.env.GOOGLE_TRANSLATE_KEY

      this.showMessage("Translation feature coming soon!", "info");

      // For MVP, just save the language preference
      this.currentLanguage = languageCode;
      this.saveSettings();
      this.loadTranslationSection();
    } catch (error) {
      console.error("Translation error:", error);
      this.showMessage("Translation failed", "error");
    }
  }

  async translateCustom() {
    const customLang = document.getElementById("custom-lang").value.trim();
    if (!customLang) return;

    // For MVP, just show coming soon message
    this.showMessage(
      `Custom translation to ${customLang} coming soon!`,
      "info"
    );
  }

  loadUsersManagement() {
    const container = document.getElementById("users-management");
    if (!container) return;

    const users = this.getUsers().filter((u) => !u.deleted);

    if (users.length === 0) {
      container.innerHTML = '<div class="empty">No users created yet.</div>';
      return;
    }

    let html = '<div class="users-list">';
    users.forEach((user) => {
      html += `
        <div class="user-item">
          <div class="user-info">
            <div class="user-name">${this.escapeHtml(user.name)}</div>
            <div class="user-date">Created: ${new Date(
              user.createdAt
            ).toLocaleDateString()}</div>
          </div>
          <div class="user-actions">
            <button onclick="app.showChangePinModal('${
              user.id
            }')" class="btn-secondary">Change PIN</button>
            <button onclick="app.showDeleteUserModal('${
              user.id
            }')" class="btn-danger">Delete</button>
          </div>
        </div>
      `;
    });
    html += "</div>";

    container.innerHTML = html;
  }

  showChangePinModal(userId) {
    const user = this.getUsers().find((u) => u.id === userId);
    if (!user) return;

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal">
        <h3>Change PIN for ${this.escapeHtml(user.name)}</h3>
        <form onsubmit="app.handleChangePin(event, '${userId}')">
          <div class="form-group">
            <label for="safety-code">Safety Code *</label>
            <input type="text" id="safety-code" required>
          </div>
          <div class="form-group">
            <label for="new-pin">New PIN (4+ digits) *</label>
            <input type="password" id="new-pin" minlength="4" required>
          </div>
          <div class="modal-buttons">
            <button type="button" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn-primary">Change PIN</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }

  handleChangePin(event, userId) {
    event.preventDefault();

    const safetyCode = document.getElementById("safety-code").value.trim();
    const newPin = document.getElementById("new-pin").value;

    try {
      this.changeUserPin(userId, safetyCode, newPin);
      document.querySelector(".modal-overlay").remove();
      this.showMessage("PIN changed successfully!", "success");
    } catch (error) {
      this.showMessage(error.message, "error");
    }
  }

  showDeleteUserModal(userId) {
    const user = this.getUsers().find((u) => u.id === userId);
    if (!user) return;

    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
      <div class="modal">
        <h3>Delete User: ${this.escapeHtml(user.name)}</h3>
        <p><strong>Warning:</strong> This will delete all local data for this user including projects and drafts.</p>
        <form onsubmit="app.handleDeleteUser(event, '${userId}')">
          <div class="form-group">
            <label for="confirm-pin">Enter PIN to confirm *</label>
            <input type="password" id="confirm-pin" required>
          </div>
          <div class="modal-buttons">
            <button type="button" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
            <button type="submit" class="btn-danger">Delete User</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }

  handleDeleteUser(event, userId) {
    event.preventDefault();

    const pin = document.getElementById("confirm-pin").value;

    try {
      this.deleteUser(userId, pin);
      document.querySelector(".modal-overlay").remove();
      this.loadUsersManagement();

      // Reset current user if deleted
      if (this.currentUser === userId) {
        this.currentUser = null;
        this.currentProject = null;
      }

      this.showMessage("User deleted successfully", "success");
    } catch (error) {
      this.showMessage(error.message, "error");
    }
  }

  // Utility Functions
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  truncate(text, length) {
    if (text.length <= length) return text;
    return text.substring(0, length) + "...";
  }

  formatFeedback(feedback) {
    // Convert markdown-style formatting to HTML
    return feedback
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\n/g, "<br>")
      .replace(/• /g, "• ");
  }

  showMessage(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    document.body.appendChild(toast);

    // Auto remove after 3 seconds
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  // Event Listeners
  setupEventListeners() {
    // Navigation
    document.addEventListener("click", (e) => {
      if (e.target.classList.contains("nav-btn")) {
        const screen = e.target.getAttribute("data-screen");
        this.showScreen(screen);
      }
    });

    // User selection
    document.addEventListener("change", (e) => {
      if (e.target.id === "user-select") {
        this.onUserSelect(e.target.value);
      }
      if (e.target.id === "project-select") {
        this.onProjectSelect(e.target.value);
      }
    });

    // Feedback form
    document.addEventListener("submit", (e) => {
      if (e.target.id === "feedback-form") {
        e.preventDefault();
        const formData = new FormData(e.target);
        const data = {
          username: formData.get("feedback-username"),
          contact: formData.get("feedback-contact"),
          message: formData.get("feedback-message"),
        };
        this.submitFeedback(data);
      }
    });

    // Close modals on outside click
    document.addEventListener("click", (e) => {
      if (
        e.target.classList.contains("modal-overlay") ||
        e.target.classList.contains("feedback-modal-overlay") ||
        e.target.classList.contains("interview-modal-overlay") ||
        e.target.classList.contains("idea-preview-overlay")
      ) {
        e.target.remove();
      }
    });

    // Handle service worker messages
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "CACHE_UPDATED") {
          this.showMessage("App updated! Reload to see changes.", "info");
        }
      });
    }
  }
}

// Initialize app when DOM is loaded
document.addEventListener("DOMContentLoaded", () => {
  window.app = new CapseraApp();
});

// Sample data for development/testing
const SAMPLE_QUESTIONS = {
  draft1: [
    "What problem does your product solve?",
    "Who does this product help?",
    "What do people currently use and how is that limited?",
    "How is your product better?",
    "How did you find Capsera?",
  ],
  draft2: [
    "Did you conduct customer interviews? How many?",
    "What did you learn from customer interviews?",
    "Who are your main competitors? How did you research them?",
    "Did you build an MVP? If yes, share the link. If no, why not?",
    "How big is your target market?",
  ],
  draft3: [
    "Give us your 30-second elevator pitch",
    "How will you make money?",
    "What traction do you have? (users, revenue, partnerships)",
    "How much funding do you need and what for?",
    "Link to your MVP or prototype",
    "Email for mentor/funder contact (optional)",
  ],
};

// Feedback form questions for developers
const FEEDBACK_QUESTIONS = [
  "How intuitive is the app interface?",
  "What features would make this more useful?",
  "How likely are you to recommend Capsera to others?",
  "What challenges do young entrepreneurs face that we should address?",
  "Any specific feedback for the developers (Nahom, Shourya, and Sahasra)?",
];

// Export for potential external use
if (typeof module !== "undefined" && module.exports) {
  module.exports = CapseraApp;
}
