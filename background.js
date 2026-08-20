// Background service worker for Smart Tab Organiser extension
importScripts('ai-models.js');

console.log('Smart Tab Organiser extension background service worker loaded');

const PR_GROUP_TITLE = 'PRs';
const CLOSED_GROUP_TITLE = 'Closed';
const ALWAYS_PRESERVED_GROUP_NAMES = ['BOOKMARKS', 'PRS'];
const GITHUB_API_VERSION = '2022-11-28';

/** Extract a complete bracketed slice starting at `start` (handles strings/escapes). */
function extractBracketedSlice(text, start) {
  if (start < 0 || start >= text.length || text[start] !== '[') return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  let stringChar = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === stringChar) inString = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = true;
      stringChar = c;
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function resolveTargetWindowId(windowId) {
  if (Number.isInteger(windowId) && windowId >= 0) return windowId;
  return (await chrome.windows.getCurrent()).id;
}

function tabQueryForWindow(windowId) {
  return Number.isInteger(windowId) && windowId >= 0
    ? { windowId }
    : { currentWindow: true };
}

function getAlwaysPreservedGroupNames(closedIssueGroupEnabled) {
  const names = new Set(ALWAYS_PRESERVED_GROUP_NAMES);
  if (closedIssueGroupEnabled === true) names.add(CLOSED_GROUP_TITLE.toUpperCase());
  return names;
}

/** Parse a min-group-size setting: any non-negative integer is valid (0 included), default 1. */
function parseMinTabs(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

function normalizeTabIndices(indices) {
  if (!Array.isArray(indices)) return [];
  return indices
    .map((idx) => (typeof idx === 'string' ? parseInt(idx, 10) : idx))
    .filter((idx) => Number.isInteger(idx) && idx > 0);
}

function isValidGroupsArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every(
    (g) =>
      g &&
      typeof g === 'object' &&
      typeof g.groupName === 'string' &&
      Array.isArray(g.tabIndices) &&
      normalizeTabIndices(g.tabIndices).length > 0
  );
}

/** Parse AI tab-grouping response; ignores non-JSON bracketed text like [domain.com]. */
function parseAiGroupsResponse(content) {
  const candidates = [];

  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) candidates.push(fenceMatch[1].trim());

  const trimmed = content.trim();
  if (trimmed.startsWith('[')) candidates.push(trimmed);

  let pos = 0;
  while ((pos = content.indexOf('[', pos)) !== -1) {
    const slice = extractBracketedSlice(content, pos);
    if (slice) {
      candidates.push(slice);
      pos += slice.length;
    } else {
      pos++;
    }
  }

  const seen = new Set();
  const unique = candidates.filter((c) => {
    if (seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  unique.sort((a, b) => {
    const aScore = a.startsWith('[{') ? 0 : 1;
    const bScore = b.startsWith('[{') ? 0 : 1;
    return aScore - bScore || b.length - a.length;
  });

  for (const jsonStr of unique) {
    try {
      let parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed) && parsed && typeof parsed === 'object' && parsed.groupName) {
        parsed = [parsed];
      }
      if (!isValidGroupsArray(parsed)) continue;
      return parsed.map((g) => ({
        groupName: g.groupName,
        tabIndices: normalizeTabIndices(g.tabIndices),
      }));
    } catch (_) {
      // try next candidate
    }
  }
  return null;
}

// ---- AI provider error handling --------------------------------------------------------------
const PROVIDER_LABELS = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
  'chrome-ai': 'Chrome built-in AI',
  local: 'Local model'
};
// Providers that never send tab data off the machine.
const ON_DEVICE_PROVIDERS = ['chrome-ai', 'local'];

function isOnDeviceProvider(provider) {
  return ON_DEVICE_PROVIDERS.includes(provider);
}

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider;
}

class AiProviderError extends Error {
  constructor({ provider, status, message, rawBody, cause }) {
    super(message || 'AI provider error');
    this.name = 'AiProviderError';
    this.provider = provider;
    this.status = status || null;
    this.rawBody = rawBody;
    if (cause) this.cause = cause;
  }
}

/** Try multiple known paths to pull a useful error message out of an API JSON body. */
function extractProviderErrorMessage(body) {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body.message === 'string') return body.message;
  if (body.error) {
    if (typeof body.error === 'string') return body.error;
    if (typeof body.error.message === 'string') return body.error.message;
    if (Array.isArray(body.error) && body.error[0]?.message) return body.error[0].message;
  }
  if (Array.isArray(body.errors) && body.errors[0]?.message) return body.errors[0].message;
  try {
    return JSON.stringify(body);
  } catch (_) {
    return String(body);
  }
}

/** Translate any thrown error from a provider call into a user-friendly classification. */
function classifyAiError(err) {
  const provider = err?.provider;
  const status = err?.status || null;
  const baseMsg = err?.message || String(err) || '';
  const lower = baseMsg.toLowerCase();
  const label = provider ? providerLabel(provider) : 'AI provider';

  if (lower.includes('cors')) {
    return {
      type: 'cors',
      provider,
      summary: `${label} blocked browser access (CORS).`,
      detail: baseMsg,
      hint: `Your ${label} organization has disabled direct browser access. Use a different key or switch provider.`,
    };
  }
  if (status === 401 || /invalid api key|authentication|unauthorized/.test(lower)) {
    return {
      type: 'auth',
      provider,
      summary: `${label} rejected the API key (HTTP 401).`,
      detail: baseMsg,
      hint: `Update the ${label} API key in Smart Tab Organiser settings.`,
    };
  }
  if (status === 403 || /forbidden|permission denied|not allowed/.test(lower)) {
    return {
      type: 'forbidden',
      provider,
      summary: `${label} denied the request (HTTP 403).`,
      detail: baseMsg,
      hint: `Your ${label} key may not have access to the selected model.`,
    };
  }
  if (status === 429 || /rate limit|quota|too many requests/.test(lower)) {
    return {
      type: 'rateLimit',
      provider,
      summary: `${label} rate limit hit (HTTP 429).`,
      detail: baseMsg,
      hint: `Wait a moment, switch ${label} model, or enable fallback providers.`,
    };
  }
  if (status === 404 || /model.*not found|no such model/.test(lower)) {
    return {
      type: 'modelMissing',
      provider,
      summary: `${label} model not available.`,
      detail: baseMsg,
      hint: `Pick a different ${label} model in settings.`,
    };
  }
  if (status && status >= 500) {
    return {
      type: 'server',
      provider,
      summary: `${label} server error (HTTP ${status}).`,
      detail: baseMsg,
      hint: `${label} is having issues. Try again or enable fallback providers.`,
    };
  }
  if (/failed to fetch|network|networkerror/.test(lower)) {
    return {
      type: 'network',
      provider,
      summary: `${label} network error.`,
      detail: baseMsg,
      hint: 'Check your internet connection or try a different provider.',
    };
  }
  if (/used all .* tokens on hidden reasoning|reasoning model .* produced no output/.test(lower)) {
    return {
      type: 'reasoningExhausted',
      provider,
      summary: `${label} reasoning model spent all tokens on hidden reasoning.`,
      detail: baseMsg,
      hint: `Switch to a non-reasoning ${label} model (e.g. GPT-4.1 / gpt-4o) in settings.`,
    };
  }
  if (/finish_reason=length|response was cut off/.test(lower)) {
    return {
      type: 'truncated',
      provider,
      summary: `${label} response was cut off (output too long).`,
      detail: baseMsg,
      hint: `Reduce the number of tabs, or switch to a model with a larger output budget.`,
    };
  }
  if (/no response from|invalid response format|returned no content|isn't a json array|isn’t a json array/.test(lower)) {
    return {
      type: 'badResponse',
      provider,
      summary: `${label} returned an unexpected response.`,
      detail: baseMsg,
      hint: `Try again, switch ${label} model, or use a different provider.`,
    };
  }
  if (/api key not configured/.test(lower)) {
    return {
      type: 'missingKey',
      provider,
      summary: `${label} API key not configured.`,
      detail: baseMsg,
      hint: `Add a ${label} API key in Smart Tab Organiser settings.`,
    };
  }
  return {
    type: 'unknown',
    provider,
    summary: status ? `${label} error (HTTP ${status}).` : `${label} error.`,
    detail: baseMsg,
    hint: '',
  };
}

/** Single-line short summary suitable for the cramped Chrome notification body. */
function shortFailureLabel(classification) {
  // Strip leading "<Provider> " from the summary so we can prefix with provider label ourselves
  const label = classification.provider ? providerLabel(classification.provider) : '';
  const summary = classification.summary || '';
  const stripped = label && summary.startsWith(label + ' ') ? summary.slice(label.length + 1) : summary;
  // Drop trailing period for tighter list rendering
  return stripped.replace(/\.$/, '');
}

/** Compose a single message describing all provider failures for extension UI. */
function buildMultiProviderErrorMessage(failures) {
  if (!failures || failures.length === 0) return 'AI organization failed.';
  if (failures.length === 1) {
    const c = failures[0].classification;
    return c.hint ? `${c.summary} ${c.hint}` : c.summary;
  }
  const lines = failures.map((f) => `• ${providerLabel(f.provider)}: ${shortFailureLabel(f.classification)}`);
  // For multi-failure notifications, keep it tight: list providers + one shared next step.
  return `${lines.join('\n')}\nOpen extension options for details and fixes.`;
}

// ---- end AI provider error handling ----------------------------------------------------------

// Initialize default settings on install
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('Extension installed');
    chrome.storage.local.set({
      ignoreQuery: true,
      ignoreHash: true,
      reloadTabs: false
    });
  } else if (details.reason === 'update') {
    console.log('Extension updated');
  }
  // Context menu: right-click extension icon
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'dedupe-and-organize',
      title: 'Deduplicate AND organize tabs with AI',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'reload-all-tabs',
      title: 'Reload all tabs',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'collapse-all-groups',
      title: 'Collapse all tab groups',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'expand-all-groups',
      title: 'Expand all tab groups',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'edit-extension-options',
      title: 'Edit extension options',
      contexts: ['action']
    });
  });
  // Update badge and context menu state on install/update
  updateBadge();
});

let isOrganizing = false;
let loadingSpinnerInterval = null;

// Update badge when extension starts
updateBadge();

// Circle quadrant spinner – visible, symmetrical, well-centered in badge
const SPINNER_CHARS = ['◐', '◓', '◑', '◒'];
let spinnerIndex = 0;

// Animated loading spinner badge
function startLoadingSpinner() {
  chrome.action.setBadgeBackgroundColor({ color: '#2196F3' });
  const tick = () => {
    chrome.action.setBadgeText({ text: SPINNER_CHARS[spinnerIndex] });
    spinnerIndex = (spinnerIndex + 1) % SPINNER_CHARS.length;
  };
  tick(); // show first frame immediately
  loadingSpinnerInterval = setInterval(tick, 80); // ~3 rotations/sec with 4 frames
}

function stopLoadingSpinner() {
  if (loadingSpinnerInterval) {
    clearInterval(loadingSpinnerInterval);
    loadingSpinnerInterval = null;
  }
  chrome.action.setBadgeText({ text: '' });
}

// Run organize with badge + notification feedback (for icon/context menu/command)
async function runOrganizeWithFeedback(windowId) {
  if (isOrganizing) return;
  isOrganizing = true;

  // Show animated spinner badge
  startLoadingSpinner();
  chrome.action.setTitle({ title: 'Organizing tabs...' });
  chrome.contextMenus.update('dedupe-and-organize', { enabled: false }).catch(() => {});

  try {
    const targetWindowId = await resolveTargetWindowId(windowId);
    const settings = await chrome.storage.local.get([
      'ignoreQuery', 'ignoreHash', 'reloadTabs',
      'customInstructionsOptions', 'preserveGroups', 'preserveGroupsMinTabs', 'mergeIntoExisting'
    ]);
    // Refresh enabled GitHub groups first, then dedupe, tidy pinned tabs, and organize with AI.
    await syncEnabledGitHubTabGroups(targetWindowId).catch(() => {});
    const ignoreQuery = settings.ignoreQuery !== false;
    const ignoreHash = settings.ignoreHash !== false;
    const reloadTabs = settings.reloadTabs === true;
    await closeDuplicates(ignoreQuery, ignoreHash, reloadTabs, targetWindowId);
    await dedupeAndTidyPinned(ignoreQuery, ignoreHash, targetWindowId);

    const preserveGroups = settings.preserveGroups !== false;
    const preserveGroupsMinTabs = parseMinTabs(settings.preserveGroupsMinTabs);
    const mergeIntoExisting = settings.mergeIntoExisting === true;
    const customInstructions = settings.customInstructionsOptions || '';

    chrome.notifications.create('organize-progress', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Organizing tabs',
      message: 'AI is organizing your tabs...'
    });

    const result = await organizeTabs(preserveGroups, mergeIntoExisting, customInstructions, preserveGroupsMinTabs, targetWindowId);
    chrome.notifications.clear('organize-progress');
    if (!result.success) {
      const failures = result.failures || [];
      const title = failures.length > 1
        ? `AI organization failed (tried ${failures.length} providers)`
        : failures.length === 1
          ? `AI organization failed — ${failures[0].providerLabel}`
          : 'AI organization failed';
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title,
        message: result.error || 'An error occurred'
      });
      return;
    }
    const fb = result.fallbackInfo;
    const titleSuccess = fb
      ? `Tabs organized (used ${providerLabel(fb.providerUsed)} fallback)`
      : 'Tabs organized';
    let message = `Organized ${result.groupedCount} tab(s) into ${result.groupCount} group(s).`;
    if (fb) {
      message += `\n${fb.primaryFailedLabel} failed: ${fb.primaryFailedSummary}`;
    }
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: titleSuccess,
      message
    });
  } catch (err) {
    chrome.notifications.clear('organize-progress');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Organization failed',
      message: err.message || 'An error occurred'
    });
  } finally {
    isOrganizing = false;
    stopLoadingSpinner();
    chrome.action.setTitle({ title: 'Dedupe and tidy pinned tabs (left-click)' }).catch(() => {});
    chrome.contextMenus.update('dedupe-and-organize', { enabled: true }).catch(() => {});
    updateBadge(); // Restore duplicate-count badge
  }
}

