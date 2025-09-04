// Global Ideas Screen - Shows top scored ideas and feedback form
import { getTopProjects, insertFeedback } from "../api/supabaseClient.js";
import { enqueueFeedback } from "../utils/syncQueue.js";

export class GlobalIdeas {
  constructor() {
    this.projects = [];
    this.isLoading = false;
    this.currentModal = null;
    this.feedbackForm = null;
  }

  async render(container) {
    console.log("Rendering Global Ideas screen");

    container.innerHTML = `
      <div class="global-ideas-screen">
        <h1>🌟 Global Ideas</h1>
        <p class="subtitle">Discover top-rated ideas from the Capsera community</p>
        
        <div class="projects-section">
          <h2>Top Scored Ideas</h2>
          <div id="projects-list" class="projects-list">
            <div class="loading">
              <div class="spinner"></div>
              Loading top ideas...
            </div>
          </div>
        </div>
        
        <div class="feedback-section">
          <div class="card">
            <div class="card-header">
              <h2>💬 Help Us Improve Capsera</h2>
              <p>Your feedback helps Nahom, Shourya, and Sahasra make Capsera better for everyone!</p>
            </div>
            
            <form id="feedback-form" class="feedback-form">
              <div class="form-group">
                <label for="liked_most">What did you like most about Capsera? *</label>
                <textarea 
                  id="liked_most" 
                  name="liked_most" 
                  required 
                  rows="3"
                  placeholder="Tell us what you enjoyed most about using Capsera..."></textarea>
              </div>

              <div class="form-group">
                <label for="frustrated_most">What frustrated you most or stopped you from completing a task? *</label>
                <textarea 
                  id="frustrated_most" 
                  name="frustrated_most" 
                  required 
                  rows="3"
                  placeholder="Share any challenges or frustrations you experienced..."></textarea>
              </div>

              <div class="form-group">
                <label for="feature_improve">What feature do you think would most improve idea development? *</label>
                <textarea 
                  id="feature_improve" 
                  name="feature_improve" 
                  required 
                  rows="3"
                  placeholder="Suggest a feature that would help you develop ideas better..."></textarea>
              </div>

              <div class="form-group">
                <label for="accessibility_issues">Any accessibility or language issues you faced?</label>
                <textarea 
                  id="accessibility_issues" 
                  name="accessibility_issues" 
                  rows="3"
                  placeholder="Tell us about any accessibility barriers or language difficulties..."></textarea>
              </div>

              <div class="form-group">
                <label for="follow_up_contact">Would you like a follow-up from the developers? If yes, leave email or phone (optional).</label>
                <input 
                  type="text" 
                  id="follow_up_contact" 
                  name="follow_up_contact"
                  placeholder="your.email@example.com or phone number...">
              </div>

              <div class="form-group">
                <label for="other_comments">Any other comments or suggestions?</label>
                <textarea 
                  id="other_comments" 
                  name="other_comments" 
                  rows="3"
                  placeholder="Share any additional thoughts, ideas, or feedback..."></textarea>
              </div>

              <div class="form-group">
                <label for="username_feedback">Your name (optional - leave blank for anonymous):</label>
                <input 
                  type="text" 
                  id="username_feedback" 
                  name="username_feedback"
                  placeholder="Anonymous">
              </div>

              <button type="submit" class="btn btn-primary" id="submit-feedback-btn">
                Send Feedback
              </button>
              
              <div id="feedback-status" class="feedback-status"></div>
            </form>
          </div>
        </div>
      </div>
    `;

    // Setup event listeners
    this.setupEventListeners();

    // Load projects
    await this.loadTopProjects();
  }

  setupEventListeners() {
    // Feedback form submission
    const feedbackForm = document.getElementById("feedback-form");
    if (feedbackForm) {
      feedbackForm.addEventListener("submit", (e) =>
        this.handleFeedbackSubmit(e)
      );
    }
  }

  async loadTopProjects() {
    console.log("Loading top projects...");
    const projectsList = document.getElementById("projects-list");

    if (!projectsList) return;

    this.isLoading = true;

    try {
      // Try to load from Supabase if online
      if (navigator.onLine !== false) {
        this.projects = await getTopProjects(50);
        this.renderProjectsList();
      } else {
        projectsList.innerHTML = `
          <div class="offline-message">
            <p>📱 You're offline</p>
            <p>Global ideas are only available when online. Check back when you have an internet connection!</p>
          </div>
        `;
      }
    } catch (error) {
      console.error("Failed to load top projects:", error);
      projectsList.innerHTML = `
        <div class="error-message">
          <p>❌ Failed to load ideas</p>
          <p>There was a problem loading the global ideas. Please try again later.</p>
          <button class="btn btn-secondary" onclick="window.location.reload()">Retry</button>
        </div>
      `;
    } finally {
      this.isLoading = false;
    }
  }

