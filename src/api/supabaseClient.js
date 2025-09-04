// Supabase client for final submissions and feedback
// Only handles final project submissions (3rd draft) and feedback form entries

let supabase = null;

// Initialize Supabase client (lazy loading)
function initSupabase() {
  if (supabase) return supabase;

  if (!window.ENV?.SUPABASE_URL || !window.ENV?.SUPABASE_ANON_KEY) {
    console.error("Supabase configuration missing in window.ENV");
    throw new Error("Supabase not configured");
  }

  // Import Supabase from CDN (since we can't install it)
  // This would need to be included in index.html via script tag
  if (typeof window.supabase === "undefined") {
    throw new Error(
      "Supabase library not loaded - add script tag to index.html"
    );
  }

  supabase = window.supabase.createClient(
    window.ENV.SUPABASE_URL,
    window.ENV.SUPABASE_ANON_KEY
  );

  console.log("Supabase client initialized");
  return supabase;
}

// Insert final project submission (3rd draft only)
export async function insertFinalProject(projectData) {
  console.log("Submitting final project to Supabase...");

  try {
    const client = initSupabase();

    // Validate required fields
    if (!projectData.projectTitle || !projectData.userDisplayName) {
      throw new Error("Missing required project fields: title and user name");
    }

    if (!projectData.drafts || projectData.drafts.length !== 3) {
      throw new Error("Final submission must include exactly 3 drafts");
    }

    // Prepare data for insertion
    const submissionData = {
      project_title: projectData.projectTitle,
      user_display_name: projectData.userDisplayName,
      submission_date: projectData.submissionDate || new Date().toISOString(),
      draft_1_content: projectData.drafts[0]?.content || {},
      draft_1_score: projectData.drafts[0]?.score || null,
      draft_1_feedback: projectData.drafts[0]?.aiFeedback || null,
      draft_2_content: projectData.drafts[1]?.content || {},
      draft_2_score: projectData.drafts[1]?.score || null,
      draft_2_feedback: projectData.drafts[1]?.aiFeedback || null,
      draft_3_content: projectData.drafts[2]?.content || {},
      draft_3_score: projectData.drafts[2]?.score || null,
      draft_3_feedback: projectData.drafts[2]?.aiFeedback || null,
      final_score:
        projectData.finalScore || projectData.drafts[2]?.score || null,
      mvp_link: projectData.mvpLink || null,
      image_urls: projectData.imageUrls || null,
      locale_language: projectData.localeLanguage || "en",
      device_meta: projectData.deviceMeta || navigator.userAgent,
      app_version: window.ENV?.APP_VERSION || "1.0.0",
      created_at: new Date().toISOString(),
    };

    // Insert into projects table
    // NOTE: You need to create this table in Supabase with appropriate RLS policies
    const { data, error } = await client
      .from("final_projects")
      .insert([submissionData])
      .select();

    if (error) {
      console.error("Supabase insertion error:", error);
      throw error;
    }

    console.log("Final project submitted successfully:", data[0]?.id);
    return data[0];
  } catch (error) {
    console.error("Failed to submit final project:", error);
    throw error;
  }
}

// Insert feedback from Global Ideas screen
export async function insertFeedback(feedbackData) {
  console.log("Submitting feedback to Supabase...");

  try {
    const client = initSupabase();

    // Validate required fields
    if (!feedbackData.answers || typeof feedbackData.answers !== "object") {
      throw new Error("Feedback answers are required");
    }

    // Prepare data for insertion
    const submissionData = {
      username_or_anonymous: feedbackData.username_or_anonymous || "Anonymous",
      contact_optional: feedbackData.contactOptional || null,
      answers: feedbackData.answers,
      user_agent: feedbackData.userAgent || navigator.userAgent,
      created_at: feedbackData.createdAt || new Date().toISOString(),
      app_version:
        feedbackData.appVersion || window.ENV?.APP_VERSION || "1.0.0",
      // Individual answer fields for easier querying
      liked_most: feedbackData.answers.liked_most || null,
      frustrated_most: feedbackData.answers.frustrated_most || null,
      feature_improve: feedbackData.answers.feature_improve || null,
      accessibility_issues: feedbackData.answers.accessibility_issues || null,
      follow_up_contact: feedbackData.answers.follow_up_contact || null,
      other_comments: feedbackData.answers.other_comments || null,
    };

    // Insert into feedback table
    // NOTE: You need to create this table in Supabase with appropriate RLS policies
    const { data, error } = await client
      .from("user_feedback")
      .insert([submissionData])
      .select();

    if (error) {
      console.error("Supabase feedback insertion error:", error);
      throw error;
    }

    console.log("Feedback submitted successfully:", data[0]?.id);
    return data[0];
  } catch (error) {
    console.error("Failed to submit feedback:", error);
    throw error;
  }
}

