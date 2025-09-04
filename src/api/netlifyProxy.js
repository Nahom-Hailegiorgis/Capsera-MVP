// Netlify serverless function proxy for OpenAI and Google Translate APIs
// Includes caching, debouncing, and credit-conscious usage

import { getCacheItem, setCacheItem, generateHash } from "../utils/idb.js";

// Debounce map for avoiding rapid successive calls
const debounceMap = new Map();
const DEBOUNCE_DELAY = 800; // milliseconds

// Request rate limiting
const requestHistory = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 20;

// Cache settings
const OPENAI_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const TRANSLATE_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

// Utility function to check rate limits
function checkRateLimit(endpoint) {
  const now = Date.now();
  const key = `rate_limit_${endpoint}`;

  if (!requestHistory.has(key)) {
    requestHistory.set(key, []);
  }

  const requests = requestHistory.get(key);

  // Remove old requests outside the window
  const validRequests = requests.filter(
    (time) => now - time < RATE_LIMIT_WINDOW
  );
  requestHistory.set(key, validRequests);

  if (validRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    throw new Error("Rate limit exceeded. Please try again in a moment.");
  }

  // Add current request
  validRequests.push(now);
}

// Debounced function wrapper
function debounce(func, key, delay = DEBOUNCE_DELAY) {
  return new Promise((resolve, reject) => {
    if (debounceMap.has(key)) {
      clearTimeout(debounceMap.get(key));
    }

    const timeoutId = setTimeout(async () => {
      try {
        const result = await func();
        resolve(result);
      } catch (error) {
        reject(error);
      } finally {
        debounceMap.delete(key);
      }
    }, delay);

    debounceMap.set(key, timeoutId);
  });
}

// Generate cache key for OpenAI requests
async function generateOpenAICacheKey(prompt, draftNumber, model) {
  const keyString = `openai_${prompt}_${draftNumber}_${model}`;
  return await generateHash(keyString);
}

// Generate cache key for translation requests
async function generateTranslateCacheKey(text, targetLang) {
  const keyString = `translate_${text}_${targetLang}`;
  return await generateHash(keyString);
}