// Deduplicate then tidy pinned tabs (unpin non-matching, pin & order matching)
async function runDedupeAndTidyPinned(windowId) {
  try {
    const targetWindowId = await resolveTargetWindowId(windowId);
    const settings = await chrome.storage.local.get([
      'ignoreQuery', 'ignoreHash', 'reloadTabs'
    ]);
    await syncEnabledGitHubTabGroups(targetWindowId).catch(() => {});
    const ignoreQuery = settings.ignoreQuery !== false;
    const ignoreHash = settings.ignoreHash !== false;
    const reloadTabs = settings.reloadTabs === true;
    await closeDuplicates(ignoreQuery, ignoreHash, reloadTabs, targetWindowId);
    const result = await dedupeAndTidyPinned(ignoreQuery, ignoreHash, targetWindowId);
    if (result.success) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Pinned tabs tidied',
        message: result.message || 'Pinned tabs updated.'
      });
    } else {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon128.png'),
        title: 'Tidy pinned tabs failed',
        message: result.error || 'An error occurred'
      });
    }
    updateBadge();
  } catch (error) {
    console.error('Error in runDedupeAndTidyPinned:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Tidy pinned tabs failed',
      message: error.message || 'An error occurred'
    });
    updateBadge();
  }
}

// Handle extension icon left click - dedupe then tidy pinned tabs
// (or the full dedupe + AI organize flow when "Organize tabs on click" is enabled)
chrome.action.onClicked.addListener(async (tab) => {
  try {
    const { organizeOnClick } = await chrome.storage.local.get(['organizeOnClick']);
    if (organizeOnClick === true) {
      await runOrganizeWithFeedback(tab?.windowId);
    } else {
      await runDedupeAndTidyPinned(tab?.windowId);
    }
  } catch (error) {
    console.error('Error on extension icon click:', error);
  }
});

// Right-click extension icon -> context menu
async function collapseAllTabGroups() {
  try {
    const window = await chrome.windows.getLastFocused();
    if (!window?.id) return;
    const groups = await chrome.tabGroups.query({ windowId: window.id });
    await Promise.all(groups.map(g => chrome.tabGroups.update(g.id, { collapsed: true })));
  } catch (err) {
    console.error('Error collapsing tab groups:', err);
  }
}

async function expandAllTabGroups() {
  try {
    const window = await chrome.windows.getLastFocused();
    if (!window?.id) return;
    const groups = await chrome.tabGroups.query({ windowId: window.id });
    await Promise.all(groups.map(g => chrome.tabGroups.update(g.id, { collapsed: false })));
  } catch (err) {
    console.error('Error expanding tab groups:', err);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'dedupe-and-organize') {
    runOrganizeWithFeedback(tab?.windowId);
  } else if (info.menuItemId === 'reload-all-tabs') {
    reloadAllTabs(tab?.windowId);
  } else if (info.menuItemId === 'collapse-all-groups') {
    collapseAllTabGroups();
  } else if (info.menuItemId === 'expand-all-groups') {
    expandAllTabGroups();
  } else if (info.menuItemId === 'edit-extension-options') {
    chrome.runtime.openOptionsPage();
  }
});

// Keyboard shortcut: Cmd+Shift+O (Mac) / Ctrl+Shift+O (Windows)
chrome.commands.onCommand.addListener((command) => {
  if (command === 'organize-tabs') {
    runOrganizeWithFeedback();
  }
});

// Count duplicate tabs
async function countDuplicates() {
  try {
    const settings = await chrome.storage.local.get(['ignoreQuery', 'ignoreHash']);
    const ignoreQuery = settings.ignoreQuery !== false; // default to true
    const ignoreHash = settings.ignoreHash !== false; // default to true
    
    // Get all tabs in the current window with URLs loaded (handles suspended tabs)
    let tabs = await getAllTabsWithUrls();
    tabs = await refreshTabsForDedupe(tabs);
    
    if (tabs.length <= 1) {
      return 0;
    }
    
    // Group tabs by normalized URL
    const tabGroups = new Map();
    
    tabs.forEach(tab => {
      // Skip invalid or special URLs
      if (!isValidUrl(tab.url)) {
        return;
      }
      
      const normalizedUrl = normalizeUrl(tab.url, ignoreQuery, ignoreHash);
      
      // Skip invalid normalized URLs (they won't match anything anyway)
      if (normalizedUrl.startsWith('__invalid__') || normalizedUrl.startsWith('__error__')) {
        return;
      }
      
      if (!tabGroups.has(normalizedUrl)) {
        tabGroups.set(normalizedUrl, []);
      }
      
      tabGroups.get(normalizedUrl).push(tab);
    });
    
    // Count duplicates (tabs that would be closed)
    let duplicateCount = 0;
    
    tabGroups.forEach((groupTabs) => {
      if (groupTabs.length > 1) {
        // All but one are duplicates
        duplicateCount += groupTabs.length - 1;
      }
    });
    
    return duplicateCount;
  } catch (error) {
    console.error('Error counting duplicates:', error);
    return 0;
  }
}