// Get top scored projects for Global Ideas screen
export async function getTopProjects(limit = 50) {
  console.log("Fetching top projects from Supabase...");

  try {
    const client = initSupabase();

    // Fetch projects ordered by final score, limit results
    // Only get necessary fields for the list view (no content for privacy)
    const { data, error } = await client
      .from("final_projects")
      .select(
        "id, user_display_name, submission_date, final_score, project_title"
      )
      .order("final_score", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Supabase query error:", error);
      throw error;
    }

    console.log(`Fetched ${data.length} top projects`);
    return data;
  } catch (error) {
    console.error("Failed to fetch top projects:", error);
    throw error;
  }
}

// Get basic project info for "no sneak peek" modal (no content)
export async function getProjectInfo(projectId) {
  console.log("Fetching project info from Supabase...");

  try {
    const client = initSupabase();

    // Only get basic info, no draft content (privacy protection)
    const { data, error } = await client
      .from("final_projects")
      .select(
        "id, user_display_name, submission_date, final_score, project_title, locale_language"
      )
      .eq("id", projectId)
      .single();

    if (error) {
      console.error("Supabase query error:", error);
      throw error;
    }

    console.log("Fetched project info:", data.id);
    return data;
  } catch (error) {
    console.error("Failed to fetch project info:", error);
    throw error;
  }
}

// Check Supabase connection status
export async function checkConnection() {
  try {
    const client = initSupabase();

    // Simple query to test connection
    const { data, error } = await client
      .from("final_projects")
      .select("id")
      .limit(1);

    if (error && error.code !== "PGRST116") {
      // PGRST116 is "no rows found" which is OK
      throw error;
    }

    return true;
  } catch (error) {
    console.error("Supabase connection test failed:", error);
    return false;
  }
}

// Get Supabase client instance (for advanced usage)
export function getSupabaseClient() {
  return initSupabase();
}

// Utility function to format project data for submission
export function formatProjectForSubmission(project, drafts, user) {
  if (!project || !drafts || !user) {
    throw new Error("Missing required data for project submission");
  }

  // Sort drafts by draft number
  const sortedDrafts = drafts.sort((a, b) => a.draftNumber - b.draftNumber);

  if (sortedDrafts.length !== 3) {
    throw new Error("Project must have exactly 3 drafts for final submission");
  }

  return {
    projectTitle: project.name,
    userDisplayName: user.name,
    submissionDate: new Date().toISOString(),
    drafts: sortedDrafts.map((draft) => ({
      draftNumber: draft.draftNumber,
      content: draft.answers,
      score: draft.score,
      aiFeedback: draft.aiFeedback,
    })),
    finalScore: sortedDrafts[2].score, // Use 3rd draft score as final
    mvpLink: sortedDrafts[2].answers?.mvp_link || null,
    imageUrls: sortedDrafts.map((d) => d.answers?.image_url).filter(Boolean),
    localeLanguage: localStorage.getItem("capsera_language") || "en",
    deviceMeta: navigator.userAgent,
  };
}

// Utility function to format feedback data
export function formatFeedbackForSubmission(
  answers,
  username = "Anonymous",
  contact = null
) {
  return {
    username_or_anonymous: username,
    contactOptional: contact,
    answers: answers,
    userAgent: navigator.userAgent,
    createdAt: new Date().toISOString(),
    appVersion: window.ENV?.APP_VERSION || "1.0.0",
  };
}

/*
NOTE FOR DEVELOPERS:
You need to create the following tables in Supabase:

1. final_projects table:
   - id (uuid, primary key, default gen_random_uuid())
   - project_title (text)
   - user_display_name (text)
   - submission_date (timestamptz)
   - draft_1_content (jsonb)
   - draft_1_score (integer)
   - draft_1_feedback (jsonb)
   - draft_2_content (jsonb) 
   - draft_2_score (integer)
   - draft_2_feedback (jsonb)
   - draft_3_content (jsonb)
   - draft_3_score (integer)
   - draft_3_feedback (jsonb)
   - final_score (integer)
   - mvp_link (text)
   - image_urls (text[])
   - locale_language (text)
   - device_meta (text)
   - app_version (text)
   - created_at (timestamptz, default now())

2. user_feedback table:
   - id (uuid, primary key, default gen_random_uuid())
   - username_or_anonymous (text)
   - contact_optional (text)
   - answers (jsonb)
   - user_agent (text)
   - created_at (timestamptz, default now())
   - app_version (text)
   - liked_most (text)
   - frustrated_most (text)
   - feature_improve (text)
   - accessibility_issues (text)
   - follow_up_contact (text)
   - other_comments (text)

RLS Policies:
- Enable RLS on both tables
- Allow anonymous INSERT for both tables
- Allow anonymous SELECT for final_projects (for Global Ideas)
- Restrict SELECT on user_feedback to admin users only

Don't forget to add the Supabase JS library script tag to index.html:
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
*/

export default {
  insertFinalProject,
  insertFeedback,
  getTopProjects,
  getProjectInfo,
  checkConnection,
  formatProjectForSubmission,
  formatFeedbackForSubmission,
};