// OpenAI API proxy with caching and smart model selection
export async function postOpenAI(prompt, draftNumber = 1, options = {}) {
  console.log("OpenAI request initiated:", { draftNumber, options });

  // Validate inputs
  if (!prompt || prompt.trim().length === 0) {
    throw new Error("Prompt cannot be empty");
  }

  if (prompt.length > 10000) {
    throw new Error("Prompt too long (max 10,000 characters)");
  }

  const {
    modelPreference = "auto", // 'small', 'large', 'auto'
    detailed = false,
    previousScores = [],
    previousFeedback = [],
  } = options;

  // Smart model selection based on draft number and options
  let selectedModel = "gpt-3.5-turbo"; // Default to cheaper model

  if (
    modelPreference === "large" ||
    (draftNumber === 3 && detailed) ||
    (modelPreference === "auto" &&
      (previousScores.some((score) => score < 70) || detailed))
  ) {
    selectedModel = "gpt-4o-mini"; // More expensive but better quality
  }

  // Generate cache key
  const cacheKey = await generateOpenAICacheKey(
    prompt + JSON.stringify(previousScores),
    draftNumber,
    selectedModel
  );

  // Check cache first
  try {
    const cached = await getCacheItem(cacheKey);
    if (
      cached &&
      Date.now() - new Date(cached.createdAt).getTime() < OPENAI_CACHE_DURATION
    ) {
      console.log("OpenAI cache hit:", cacheKey.substring(0, 8));
      return cached.data;
    }
  } catch (error) {
    console.warn("Cache check failed:", error);
  }

  // Debounce to avoid rapid successive calls
  const debounceKey = `openai_${cacheKey.substring(0, 16)}`;

  return debounce(async () => {
    // Check rate limits
    checkRateLimit("openai");

    const requestPayload = {
      prompt: prompt.trim(),
      draftNumber,
      modelPreference: selectedModel,
      detailed,
      previousScores,
      previousFeedback,
    };

    try {
      console.log(
        `Calling OpenAI via Netlify function (model: ${selectedModel})`
      );

      const response = await fetch("/api/openai-proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      // Validate response structure
      if (!result.score || !result.aiFeedback) {
        throw new Error("Invalid OpenAI response structure");
      }

      // Cache the result
      try {
        await setCacheItem(cacheKey, result, "openai");
        console.log("OpenAI result cached");
      } catch (error) {
        console.warn("Failed to cache OpenAI result:", error);
      }

      console.log("OpenAI request completed successfully");
      return result;
    } catch (error) {
      console.error("OpenAI request failed:", error);
      throw error;
    }
  }, debounceKey);
}

// Google Translate API proxy with caching
export async function postTranslate(text, targetLang) {
  console.log("Translation request initiated:", {
    targetLang,
    textLength: text.length,
  });

  // Validate inputs
  if (!text || text.trim().length === 0) {
    throw new Error("Text to translate cannot be empty");
  }

  if (!targetLang || targetLang.trim().length === 0) {
    throw new Error("Target language is required");
  }

  if (text.length > 5000) {
    throw new Error("Text too long for translation (max 5,000 characters)");
  }

  const trimmedText = text.trim();
  const normalizedLang = targetLang.toLowerCase().trim();

  // Generate cache key
  const cacheKey = await generateTranslateCacheKey(trimmedText, normalizedLang);

  // Check cache first
  try {
    const cached = await getCacheItem(cacheKey);
    if (
      cached &&
      Date.now() - new Date(cached.createdAt).getTime() <
        TRANSLATE_CACHE_DURATION
    ) {
      console.log("Translation cache hit:", normalizedLang);
      return cached.data;
    }
  } catch (error) {
    console.warn("Translation cache check failed:", error);
  }

  // Debounce to avoid rapid successive calls
  const debounceKey = `translate_${cacheKey.substring(0, 16)}`;

  return debounce(async () => {
    // Check rate limits
    checkRateLimit("translate");

    const requestPayload = {
      text: trimmedText,
      targetLang: normalizedLang,
    };

    try {
      console.log(
        `Calling Google Translate via Netlify function (target: ${normalizedLang})`
      );

      const response = await fetch("/api/translate-proxy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Translation API error: ${response.status} ${errorText}`
        );
      }

      const result = await response.json();

      // Validate response structure
      if (!result.translatedText) {
        throw new Error("Invalid translation response structure");
      }

      // Cache the result
      try {
        await setCacheItem(cacheKey, result, "translate");
        console.log("Translation result cached");
      } catch (error) {
        console.warn("Failed to cache translation result:", error);
      }

      console.log("Translation request completed successfully");
      return result;
    } catch (error) {
      console.error("Translation request failed:", error);
      throw error;
    }
  }, debounceKey);
}

