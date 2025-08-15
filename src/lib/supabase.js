import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing Supabase configuration. Please check your .env file.");
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
  },
  global: {
    headers: {
      "x-device-id": getDeviceId(),
    },
  },
});

function getDeviceId() {
  let deviceId = localStorage.getItem("device_id");
  if (!deviceId) {
    deviceId =
      "device_" + Math.random().toString(36).substr(2, 9) + "_" + Date.now();
    localStorage.setItem("device_id", deviceId);
  }
  return deviceId;
}

export { getDeviceId };

// Ideas operations
export async function fetchIdeas() {
  try {
    console.log("Fetching ideas from Supabase...");
    const { data, error } = await supabase
      .from("ideas")
      .select("*")
      .order("timestamp", { ascending: false });

    if (error) {
      console.error("Supabase fetch ideas error:", error);
      throw error;
    }

    console.log(`Successfully fetched ${data.length} ideas`);
    return data || [];
  } catch (error) {
    console.error("Failed to fetch ideas:", error);
    throw error;
  }
}

export async function fetchMySubmissions() {
  try {
    const deviceId = getDeviceId();
    console.log(`Fetching submissions for device: ${deviceId}`);

    const { data, error } = await supabase
      .from("ideas")
      .select("*")
      .eq("device_id", deviceId)
      .order("timestamp", { ascending: false });

    if (error) {
      console.error("Supabase fetch submissions error:", error);
      throw error;
    }

    console.log(`Successfully fetched ${data.length} submissions`);
    return data || [];
  } catch (error) {
    console.error("Failed to fetch my submissions:", error);
    throw error;
  }
}

export async function findPotentialDuplicates(productIdea) {
  try {
    console.log("Searching for potential duplicates...");

    // Extract key words for search (remove common words)
    const searchTerms = productIdea
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 3 &&
          ![
            "this",
            "that",
            "with",
            "from",
            "they",
            "have",
            "will",
            "would",
            "could",
            "should",
          ].includes(word)
      )
      .slice(0, 5); // Use top 5 keywords

    if (searchTerms.length === 0) {
      return [];
    }

    // Build ILIKE query for multiple terms
    let query = supabase
      .from("ideas")
      .select("id, product_idea, who_to_serve, timestamp")
      .order("timestamp", { ascending: false })
      .limit(300);

    // Search for ideas containing any of the key terms
    const searchPattern = searchTerms.join("|");
    query = query.ilike("product_idea", `%${searchTerms[0]}%`);

    const { data, error } = await query;

    if (error) {
      console.error("Error searching for duplicates:", error);
      return [];
    }

    console.log(`Found ${data.length} potential matches for duplicate check`);
    return data || [];
  } catch (error) {
    console.error("Failed to search for duplicates:", error);
    return [];
  }
}

export async function submitIdea(ideaData) {
  try {
    const deviceId = getDeviceId();
    console.log("Submitting idea to Supabase...", ideaData);

    const submission = {
      ...ideaData,
      device_id: deviceId,
      timestamp: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("ideas")
      .insert([submission])
      .select();

    if (error) {
      console.error("Supabase insert error:", error);
      if (error.message.includes("RLS")) {
        console.error(
          "RLS Policy Decline: Row Level Security prevented this operation"
        );
        throw new Error("Access denied by security policy");
      }
      throw error;
    }

    console.log("Successfully submitted idea:", data);
    return data[0];
  } catch (error) {
    console.error("Failed to submit idea:", error);
    throw error;
  }
}

export async function submitFeedback(feedbackData) {
  try {
    const deviceId = getDeviceId();
    console.log("Submitting feedback to Supabase...", feedbackData);

    const submission = {
      ...feedbackData,
      device_id: deviceId,
      timestamp: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("feedback")
      .insert([submission])
      .select();

    if (error) {
      console.error("Supabase feedback insert error:", error);
      if (error.message.includes("RLS")) {
        console.error(
          "RLS Policy Decline: Row Level Security prevented this operation"
        );
        throw new Error("Access denied by security policy");
      }
      throw error;
    }

    console.log("Successfully submitted feedback:", data);
    return data[0];
  } catch (error) {
    console.error("Failed to submit feedback:", error);
    throw error;
  }
}
