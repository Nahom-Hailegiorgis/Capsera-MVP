// Simple hash-based router for Capsera SPA
import { GlobalIdeas } from "./screens/GlobalIdeas.js";
import { MySubmissions } from "./screens/MySubmissions.js";
import { SubmitIdea } from "./screens/SubmitIdea.js";
import { Settings } from "./screens/Settings.js";

// Router state
let currentRoute = "";
let currentScreen = null;

// Route definitions
const routes = {
  "": "global-ideas", // Default route (#/)
  "global-ideas": "global-ideas",
  my: "my-submissions",
  submit: "submit-idea",
  settings: "settings",
};

// Screen components mapping
const screens = {
  "global-ideas": GlobalIdeas,
  "my-submissions": MySubmissions,
  "submit-idea": SubmitIdea,
  settings: Settings,
};

// Get current route from hash
function getCurrentRoute() {
  const hash = window.location.hash.slice(1); // Remove #
  const path = hash.startsWith("/") ? hash.slice(1) : hash; // Remove leading /
  return path || "";
}

// Navigate to a specific route
export function navigateTo(path) {
  const route = path.startsWith("#") ? path : `#/${path}`;
  window.location.hash = route;
}

// Update navigation active states
function updateNavigation(screenId) {
  const navLinks = document.querySelectorAll(".nav-link");

  navLinks.forEach((link) => {
    link.classList.remove("active");

    const href = link.getAttribute("href");
    if (href) {
      const linkRoute = href.slice(2) || ""; // Remove #/
      const targetScreen = routes[linkRoute];

      if (targetScreen === screenId) {
        link.classList.add("active");
      }
    }
  });
}

// Render a screen component
async function renderScreen(screenId) {
  const mainContent = document.getElementById("main-content");

  if (!mainContent) {
    console.error("Main content element not found");
    return;
  }

  // Show loading state
  mainContent.innerHTML =
    '<div class="loading"><div class="spinner"></div>Loading...</div>';

  try {
    const ScreenComponent = screens[screenId];

    if (!ScreenComponent) {
      throw new Error(`Screen component not found: ${screenId}`);
    }

    console.log(`Rendering screen: ${screenId}`);

    // Destroy current screen if it has a destroy method
    if (currentScreen && typeof currentScreen.destroy === "function") {
      await currentScreen.destroy();
    }

    // Create new screen instance
    currentScreen = new ScreenComponent();

    // Render the screen
    await currentScreen.render(mainContent);

    // Update navigation
    updateNavigation(screenId);

    console.log(`Screen rendered successfully: ${screenId}`);
  } catch (error) {
    console.error(`Failed to render screen ${screenId}:`, error);

    // Show error state
    mainContent.innerHTML = `
      <div class="error-state">
        <h2>Oops! Something went wrong</h2>
        <p>Failed to load the ${screenId} screen.</p>
        <button class="btn btn-primary" onclick="window.location.reload()">Refresh Page</button>
      </div>
    `;
  }
}

// Handle route changes
async function handleRouteChange() {
  const route = getCurrentRoute();

  if (route === currentRoute) {
    return; // No change
  }

  console.log(`Route changed: ${currentRoute} -> ${route}`);

  const screenId = routes[route];

  if (!screenId) {
    console.warn(`Unknown route: ${route}, redirecting to default`);
    navigateTo("");
    return;
  }

  currentRoute = route;
  await renderScreen(screenId);

  // Dispatch route change event
  window.dispatchEvent(
    new CustomEvent("routeChanged", {
      detail: { route, screenId },
    })
  );
}

// Initialize the router
export async function initRouter() {
  console.log("Initializing router...");

  // Listen for hash changes
  window.addEventListener("hashchange", handleRouteChange);

  // Listen for navigation clicks
  document.addEventListener("click", (event) => {
    const link = event.target.closest('a[href^="#/"]');
    if (link) {
      event.preventDefault();
      const href = link.getAttribute("href");
      window.location.hash = href;
    }
  });

  // Handle initial route
  await handleRouteChange();

  console.log("Router initialized successfully");
}