// Batch translation for multiple strings
export async function batchTranslate(textArray, targetLang) {
  console.log("Batch translation request:", {
    count: textArray.length,
    targetLang,
  });

  if (!Array.isArray(textArray) || textArray.length === 0) {
    throw new Error("Text array is required for batch translation");
  }

  const results = {};
  const uncachedTexts = [];

  // Check cache for each text
  for (const text of textArray) {
    try {
      const cacheKey = await generateTranslateCacheKey(text, targetLang);
      const cached = await getCacheItem(cacheKey);

      if (
        cached &&
        Date.now() - new Date(cached.createdAt).getTime() <
          TRANSLATE_CACHE_DURATION
      ) {
        results[text] = cached.data.translatedText;
      } else {
        uncachedTexts.push(text);
      }
    } catch (error) {
      console.warn("Cache check failed for text:", text.substring(0, 50));
      uncachedTexts.push(text);
    }
  }

  console.log(
    `Batch translation: ${Object.keys(results).length} cached, ${
      uncachedTexts.length
    } to translate`
  );

  // Translate uncached texts individually (with small delays to avoid rate limits)
  for (let i = 0; i < uncachedTexts.length; i++) {
    const text = uncachedTexts[i];

    try {
      const translationResult = await postTranslate(text, targetLang);
      results[text] = translationResult.translatedText;

      // Small delay between requests to avoid overwhelming the API
      if (i < uncachedTexts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error) {
      console.error(
        `Failed to translate text: ${text.substring(0, 50)}`,
        error
      );
      results[text] = text; // Fallback to original text
    }
  }

  return results;
}

// Get cached OpenAI results for debugging
export async function getOpenAICacheInfo() {
  try {
    // This would need to query the cache store by type
    // Implementation depends on the cache structure in idb.js
    console.log("Getting OpenAI cache info...");
    return {
      message: "Cache info not implemented yet",
      // TODO: Implement cache statistics
    };
  } catch (error) {
    console.error("Failed to get cache info:", error);
    return { error: error.message };
  }
}

// Get cached translation results for debugging
export async function getTranslationCacheInfo() {
  try {
    console.log("Getting translation cache info...");
    return {
      message: "Cache info not implemented yet",
      // TODO: Implement cache statistics
    };
  } catch (error) {
    console.error("Failed to get translation cache info:", error);
    return { error: error.message };
  }
}

// Clear API caches (for development)
export async function clearAPICaches() {
  try {
    // This would need to clear cache items by type
    console.log("Clearing API caches...");
    return {
      message: "Cache clearing not implemented yet",
      // TODO: Implement cache clearing
    };
  } catch (error) {
    console.error("Failed to clear caches:", error);
    return { error: error.message };
  }
}

// Check API connectivity
export async function checkAPIConnectivity() {
  const status = {
    openai: false,
    translate: false,
    timestamp: new Date().toISOString(),
  };

  // Test OpenAI connectivity
  try {
    const testResult = await fetch("/api/openai-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test connectivity",
        draftNumber: 1,
        modelPreference: "gpt-3.5-turbo",
      }),
    });

    status.openai = testResult.ok;
  } catch (error) {
    console.warn("OpenAI connectivity test failed:", error);
    status.openai = false;
  }

  // Test Translation connectivity
  try {
    const testResult = await fetch("/api/translate-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "Test",
        targetLang: "es",
      }),
    });

    status.translate = testResult.ok;
  } catch (error) {
    console.warn("Translation connectivity test failed:", error);
    status.translate = false;
  }

  return status;
}

// Utility function to estimate API costs (for development monitoring)
export function estimateAPICosts(requests) {
  // Rough cost estimates (as of 2024)
  const costs = {
    "gpt-3.5-turbo": 0.0015, // per 1K tokens
    "gpt-4o-mini": 0.00015, // per 1K tokens
    translate: 0.00002, // per character
  };

  let totalCost = 0;
  let breakdown = {};

  for (const request of requests) {
    const { type, model, tokens, characters } = request;
    let requestCost = 0;

    if (type === "openai" && tokens) {
      const rate = costs[model] || costs["gpt-3.5-turbo"];
      requestCost = (tokens / 1000) * rate;
      breakdown[`${model}_requests`] =
        (breakdown[`${model}_requests`] || 0) + 1;
    } else if (type === "translate" && characters) {
      requestCost = characters * costs.translate;
      breakdown.translate_requests = (breakdown.translate_requests || 0) + 1;
    }

    totalCost += requestCost;
  }

  return {
    totalEstimatedCost: Math.round(totalCost * 100) / 100, // Round to 2 decimal places
    breakdown,
    currency: "USD",
  };
}

// Export utility functions for external use
export default {
  postOpenAI,
  postTranslate,
  batchTranslate,
  getOpenAICacheInfo,
  getTranslationCacheInfo,
  clearAPICaches,
  checkAPIConnectivity,
  estimateAPICosts,
};

console.log("Netlify proxy utilities loaded");