// Update the badge text and context menu enabled state
async function updateBadge() {
  if (isOrganizing) return; // the progress spinner owns the badge while organizing
  const duplicateCount = await countDuplicates();
  if (isOrganizing) return;

  if (duplicateCount > 0) {
    chrome.action.setBadgeText({ text: duplicateCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Tab events fire in bursts (onUpdated fires several times per page load) and each
// badge update queries every tab, so coalesce them.
let updateBadgeTimer = null;
function scheduleBadgeUpdate() {
  if (updateBadgeTimer) clearTimeout(updateBadgeTimer);
  updateBadgeTimer = setTimeout(() => {
    updateBadgeTimer = null;
    updateBadge();
  }, 300);
}

// Update badge when tabs are created, updated, or removed
chrome.tabs.onCreated.addListener(scheduleBadgeUpdate);

chrome.tabs.onUpdated.addListener(scheduleBadgeUpdate);

chrome.tabs.onRemoved.addListener(scheduleBadgeUpdate);

chrome.tabs.onActivated.addListener(scheduleBadgeUpdate);

// Also update badge when window focus changes (user switches windows)
chrome.windows.onFocusChanged.addListener(scheduleBadgeUpdate);

// Check if URL is valid and processable
function isValidUrl(url) {
  if (!url || typeof url !== 'string' || url.trim() === '') {
    return false;
  }
  
  // Skip special Chrome URLs
  if (url.startsWith('chrome://') || 
      url.startsWith('chrome-extension://') ||
      url.startsWith('about:') ||
      url.startsWith('edge://') ||
      url.startsWith('moz-extension://')) {
    return false;
  }
  
  // Check if it's a valid URL format
  try {
    new URL(url);
    return true;
  } catch (e) {
    return false;
  }
}

function isStaleTabError(e) {
  const msg = e?.message || String(e);
  return msg.includes('No tab with id');
}

// Ensure tab has a URL loaded (handles suspended/inactive tabs in Arc)
async function ensureTabUrl(tab) {
  // If tab already has a valid URL, return it
  if (tab.url && isValidUrl(tab.url)) {
    return tab.url;
  }

  // Tab may have been closed between query and get (common during badge updates)
  try {
    const fullTab = await chrome.tabs.get(tab.id);
    if (fullTab.url && isValidUrl(fullTab.url)) {
      return fullTab.url;
    }
  } catch (e) {
    if (isStaleTabError(e)) {
      return null;
    }
    console.warn(`Could not load URL for tab ${tab.id}:`, e);
  }

  return tab.url || '';
}

// HTTP(S) tabs suitable for AI organization (after URLs are resolved)
function isOrganizableHttpTab(tab) {
  const url = tab.url || '';
  return !url.startsWith('chrome://') &&
    !url.startsWith('chrome-extension://') &&
    !url.startsWith('edge://') &&
    !url.startsWith('about:') &&
    url.startsWith('http');
}

async function getOrganizableTabs(windowId) {
  const tabs = await getAllTabsWithUrls(windowId);
  return tabs.filter(isOrganizableHttpTab);
}

/** Drop tab ids that were closed during a long async operation. */
async function filterExistingTabIds(tabIds) {
  const existing = await Promise.all(
    tabIds.map(async (id) => {
      try {
        await chrome.tabs.get(id);
        return id;
      } catch (e) {
        return isStaleTabError(e) ? null : Promise.reject(e);
      }
    })
  );
  return existing.filter((id) => id !== null);
}

/** Keep only tabs that still match the snapshot sent to the AI provider. */
async function filterUnchangedTabIds(tabIds, snapshotsById, windowId) {
  const unchanged = await Promise.all(
    tabIds.map(async (id) => {
      const snapshot = snapshotsById.get(id);
      if (!snapshot) return null;

      try {
        const tab = await chrome.tabs.get(id);
        const currentUrl = tab.url || '';
        const snapshotUrl = snapshot.url || '';
        const snapshotWasNavigating = snapshot.pendingUrl && snapshot.pendingUrl !== snapshotUrl;
        const tabIsNavigating = tab.pendingUrl && tab.pendingUrl !== currentUrl;
        if (snapshotWasNavigating || tabIsNavigating) return null;
        if (tab.windowId !== windowId || tab.pinned || isInSplitView(tab)) return null;
        if (tab.groupId !== snapshot.groupId || currentUrl !== snapshotUrl) return null;
        return id;
      } catch (error) {
        return isStaleTabError(error) ? null : Promise.reject(error);
      }
    })
  );
  return unchanged.filter((id) => id !== null);
}

// Get all tabs with their URLs loaded (handles suspended tabs)
async function getAllTabsWithUrls(windowId) {
  const tabs = await chrome.tabs.query(tabQueryForWindow(windowId));
  
  // For tabs without URLs, try to load them
  // This is especially important for Arc browser which suspends inactive tabs
  const tabsWithUrls = await Promise.all(
    tabs.map(async (tab) => {
      const url = await ensureTabUrl(tab);
      if (url === null) return null;
      return { ...tab, url };
    })
  );

  return tabsWithUrls.filter(Boolean);
}

// Normalize URL for comparison
function normalizeUrl(url, ignoreQuery, ignoreHash) {
  // Validate URL first
  if (!isValidUrl(url)) {
    // Return a unique identifier for invalid URLs so they don't match anything
    return `__invalid__${url}`;
  }
  
  try {
    const urlObj = new URL(url);
    
    // Normalize hostname to lowercase (domains are case-insensitive)
    urlObj.hostname = urlObj.hostname.toLowerCase();
    
    // Normalize pathname to lowercase (most web servers treat paths as case-insensitive)
    // This handles cases like GitHub where repository names are case-insensitive
    urlObj.pathname = urlObj.pathname.toLowerCase();
    
    // Remove hash if ignoring it
    if (ignoreHash) {
      urlObj.hash = '';
    }
    
    // Remove query if ignoring it
    if (ignoreQuery) {
      urlObj.search = '';
    }
    
    // Normalize default index files
    const pathname = urlObj.pathname
      .replace(/\/index\.(html|htm|xhtml|php|cgi|aspx)$/i, '/')
      .replace(/\/$/, '/');
    
    urlObj.pathname = pathname;
    
    return urlObj.toString();
  } catch (e) {
    // Fallback for any unexpected errors
    console.error('Error normalizing URL:', e, url);
    return `__error__${url}`;
  }
}

// Extract number from anchor/hash
function extractAnchorNumber(url) {
  // Validate URL first
  if (!isValidUrl(url)) {
    return 0;
  }
  
  try {
    const urlObj = new URL(url);
    const hash = urlObj.hash;
    
    if (!hash) {
      return 0; // No anchor, treat as base (lowest priority)
    }
    
    // Extract all numbers from the hash
    const numbers = hash.match(/\d+/g);
    if (!numbers || numbers.length === 0) {
      return 0;
    }
    
    // Get the largest number found in the hash
    // For GitHub: #issuecomment-3595795518 -> 3595795518
    const maxNumber = Math.max(...numbers.map(n => parseInt(n, 10)));
    return maxNumber;
  } catch (e) {
    return 0;
  }
}

// Chrome 140+ Split View: closing or moving a split tab unsplits the pair.
const SPLIT_VIEW_NONE = typeof chrome.tabs?.SPLIT_VIEW_ID_NONE === 'number'
  ? chrome.tabs.SPLIT_VIEW_ID_NONE
  : -1;

function isInSplitView(tab) {
  const id = tab?.splitViewId;
  return typeof id === 'number' && id !== SPLIT_VIEW_NONE;
}

/** Prefer keeping split-view tabs over non-split duplicates (overrides recency). */
function compareSplitViewPreference(tab1, tab2) {
  const t1Split = isInSplitView(tab1);
  const t2Split = isInSplitView(tab2);
  if (t1Split && !t2Split) return -1;
  if (!t1Split && t2Split) return 1;
  return 0;
}

function compareTabsByRecency(tab1, tab2, ignoreHash) {
  const num1 = extractAnchorNumber(tab1.url);
  const num2 = extractAnchorNumber(tab2.url);

  if (num1 > num2) return -1;
  if (num2 > num1) return 1;
  return (tab2.lastAccessed || 0) - (tab1.lastAccessed || 0);
}

/** Prefer keeping pinned tabs over unpinned duplicates. */
function comparePinnedPreference(tab1, tab2) {
  if (tab1.pinned && !tab2.pinned) return -1;
  if (!tab1.pinned && tab2.pinned) return 1;
  return 0;
}

// Split view > pinned > PR group > highest anchor / most recent
function compareTabsWithPrGroup(tab1, tab2, ignoreHash, prGroupId) {
  const splitPref = compareSplitViewPreference(tab1, tab2);
  if (splitPref !== 0) return splitPref;
  const pinnedPref = comparePinnedPreference(tab1, tab2);
  if (pinnedPref !== 0) return pinnedPref;
  if (prGroupId != null) {
    const t1InPr = tab1.groupId === prGroupId;
    const t2InPr = tab2.groupId === prGroupId;
    if (t1InPr && !t2InPr) return -1;
    if (!t1InPr && t2InPr) return 1;
  }
  return compareTabsByRecency(tab1, tab2, ignoreHash);
}

async function refreshTabsForDedupe(tabs) {
  return Promise.all(
    tabs.map(async (tab) => {
      try {
        const fresh = await chrome.tabs.get(tab.id);
        return {
          ...tab,
          url: tab.url,
          splitViewId: fresh.splitViewId,
          lastAccessed: fresh.lastAccessed,
          groupId: fresh.groupId,
        };
      } catch {
        return tab;
      }
    })
  );
}

// Close duplicate tabs
async function closeDuplicates(ignoreQuery, ignoreHash, reloadTabs, windowId) {
  try {
    // Get all tabs in the target window with URLs loaded (handles suspended tabs)
    let tabs = await getAllTabsWithUrls(windowId);
    tabs = await refreshTabsForDedupe(tabs);

    if (tabs.length <= 1) {
      return {
        success: true,
        closedCount: 0,
        keptCount: tabs.length,
        message: 'No duplicate tabs found'
      };
    }

    // Resolve PR group id when feature is enabled (prefer tab in PR group when deduping)
    let prGroupId = null;
    const prSettings = await chrome.storage.local.get(['prGroupEnabled']);
    if (prSettings.prGroupEnabled === true && tabs[0].windowId) {
      const groups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
      const prGroup = groups.find(g => (g.title || '').trim() === PR_GROUP_TITLE);
      if (prGroup) prGroupId = prGroup.id;
    }
    
    // Group tabs by normalized URL
    const tabGroups = new Map();
    
    tabs.forEach(tab => {
      // Skip invalid or special URLs
      if (!isValidUrl(tab.url)) {
        return;
      }
      
      const normalizedUrl = normalizeUrl(tab.url, ignoreQuery, ignoreHash);
      
      // Skip invalid normalized URLs (they won't match anything anyway)
      if (normalizedUrl.startsWith('__invalid__') || normalizedUrl.startsWith('__error__')) {
        return;
      }
      
      if (!tabGroups.has(normalizedUrl)) {
        tabGroups.set(normalizedUrl, []);
      }
      
      tabGroups.get(normalizedUrl).push(tab);
    });
    
    // Find tabs to close
    const tabsToClose = [];
    const tabsToKeep = [];
    
    tabGroups.forEach((groupTabs, normalizedUrl) => {
      if (groupTabs.length <= 1) {
        // No duplicates in this group
        tabsToKeep.push(...groupTabs);
        return;
      }
      
      // Sort to find the best tab to keep: split view > in PR group > highest anchor / most recent
      groupTabs.sort((a, b) => compareTabsWithPrGroup(a, b, ignoreHash, prGroupId));
      
      // Keep the first one (highest anchor number or most recent)
      const tabToKeep = groupTabs[0];
      tabsToKeep.push(tabToKeep);
      
      // Mark the rest for closing
      for (let i = 1; i < groupTabs.length; i++) {
        tabsToClose.push(groupTabs[i].id);
      }
    });
    
    // Close duplicate tabs
    let closedCount = 0;
    if (tabsToClose.length > 0) {
      await Promise.all(tabsToClose.map(tabId => chrome.tabs.remove(tabId)));
      closedCount = tabsToClose.length;
    }
    
    // Reload remaining tabs if requested (skip split-view tabs — reload can unsplit)
    if (reloadTabs && tabsToKeep.length > 0) {
      const reloadPromises = tabsToKeep
        .filter((tab) => !isInSplitView(tab))
        .map((tab) =>
          chrome.tabs.reload(tab.id).catch((err) => {
            console.error(`Failed to reload tab ${tab.id}:`, err);
          })
        );
      await Promise.all(reloadPromises);
    }
    
    // Update badge after closing duplicates
    updateBadge();
    
    return {
      success: true,
      closedCount,
      keptCount: tabsToKeep.length,
      message: `Closed ${closedCount} duplicate tab(s)`
    };
  } catch (error) {
    console.error('Error closing duplicates:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Reload all tabs
async function reloadAllTabs(windowId) {
  try {
    const tabs = await chrome.tabs.query(tabQueryForWindow(windowId));
    const reloadPromises = tabs.map(tab => 
      chrome.tabs.reload(tab.id).catch(err => {
        console.error(`Failed to reload tab ${tab.id}:`, err);
        return null;
      })
    );
    
    const results = await Promise.all(reloadPromises);
    const reloadedCount = results.filter(r => r !== null).length;
    
    return {
      success: true,
      reloadedCount,
      message: `Reloaded ${reloadedCount} tab(s)`
    };
  } catch (error) {
    console.error('Error reloading tabs:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Get normalized pinned URL entries from storage (uses current ignoreQuery/ignoreHash).
// - * prefix = hard prefix match (create tab if missing when pinning).
// - ~ prefix = soft: only pin when a matching tab already exists; never create a tab.
// - ~* = soft prefix (e.g. ~*https://app.slack.com/). Plain ~https://... = soft exact.
// Each entry has rawUrl (for creating tabs) and soft (true = do not create tab).
function getPinnedEntries(list, ignoreQuery, ignoreHash) {
  const lines = Array.isArray(list) ? list : (typeof list === 'string' ? list.split('\n').map(s => s.trim()).filter(Boolean) : []);
  const entries = [];
  const exactSet = new Set();
  for (const line of lines) {
    let rest = line.trim();
    const soft = rest.startsWith('~');
    if (soft) rest = rest.slice(1).trim();
    const isPrefix = rest.startsWith('*');
    const urlPart = (isPrefix ? rest.slice(1).trim() : rest).trim();
    if (!urlPart) continue;
    const normalized = normalizeUrl(urlPart, ignoreQuery, ignoreHash);
    if (normalized.startsWith('__invalid__') || normalized.startsWith('__error__')) continue;
    entries.push({ type: isPrefix ? 'prefix' : 'exact', pattern: normalized, rawUrl: urlPart, soft: !!soft });
    if (!isPrefix) exactSet.add(normalized);
  }
  const prefixPatterns = entries.filter(e => e.type === 'prefix').map(e => e.pattern);
  return { entries, exactSet, prefixPatterns };
}

function tabMatchesPinnedList(tabNorm, { exactSet, prefixPatterns }) {
  return exactSet.has(tabNorm) || prefixPatterns.some(p => tabNorm.startsWith(p));
}

function getPinnedOrderIndex(tabNorm, entries) {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === 'exact' && tabNorm === e.pattern) return i;
    if (e.type === 'prefix' && tabNorm.startsWith(e.pattern)) return i;
  }
  return entries.length;
}

async function getPinnedUrlSetAndOrder(ignoreQuery, ignoreHash) {
  const stored = await chrome.storage.local.get(['pinnedUrls']);
  const raw = stored.pinnedUrls;
  return getPinnedEntries(raw || [], ignoreQuery, ignoreHash);
}

// Ensure tabs from the pinned URL list are Chrome-pinned in the window.
// Creates new tabs for hard entries not already open; pins and orders them.
// Returns { pinned: true } if any tabs were pinned, { pinned: false } otherwise.
async function ensurePinnedTabsExist(windowId, ignoreQuery, ignoreHash) {
  const { entries } = await getPinnedUrlSetAndOrder(ignoreQuery, ignoreHash);
  if (entries.length === 0) {
    return { pinned: false };
  }

  const allTabs = await chrome.tabs.query({ windowId });
  const tabsWithUrls = (await Promise.all(
    allTabs.map(async (tab) => {
      const url = await ensureTabUrl(tab);
      if (url === null) return null;
      return { ...tab, url };
    })
  )).filter(Boolean);

  const usedTabIds = new Set();
  const tabIdsInOrder = [];

  for (const entry of entries) {
    const norm = entry.pattern;
    const isPrefix = entry.type === 'prefix';

    const existingTab = tabsWithUrls.find(t => {
      if (!t.url || !isValidUrl(t.url) || usedTabIds.has(t.id) || isInSplitView(t)) return false;
      const tNorm = normalizeUrl(t.url, ignoreQuery, ignoreHash);
      if (tNorm.startsWith('__invalid__') || tNorm.startsWith('__error__')) return false;
      if (isPrefix) return tNorm.startsWith(norm);
      return tNorm === norm;
    });

    if (existingTab) {
      usedTabIds.add(existingTab.id);
      tabIdsInOrder.push(existingTab.id);
      continue;
    }

    if (entry.soft) continue;

    const urlToOpen = entry.rawUrl || (await getRawPinnedUrlForNormalized(norm, ignoreQuery, ignoreHash));
    const newTab = await chrome.tabs.create({ url: urlToOpen, windowId });
    tabIdsInOrder.push(newTab.id);
    usedTabIds.add(newTab.id);
  }

  if (tabIdsInOrder.length === 0) {
    return { pinned: false };
  }

  for (const tabId of tabIdsInOrder) {
    await chrome.tabs.update(tabId, { pinned: true });
  }
  for (let i = 0; i < tabIdsInOrder.length; i++) {
    await chrome.tabs.move(tabIdsInOrder[i], { index: i });
  }
  return { pinned: true };
}

// Helper: get raw URL string for an exact normalized pattern from stored pinned list (skips soft and prefix lines).
async function getRawPinnedUrlForNormalized(normalizedPattern, ignoreQuery, ignoreHash) {
  const rawStored = await chrome.storage.local.get(['pinnedUrls']);
  const rawList = Array.isArray(rawStored.pinnedUrls)
    ? rawStored.pinnedUrls
    : (typeof rawStored.pinnedUrls === 'string' ? rawStored.pinnedUrls.split('\n').map(s => s.trim()).filter(Boolean) : []);
  for (const line of rawList) {
    if (!line) continue;
    let rest = line.trim();
    if (rest.startsWith('~')) rest = rest.slice(1).trim();
    if (rest.startsWith('*')) continue; // exact lookup only
    const normalized = normalizeUrl(rest, ignoreQuery, ignoreHash);
    if (normalized === normalizedPattern) return rest;
  }
  return normalizedPattern;
}

// Deduplicate then tidy pinned tabs: unpin tabs not in the pinned URL list, pin & order matching ones.
async function dedupeAndTidyPinned(ignoreQuery, ignoreHash, windowId) {
  try {
    const tabs = await chrome.tabs.query(tabQueryForWindow(windowId));
    if (!tabs.length) {
      return { success: false, error: 'No tabs in window' };
    }
    const targetWindowId = tabs[0].windowId;
    const { entries, exactSet, prefixPatterns } = await getPinnedUrlSetAndOrder(ignoreQuery, ignoreHash);

    // Apply BOOKMARKS group colour if that group exists
    const colorSettings = await chrome.storage.local.get(['bookmarksGroupColor']);
    const bookmarksColor = colorSettings.bookmarksGroupColor || 'yellow';
    const groups = await chrome.tabGroups.query({ windowId: targetWindowId });
    const bookmarksGroup = groups.find(g => (g.title || '').trim().toUpperCase() === 'BOOKMARKS');
    if (bookmarksGroup) {
      await chrome.tabGroups.update(bookmarksGroup.id, { color: bookmarksColor });
    }

    const currentlyPinned = tabs.filter(t => t.pinned);

    if (entries.length === 0 && currentlyPinned.length === 0) {
      return { success: true, message: 'No pinned URLs configured and no pinned tabs; nothing to tidy.' };
    }

    if (entries.length === 0) {
      return { success: true, message: 'No pinned URLs configured; pinned tabs unchanged.' };
    }

    // If no tabs are currently pinned, ensure they exist from the list
    if (currentlyPinned.length === 0) {
      const result = await ensurePinnedTabsExist(targetWindowId, ignoreQuery, ignoreHash);
      if (result.pinned) {
        return { success: true, message: 'Pinned tabs created from your list.' };
      }
      return { success: true, message: 'No matching tabs to pin.' };
    }

    // Unpin tabs that don't match the pinned URL list (never touch split-view tabs)
    const toUnpin = [];
    const toKeep = [];
    for (const tab of currentlyPinned) {
      if (isInSplitView(tab)) {
        toKeep.push(tab);
        continue;
      }
      const url = tab.url || '';
      if (!isValidUrl(url)) {
        toKeep.push(tab);
        continue;
      }
      const norm = normalizeUrl(url, ignoreQuery, ignoreHash);
      if (tabMatchesPinnedList(norm, { exactSet, prefixPatterns })) {
        toKeep.push(tab);
      } else {
        toUnpin.push(tab);
      }
    }

    for (const tab of toUnpin) {
      await chrome.tabs.update(tab.id, { pinned: false });
    }

    // Pin any unpinned tabs that match the list
    const allTabsNow = await chrome.tabs.query({ windowId: targetWindowId });
    const tabsWithUrls = (await Promise.all(
      allTabsNow.map(async (tab) => {
        const url = await ensureTabUrl(tab);
        if (url === null) return null;
        return { ...tab, url };
      })
    )).filter(Boolean);
    const alreadyPinnedIds = new Set(toKeep.map(t => t.id));

    for (const entry of entries) {
      const norm = entry.pattern;
      const isPrefix = entry.type === 'prefix';
      const alreadyHave = toKeep.some(t => {
        const tNorm = normalizeUrl(t.url || '', ignoreQuery, ignoreHash);
        return isPrefix ? tNorm.startsWith(norm) : tNorm === norm;
      });
      if (alreadyHave) continue;

      const matchingTab = tabsWithUrls.find(t => {
        if (!t.url || !isValidUrl(t.url) || alreadyPinnedIds.has(t.id) || isInSplitView(t)) return false;
        const tNorm = normalizeUrl(t.url, ignoreQuery, ignoreHash);
        if (tNorm.startsWith('__invalid__') || tNorm.startsWith('__error__')) return false;
        return isPrefix ? tNorm.startsWith(norm) : tNorm === norm;
      });

      if (matchingTab) {
        await chrome.tabs.update(matchingTab.id, { pinned: true });
        alreadyPinnedIds.add(matchingTab.id);
        toKeep.push(matchingTab);
      } else if (!entry.soft) {
        const urlToOpen = entry.rawUrl || (await getRawPinnedUrlForNormalized(norm, ignoreQuery, ignoreHash));
        const newTab = await chrome.tabs.create({ url: urlToOpen, windowId: targetWindowId, pinned: true });
        alreadyPinnedIds.add(newTab.id);
        toKeep.push(newTab);
      }
    }

    // Order pinned tabs to match the list (split-view tabs stay put — moving them unsplits)
    const toReorder = toKeep.filter((t) => !isInSplitView(t));
    toReorder.sort((a, b) => {
      const na = normalizeUrl(a.url || '', ignoreQuery, ignoreHash);
      const nb = normalizeUrl(b.url || '', ignoreQuery, ignoreHash);
      return getPinnedOrderIndex(na, entries) - getPinnedOrderIndex(nb, entries);
    });
    const splitPinnedCount = toKeep.length - toReorder.length;
    for (let i = 0; i < toReorder.length; i++) {
      await chrome.tabs.move(toReorder[i].id, { index: splitPinnedCount + i });
    }

    const unpinned = toUnpin.length;
    return {
      success: true,
      message: unpinned > 0
        ? `Unpinned ${unpinned} tab(s) and reordered pinned tabs.`
        : 'Reordered pinned tabs to match your list.'
    };
  } catch (error) {
    console.error('Error in dedupeAndTidyPinned:', error);
    const msg = error.message || String(error);
    if (msg.includes('Tabs cannot be edited')) {
      return { success: false, error: 'Please try again in a moment. Release any tab you\'re dragging and don\'t move tabs while the extension is running.' };
    }
    if (msg.includes('No tab with id')) {
      return { success: false, error: 'A tab was closed or changed during the operation. Please try again.' };
    }
    return { success: false, error: msg };
  }
}

function githubApiHeaders(githubToken) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken.trim()}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION
  };
}

function isGitHubRateLimitResponse(response, data) {
  return response.status === 429 || (
    response.status === 403 && (
      response.headers.get('x-ratelimit-remaining') === '0' ||
      /rate limit/i.test(data.message || '')
    )
  );
}

// Fetch open PR URLs from GitHub (authored by user or review-requested)
async function fetchOpenPrUrls(githubToken) {
  if (!githubToken || !githubToken.trim()) {
    return { prUrls: [], error: 'GitHub token not set' };
  }
  const headers = githubApiHeaders(githubToken);
  try {
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) {
      const err = await userRes.json().catch(() => ({}));
      if (userRes.status === 401) return { prUrls: [], error: 'Invalid or expired GitHub token' };
      if (isGitHubRateLimitResponse(userRes, err)) return { prUrls: [], error: 'GitHub rate limit exceeded' };
      return { prUrls: [], error: err.message || `GitHub API error: ${userRes.status}` };
    }
    const user = await userRes.json();
    const login = user.login;
    if (!login) return { prUrls: [], error: 'Could not get GitHub username' };

    const prUrls = new Set();
    const addFromSearch = async (q) => {
      const res = await fetch(`https://api.github.com/search/issues?per_page=100&q=${encodeURIComponent(q)}`, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (isGitHubRateLimitResponse(res, err)) return { rateLimited: true };
        // A failed search must abort the sync: an empty result here would be
        // indistinguishable from "no open PRs" and the PR group would be cleared.
        return { error: err.message || `GitHub search error: ${res.status}` };
      }
      const data = await res.json();
      if (!Array.isArray(data.items)) return {};
      for (const item of data.items) {
        const repo = item.repository_url && item.repository_url.replace(/^https:\/\/api\.github\.com\/repos\//, '');
        if (repo && item.number) {
          const url = `https://github.com/${repo}/pull/${item.number}`;
          prUrls.add(url);
        }
      }
      return {};
    };

    const authorQ = `is:pr is:open author:${login}`;
    const reviewQ = `is:pr is:open review-requested:${login}`;
    let err1 = await addFromSearch(authorQ);
    if (err1.rateLimited) return { prUrls: [], error: 'GitHub rate limit exceeded' };
    if (err1.error) return { prUrls: [], error: err1.error };
    let err2 = await addFromSearch(reviewQ);
    if (err2.rateLimited) return { prUrls: [], error: 'GitHub rate limit exceeded' };
    if (err2.error) return { prUrls: [], error: err2.error };

    return { prUrls: Array.from(prUrls) };
  } catch (e) {
    console.error('fetchOpenPrUrls error:', e);
    return { prUrls: [], error: e.message || 'Failed to fetch PRs' };
  }
}

// Build a canonical GitHub PR URL for matching: github.com/owner/repo/pull/number.
function normalizedPrUrl(rawUrl, ignoreQuery, ignoreHash) {
  if (!isValidUrl(rawUrl)) return null;
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'github.com' && hostname !== 'www.github.com') return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4 || parts[2].toLowerCase() !== 'pull' || !/^\d+$/.test(parts[3])) {
      return null;
    }

    url.hostname = 'github.com';
    url.pathname = `/${parts.slice(0, 4).join('/')}`;
    return normalizeUrl(url.toString(), ignoreQuery !== false, ignoreHash !== false);
  } catch {
    return null;
  }
}

// Create or get PR tab group in window; sync tabs to match prUrls. Returns { success, message?, error? }.
async function syncPrTabGroup(windowId) {
  const settings = await chrome.storage.local.get(['githubToken', 'prGroupEnabled', 'ignoreQuery', 'ignoreHash']);
  if (!settings.githubToken?.trim()) {
    return { success: false, error: 'GitHub token not set' };
  }
  const targetWindowId = await resolveTargetWindowId(windowId);
  const win = await chrome.windows.get(targetWindowId);
  const { prUrls, error: fetchError } = await fetchOpenPrUrls(settings.githubToken);
  if (fetchError) return { success: false, error: fetchError };
  if (prUrls.length === 0) {
    // Clear the managed group without closing the user's tabs.
    const groups = await chrome.tabGroups.query({ windowId: win.id });
    const prGroup = groups.find(g => (g.title || '').trim() === PR_GROUP_TITLE);
    let ungroupedCount = 0;
    if (prGroup) {
      const existingTabs = await chrome.tabs.query({ groupId: prGroup.id });
      const existingTabIds = existingTabs
        .filter(tab => !isInSplitView(tab))
        .filter(tab => normalizedPrUrl(tab.pendingUrl || tab.url || '', true, true))
        .map(tab => tab.id);
      if (existingTabIds.length > 0) {
        await chrome.tabs.ungroup(existingTabIds);
        ungroupedCount = existingTabIds.length;
      }
    }
    return {
      success: true,
      message: ungroupedCount > 0
        ? `No open PRs; removed ${ungroupedCount} tab(s) from the PRs group without closing them.`
        : 'No open PRs; the PRs group is empty.'
    };
  }

  const ignoreQuery = settings.ignoreQuery !== false;
  const ignoreHash = settings.ignoreHash !== false;
  const targetNorm = new Set(prUrls.map(u => normalizedPrUrl(u, ignoreQuery, ignoreHash)).filter(Boolean));

  const allTabs = await chrome.tabs.query({ windowId: win.id });
  const tabsWithUrls = (await Promise.all(
    allTabs.map(async (tab) => {
      const url = await ensureTabUrl(tab);
      if (url === null) return null;
      return { ...tab, url };
    })
  )).filter(Boolean);

  let prGroupId = null;
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  let prGroup = groups.find(g => (g.title || '').trim() === PR_GROUP_TITLE);

  // Tabs already in PR group that match a current PR URL (normalized)
  const inPrGroupByNorm = new Map();
  if (prGroup) {
    prGroupId = prGroup.id;
    const inPr = await chrome.tabs.query({ groupId: prGroup.id });
    for (const tab of inPr) {
      const u = tab.pendingUrl || tab.url || '';
      if (!isValidUrl(u)) continue;
      const norm = normalizedPrUrl(u, ignoreQuery, ignoreHash);
      if (norm && targetNorm.has(norm)) inPrGroupByNorm.set(norm, tab);
    }
  }

  // For each PR URL, ensure one tab in the window is in the PR group (reuse existing or create)
  const usedTabIds = new Set();
  const orderPrUrls = prUrls.slice();
  orderPrUrls.sort((a, b) => a.localeCompare(b));

  for (const prUrl of orderPrUrls) {
    const norm = normalizedPrUrl(prUrl, ignoreQuery, ignoreHash);
    if (!norm) continue;
    const existing = inPrGroupByNorm.get(norm);
    if (existing) {
      usedTabIds.add(existing.id);
      continue;
    }
    // Prefer a tab elsewhere in the window with this URL (never pull from a split view)
    const sameUrlTab = tabsWithUrls.find(t => {
      if (!t.url || !isValidUrl(t.url) || isInSplitView(t)) return false;
      const tNorm = normalizedPrUrl(t.url, ignoreQuery, ignoreHash);
      return tNorm === norm && !usedTabIds.has(t.id);
    });
    if (sameUrlTab) {
      usedTabIds.add(sameUrlTab.id);
      if (prGroupId == null) {
        prGroupId = await chrome.tabs.group({
          tabIds: [sameUrlTab.id],
          createProperties: { windowId: win.id }
        });
        prGroup = (await chrome.tabGroups.query({ windowId: win.id })).find(g => g.id === prGroupId);
        await chrome.tabGroups.update(prGroupId, { title: PR_GROUP_TITLE, color: 'blue' });
      } else {
        const currentInGroup = await chrome.tabs.query({ groupId: prGroupId });
        const currentIds = currentInGroup.map(t => t.id);
        await chrome.tabs.group({ groupId: prGroupId, tabIds: [...currentIds, sameUrlTab.id] });
      }
      inPrGroupByNorm.set(norm, sameUrlTab);
      continue;
    }
    // Create new tab
    const newTab = await chrome.tabs.create({ url: prUrl, windowId: win.id });
    if (prGroupId == null) {
      prGroupId = await chrome.tabs.group({
        tabIds: [newTab.id],
        createProperties: { windowId: win.id }
      });
      await chrome.tabGroups.update(prGroupId, { title: PR_GROUP_TITLE, color: 'blue' });
    } else {
      const currentInGroup = await chrome.tabs.query({ groupId: prGroupId });
      const currentIds = currentInGroup.map(t => t.id);
      await chrome.tabs.group({ groupId: prGroupId, tabIds: [...currentIds, newTab.id] });
    }
    inPrGroupByNorm.set(norm, newTab);
    usedTabIds.add(newTab.id);
  }

  // Ungroup tabs that no longer match an open PR. Never close a tab during PR sync.
  // Tabs placed there by this sync are always kept: a freshly created tab may only
  // have pendingUrl, and must not be treated as a stale PR tab.
  if (prGroupId != null) {
    const inPr = await chrome.tabs.query({ groupId: prGroupId });
    const staleTabIds = [];
    for (const tab of inPr) {
      if (usedTabIds.has(tab.id) || isInSplitView(tab)) continue;
      const norm = normalizedPrUrl(tab.pendingUrl || tab.url || '', ignoreQuery, ignoreHash);
      if (norm && !targetNorm.has(norm)) {
        staleTabIds.push(tab.id);
      }
    }
    if (staleTabIds.length > 0) {
      await chrome.tabs.ungroup(staleTabIds);
    }
  }

  return { success: true, message: `PR group updated with ${prUrls.length} PR(s).` };
}

function parseGitHubIssueUrl(rawUrl) {
  if (!isValidUrl(rawUrl)) return null;

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'github.com' && hostname !== 'www.github.com') return null;

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 4 || parts[2].toLowerCase() !== 'issues' || !/^\d+$/.test(parts[3])) {
      return null;
    }

    const owner = decodeURIComponent(parts[0]);
    const repo = decodeURIComponent(parts[1]);
    const issueNumber = Number(parts[3]);
    const validName = /^[a-z0-9_.-]+$/i;
    if (!validName.test(owner) || !validName.test(repo) || !Number.isSafeInteger(issueNumber) || issueNumber < 1) {
      return null;
    }

    return {
      owner,
      repo,
      issueNumber,
      key: `${owner.toLowerCase()}/${repo.toLowerCase()}#${issueNumber}`
    };
  } catch (_) {
    return null;
  }
}

