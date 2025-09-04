// Netlify serverless function for Google Translate API proxy
// Implements caching headers and conservative usage

const { Translate } = require("@google-cloud/translate").v2;

// Initialize Google Translate client
let translate;
try {
  translate = new Translate({
    key: process.env.GOOGLE_TRANSLATE_KEY,
  });
} catch (error) {
  console.error("Failed to initialize Google Translate:", error);
}

// Rate limiting
const MAX_REQUESTS_PER_HOUR = 200;
const MAX_CHARS_PER_REQUEST = 5000;
const requestHistory = [];

function validateRequest(body) {
  const { text, targetLang } = body;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Text to translate is required");
  }

  if (text.length > MAX_CHARS_PER_REQUEST) {
    throw new Error(`Text too long (max ${MAX_CHARS_PER_REQUEST} characters)`);
  }

  if (
    !targetLang ||
    typeof targetLang !== "string" ||
    targetLang.trim().length === 0
  ) {
    throw new Error("Target language is required");
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
    throw new Error("Translation rate limit exceeded. Try again later.");
  }

  requestHistory.push(now);
}

// Language code normalization
function normalizeLanguageCode(lang) {
  const langMap = {
    hindi: "hi",
    bengali: "bn",
    telugu: "te",
    marathi: "mr",
    tamil: "ta",
    gujarati: "gu",
    urdu: "ur",
    malayalam: "ml",
    spanish: "es",
    french: "fr",
    german: "de",
    italian: "it",
    portuguese: "pt",
    russian: "ru",
    japanese: "ja",
    korean: "ko",
    chinese: "zh",
    arabic: "ar",
  };

  const normalized = lang.toLowerCase().trim();
  return langMap[normalized] || normalized;
}

// Check if text is likely already in target language
function isLikelyAlreadyTranslated(text, targetLang) {
  // Simple heuristic: if text is very short and common English words, don't translate
  const commonEnglishWords = [
    "the",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
  ];
  const words = text.toLowerCase().trim().split(/\s+/);

  if (targetLang === "en" && words.length <= 3) {
    return words.every((word) => commonEnglishWords.includes(word));
  }

  return false;
}

// Process translation request
async function processTranslationRequest(body) {
  const { text, targetLang } = body;

  const trimmedText = text.trim();
  const normalizedTargetLang = normalizeLanguageCode(targetLang);

  console.log(
    `Translating ${trimmedText.length} characters to ${normalizedTargetLang}`
  );

  // Skip translation if text is likely already in target language
  if (isLikelyAlreadyTranslated(trimmedText, normalizedTargetLang)) {
    console.log(
      "Text appears to already be in target language, skipping translation"
    );
    return {
      translatedText: trimmedText,
      detectedSourceLanguage: normalizedTargetLang,
      skipped: true,
    };
  }

  try {
    // Detect source language first
    const [detections] = await translate.detect(trimmedText);
    const detectedLang = Array.isArray(detections)
      ? detections[0].language
      : detections.language;

    console.log(`Detected source language: ${detectedLang}`);

    // Skip translation if source and target are the same
    if (detectedLang === normalizedTargetLang) {
      console.log(
        "Source and target languages are the same, skipping translation"
      );
      return {
        translatedText: trimmedText,
        detectedSourceLanguage: detectedLang,
        skipped: true,
      };
    }

    // Perform translation
    const [translation] = await translate.translate(trimmedText, {
      from: detectedLang,
      to: normalizedTargetLang,
    });

    console.log("Translation completed successfully");

    return {
      translatedText: translation,
      detectedSourceLanguage: detectedLang,
      targetLanguage: normalizedTargetLang,
      originalLength: trimmedText.length,
      translatedLength: translation.length,
      skipped: false,
    };
  } catch (error) {
    console.error("Google Translate API error:", error);

    // Check for common error types
    if (error.message.includes("quota")) {
      throw new Error("Translation quota exceeded. Please try again later.");
    }

    if (error.message.includes("invalid")) {
      throw new Error("Invalid language code or text format.");
    }

    // Fallback: return original text
    console.log("Translation failed, returning original text");
    return {
      translatedText: trimmedText,
      detectedSourceLanguage: "unknown",
      targetLanguage: normalizedTargetLang,
      error: error.message,
      fallback: true,
      skipped: false,
    };
  }
}

// Get supported languages (cached response)
async function getSupportedLanguages() {
  try {
    const [languages] = await translate.getLanguages("en");
    return languages.map((lang) => ({
      code: lang.code,
      name: lang.name,
    }));
  } catch (error) {
    console.error("Failed to get supported languages:", error);

    // Return common languages as fallback
    return [
      { code: "hi", name: "Hindi" },
      { code: "bn", name: "Bengali" },
      { code: "te", name: "Telugu" },
      { code: "mr", name: "Marathi" },
      { code: "ta", name: "Tamil" },
      { code: "gu", name: "Gujarati" },
      { code: "ur", name: "Urdu" },
      { code: "ml", name: "Malayalam" },
      { code: "es", name: "Spanish" },
      { code: "fr", name: "French" },
      { code: "de", name: "German" },
      { code: "zh", name: "Chinese" },
      { code: "ja", name: "Japanese" },
      { code: "ko", name: "Korean" },
      { code: "ar", name: "Arabic" },
      { code: "ru", name: "Russian" },
    ];
  }
}

// Main Netlify function handler
exports.handler = async (event, context) => {
  console.log("Google Translate proxy function called");

  // CORS headers with caching
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600", // Cache for 1 hour
  };

  // Handle OPTIONS request for CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers,
      body: "",
    };
  }

  // Handle GET request for supported languages
  if (event.httpMethod === "GET") {
    try {
      if (!translate) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: "Google Translate not configured" }),
        };
      }

      const languages = await getSupportedLanguages();

      return {
        statusCode: 200,
        headers: {
          ...headers,
          "Cache-Control": "public, max-age=86400", // Cache languages for 24 hours
        },
        body: JSON.stringify({ languages }),
      };
    } catch (error) {
      console.error("Error getting supported languages:", error);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to get supported languages" }),
      };
    }
  }

  // Only allow POST requests for translation
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // Check if API key is configured
    if (!process.env.GOOGLE_TRANSLATE_KEY || !translate) {
      console.error("GOOGLE_TRANSLATE_KEY not configured");
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Google Translate API not configured" }),
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

    // Process the translation
    const result = await processTranslationRequest(body);

    // Set appropriate cache headers based on whether translation was skipped
    if (result.skipped || result.fallback) {
      headers["Cache-Control"] = "public, max-age=300"; // 5 minutes for skipped/fallback
    } else {
      headers["Cache-Control"] = "public, max-age=604800"; // 1 week for successful translations
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error("Function error:", error);

    const statusCode = error.message.includes("rate limit")
      ? 429
      : error.message.includes("quota")
      ? 429
      : error.message.includes("invalid")
      ? 400
      : 500;

    return {
      statusCode,
      headers,
      body: JSON.stringify({
        error: error.message,
        timestamp: new Date().toISOString(),
      }),
    };
  }
};