// Get current screen instance
export function getCurrentScreen() {
  return currentScreen;
}

// Check if a route exists
export function routeExists(route) {
  return route in routes;
}

// Get all available routes
export function getRoutes() {
  return { ...routes };
}

// Back navigation handler
export function goBack() {
  if (window.history.length > 1) {
    window.history.back();
  } else {
    navigateTo("");
  }
}

// Forward navigation handler
export function goForward() {
  window.history.forward();
}

// Refresh current screen
export async function refreshCurrentScreen() {
  if (currentScreen && typeof currentScreen.refresh === "function") {
    try {
      await currentScreen.refresh();
      console.log("Current screen refreshed");
    } catch (error) {
      console.error("Failed to refresh current screen:", error);
    }
  } else {
    // Re-render current screen
    const route = getCurrentRoute();
    const screenId = routes[route] || "global-ideas";
    await renderScreen(screenId);
  }
}

// Utility function to build URLs
export function buildUrl(path, params = {}) {
  let url = `#/${path}`;

  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      searchParams.append(key, value.toString());
    }
  });

  if (searchParams.toString()) {
    url += `?${searchParams.toString()}`;
  }

  return url;
}

// Get URL parameters from current route
export function getRouteParams() {
  const hash = window.location.hash;
  const questionMarkIndex = hash.indexOf("?");

  if (questionMarkIndex === -1) {
    return {};
  }

  const searchParams = new URLSearchParams(hash.slice(questionMarkIndex + 1));
  const params = {};

  for (const [key, value] of searchParams.entries()) {
    params[key] = value;
  }

  return params;
}

// Set page title based on current screen
function updatePageTitle(screenId) {
  const titles = {
    "global-ideas": "Global Ideas - Capsera",
    "my-submissions": "My Submissions - Capsera",
    "submit-idea": "Submit Idea - Capsera",
    settings: "Settings - Capsera",
  };

  document.title = titles[screenId] || "Capsera";
}

// Enhanced route change handler with title updates
const originalHandleRouteChange = handleRouteChange;
handleRouteChange = async function () {
  await originalHandleRouteChange();

  const route = getCurrentRoute();
  const screenId = routes[route] || "global-ideas";
  updatePageTitle(screenId);
};

// Browser back/forward button support
window.addEventListener("popstate", (event) => {
  console.log("Browser navigation detected");
  handleRouteChange();
});

// Keyboard navigation support
document.addEventListener("keydown", (event) => {
  // Alt + Left Arrow = Go back
  if (event.altKey && event.key === "ArrowLeft") {
    event.preventDefault();
    goBack();
  }

  // Alt + Right Arrow = Go forward
  if (event.altKey && event.key === "ArrowRight") {
    event.preventDefault();
    goForward();
  }

  // Ctrl/Cmd + R = Refresh current screen
  if ((event.ctrlKey || event.metaKey) && event.key === "r") {
    event.preventDefault();
    refreshCurrentScreen();
  }
});

// Mobile-friendly navigation gestures (basic swipe support)
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener("touchstart", (event) => {
  touchStartX = event.changedTouches[0].screenX;
});

document.addEventListener("touchend", (event) => {
  touchEndX = event.changedTouches[0].screenX;
  handleSwipeGesture();
});

function handleSwipeGesture() {
  const swipeThreshold = 100;
  const swipeDistance = touchEndX - touchStartX;

  // Right swipe = go back
  if (swipeDistance > swipeThreshold) {
    goBack();
  }

  // Left swipe = go forward
  if (swipeDistance < -swipeThreshold) {
    // Only enable forward swipe on certain screens to avoid conflicts
    const currentScreenId = routes[getCurrentRoute()];
    if (currentScreenId === "global-ideas") {
      navigateTo("my");
    }
  }
}

// Export router utilities
export default {
  init: initRouter,
  navigateTo,
  getCurrentRoute,
  getCurrentScreen,
  routeExists,
  getRoutes,
  goBack,
  goForward,
  refreshCurrentScreen,
  buildUrl,
  getRouteParams,
};

console.log("Router module loaded");