async function fetchGitHubIssueState(githubToken, issue) {
  const owner = encodeURIComponent(issue.owner);
  const repo = encodeURIComponent(issue.repo);
  const endpoint = `https://api.github.com/repos/${owner}/${repo}/issues/${issue.issueNumber}`;

  try {
    const response = await fetch(endpoint, { headers: githubApiHeaders(githubToken) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        return { issue, error: 'Invalid or expired GitHub token', globalError: true };
      }
      if (isGitHubRateLimitResponse(response, data)) {
        return { issue, error: 'GitHub rate limit exceeded', globalError: true };
      }
      if (response.status === 404) {
        return { issue, error: 'A GitHub issue was not found, or the token cannot access it' };
      }
      return { issue, error: data.message || `GitHub API error: ${response.status}` };
    }

    if (data.pull_request) {
      return { issue, isPullRequest: true };
    }
    if (data.state !== 'open' && data.state !== 'closed') {
      return { issue, error: 'GitHub returned an unknown issue state' };
    }
    return { issue, state: data.state };
  } catch (error) {
    return { issue, error: error.message || 'Failed to fetch GitHub issue state' };
  }
}

async function getGitHubIssueTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const issueTabs = [];

  for (const tab of tabs) {
    const pendingUrl = isValidUrl(tab.pendingUrl) ? tab.pendingUrl : null;
    const url = pendingUrl || await ensureTabUrl(tab);
    if (url === null) continue;
    const issue = parseGitHubIssueUrl(url);
    if (issue) issueTabs.push({ tab: { ...tab, url }, issue });
  }

  return issueTabs;
}

