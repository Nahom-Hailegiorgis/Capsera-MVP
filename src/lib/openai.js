import OpenAI from "openai";

const apiKey = import.meta.env.VITE_OPENAI_API_KEY;

if (!apiKey) {
  console.error("Missing OpenAI API key. Please check your .env file.");
}

const openai = new OpenAI({
  apiKey: apiKey,
  dangerouslyAllowBrowser: true,
});

export async function evaluateIdea(ideaText, fullName, whoToServe) {
  try {
    console.log("Evaluating idea with OpenAI...");

    const prompt = `You are an AI evaluator for a product idea submission platform called Antithesis. Evaluate submissions based on these EXACT rules:

ALLOW: Any content that answers both fields, even if poorly written, vague, impractical, or with typos.

BLOCK ONLY FOR these 5 specific rules:
1. Spam/junk: Random strings, unrelated text, repeated automated submissions, meaningless gibberish
2. Personal contact info: Phone numbers, emails, street addresses, social media handles, private full names (public figures are OK)
3. Malicious content: Hate speech, harassment, sexual content unrelated to the idea, self-harm encouragement, dangerous illegal activity
4. Links to irrelevant/harmful content: URLs or references to harmful websites
5. Empty/near-empty: Less than 3 meaningful words in BOTH fields COMBINED

Fields to evaluate:
Full Name: "${fullName}"
Who You Serve: "${whoToServe}"
Product Idea: "${ideaText}"

Be extremely permissive - only reject clear violations. Poor ideas, vague concepts, and impractical suggestions should be APPROVED.

Provide a rough quality score (1-100) where even poor but legitimate ideas get 20-40 points.

Respond with ONLY this JSON format:
{
  "approved": true/false,
  "reason": "specific reason with rule number if rejected, or null if approved",
  "rough_score": number
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 250,
      temperature: 0.2,
    });

    const result = response.choices[0].message.content.trim();
    console.log("OpenAI evaluation result:", result);

    try {
      const evaluation = JSON.parse(result);

      if (evaluation.approved) {
        console.log(
          "Idea approved by OpenAI with score:",
          evaluation.rough_score
        );
        return {
          approved: true,
          visible: true,
          rejection_reason: null,
          rough_score: evaluation.rough_score || 50,
        };
      } else {
        console.log("Idea rejected by OpenAI:", evaluation.reason);
        return {
          approved: false,
          visible: false,
          rejection_reason: evaluation.reason || "Rejected by AI evaluation",
          rough_score: evaluation.rough_score || 10,
        };
      }
    } catch (parseError) {
      console.error("Failed to parse OpenAI response:", parseError);
      // Default to approval if we can't parse the response
      return {
        approved: true,
        visible: true,
        rejection_reason: null,
        rough_score: 50,
      };
    }
  } catch (error) {
    console.error("OpenAI API error:", error);
    // Default to approval on API errors to avoid blocking legitimate submissions
    return {
      approved: true,
      visible: true,
      rejection_reason: null,
      rough_score: 50,
    };
  }
}

export async function checkForDuplicates(
  newIdea,
  whoToServe,
  potentialMatches
) {
  try {
    console.log("Checking for duplicates with OpenAI...");

    if (!potentialMatches || potentialMatches.length === 0) {
      return { isDuplicate: false };
    }

    const matchesText = potentialMatches
      .map(
        (match, index) =>
          `${index + 1}. "${match.product_idea}" (serves: ${
            match.who_to_serve
          })`
      )
      .join("\n");

    const prompt = `You are checking if a new product idea submission is a duplicate of existing ones.

NEW SUBMISSION:
Who to serve: "${whoToServe}"
Product idea: "${newIdea}"

EXISTING SUBMISSIONS:
${matchesText}

Determine if the new submission is an exact or near-exact duplicate of any existing submission. Consider:
- Same core concept and target audience
- Minor wording differences don't make it unique
- Different implementation details of the same basic idea count as duplicates

Respond with ONLY a JSON object:
{
  "isDuplicate": true/false,
  "matchIndex": number (1-based index of matching submission, or null),
  "reason": "explanation if duplicate, or null"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.2,
    });

    const result = response.choices[0].message.content.trim();
    console.log("OpenAI duplicate check result:", result);

    try {
      const duplicateCheck = JSON.parse(result);

      if (duplicateCheck.isDuplicate) {
        console.log("Duplicate detected by OpenAI:", duplicateCheck.reason);
        return {
          isDuplicate: true,
          reason: duplicateCheck.reason || "Similar idea already exists",
        };
      } else {
        console.log("No duplicates found by OpenAI");
        return { isDuplicate: false };
      }
    } catch (parseError) {
      console.error("Failed to parse OpenAI duplicate response:", parseError);
      // Default to no duplicate if we can't parse
      return { isDuplicate: false };
    }
  } catch (error) {
    console.error("OpenAI duplicate check error:", error);
    // Default to no duplicate on API errors
    return { isDuplicate: false };
  }
}

export async function evaluateFeedback(feedbackText) {
  try {
    console.log("Evaluating feedback with OpenAI...");

    const prompt = `You are an AI moderator for user feedback on a product idea platform. Evaluate this feedback based on these EXACT rules:

ALLOW: Any genuine feedback, even if negative, poorly written, or brief.

BLOCK ONLY FOR these 5 specific rules:
1. Spam/junk: Random strings, unrelated promotional content, automated submissions, meaningless gibberish  
2. Personal contact info: Phone numbers, emails, street addresses, social media handles, private names
3. Malicious content: Hate speech, harassment, threats, sexual content, self-harm encouragement, dangerous illegal activity
4. Links to irrelevant/harmful content: URLs or references to harmful websites
5. Empty/near-empty: Less than 3 meaningful words total

Feedback Text: "${feedbackText}"

Be extremely permissive - only reject clear violations. Negative opinions and criticism should be APPROVED.

Respond with ONLY this JSON format:
{
  "approved": true/false,
  "reason": "specific reason with rule number if rejected, or null if approved"
}`;

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
      temperature: 0.2,
    });

    const result = response.choices[0].message.content.trim();
    console.log("OpenAI feedback evaluation result:", result);

    try {
      const evaluation = JSON.parse(result);

      if (evaluation.approved) {
        console.log("Feedback approved by OpenAI");
        return { approved: true };
      } else {
        console.log("Feedback rejected by OpenAI:", evaluation.reason);
        throw new Error(
          `Feedback rejected: ${
            evaluation.reason || "Inappropriate content detected"
          }`
        );
      }
    } catch (parseError) {
      console.error("Failed to parse OpenAI feedback response:", parseError);
      // Default to approval if we can't parse the response
      return { approved: true };
    }
  } catch (error) {
    console.error("OpenAI feedback evaluation error:", error);
    if (error.message.includes("rejected")) {
      throw error; // Re-throw rejection errors
    }
    // Default to approval on API errors
    return { approved: true };
  }
}