  renderProjectsList() {
    const projectsList = document.getElementById("projects-list");
    if (!projectsList) return;

    if (this.projects.length === 0) {
      projectsList.innerHTML = `
        <div class="empty-state">
          <p>🌱 No ideas yet</p>
          <p>Be the first to submit a final idea! Complete all 3 drafts to appear here.</p>
        </div>
      `;
      return;
    }

    const tableHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>User</th>
            <th>Project Title</th>
            <th>Score</th>
            <th>Submitted</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${this.projects
            .map((project) => this.renderProjectRow(project))
            .join("")}
        </tbody>
      </table>
    `;

    projectsList.innerHTML = tableHTML;

    // Add click listeners to view buttons
    projectsList.addEventListener("click", (e) => {
      if (e.target.classList.contains("view-project-btn")) {
        const projectId = e.target.dataset.projectId;
        this.showProjectModal(projectId);
      }
    });
  }

  renderProjectRow(project) {
    const scoreClass =
      project.final_score >= 85
        ? "score-high"
        : project.final_score >= 70
        ? "score-medium"
        : "score-low";

    const submissionDate = new Date(
      project.submission_date
    ).toLocaleDateString();

    return `
      <tr>
        <td>${this.escapeHtml(project.user_display_name)}</td>
        <td>${this.escapeHtml(project.project_title)}</td>
        <td><span class="score-badge ${scoreClass}">${
      project.final_score
    }</span></td>
        <td>${submissionDate}</td>
        <td>
          <button class="btn btn-small btn-secondary view-project-btn" data-project-id="${
            project.id
          }">
            View
          </button>
        </td>
      </tr>
    `;
  }

  async showProjectModal(projectId) {
    const project = this.projects.find((p) => p.id === projectId);
    if (!project) return;

    // Create modal with "no sneak peek" message
    this.currentModal = this.createModal(
      "Project Info",
      `
      <div class="no-sneak-peek">
        <div class="blur-background">
          <h3>🙈 No sneak peeks!</h3>
          <p>We keep the content private to encourage original thinking.</p>
        </div>
        
        <div class="project-info">
          <h4>Project Details</h4>
          <div class="detail-row">
            <strong>Title:</strong> ${this.escapeHtml(project.project_title)}
          </div>
          <div class="detail-row">
            <strong>Score:</strong> <span class="score-badge ${
              project.final_score >= 85
                ? "score-high"
                : project.final_score >= 70
                ? "score-medium"
                : "score-low"
            }">${project.final_score}/100</span>
          </div>
          <div class="detail-row">
            <strong>Submitted:</strong> ${new Date(
              project.submission_date
            ).toLocaleDateString()}
          </div>
          ${
            project.locale_language !== "en"
              ? `
          <div class="detail-row">
            <strong>Language:</strong> ${this.escapeHtml(
              project.locale_language
            )}
          </div>
          `
              : ""
          }
        </div>
        
        <p class="privacy-note">
          💡 Content is private to encourage authentic, original ideas from all users.
        </p>
      </div>
    `
    );
  }

  async handleFeedbackSubmit(event) {
    event.preventDefault();

    const submitBtn = document.getElementById("submit-feedback-btn");
    const statusDiv = document.getElementById("feedback-status");

    if (!submitBtn || !statusDiv) return;

    // Disable submit button
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    try {
      // Collect form data
      const formData = new FormData(event.target);
      const answers = {};

      // Required fields
      answers.liked_most = formData.get("liked_most")?.trim();
      answers.frustrated_most = formData.get("frustrated_most")?.trim();
      answers.feature_improve = formData.get("feature_improve")?.trim();

      // Optional fields
      answers.accessibility_issues =
        formData.get("accessibility_issues")?.trim() || null;
      answers.follow_up_contact =
        formData.get("follow_up_contact")?.trim() || null;
      answers.other_comments = formData.get("other_comments")?.trim() || null;

      const username = formData.get("username_feedback")?.trim() || "Anonymous";

      // Validate required fields
      if (
        !answers.liked_most ||
        !answers.frustrated_most ||
        !answers.feature_improve
      ) {
        throw new Error("Please fill in all required fields");
      }

      // Prepare feedback data
      const feedbackData = {
        username_or_anonymous: username,
        contactOptional: answers.follow_up_contact,
        answers: answers,
        userAgent: navigator.userAgent,
        createdAt: new Date().toISOString(),
        appVersion: window.ENV?.APP_VERSION || "1.0.0",
      };

      // Try to submit directly if online, otherwise queue for later
      if (navigator.onLine !== false) {
        try {
          await insertFeedback(feedbackData);
          this.showFeedbackSuccess(
            "Thank you! Your feedback has been sent successfully."
          );
        } catch (supabaseError) {
          console.warn(
            "Direct submission failed, queuing for later:",
            supabaseError
          );
          await enqueueFeedback(feedbackData);
          this.showFeedbackSuccess(
            "Thank you! Your feedback has been queued and will be sent when online."
          );
        }
      } else {
        await enqueueFeedback(feedbackData);
        this.showFeedbackSuccess(
          "Thank you! Your feedback has been saved and will be sent when you come online."
        );
      }

      // Clear form
      event.target.reset();
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      statusDiv.innerHTML = `
        <div class="error-message" style="color: #dc3545; padding: 10px; border: 1px solid #dc3545; border-radius: 4px; margin-top: 10px;">
          ❌ ${error.message || "Failed to submit feedback. Please try again."}
        </div>
      `;
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Feedback";
    }
  }

  showFeedbackSuccess(message) {
    const statusDiv = document.getElementById("feedback-status");
    if (statusDiv) {
      statusDiv.innerHTML = `
        <div class="success-message" style="color: #28a745; padding: 10px; border: 1px solid #28a745; border-radius: 4px; margin-top: 10px;">
          ✅ ${message}
        </div>
      `;

      // Clear success message after 5 seconds
      setTimeout(() => {
        statusDiv.innerHTML = "";
      }, 5000);
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

    // Close modal on overlay click
    modalOverlay.onclick = (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.style.display = "none";
      }
    };

    return modalOverlay;
  }

  escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  async refresh() {
    console.log("Refreshing Global Ideas screen");
    await this.loadTopProjects();
  }

  async destroy() {
    // Close any open modals
    if (this.currentModal) {
      this.currentModal.style.display = "none";
    }

    // Clean up event listeners (they'll be removed with DOM)
    console.log("Global Ideas screen destroyed");
  }
}