// Move closed issue tabs from any group, or from no group, into the Closed group.
async function syncClosedIssueTabGroup(windowId) {
  const settings = await chrome.storage.local.get(['githubToken']);
  const githubToken = settings.githubToken?.trim();
  if (!githubToken) {
    return { success: false, error: 'GitHub token not set' };
  }

  const targetWindowId = await resolveTargetWindowId(windowId);
  const win = await chrome.windows.get(targetWindowId);
  const issueTabs = await getGitHubIssueTabs(win.id);
  if (issueTabs.length === 0) {
    return { success: true, checkedCount: 0, movedCount: 0, message: 'No GitHub issue tabs found in this window.' };
  }

  const issuesByKey = new Map(issueTabs.map(({ issue }) => [issue.key, issue]));
  const uniqueIssues = Array.from(issuesByKey.values());
  const stateResults = [];

  // Small batches avoid a burst of requests when a window contains many issue tabs.
  for (let i = 0; i < uniqueIssues.length; i += 5) {
    const batch = uniqueIssues.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(issue => fetchGitHubIssueState(githubToken, issue))
    );
    stateResults.push(...batchResults);
    if (batchResults.some(result => result.globalError)) break;
  }

  const successfulResults = stateResults.filter(result => !result.error);
  const failedResults = stateResults.filter(result => result.error);
  const failedCount = uniqueIssues.length - successfulResults.length;
  if (successfulResults.length === 0 && failedCount > 0) {
    return {
      success: false,
      error: failedResults[0]?.error || 'Could not check GitHub issue states',
      failedCount
    };
  }

  const closedIssueKeys = new Set(
    successfulResults
      .filter(result => !result.isPullRequest && result.state === 'closed')
      .map(result => result.issue.key)
  );
  const checkedCount = successfulResults.filter(result => !result.isPullRequest).length;

  // Re-read the tabs after the API requests so a tab that navigated elsewhere is not moved.
  const currentIssueTabs = await getGitHubIssueTabs(win.id);
  const closedTabs = currentIssueTabs
    .filter(({ issue }) => closedIssueKeys.has(issue.key))
    .map(({ tab }) => tab);

  const groups = await chrome.tabGroups.query({ windowId: win.id });
  const closedGroup = groups.find(
    group => (group.title || '').trim().toUpperCase() === CLOSED_GROUP_TITLE.toUpperCase()
  );

  let alreadyGroupedCount = 0;
  let skippedPinnedCount = 0;
  let skippedSplitViewCount = 0;
  const tabIdsToMove = [];

  for (const tab of closedTabs) {
    if (closedGroup && tab.groupId === closedGroup.id) {
      alreadyGroupedCount++;
    } else if (tab.pinned) {
      skippedPinnedCount++;
    } else if (isInSplitView(tab)) {
      skippedSplitViewCount++;
    } else {
      tabIdsToMove.push(tab.id);
    }
  }

  const liveTabIds = await filterExistingTabIds(tabIdsToMove);
  if (liveTabIds.length > 0) {
    if (closedGroup) {
      await chrome.tabs.group({ groupId: closedGroup.id, tabIds: liveTabIds });
    } else {
      const closedGroupId = await chrome.tabs.group({
        tabIds: liveTabIds,
        createProperties: { windowId: win.id }
      });
      await chrome.tabGroups.update(closedGroupId, { title: CLOSED_GROUP_TITLE, color: 'grey' });
    }
  }

  let message;
  if (closedTabs.length === 0) {
    message = `No closed GitHub issue tabs found after checking ${checkedCount} issue(s).`;
  } else {
    message = `Found ${closedTabs.length} closed GitHub issue tab(s).`;
    if (liveTabIds.length > 0) message += ` Moved ${liveTabIds.length} to ${CLOSED_GROUP_TITLE}.`;
    if (alreadyGroupedCount > 0) message += ` ${alreadyGroupedCount} already in ${CLOSED_GROUP_TITLE}.`;
    const skippedCount = skippedPinnedCount + skippedSplitViewCount;
    if (skippedCount > 0) message += ` Skipped ${skippedCount} pinned or split-view tab(s).`;
  }
  if (failedCount > 0) {
    message += ` Could not check ${failedCount} issue(s).`;
  }

  return {
    success: true,
    checkedCount,
    closedCount: closedTabs.length,
    movedCount: liveTabIds.length,
    alreadyGroupedCount,
    skippedPinnedCount,
    skippedSplitViewCount,
    failedCount,
    warning: failedCount > 0 ? `Could not check ${failedCount} GitHub issue(s).` : null,
    message
  };
}

async function syncEnabledGitHubTabGroups(windowId) {
  const settings = await chrome.storage.local.get([
    'githubToken', 'prGroupEnabled', 'closedIssueGroupEnabled'
  ]);
  const enabled = settings.prGroupEnabled === true || settings.closedIssueGroupEnabled === true;
  if (!enabled) return { warnings: [] };

  const warnings = [];
  if (!settings.githubToken?.trim()) {
    warnings.push('Add a GitHub token in the extension settings.');
  } else {
    const runSync = async (label, sync) => {
      try {
        const result = await sync();
        if (result?.success === false) {
          const error = result.error || 'refresh failed';
          warnings.push(`${label}: ${error}`);
          return /invalid or expired github token|rate limit|github api error: 429|failed to fetch/i.test(error);
        }
        if (result?.warning) warnings.push(`${label}: ${result.warning}`);
        return false;
      } catch (error) {
        const message = error.message || 'refresh failed';
        warnings.push(`${label}: ${message}`);
        return /authentication|unauthorized|rate limit|failed to fetch/i.test(message);
      }
    };

    let stopRemainingSyncs = false;
    if (settings.prGroupEnabled === true) {
      stopRemainingSyncs = await runSync(PR_GROUP_TITLE, () => syncPrTabGroup(windowId));
    }
    if (settings.closedIssueGroupEnabled === true && !stopRemainingSyncs) {
      await runSync(CLOSED_GROUP_TITLE, () => syncClosedIssueTabGroup(windowId));
    }
  }

  if (warnings.length > 0) {
    const uniqueWarnings = Array.from(new Set(warnings));
    console.warn('GitHub tab group refresh warnings:', uniqueWarnings);
    await chrome.notifications.create('github-sync-warning', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'GitHub tab groups not fully refreshed',
      message: uniqueWarnings.join('\n')
    });
    return { warnings: uniqueWarnings };
  }

  return { warnings: [] };
}

function formatExistingGroupsForPrompt(existingGroups) {
  if (!existingGroups || existingGroups.length === 0) return '';
  const lines = existingGroups.map((group) => {
    const samples = group.tabs.slice(0, 5).map(t =>
      `"${(t.title || 'Untitled').replace(/"/g, "'")}"`
    );
    const more = group.tabs.length > 5 ? ` (+${group.tabs.length - 5} more)` : '';
    return `Existing Group "${group.title}": ${group.tabs.length} tab(s) — ${samples.join(', ')}${more}`;
  }).join('\n');
  return `\n\nExisting Groups (merge ungrouped tabs from the list above into these groups when appropriate):
${lines}

IMPORTANT: Only assign tabs from the numbered list above. Tabs already in existing groups are not listed and must stay where they are. When merging, use the EXACT group name from an existing group. You can also create new groups for tabs that don't fit.`;
}

/** Build the tab-categorization prompt shared by every AI provider. */
function buildOrganizePrompt(tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
  const tabList = tabs.map((tab, index) => {
    const title = tab.title || 'Untitled';
    const url = tab.url || '';
    return `${index + 1}. "${title}" - ${url}`;
  }).join('\n');

  let basePrompt = `You are a helpful assistant that organizes browser tabs into logical groups. Analyze the following tabs and group them into categories. Return ONLY a JSON array where each object has:
- "groupName": a short descriptive name for the group (max 20 characters)
- "tabIndices": an array of 1-based indices of tabs that belong to this group

Tabs:
${tabList}`;

  basePrompt += formatExistingGroupsForPrompt(existingGroups);

  if (splitTabIndices && splitTabIndices.length > 0) {
    basePrompt += `\n\nSIDE-BY-SIDE SPLITS (these tab pairs/groups MUST stay together in the SAME group - never separate them):
${splitTabIndices.map((indices, i) => `- Split ${i + 1}: tabs ${indices.join(', ')}`).join('\n')}`;
  }

  const minSizeRule = minGroupSize > 0
    ? `- Each group must contain MORE than ${minGroupSize} tab(s). Never create a group with ${minGroupSize} or fewer tabs; put those tabs in "Misc".\n`
    : `- Never create a group with only one tab. All single tabs should be grouped into a group named "Misc".\n- Each group must contain at least 2 tabs (except for "Misc" which can contain multiple single tabs).\n`;
  basePrompt += `\n\nIMPORTANT RULES:
${minSizeRule}- If you have tabs that don't fit into any logical group, put them in "Misc".
- NEVER add or remove any tabs to groups named "BOOKMARKS" or "PRs". Leave these groups exactly as they are.
- Pinned tabs are never included in this list. Do not reference or create groups for pinned tabs.
- Tabs in a side-by-side split must be placed in the SAME group together. Never separate them or unsplit them.

${customInstructions ? `Additional instructions: ${customInstructions}\n` : ''}

Return ONLY a JSON array of objects (no markdown, no prose, no domain shorthand like [domain.com]). Each object must have "groupName" (string) and "tabIndices" (array of numbers). Example:
[{"groupName": "Work", "tabIndices": [1, 3, 5]}, {"groupName": "Social", "tabIndices": [2, 4]}, {"groupName": "Misc", "tabIndices": [6, 7]}]`;

  return basePrompt;
}

// Call OpenAI API to categorize tabs
async function callOpenAI(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
  const basePrompt = buildOrganizePrompt(tabs, customInstructions, existingGroups, splitTabIndices, minGroupSize);

  const resolvedModel = model || globalThis.getRecommendedModelId('openai');
  const reasoningModel = isOpenAiReasoningModel(resolvedModel);
  const requestBody = {
    model: resolvedModel,
    messages: [
      {
        role: 'user',
        content: basePrompt
      }
    ],
    // Reasoning models share this budget between hidden reasoning + visible output, so be generous
    max_completion_tokens: reasoningModel ? 16000 : 5000,
  };
  if (reasoningModel) {
    // Tab grouping is a structured but low-difficulty task; cap reasoning so the output budget isn't starved
    requestBody.reasoning_effort = 'low';
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = extractProviderErrorMessage(errorBody) || `OpenAI API error: ${response.status}`;
    console.error('[Smart Tab Organiser] OpenAI API error:', response.status, message, errorBody);
    throw new AiProviderError({ provider: 'openai', status: response.status, message, rawBody: errorBody });
  }

  const data = await response.json();
  const firstChoice = data.choices?.[0];
  const content = firstChoice?.message?.content?.trim();

  if (!content) {
    const finishReason = firstChoice?.finish_reason;
    const reasoningTokens = data.usage?.completion_tokens_details?.reasoning_tokens;
    const completionTokens = data.usage?.completion_tokens;
    console.warn('[Smart Tab Organiser] OpenAI: no content in response. Full response:', {
      hasChoices: !!data.choices?.length,
      choicesLength: data.choices?.length ?? 0,
      firstChoice: firstChoice ? {
        message: firstChoice.message,
        finish_reason: finishReason
      } : null,
      usage: data.usage,
      model: data.model
    });
    // When a reasoning model hits its budget the API returns finish_reason='length' with all tokens spent on hidden reasoning
    const truncatedByLength = finishReason === 'length';
    const looksLikeReasoningExhaustion = truncatedByLength
      || (reasoningTokens && completionTokens && completionTokens === reasoningTokens);
    let message;
    if (looksLikeReasoningExhaustion && reasoningModel) {
      message = `OpenAI reasoning model "${resolvedModel}" used all ${completionTokens || reasoningTokens || '?'} tokens on hidden reasoning and produced no output. Pick a non-reasoning model (e.g. GPT-4.1) or one with lower reasoning effort.`;
    } else if (truncatedByLength) {
      message = `OpenAI response was cut off (finish_reason=length). Try a model with a larger output budget.`;
    } else {
      message = `OpenAI returned no content (finish_reason=${finishReason || 'unknown'}).`;
    }
    throw new AiProviderError({ provider: 'openai', message, rawBody: { finish_reason: finishReason, usage: data.usage, model: data.model } });
  }

  const groups = parseAiGroupsResponse(content);
  if (!groups) {
    console.warn('[Smart Tab Organiser] OpenAI: invalid format (no valid groups JSON). Content preview:', content.slice(0, 200));
    throw new AiProviderError({ provider: 'openai', message: `OpenAI returned text that isn't a JSON array of groups (model=${resolvedModel}).` });
  }

  return groups;
}

