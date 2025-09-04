// Netlify serverless function for OpenAI API proxy
// Implements conservative credit usage with smart model selection and structured scoring

const { Configuration, OpenAIApi } = require("openai");

// Initialize OpenAI with environment variable
const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// Model configurations - using cost-effective models
const MODELS = {
  small: "gpt-3.5-turbo", // Cheap, fast for initial scoring
  large: "gpt-4o-mini", // Better quality for detailed feedback
};

// Rate limiting and validation
const MAX_PROMPT_LENGTH = 10000;
const MAX_REQUESTS_PER_HOUR = 100;
const requestHistory = [];

function validateRequest(body) {
  const { prompt, draftNumber } = body;

  if (!prompt || typeof prompt !== "string" || prompt.trim().length === 0) {
    throw new Error("Valid prompt is required");
  }

  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt too long (max ${MAX_PROMPT_LENGTH} characters)`);
  }

  if (!draftNumber || ![1, 2, 3].includes(draftNumber)) {
    throw new Error("Draft number must be 1, 2, or 3");
  }
}

function checkRateLimit() {
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;

  // Clean old requests
  const recentRequests = requestHistory.filter((time) => time > oneHourAgo);
  requestHistory.length = 0;
  requestHistory.push(...recentRequests);

  if (recentRequests.length >= MAX_REQUESTS_PER_HOUR) {
    throw new Error("Rate limit exceeded. Try again later.");
  }

  requestHistory.push(now);
}

// Spam detection heuristics
function detectSpam(prompt) {
  const text = prompt.toLowerCase().trim();

  // Very short responses (likely not serious)
  if (text.length < 10) {
    return { isSpam: true, reason: "extremely_short" };
  }

  // Single character repeated
  if (/^(.)\1{5,}$/.test(text)) {
    return { isSpam: true, reason: "repeated_character" };
  }

  // Mostly nonsense characters
  const nonsenseRatio =
    (text.match(/[^a-z0-9\s.,!?]/g) || []).length / text.length;
  if (nonsenseRatio > 0.5) {
    return { isSpam: true, reason: "nonsense_characters" };
  }

  // Identical very short answers (placeholder detection)
  const shortAnswers = text.match(/\w{1,3}\b/g) || [];
  if (shortAnswers.length > 5 && new Set(shortAnswers).size < 3) {
    return { isSpam: true, reason: "placeholder_text" };
  }

  return { isSpam: false };
}

// Generate scoring prompt based on draft number and context
function generateScoringPrompt(prompt, draftNumber, previousScores = []) {
  const baseInstructions = `
You are an expert startup mentor evaluating business ideas. Score this submission on a scale of 0-100.

SCORING BASELINE:
- Start with base score of 70
- Add 0-10 points for: Problem clarity, Uniqueness vs competitors, Solution feasibility, User research evidence, Solution completeness, MVP/prototype evidence
- Maximum possible: 100 points
- Only score below 70 for spam, empty responses, or extremely low quality submissions

PROVIDE YOUR RESPONSE IN THIS EXACT JSON FORMAT:
{
  "score": [integer 0-100],
  "aiFeedback": {
    "pros": ["bullet point 1", "bullet point 2", ...],
    "cons": ["bullet point 1", "bullet point 2", ...],
    "nextSteps": ["actionable step 1", "actionable step 2", ...],
    "whyScore": "Brief explanation of the score"
  }
}`;

  let specificInstructions = "";

  if (draftNumber === 1) {
    specificInstructions = `
This is DRAFT 1. Focus on:
- Problem identification clarity
- Basic solution concept
- Initial market understanding
- Encourage customer interviews for Draft 2`;
  } else if (draftNumber === 2) {
    specificInstructions = `
This is DRAFT 2. Evaluate improvement from Draft 1:
- Market validation efforts (interviews, research)
- Competitive analysis depth
- MVP development progress
- Integration of feedback from Draft 1
${
  previousScores.length > 0
    ? `Previous score: ${previousScores[0]}. Award bonus points (up to +5) for meaningful iteration.`
    : ""
}`;
  } else if (draftNumber === 3) {
    specificInstructions = `
This is FINAL DRAFT 3. Comprehensive evaluation:
- Pitch quality and investor readiness
- Research depth and evidence
- MVP development and links
- Overall iteration and improvement journey
${
  previousScores.length > 0
    ? `Previous scores: ${previousScores.join(
        ", "
      )}. Award bonus points (up to +10) for strong iteration across all drafts.`
    : ""
}`;
  }

  return `${baseInstructions}\n\n${specificInstructions}\n\nSubmission to evaluate:\n${prompt}`;
}

// Process OpenAI request with two-stage approach
async function processOpenAIRequest(body) {
  const {
    prompt,
    draftNumber,
    modelPreference,
    detailed = false,
    previousScores = [],
  } = body;

  // Check for spam first
  const spamCheck = detectSpam(prompt);
  if (spamCheck.isSpam) {
    console.log("Spam detected:", spamCheck.reason);
    return {
      score: 25, // Low score for spam
      aiFeedback: {
        pros: ["Submission received"],
        cons: [
          "Response appears incomplete or placeholder",
          "Needs more detailed and thoughtful answers",
        ],
        nextSteps: [
          "Provide more detailed responses to each question",
          "Focus on specific, real examples",
          "Take time to thoughtfully consider each aspect of your idea",
        ],
        whyScore:
          "Score is low due to incomplete or placeholder responses. Please provide more thoughtful, detailed answers.",
      },
      debug: { spamDetected: true, reason: spamCheck.reason },
    };
  }

  // Select model based on preference and context
  let selectedModel = MODELS.small; // Default to cheaper model

  if (
    modelPreference === "large" ||
    (draftNumber === 3 && detailed) ||
    previousScores.some((score) => score < 70)
  ) {
    selectedModel = MODELS.large;
  }

  console.log(`Using model: ${selectedModel} for draft ${draftNumber}`);

  try {
    // Generate scoring prompt
    const scoringPrompt = generateScoringPrompt(
      prompt,
      draftNumber,
      previousScores
    );

    // First pass: Get basic score and feedback
    const completion = await openai.createChatCompletion({
      model: selectedModel,
      messages: [
        {
          role: "system",
          content:
            "You are an expert startup mentor. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content: scoringPrompt,
        },
      ],
      max_tokens: selectedModel === MODELS.large ? 800 : 500,
      temperature: 0.7,
    });

    const responseText = completion.data.choices[0].message.content.trim();
    console.log("OpenAI raw response length:", responseText.length);

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error("Failed to parse OpenAI response as JSON:", parseError);
      // Fallback response
      return {
        score: 75,
        aiFeedback: {
          pros: ["Idea submission received"],
          cons: ["Unable to provide detailed feedback due to processing error"],
          nextSteps: [
            "Try resubmitting with more structured responses",
            "Focus on clear, specific answers",
          ],
          whyScore: "Standard score due to processing limitations",
        },
        debug: {
          parseError: true,
          rawResponse: responseText.substring(0, 200),
        },
      };
    }

    // Validate and clean the response
    const score = Math.max(0, Math.min(100, parseInt(result.score) || 75));
    const aiFeedback = {
      pros: Array.isArray(result.aiFeedback?.pros)
        ? result.aiFeedback.pros
        : ["Idea has potential"],
      cons: Array.isArray(result.aiFeedback?.cons)
        ? result.aiFeedback.cons
        : ["Needs more development"],
      nextSteps: Array.isArray(result.aiFeedback?.nextSteps)
        ? result.aiFeedback.nextSteps
        : [
            "Develop your idea further",
            "Research your target market",
            "Consider potential competitors",
          ],
      whyScore:
        result.aiFeedback?.whyScore ||
        "Score based on overall submission quality",
    };

    console.log(`OpenAI scoring completed: ${score}/100`);

    return {
      score,
      aiFeedback,
      debug: {
        model: selectedModel,
        tokensUsed: completion.data.usage?.total_tokens,
        spamDetected: false,
      },
    };
  } catch (error) {
    console.error("OpenAI API error:", error);

    // Return fallback response on API errors
    return {
      score: 75,
      aiFeedback: {
        pros: ["Idea submission received"],
        cons: ["Unable to provide detailed feedback due to API limitations"],
        nextSteps: [
          "Continue developing your idea",
          "Consider market research",
          "Try submitting again later",
        ],
        whyScore: "Standard score due to technical limitations",
      },
      debug: { error: error.message, fallback: true },
    };
  }
}

// Main Netlify function handler
exports.handler = async (event, context) => {
  console.log("OpenAI proxy function called");

  // CORS headers
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    };
  }

  // Only allow POST requests
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // Check if API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.error("OPENAI_API_KEY not configured");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "OpenAI API not configured" }),
      };
    }

    // Parse request body
    let body;
    try {
      body = JSON.parse(event.body);
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid JSON in request body" }),
      };
    }

    // Validate request
    validateRequest(body);

    // Check rate limits
    checkRateLimit();

    // Process the request
    const result = await processOpenAIRequest(body);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("Function error:", error);

    return {
      statusCode: error.message.includes("Rate limit") ? 429 : 400,
      headers,
      body: JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