/** OpenAI reasoning models share max_completion_tokens between hidden reasoning + output and accept `reasoning_effort`. */
function isOpenAiReasoningModel(modelId) {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  // o-series and gpt-5+ are reasoning-capable; gpt-4.x and gpt-4o are not
  if (/^o\d/.test(id)) return true; // o1, o3, o4 …
  if (/^gpt-5/.test(id)) return true; // gpt-5.x, gpt-5.6-sol/terra/luna, …
  return false;
}

// Call Claude API to categorize tabs
async function callClaude(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
  const basePrompt = buildOrganizePrompt(tabs, customInstructions, existingGroups, splitTabIndices, minGroupSize);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || globalThis.getRecommendedModelId('claude'),
      max_tokens: 5000,
      messages: [
        {
          role: 'user',
          content: basePrompt
        }
      ]
    })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = extractProviderErrorMessage(errorBody) || `Claude API error: ${response.status}`;
    console.error('[Smart Tab Organiser] Claude API error:', response.status, message, errorBody);
    throw new AiProviderError({ provider: 'claude', status: response.status, message, rawBody: errorBody });
  }

  const data = await response.json();
  const content = data.content[0]?.text?.trim();

  if (!content) {
    console.warn('[Smart Tab Organiser] Claude: no content in response. Full response:', {
      hasContent: !!data.content?.length,
      contentLength: data.content?.length ?? 0,
      firstBlock: data.content?.[0] ? { type: data.content[0].type, textLength: data.content[0].text?.length } : null,
      stop_reason: data.stop_reason,
      usage: data.usage,
      model: data.model
    });
    throw new AiProviderError({ provider: 'claude', message: 'No response from Claude' });
  }

  const groups = parseAiGroupsResponse(content);
  if (!groups) {
    console.warn('[Smart Tab Organiser] Claude: invalid format (no valid groups JSON). Content preview:', content.slice(0, 200));
    throw new AiProviderError({ provider: 'claude', message: 'Invalid response format from Claude' });
  }

  return groups;
}

// Call Gemini API to categorize tabs
async function callGemini(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
  const basePrompt = buildOrganizePrompt(tabs, customInstructions, existingGroups, splitTabIndices, minGroupSize);

  const modelId = model || globalThis.getRecommendedModelId('gemini');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: basePrompt }] }],
      generationConfig: {
        maxOutputTokens: 5000,
        temperature: 0.2
      }
    })
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => null);
    const message = extractProviderErrorMessage(errorBody) || `Gemini API error: ${response.status}`;
    console.error('[Smart Tab Organiser] Gemini API error:', response.status, message, errorBody);
    throw new AiProviderError({ provider: 'gemini', status: response.status, message, rawBody: errorBody });
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!content) {
    console.warn('[Smart Tab Organiser] Gemini: no content in response. Full response:', {
      hasCandidates: !!data.candidates?.length,
      finishReason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata
    });
    throw new AiProviderError({ provider: 'gemini', message: 'No response from Gemini' });
  }

  const groups = parseAiGroupsResponse(content);
  if (!groups) {
    console.warn('[Smart Tab Organiser] Gemini: invalid format (no valid groups JSON). Content preview:', content.slice(0, 200));
    throw new AiProviderError({ provider: 'gemini', message: 'Invalid response format from Gemini' });
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Local models: Ollama (and other OpenAI-compatible local servers)
// ---------------------------------------------------------------------------

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';
// Local models are slow (a 35B model takes ~50s for a dozen tabs), but this must stay
// under the ~5 minute cap Chrome puts on a single service worker event.
const OLLAMA_TIMEOUT_MS = 180000;

/**
 * Normalize a user-entered local server address into an OpenAI-compatible base URL.
 * Accepts "localhost:11434", "http://localhost:11434", "http://localhost:11434/v1".
 */
function normalizeLocalBaseUrl(rawUrl) {
  let url = (rawUrl || '').trim() || DEFAULT_OLLAMA_BASE_URL;
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  url = url.replace(/\/+$/, '');
  // Strip a full endpoint path if the user pasted one, then ensure the /v1 prefix.
  url = url.replace(/\/chat\/completions$/, '');
  if (!/\/v\d+$/.test(url)) {
    url = `${url}/v1`;
  }
  return url;
}

/** True when the address exactly matches a loopback origin allowed by the manifest. */
function isAllowedLocalModelUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && (
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
    );
  } catch {
    return false;
  }
}

function requireAllowedLocalModelUrl(baseUrl) {
  if (!isAllowedLocalModelUrl(baseUrl)) {
    throw new Error(
      'Local model address must use http://localhost or http://127.0.0.1. Network hosts are not allowed.'
    );
  }
}

/** Turn a fetch failure against a local server into an actionable message. */
function localServerError(error, baseUrl) {
  if (error.name === 'AbortError') {
    return new Error(`Local model timed out after ${Math.round(OLLAMA_TIMEOUT_MS / 1000)}s. Try a smaller model, or organize fewer tabs.`);
  }
  if (error instanceof TypeError) {
    if (!isAllowedLocalModelUrl(baseUrl)) {
      return new Error(
        `Could not reach ${baseUrl}. This extension only has permission for localhost and 127.0.0.1, so a model server on ` +
        `another host or network address will be blocked.`
      );
    }
    return new Error(
      `Could not reach the local model server at ${baseUrl}. Check that it is running, and that it allows requests from extensions ` +
      `(for Ollama, start it with OLLAMA_ORIGINS="chrome-extension://*").`
    );
  }
  return error;
}

/** List the models a local OpenAI-compatible server currently has available. */
async function listLocalModels(rawBaseUrl) {
  const baseUrl = normalizeLocalBaseUrl(rawBaseUrl);
  requireAllowedLocalModelUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrl}/models`, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Local model server returned ${response.status} for ${baseUrl}/models`);
    }
    const data = await response.json();
    const models = (data.data || data.models || [])
      .map(m => m.id || m.name)
      .filter(Boolean)
      .sort();
    return { baseUrl, models };
  } catch (error) {
    throw localServerError(error, baseUrl);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call a local OpenAI-compatible server (Ollama, LM Studio, llama.cpp, vLLM) to categorize tabs.
 * Local models are less reliable at emitting bare JSON, so one stricter retry is attempted.
 */
async function callLocalModel(rawBaseUrl, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
  const baseUrl = normalizeLocalBaseUrl(rawBaseUrl);
  requireAllowedLocalModelUrl(baseUrl);
  const basePrompt = buildOrganizePrompt(tabs, customInstructions, existingGroups, splitTabIndices, minGroupSize);
  const retryReminder = '\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON array: start with [ and end with ]. No explanation, no markdown code fences.';

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? basePrompt : basePrompt + retryReminder;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    let content;
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 5000,
          temperature: 0.2,
          stream: false
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
        console.error('[Smart Tab Organiser] Local model error:', response.status, error);
        throw new Error(error.error?.message || error.message || `Local model server error: ${response.status}`);
      }

      const data = await response.json();
      content = data.choices?.[0]?.message?.content?.trim();
    } catch (error) {
      throw localServerError(error, baseUrl);
    } finally {
      clearTimeout(timer);
    }

    if (!content) {
      lastError = new Error(`No response from local model "${model}"`);
      continue;
    }

    const groups = parseAiGroupsResponse(content);
    if (!groups) {
      console.warn('[Smart Tab Organiser] Local model: invalid format. Content preview:', content.slice(0, 200));
      lastError = new Error(`Invalid response format from local model "${model}"`);
      continue;
    }
    return groups;
  }

  throw lastError || new Error('Local model produced no usable response');
}

// ---------------------------------------------------------------------------
// Chrome built-in AI (Gemini Nano, on-device via the Prompt API)
// ---------------------------------------------------------------------------

// Gemini Nano has a small context window, so tabs are organized in batches and merged.
const CHROME_AI_TABS_PER_BATCH = 20;

const CHROME_AI_GROUPS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      groupName: { type: 'string' },
      tabIndices: { type: 'array', items: { type: 'integer' } }
    },
    required: ['groupName', 'tabIndices'],
    additionalProperties: false
  }
};

/** Report whether the on-device model is usable, and whether it still needs downloading. */
async function checkChromeAiAvailability() {
  if (typeof LanguageModel === 'undefined') {
    return {
      available: false,
      state: 'unsupported',
      message: 'Chrome built-in AI is not available in this browser. It needs Chrome 138 or later on a supported desktop platform.'
    };
  }
  let state;
  try {
    state = await LanguageModel.availability();
  } catch (error) {
    return { available: false, state: 'unsupported', message: `Chrome built-in AI is unavailable: ${error.message}` };
  }
  if (state === 'unavailable') {
    return {
      available: false,
      state,
      message: 'Chrome built-in AI is unsupported on this device. It requires ~22 GB free disk space and either 4 GB+ of VRAM or 16 GB+ of RAM.'
    };
  }
  if (state === 'downloadable') {
    return { available: true, state, message: 'Ready to use. Gemini Nano will download (a few GB) the first time you organize tabs.' };
  }
  if (state === 'downloading') {
    return { available: true, state, message: 'Gemini Nano is downloading. Organizing tabs will work once the download finishes.' };
  }
  return { available: true, state, message: 'Gemini Nano is downloaded and ready to use on this device.' };
}

/** Verify the on-device model can be used, warning once if it still has to download. */
async function ensureChromeAiReady() {
  const status = await checkChromeAiAvailability();
  if (!status.available) {
    throw new Error(status.message);
  }
  if (status.state === 'downloadable' || status.state === 'downloading') {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Downloading on-device model',
      message: 'Chrome is downloading Gemini Nano (a few GB). Tab organisation will start once it is ready.'
    });
  }
}

/** Create an on-device session. Assumes ensureChromeAiReady() has already passed. */
async function createChromeAiSession() {
  try {
    return await LanguageModel.create({
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          console.log(`[Smart Tab Organiser] Gemini Nano download: ${Math.round((e.loaded || 0) * 100)}%`);
        });
      }
    });
  } catch (error) {
    // Chrome can require a user gesture to start the initial model download, which a
    // service worker doesn't have. The options page has a button that does have one.
    if (error.name === 'NotAllowedError' || /user (gesture|activation)/i.test(error.message)) {
      throw new Error('Chrome needs permission to download Gemini Nano first. Open this extension\'s options page and click "Download model".');
    }
    throw new Error(`Could not start Chrome built-in AI: ${error.message}`);
  }
}

/** Merge per-batch group lists into one, combining groups that share a name. */
function mergeGroupBatches(batches) {
  const merged = new Map();
  for (const groups of batches) {
    for (const group of groups) {
      const name = (group.groupName || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = merged.get(key);
      const indices = (group.tabIndices || []).filter(idx => Number.isInteger(idx));
      if (existing) {
        existing.tabIndices.push(...indices);
      } else {
        merged.set(key, { groupName: name, tabIndices: [...indices] });
      }
    }
  }
  return Array.from(merged.values());
}

/**
 * Categorize tabs with Chrome's on-device model. Nothing leaves the machine.
 * Tabs are batched to fit the small context window; batch results are merged by group name.
 */
async function callChromeAI(tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
  await ensureChromeAiReady();

  const batches = [];
  for (let start = 0; start < tabs.length; start += CHROME_AI_TABS_PER_BATCH) {
    batches.push({ start, tabs: tabs.slice(start, start + CHROME_AI_TABS_PER_BATCH) });
  }

  const results = [];
  for (const batch of batches) {
    const batchEnd = batch.start + batch.tabs.length; // exclusive, 0-based
    // Remap global 1-based split indices to this batch; splits spanning batches are
    // reunited later by organizeTabs().
    const batchSplits = (splitTabIndices || [])
      .map(indices => indices
        .filter(idx => idx > batch.start && idx <= batchEnd)
        .map(idx => idx - batch.start))
      .filter(indices => indices.length >= 2);

    const prompt = buildOrganizePrompt(batch.tabs, customInstructions, existingGroups, batchSplits, minGroupSize);

    const session = await createChromeAiSession();
    let content;
    try {
      content = await session.prompt(prompt, { responseConstraint: CHROME_AI_GROUPS_SCHEMA });
    } catch (error) {
      throw new Error(`Chrome built-in AI failed: ${error.message}`);
    } finally {
      session.destroy();
    }

    const groups = parseAiGroupsResponse((content || '').trim());
    if (!groups) {
      console.warn('[Smart Tab Organiser] Chrome AI: invalid format. Content preview:', (content || '').slice(0, 200));
      throw new Error('Invalid response format from Chrome built-in AI');
    }

    // Shift batch-local indices back to global 1-based tab indices.
    results.push(groups.map(group => ({
      groupName: group.groupName,
      tabIndices: (group.tabIndices || [])
        .filter(idx => Number.isInteger(idx) && idx >= 1 && idx <= batch.tabs.length)
        .map(idx => idx + batch.start)
    })));
  }

  return mergeGroupBatches(results);
}
// Organize tabs using AI
function tabTitleForSort(tab) {
  return (tab.title || '').trim() || 'Untitled';
}

/** Reorder tabs inside each group A–Z by page title (skips extension-managed groups). */
async function sortTabsWithinGroupsByTitle(windowId, alwaysPreservedGroupNames) {
  const groups = await chrome.tabGroups.query({ windowId });
  for (const group of groups) {
    const name = (group.title || '').trim().toUpperCase();
    if (alwaysPreservedGroupNames.has(name)) continue;

    const tabs = await chrome.tabs.query({ groupId: group.id });
    if (tabs.length <= 1) continue;
    if (tabs.some((t) => isInSplitView(t))) continue;

    const sorted = [...tabs].sort((a, b) =>
      tabTitleForSort(a).localeCompare(tabTitleForSort(b), undefined, { sensitivity: 'base', numeric: true })
    );
    const anchorIndex = Math.min(...tabs.map((t) => t.index));
    for (let i = 0; i < sorted.length; i++) {
      await chrome.tabs.move(sorted[i].id, { index: anchorIndex + i });
    }
  }
}

/** Remove URL components that usually contain tracking values, tokens, or private state. */
function sanitizeUrlForCloudAi(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function sanitizeTabsForCloudAi(tabs) {
  return tabs.map(tab => ({
    ...tab,
    url: sanitizeUrlForCloudAi(tab.url || '')
  }));
}

/** Dispatch to the right provider-specific call. Wraps non-AiProviderError throws so we always get structured errors. */
async function callProvider(provider, settings, tabs, instructions, existingGroupsForAI, splitTabIndices, minTabs) {
  try {
    const promptTabs = isOnDeviceProvider(provider) ? tabs : sanitizeTabsForCloudAi(tabs);
    if (provider === 'openai') {
      const key = settings.openaiKey?.trim();
      if (!key) throw new AiProviderError({ provider, message: 'OpenAI API key not configured' });
      const model = globalThis.resolveStoredModel('openai', settings.openaiModel);
      return await callOpenAI(key, model, promptTabs, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    }
    if (provider === 'claude') {
      const key = settings.claudeKey?.trim();
      if (!key) throw new AiProviderError({ provider, message: 'Claude API key not configured' });
      const model = globalThis.resolveStoredModel('claude', settings.claudeModel);
      return await callClaude(key, model, promptTabs, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    }
    if (provider === 'gemini') {
      const key = settings.geminiKey?.trim();
      if (!key) throw new AiProviderError({ provider, message: 'Gemini API key not configured' });
      const model = globalThis.resolveStoredModel('gemini', settings.geminiModel);
      return await callGemini(key, model, promptTabs, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    }
    if (provider === 'chrome-ai') {
      // On-device: no key, nothing leaves the machine.
      return await callChromeAI(promptTabs, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    }
    if (provider === 'local') {
      const model = settings.localModel?.trim();
      if (!model) throw new AiProviderError({ provider, message: 'No local model name configured' });
      const baseUrl = settings.localBaseUrl?.trim() || DEFAULT_OLLAMA_BASE_URL;
      return await callLocalModel(baseUrl, model, promptTabs, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    }
    throw new AiProviderError({ provider, message: `Unknown AI provider: ${provider}` });
  } catch (err) {
    if (err instanceof AiProviderError) throw err;
    throw new AiProviderError({ provider, message: err?.message || String(err), cause: err });
  }
}

function providerHasKey(provider, settings) {
  if (provider === 'openai') return !!settings.openaiKey?.trim();
  if (provider === 'claude') return !!settings.claudeKey?.trim();
  if (provider === 'gemini') return !!settings.geminiKey?.trim();
  return false;
}

/** True if the provider has everything it needs from settings to be worth attempting. */
function providerIsConfigured(provider, settings) {
  if (provider === 'chrome-ai') return true; // no key or name; availability is checked at call time
  if (provider === 'local') return !!settings.localModel?.trim();
  return providerHasKey(provider, settings);
}

// The user's preferred fallback order (Options → Fallback order). Unknown entries are
// dropped and missing providers appended, so old or partial saved values stay valid.
const DEFAULT_FALLBACK_ORDER = ['chrome-ai', 'local', 'openai', 'claude', 'gemini'];

function normalizeFallbackOrder(saved) {
  const seen = new Set();
  const order = [];
  for (const p of (Array.isArray(saved) ? saved : [])) {
    if (DEFAULT_FALLBACK_ORDER.includes(p) && !seen.has(p)) {
      seen.add(p);
      order.push(p);
    }
  }
  for (const p of DEFAULT_FALLBACK_ORDER) {
    if (!seen.has(p)) order.push(p);
  }
  return order;
}

/**
 * Walk the user's fallback order and work out, for every provider, whether it would join
 * the chain — and if not, why. The chain itself falls out of the walk: primary first,
 * then each eligible provider in order.
 *
 * Eligibility encodes the privacy boundary of the primary choice:
 * - A cloud primary falls back to the other cloud providers you hold keys for. It never
 *   silently switches to an on-device provider (surprise latency, possible model download).
 * - An on-device primary falls back to the other on-device provider, since both keep tab
 *   data on the machine: the local server needs a model name configured, and Chrome
 *   built-in AI only joins when its model is already downloaded — a fallback must never
 *   trigger a multi-gigabyte download the user didn't ask for.
 * - Cloud providers join an on-device chain only with the explicit aiAllowCloudFallback
 *   opt-in, because that fallback sends tab data off the machine. Within the eligible
 *   set, the user's order wins.
 *
 * Statuses: 'primary' | 'ready' (in the chain) | 'disabled' | 'no-key' |
 * 'not-downloaded' | 'no-model-name' | 'cloud-opt-in-off' | 'not-after-cloud'.
 * The options page renders these directly, so the UI can never drift from this logic.
 */
async function describeProviderChain(settings) {
  const primary = settings.aiProvider || 'openai';
  const order = normalizeFallbackOrder(settings.aiFallbackOrder);
  const fallbackEnabled = settings.aiFallbackEnabled !== false;
  const onDevicePrimary = isOnDeviceProvider(primary);

  // Only probe Nano availability when it could actually join the chain.
  let chromeAiReady = false;
  if (fallbackEnabled && onDevicePrimary && primary !== 'chrome-ai') {
    const status = await checkChromeAiAvailability();
    chromeAiReady = status.state === 'available';
  }

  const chain = [primary];
  const entries = order.map((p) => {
    if (p === primary) return { provider: p, status: 'primary' };
    if (!fallbackEnabled) return { provider: p, status: 'disabled' };
    if (onDevicePrimary) {
      if (p === 'local') {
        if (!settings.localModel?.trim()) return { provider: p, status: 'no-model-name' };
      } else if (p === 'chrome-ai') {
        if (!chromeAiReady) return { provider: p, status: 'not-downloaded' };
      } else {
        if (settings.aiAllowCloudFallback !== true) return { provider: p, status: 'cloud-opt-in-off' };
        if (!providerHasKey(p, settings)) return { provider: p, status: 'no-key' };
      }
    } else {
      if (isOnDeviceProvider(p)) return { provider: p, status: 'not-after-cloud' };
      if (!providerHasKey(p, settings)) return { provider: p, status: 'no-key' };
    }
    chain.push(p);
    return { provider: p, status: 'ready' };
  });

  return { primary, order, chain, entries, fallbackEnabled, onDevicePrimary };
}

/** Ordered list of providers to attempt: primary first, then eligible fallbacks in the user's order. */
async function buildProviderChain(settings) {
  return (await describeProviderChain(settings)).chain;
}

async function organizeTabs(preserveGroups, mergeIntoExisting, customInstructions, preserveGroupsMinTabs = 1, windowId) {
  try {
    const minTabs = parseMinTabs(preserveGroupsMinTabs);

    // Get AI settings
    const settings = await chrome.storage.local.get([
      'openaiKey', 'claudeKey', 'geminiKey', 'aiProvider', 'aiFallbackEnabled', 'aiAllowCloudFallback',
      'aiFallbackOrder', 'openaiModel', 'claudeModel', 'geminiModel', 'customInstructionsOptions',
      'localBaseUrl', 'localModel', 'closedIssueGroupEnabled'
    ]);

    // Use custom instructions from the action, or fall back to the saved settings.
    let instructions = customInstructions || settings.customInstructionsOptions || '';
    if (settings.closedIssueGroupEnabled === true) {
      const closedGroupInstruction = `The ${CLOSED_GROUP_TITLE} group is managed by the extension. Do not assign other tabs to it.`;
      instructions = [instructions, closedGroupInstruction].filter(Boolean).join('\n');
    }

    // Validate that at least one provider in the chain is configured
    // (on-device providers need no API key: chrome-ai needs nothing, local needs a model name)
    const providerChain = await buildProviderChain(settings);
    const usableChain = providerChain.filter((p) => providerIsConfigured(p, settings));
    if (usableChain.length === 0) {
      const primary = providerChain[0] || 'openai';
      const fix = primary === 'local'
        ? 'Set a model name in Smart Tab Organiser settings (e.g. "llama3.1:8b").'
        : 'Add a key in Smart Tab Organiser settings, or configure another provider as fallback.';
      return {
        success: false,
        error: `${providerLabel(primary)} is not configured. ${fix}`,
      };
    }

    // Resolve URLs for suspended tabs (e.g. Arc) before filtering
    const validTabs = await getOrganizableTabs(windowId);

    if (validTabs.length === 0) {
      return {
        success: false,
        error: 'No valid tabs to organize (only http/https pages can be grouped)'
      };
    }

    const tabs = validTabs;

    // Never change extension-managed groups, regardless of the preservation setting.
    // Pinned tabs (Chrome-native) are excluded separately via tab.pinned.
    const allGroups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
    const alwaysPreservedGroupNames = getAlwaysPreservedGroupNames(settings.closedIssueGroupEnabled);
    const alwaysPreservedGroupIds = new Set(
      allGroups
        .filter(g => alwaysPreservedGroupNames.has((g.title || '').trim().toUpperCase()))
        .map(g => g.id)
    );

    // Preserved groups = always-preserved + (when preserveGroups) groups with more than minTabs tabs
    const preservedGroupIds = new Set(alwaysPreservedGroupIds);
    if (preserveGroups) {
      for (const group of allGroups) {
        if (alwaysPreservedGroupIds.has(group.id)) continue;
        const groupTabs = await chrome.tabs.query({ groupId: group.id });
        if (groupTabs.length > minTabs) {
          preservedGroupIds.add(group.id);
        }
      }
    }

    // Ungroup tabs in any group that is not preserved (so they go through AI again)
    for (const group of allGroups) {
      if (preservedGroupIds.has(group.id)) continue;
      const groupTabs = await chrome.tabs.query({ groupId: group.id });
      if (groupTabs.some((t) => isInSplitView(t))) continue;
      const liveIds = await filterExistingTabIds(groupTabs.map((t) => t.id));
      if (liveIds.length > 0) {
        await chrome.tabs.ungroup(liveIds);
      }
    }

    // Get existing groups information (for merge — only preserved groups with > minTabs, excluding always-preserved)
    let existingGroupsInfo = [];
    if (mergeIntoExisting) {
      for (const group of allGroups) {
        if (alwaysPreservedGroupIds.has(group.id)) continue;
        if (!preservedGroupIds.has(group.id)) continue;
        const groupTabs = await chrome.tabs.query({ groupId: group.id });
        if (groupTabs.length > minTabs) {
          existingGroupsInfo.push({
            id: group.id,
            title: group.title,
            color: group.color,
            tabs: groupTabs
          });
        }
      }
    }

    // Re-query after ungrouping so tab.groupId is up to date (with URLs for suspended tabs)
    const validTabsAfterUngroup = await getOrganizableTabs(windowId);

    // Never send pinned tabs or tabs in extension-managed groups to AI.
    // When preserving or merging, skip tabs already in a preserved group (prompt lists those separately).
    // When not preserving, every other organizable tab is eligible.
    const tabsForAI = validTabsAfterUngroup.filter((tab) => {
      if (tab.pinned) return false;
      if (isInSplitView(tab)) return false;
      if (alwaysPreservedGroupIds.has(tab.groupId)) return false;
      if (preserveGroups || mergeIntoExisting) {
        if (tab.groupId && tab.groupId !== -1 && preservedGroupIds.has(tab.groupId)) {
          return false;
        }
      }
      return true;
    });
    const tabsForAISnapshots = new Map(tabsForAI.map(tab => [tab.id, tab]));

    if (tabsForAI.length === 0) {
      const hint = preserveGroups || mergeIntoExisting
        ? ' All organizable tabs are already in preserved groups — disable "Preserve existing groups" or ungroup some tabs first.'
        : '';
      return {
        success: false,
        error: `No tabs to organize.${hint}`
      };
    }

    // Build split view info: tabs with same splitViewId must stay together (Chrome 140+)
    const splitMap = new Map();
    tabsForAI.forEach((tab, index) => {
      const svId = tab.splitViewId;
      if (typeof svId === 'number' && svId !== SPLIT_VIEW_NONE) {
        if (!splitMap.has(svId)) splitMap.set(svId, []);
        splitMap.get(svId).push(index + 1); // 1-based index for AI
      }
    });
    const splitTabIndices = Array.from(splitMap.values()).filter(indices => indices.length >= 2);

    // Call AI API (with fallback chain) — try primary first, then configured fallbacks
    let groups = null;
    let providerUsed = null;
    const failures = [];
    const existingGroupsForAI = mergeIntoExisting ? existingGroupsInfo : null;

    for (const provider of usableChain) {
      try {
        const result = await callProvider(provider, settings, tabsForAI, instructions, existingGroupsForAI, splitTabIndices, minTabs);
        if (!Array.isArray(result) || result.length === 0) {
          throw new AiProviderError({ provider, message: `Invalid response from ${providerLabel(provider)}: expected array of groups` });
        }
        groups = result;
        providerUsed = provider;
        break;
      } catch (err) {
        const aiErr = err instanceof AiProviderError
          ? err
          : new AiProviderError({ provider, message: err?.message || String(err), cause: err });
        const classification = classifyAiError(aiErr);
        console.warn(`[Smart Tab Organiser] Provider ${provider} failed:`, classification.summary, aiErr);
        failures.push({ provider, classification, raw: aiErr.message });
      }
    }

    if (!groups) {
      return {
        success: false,
        error: buildMultiProviderErrorMessage(failures),
        failures: failures.map((f) => ({
          provider: f.provider,
          providerLabel: providerLabel(f.provider),
          type: f.classification.type,
          summary: f.classification.summary,
          detail: f.classification.detail,
          hint: f.classification.hint,
        })),
      };
    }

    const fallbackInfo = failures.length > 0
      ? {
        providerUsed,
        primaryFailed: failures[0].provider,
        primaryFailedLabel: providerLabel(failures[0].provider),
        primaryFailedSummary: failures[0].classification.summary,
        attempts: failures.length + 1,
      }
      : null;

    // Reserved names are a code boundary, not only a prompt instruction.
    const groupsWithReservedNames = groups.filter(group =>
      alwaysPreservedGroupNames.has((group.groupName || '').trim().toUpperCase())
    );
    if (groupsWithReservedNames.length > 0) {
      let miscGroup = groups.find(group => (group.groupName || '').trim().toLowerCase() === 'misc');
      if (!miscGroup) {
        miscGroup = { groupName: 'Misc', tabIndices: [] };
        groups.push(miscGroup);
      }
      for (const group of groupsWithReservedNames) {
        miscGroup.tabIndices.push(...(group.tabIndices || []));
      }
      groups = groups.filter(group => !groupsWithReservedNames.includes(group));
    }

    // Enforce minimum group size: merge any group with ≤ minTabs tabs into Misc
    if (minTabs > 0) {
      let miscGroup = groups.find(g => (g.groupName || '').toLowerCase() === 'misc');
      if (!miscGroup) {
        miscGroup = { groupName: 'Misc', tabIndices: [] };
        groups.push(miscGroup);
      }
      for (const group of groups) {
        if (group === miscGroup) continue;
        const indices = group.tabIndices || [];
        if (indices.length <= minTabs) {
          miscGroup.tabIndices.push(...indices);
          group.tabIndices = [];
        }
      }
      groups = groups.filter(g => (g.tabIndices || []).length > 0);
    }

    // Ensure split tabs stay together: merge any split that AI put in different groups
    for (const splitIndices of splitTabIndices) {
      const indexToGroup = new Map();
      groups.forEach((g, i) => {
        (g.tabIndices || []).forEach(idx => indexToGroup.set(idx, i));
      });
      const groupsWithSplitTabs = [...new Set(
        splitIndices.map(idx => indexToGroup.get(idx)).filter(i => i !== undefined)
      )];
      if (groupsWithSplitTabs.length > 1) {
        const targetIdx = groupsWithSplitTabs[0];
        const targetGroup = groups[targetIdx];
        for (const idx of splitIndices) {
          if (!targetGroup.tabIndices.includes(idx)) {
            targetGroup.tabIndices.push(idx);
          }
        }
        for (const gi of groupsWithSplitTabs.slice(1)) {
          groups[gi].tabIndices = (groups[gi].tabIndices || []).filter(i => !splitIndices.includes(i));
        }
      }
    }

    // Skip tabs that moved or changed while an AI provider processed the request.
    const currentWindowId = validTabs[0].windowId;
    const currentWindowTabIds = new Set(await filterUnchangedTabIds(
      tabsForAI.map(tab => tab.id),
      tabsForAISnapshots,
      currentWindowId
    ));

    // Create or update tab groups
    let groupedCount = 0;
    let groupCount = 0;
    const usedTabIndices = new Set();
    const miscTabIds = []; // Collect tabs for Misc group
    
    // Create a map of existing group names to group IDs for merging
    const existingGroupMap = new Map();
    const usedColors = new Set();
    if (mergeIntoExisting) {
      existingGroupsInfo.forEach(group => {
        existingGroupMap.set(group.title.toLowerCase(), group.id);
        if (group.color) usedColors.add(group.color);
      });
    }
    // Also consider existing groups when preserving (we might create new ones alongside)
    const allExistingGroups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
    allExistingGroups.forEach(g => { if (g.color) usedColors.add(g.color); });

    const allColors = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];

    // First pass: process groups with 2+ tabs
    for (const group of groups) {
      if (!group.groupName || !Array.isArray(group.tabIndices) || group.tabIndices.length === 0) {
        continue;
      }

      // Convert 1-based indices to tab IDs (only current-window tabs)
      const tabIds = group.tabIndices
        .map(idx => {
          const tabIndex = idx - 1; // Convert to 0-based
          if (tabIndex >= 0 && tabIndex < tabsForAI.length) {
            return tabsForAI[tabIndex].id;
          }
          return null;
        })
        .filter(id => id !== null && !usedTabIndices.has(id) && currentWindowTabIds.has(id));

      const liveTabIds = await filterUnchangedTabIds(tabIds, tabsForAISnapshots, currentWindowId);
      if (liveTabIds.length === 0) {
        continue;
      }

      // Handle single-tab groups: add to Misc
      if (liveTabIds.length === 1) {
        miscTabIds.push(...liveTabIds);
        usedTabIndices.add(liveTabIds[0]);
        continue;
      }

      // Mark tabs as used
      liveTabIds.forEach((id) => usedTabIndices.add(id));

      // Check if we should merge into an existing group
      const groupNameLower = group.groupName.toLowerCase();
      const existingGroupId = existingGroupMap.get(groupNameLower);
      
      let groupId;
      if (existingGroupId) {
        // Merge only newly assigned tabs — do not re-group existing members (avoids reordering)
        const existingTabs = await chrome.tabs.query({ groupId: existingGroupId });
        const existingTabIdSet = new Set(
          existingTabs.filter(t => t.windowId === currentWindowId).map(t => t.id)
        );
        const newTabIds = await filterUnchangedTabIds(
          liveTabIds.filter((id) => !existingTabIdSet.has(id) && currentWindowTabIds.has(id)),
          tabsForAISnapshots,
          currentWindowId
        );
        if (newTabIds.length > 0) {
          await chrome.tabs.group({ groupId: existingGroupId, tabIds: newTabIds });
          groupedCount += newTabIds.length;
        }
        groupId = existingGroupId;
      } else {
        // Create new group (only current-window tabs)
        groupId = await chrome.tabs.group({
          tabIds: liveTabIds,
          createProperties: { windowId: currentWindowId }
        });
        
        // Pick a color not yet used; if all used, cycle through
        const available = allColors.filter(c => !usedColors.has(c));
        const color = available.length > 0 ? available[0] : allColors[groupCount % allColors.length];
        usedColors.add(color);
        
        await chrome.tabGroups.update(groupId, {
          title: group.groupName.substring(0, 20),
          color: color
        });
        
        groupedCount += liveTabIds.length;
        groupCount++;
      }
    }

    // Second pass: collect any remaining ungrouped tabs (shouldn't happen, but safety check)
    const allTabIdsSet = new Set(tabsForAI.map(t => t.id));
    const usedTabIdsSet = new Set(Array.from(usedTabIndices));
    const remainingTabs = tabsForAI.filter(tab => 
      !usedTabIdsSet.has(tab.id) && 
      (!tab.groupId || tab.groupId === -1)
    );
    
    if (remainingTabs.length > 0) {
      // Add remaining tabs to Misc (only current window)
      miscTabIds.push(...remainingTabs.map(t => t.id).filter(id => currentWindowTabIds.has(id)));
    }

    // Create or merge into Misc group if we have tabs for it
    const liveMiscTabIds = await filterUnchangedTabIds(
      miscTabIds,
      tabsForAISnapshots,
      currentWindowId
    );
    if (liveMiscTabIds.length > 0) {
      const existingMiscGroupId = existingGroupMap.get('misc');
      
      if (existingMiscGroupId) {
        // Merge only new tabs into existing Misc group (do not reorder existing members)
        const existingTabs = await chrome.tabs.query({ groupId: existingMiscGroupId });
        const existingTabIdSet = new Set(
          existingTabs.filter(t => t.windowId === currentWindowId).map(t => t.id)
        );
        const newMiscTabIds = await filterUnchangedTabIds(
          liveMiscTabIds.filter((id) => !existingTabIdSet.has(id) && currentWindowTabIds.has(id)),
          tabsForAISnapshots,
          currentWindowId
        );
        if (newMiscTabIds.length > 0) {
          await chrome.tabs.group({ groupId: existingMiscGroupId, tabIds: newMiscTabIds });
          groupedCount += newMiscTabIds.length;
        }
      } else {
        // Create new Misc group (only current-window tabs)
        const miscIdsInWindow = liveMiscTabIds.filter((id) => currentWindowTabIds.has(id));
        if (miscIdsInWindow.length > 0) {
          const newMiscGroupId = await chrome.tabs.group({
            tabIds: miscIdsInWindow,
            createProperties: { windowId: currentWindowId }
          });
          await chrome.tabGroups.update(newMiscGroupId, {
            title: 'Misc',
            color: 'grey'
          });
          groupedCount += miscIdsInWindow.length;
          groupCount++;
        }
      }
    }

    const sortSettings = await chrome.storage.local.get(['sortTabsWithinGroupsByTitle']);
    if (sortSettings.sortTabsWithinGroupsByTitle === true) {
      await sortTabsWithinGroupsByTitle(currentWindowId, alwaysPreservedGroupNames);
    }

    return {
      success: true,
      groupedCount,
      groupCount,
      providerUsed,
      providerUsedLabel: providerUsed ? providerLabel(providerUsed) : null,
      fallbackInfo
    };
  } catch (error) {
    console.error('Error organizing tabs:', error);
    const msg = error.message || String(error);
    if (msg.includes('No tab with id')) {
      return {
        success: false,
        error: 'One or more tabs were closed during organization. Please try again.'
      };
    }
    if (msg.includes('Tabs cannot be edited')) {
      return {
        success: false,
        error: 'Please try again in a moment. Release any tab you\'re dragging and don\'t move tabs while the extension is running.'
      };
    }
    return {
      success: false,
      error: msg
    };
  }
}

// Ungroup all tabs (always skips extension-managed groups; pinned tabs are unaffected)
async function ungroupTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length === 0) {
      return {
        success: false,
        error: 'No tabs found'
      };
    }

    // Get all groups in the current window; never ungroup enabled extension-managed groups.
    const groups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
    const { closedIssueGroupEnabled } = await chrome.storage.local.get(['closedIssueGroupEnabled']);
    const alwaysPreservedGroupNames = getAlwaysPreservedGroupNames(closedIssueGroupEnabled);
    const alwaysPreservedIds = new Set(
      groups
        .filter(g => alwaysPreservedGroupNames.has((g.title || '').trim().toUpperCase()))
        .map(g => g.id)
    );

    let ungroupedCount = 0;
    for (const group of groups) {
      if (alwaysPreservedIds.has(group.id)) continue;
      const groupTabs = await chrome.tabs.query({ groupId: group.id });
      if (groupTabs.length > 0) {
        await chrome.tabs.ungroup(groupTabs.map(t => t.id));
        ungroupedCount += groupTabs.length;
      }
    }

    return {
      success: true,
      ungroupedCount
    };
  } catch (error) {
    console.error('Error ungrouping tabs:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Handle messages from extension pages.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'closeDuplicates') {
    (async () => {
      const targetWindowId = await resolveTargetWindowId(request.windowId);
      await syncEnabledGitHubTabGroups(targetWindowId).catch(() => {});
      return closeDuplicates(request.ignoreQuery, request.ignoreHash, request.reloadTabs, targetWindowId);
    })()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'reloadAllTabs') {
    reloadAllTabs(request.windowId)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'updateBadge') {
    updateBadge().then(() => sendResponse({ success: true }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'getDuplicateCount') {
    countDuplicates()
      .then(count => sendResponse({ success: true, count }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'organizeTabs') {
    (async () => {
      const targetWindowId = await resolveTargetWindowId(request.windowId);
      await syncEnabledGitHubTabGroups(targetWindowId).catch(() => {});
      // A caller can omit preserveGroupsMinTabs. Use the saved value instead of 1.
      let minTabsRaw = request.preserveGroupsMinTabs;
      if (minTabsRaw === undefined) {
        minTabsRaw = (await chrome.storage.local.get(['preserveGroupsMinTabs'])).preserveGroupsMinTabs;
      }
      return organizeTabs(
        request.preserveGroups,
        request.mergeIntoExisting || false,
        request.customInstructions,
        parseMinTabs(minTabsRaw),
        targetWindowId
      );
    })()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'ungroupTabs') {
    ungroupTabs()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'dedupeAndTidyPinned') {
    (async () => {
      const targetWindowId = await resolveTargetWindowId(request.windowId);
      await syncEnabledGitHubTabGroups(targetWindowId).catch(() => {});
      const settings = await chrome.storage.local.get(['ignoreQuery', 'ignoreHash', 'reloadTabs']);
      const ignoreQuery = settings.ignoreQuery !== false;
      const ignoreHash = settings.ignoreHash !== false;
      const reloadTabs = settings.reloadTabs === true;
      await closeDuplicates(ignoreQuery, ignoreHash, reloadTabs, targetWindowId);
      return dedupeAndTidyPinned(ignoreQuery, ignoreHash, targetWindowId);
    })()
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (request.action === 'syncPrTabGroup') {
    syncPrTabGroup(request.windowId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'syncClosedIssueTabGroup') {
    syncClosedIssueTabGroup(request.windowId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Checked from the options page so the result reflects the service worker,
  // which is where tab organisation actually runs.
  if (request.action === 'checkChromeAI') {
    checkChromeAiAvailability()
      .then(status => sendResponse({ success: true, ...status }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (request.action === 'listLocalModels') {
    listLocalModels(request.baseUrl)
      .then(result => sendResponse({ success: true, ...result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // The options page renders the fallback order and hint from this, so what the user
  // sees is exactly the chain organizeTabs would run — one source of truth.
  if (request.action === 'describeProviderChain') {
    (async () => {
      const settings = await chrome.storage.local.get([
        'openaiKey', 'claudeKey', 'geminiKey', 'aiProvider', 'aiFallbackEnabled',
        'aiAllowCloudFallback', 'aiFallbackOrder', 'localModel'
      ]);
      return describeProviderChain(settings);
    })()
      .then(desc => sendResponse({ success: true, ...desc }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
