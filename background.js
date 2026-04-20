// Background service worker for Smart Tab Organiser extension

console.log('Smart Tab Organiser extension background service worker loaded');

/** Extract the first complete JSON array from text (handles trailing explanation text from the model). */
function extractJsonArray(text) {
  const start = text.indexOf('[');
  if (start === -1) return null;
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
      title: 'Deduplicate and organize tabs with AI',
      contexts: ['action']
    });
    chrome.contextMenus.create({
      id: 'edit-prompt',
      title: 'Edit prompt',
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
  });
  // Update badge and context menu state on install/update
  updateBadge();
});

// Update badge when extension starts
updateBadge();

let isOrganizing = false;
let loadingSpinnerInterval = null;

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
async function runOrganizeWithFeedback() {
  if (isOrganizing) return;
  isOrganizing = true;

  // Show animated spinner badge
  startLoadingSpinner();
  chrome.action.setTitle({ title: 'Organizing tabs...' });
  chrome.contextMenus.update('dedupe-and-organize', { enabled: false }).catch(() => {});

  const settings = await chrome.storage.local.get([
    'ignoreQuery', 'ignoreHash', 'reloadTabs',
    'customInstructionsOptions', 'preserveGroups', 'preserveGroupsMinTabs', 'mergeIntoExisting',
    'githubToken', 'prGroupEnabled'
  ]);
  // Optionally refresh PR tab group first, then dedupe, then tidy pinned tabs, then organize with AI
  if (settings.githubToken?.trim()) {
    await syncPrTabGroup().catch(() => {});
  }
  const ignoreQuery = settings.ignoreQuery !== false;
  const ignoreHash = settings.ignoreHash !== false;
  const reloadTabs = settings.reloadTabs === true;
  await closeDuplicates(ignoreQuery, ignoreHash, reloadTabs);
  await dedupeAndTidyPinned(ignoreQuery, ignoreHash);

  const preserveGroups = settings.preserveGroups !== false;
  const preserveGroupsMinTabs = Math.max(0, parseInt(settings.preserveGroupsMinTabs, 10) || 1);
  const mergeIntoExisting = settings.mergeIntoExisting === true;
  const customInstructions = settings.customInstructionsOptions || '';

  chrome.notifications.create('organize-progress', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: 'Organizing tabs',
    message: 'AI is organizing your tabs...'
  });

  try {
    const result = await organizeTabs(preserveGroups, mergeIntoExisting, customInstructions, preserveGroupsMinTabs);
    chrome.notifications.clear('organize-progress');
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Tabs organized',
      message: `Organized ${result.groupedCount} tab(s) into ${result.groupCount} group(s).`
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
async function runDedupeAndTidyPinned() {
  try {
    const settings = await chrome.storage.local.get([
      'ignoreQuery', 'ignoreHash', 'reloadTabs',
      'githubToken', 'prGroupEnabled'
    ]);
    if (settings.githubToken?.trim()) {
      await syncPrTabGroup().catch(() => {});
    }
    const ignoreQuery = settings.ignoreQuery !== false;
    const ignoreHash = settings.ignoreHash !== false;
    const reloadTabs = settings.reloadTabs === true;
    await closeDuplicates(ignoreQuery, ignoreHash, reloadTabs);
    const result = await dedupeAndTidyPinned(ignoreQuery, ignoreHash);
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
chrome.action.onClicked.addListener(async () => {
  try {
    await runDedupeAndTidyPinned();
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

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'dedupe-and-organize') {
    runOrganizeWithFeedback();
  } else if (info.menuItemId === 'edit-prompt') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html#custom-instructions') });
  } else if (info.menuItemId === 'collapse-all-groups') {
    collapseAllTabGroups();
  } else if (info.menuItemId === 'expand-all-groups') {
    expandAllTabGroups();
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
    const tabs = await getAllTabsWithUrls();
    
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
  const duplicateCount = await countDuplicates();
  
  if (duplicateCount > 0) {
    chrome.action.setBadgeText({ text: duplicateCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#FF4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// Update badge when tabs are created, updated, or removed
chrome.tabs.onCreated.addListener(() => {
  updateBadge();
});

chrome.tabs.onUpdated.addListener(() => {
  updateBadge();
});

chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

chrome.tabs.onActivated.addListener(() => {
  updateBadge();
});

// Also update badge when window focus changes (user switches windows)
chrome.windows.onFocusChanged.addListener(() => {
  updateBadge();
});

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

// Ensure tab has a URL loaded (handles suspended/inactive tabs in Arc)
async function ensureTabUrl(tab) {
  // If tab already has a valid URL, return it
  if (tab.url && isValidUrl(tab.url)) {
    return tab.url;
  }
  
  // Try to get the tab's full information, which may force-load it
  // This helps with browsers like Arc that suspend inactive tabs
  try {
    const fullTab = await chrome.tabs.get(tab.id);
    if (fullTab.url && isValidUrl(fullTab.url)) {
      return fullTab.url;
    }
  } catch (e) {
    // Tab might have been closed or we don't have permission
    console.warn(`Could not load URL for tab ${tab.id}:`, e);
  }
  
  // Return the original URL (might be empty/invalid, but that's handled elsewhere)
  return tab.url || '';
}

// Get all tabs with their URLs loaded (handles suspended tabs)
async function getAllTabsWithUrls() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  
  // For tabs without URLs, try to load them
  // This is especially important for Arc browser which suspends inactive tabs
  const tabsWithUrls = await Promise.all(
    tabs.map(async (tab) => {
      const url = await ensureTabUrl(tab);
      return { ...tab, url };
    })
  );
  
  return tabsWithUrls;
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

// Compare tabs to determine which to keep
function isInSplitView(tab) {
  const id = tab.splitViewId;
  return id !== undefined && id !== null && id !== -1;
}

function compareTabs(tab1, tab2, ignoreHash) {
  // Never close a tab that's in a split view in favor of a duplicate that isn't
  const t1Split = isInSplitView(tab1);
  const t2Split = isInSplitView(tab2);
  if (t1Split && !t2Split) return -1; // keep tab1
  if (!t1Split && t2Split) return 1;  // keep tab2

  const num1 = extractAnchorNumber(tab1.url);
  const num2 = extractAnchorNumber(tab2.url);
  
  // If ignoring hash, we still want to keep the one with the highest anchor number
  // But if both have no anchor or same number, keep the most recently accessed
  if (num1 > num2) {
    return -1; // tab1 should be kept
  } else if (num2 > num1) {
    return 1; // tab2 should be kept
  } else {
    // Same anchor number (or both 0), keep the most recently accessed
    return tab2.lastAccessed - tab1.lastAccessed;
  }
}

// Same as compareTabs but prefers the tab in the PR group (when prGroupId is set). Split view still wins.
function compareTabsWithPrGroup(tab1, tab2, ignoreHash, prGroupId) {
  const t1Split = isInSplitView(tab1);
  const t2Split = isInSplitView(tab2);
  if (t1Split && !t2Split) return -1;
  if (!t1Split && t2Split) return 1;
  if (prGroupId != null) {
    const t1InPr = tab1.groupId === prGroupId;
    const t2InPr = tab2.groupId === prGroupId;
    if (t1InPr && !t2InPr) return -1;
    if (!t1InPr && t2InPr) return 1;
  }
  return compareTabs(tab1, tab2, ignoreHash);
}

// Close duplicate tabs
async function closeDuplicates(ignoreQuery, ignoreHash, reloadTabs) {
  try {
    // Get all tabs in the current window with URLs loaded (handles suspended tabs)
    const tabs = await getAllTabsWithUrls();
    
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
    
    // Reload remaining tabs if requested
    if (reloadTabs && tabsToKeep.length > 0) {
      const reloadPromises = tabsToKeep.map(tab => 
        chrome.tabs.reload(tab.id).catch(err => {
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
async function reloadAllTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
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
  const tabsWithUrls = await Promise.all(
    allTabs.map(async (tab) => ({ ...tab, url: await ensureTabUrl(tab) }))
  );

  const usedTabIds = new Set();
  const tabIdsInOrder = [];

  for (const entry of entries) {
    const norm = entry.pattern;
    const isPrefix = entry.type === 'prefix';

    const existingTab = tabsWithUrls.find(t => {
      if (!t.url || !isValidUrl(t.url) || usedTabIds.has(t.id)) return false;
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
async function dedupeAndTidyPinned(ignoreQuery, ignoreHash) {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (!tabs.length) {
      return { success: false, error: 'No tabs in window' };
    }
    const windowId = tabs[0].windowId;
    const { entries, exactSet, prefixPatterns } = await getPinnedUrlSetAndOrder(ignoreQuery, ignoreHash);

    // Apply BOOKMARKS group colour if that group exists
    const colorSettings = await chrome.storage.local.get(['bookmarksGroupColor']);
    const bookmarksColor = colorSettings.bookmarksGroupColor || 'yellow';
    const groups = await chrome.tabGroups.query({ windowId });
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
      const result = await ensurePinnedTabsExist(windowId, ignoreQuery, ignoreHash);
      if (result.pinned) {
        return { success: true, message: 'Pinned tabs created from your list.' };
      }
      return { success: true, message: 'No matching tabs to pin.' };
    }

    // Unpin tabs that don't match the pinned URL list
    const toUnpin = [];
    const toKeep = [];
    for (const tab of currentlyPinned) {
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
    const allTabsNow = await chrome.tabs.query({ windowId });
    const tabsWithUrls = await Promise.all(
      allTabsNow.map(async (tab) => ({ ...tab, url: await ensureTabUrl(tab) }))
    );
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
        if (!t.url || !isValidUrl(t.url) || alreadyPinnedIds.has(t.id)) return false;
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
        const newTab = await chrome.tabs.create({ url: urlToOpen, windowId, pinned: true });
        alreadyPinnedIds.add(newTab.id);
        toKeep.push(newTab);
      }
    }

    // Order pinned tabs to match the list
    toKeep.sort((a, b) => {
      const na = normalizeUrl(a.url || '', ignoreQuery, ignoreHash);
      const nb = normalizeUrl(b.url || '', ignoreQuery, ignoreHash);
      return getPinnedOrderIndex(na, entries) - getPinnedOrderIndex(nb, entries);
    });
    for (let i = 0; i < toKeep.length; i++) {
      await chrome.tabs.move(toKeep[i].id, { index: i });
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

// Fetch open PR URLs from GitHub (authored by user or review-requested)
async function fetchOpenPrUrls(githubToken) {
  if (!githubToken || !githubToken.trim()) {
    return { prUrls: [], error: 'GitHub token not set' };
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken.trim()}`
  };
  try {
    const userRes = await fetch('https://api.github.com/user', { headers });
    if (!userRes.ok) {
      const err = await userRes.json().catch(() => ({}));
      if (userRes.status === 401) return { prUrls: [], error: 'Invalid or expired GitHub token' };
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
        if (res.status === 403 && /rate limit/i.test(err.message || '')) return { rateLimited: true };
        return {};
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
    let err2 = await addFromSearch(reviewQ);
    if (err2.rateLimited) return { prUrls: [], error: 'GitHub rate limit exceeded' };

    return { prUrls: Array.from(prUrls) };
  } catch (e) {
    console.error('fetchOpenPrUrls error:', e);
    return { prUrls: [], error: e.message || 'Failed to fetch PRs' };
  }
}

// Build normalized PR URL for matching (github.com/owner/repo/pull/number, no hash/query)
function normalizedPrUrl(url, ignoreQuery, ignoreHash) {
  if (!url || !url.includes('github.com') || !url.includes('/pull/')) return null;
  return normalizeUrl(url, ignoreQuery !== false, ignoreHash !== false);
}

// Create or get PR tab group in window; sync tabs to match prUrls. Returns { success, message?, error? }.
async function syncPrTabGroup(windowId) {
  const settings = await chrome.storage.local.get(['githubToken', 'prGroupEnabled', 'ignoreQuery', 'ignoreHash']);
  if (!settings.githubToken?.trim()) {
    return { success: false, error: 'GitHub token not set' };
  }
  const { prUrls, error: fetchError } = await fetchOpenPrUrls(settings.githubToken);
  if (fetchError) return { success: false, error: fetchError };
  if (prUrls.length === 0) {
    // No open PRs: ensure group exists but is empty (or remove tabs that are no longer PRs)
    const win = windowId != null ? await chrome.windows.get(windowId) : (await chrome.windows.getCurrent());
    const groups = await chrome.tabGroups.query({ windowId: win.id });
    const prGroup = groups.find(g => (g.title || '').trim() === PR_GROUP_TITLE);
    if (prGroup) {
      const existingTabs = await chrome.tabs.query({ groupId: prGroup.id });
      for (const tab of existingTabs) {
        await chrome.tabs.remove(tab.id);
      }
    }
    return { success: true, message: 'No open PRs; PR group cleared.' };
  }

  const ignoreQuery = settings.ignoreQuery !== false;
  const ignoreHash = settings.ignoreHash !== false;
  const targetNorm = new Set(prUrls.map(u => normalizedPrUrl(u, ignoreQuery, ignoreHash)).filter(Boolean));

  const win = windowId != null ? await chrome.windows.get(windowId) : (await chrome.windows.getCurrent());
  const allTabs = await chrome.tabs.query({ windowId: win.id });
  const tabsWithUrls = await Promise.all(
    allTabs.map(async (tab) => ({ ...tab, url: await ensureTabUrl(tab) }))
  );

  let prGroupId = null;
  const groups = await chrome.tabGroups.query({ windowId: win.id });
  let prGroup = groups.find(g => (g.title || '').trim() === PR_GROUP_TITLE);

  // Tabs already in PR group that match a current PR URL (normalized)
  const inPrGroupByNorm = new Map();
  if (prGroup) {
    prGroupId = prGroup.id;
    const inPr = await chrome.tabs.query({ groupId: prGroup.id });
    for (const tab of inPr) {
      const u = tab.url || '';
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
    // Prefer a tab elsewhere in the window with this URL
    const sameUrlTab = tabsWithUrls.find(t => {
      if (!t.url || !isValidUrl(t.url)) return false;
      const tNorm = normalizedPrUrl(t.url, ignoreQuery, ignoreHash);
      return tNorm === norm && !usedTabIds.has(t.id);
    });
    if (sameUrlTab) {
      usedTabIds.add(sameUrlTab.id);
      if (prGroupId == null) {
        prGroupId = await chrome.tabs.group({ tabIds: [sameUrlTab.id] });
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
      prGroupId = await chrome.tabs.group({ tabIds: [newTab.id] });
      await chrome.tabGroups.update(prGroupId, { title: PR_GROUP_TITLE, color: 'blue' });
    } else {
      const currentInGroup = await chrome.tabs.query({ groupId: prGroupId });
      const currentIds = currentInGroup.map(t => t.id);
      await chrome.tabs.group({ groupId: prGroupId, tabIds: [...currentIds, newTab.id] });
    }
    inPrGroupByNorm.set(norm, newTab);
    usedTabIds.add(newTab.id);
  }

  // Remove from PR group any tabs that are no longer in prUrls
  if (prGroupId != null) {
    const inPr = await chrome.tabs.query({ groupId: prGroupId });
    for (const tab of inPr) {
      const norm = normalizedPrUrl(tab.url || '', ignoreQuery, ignoreHash);
      if (!norm || !targetNorm.has(norm)) {
        await chrome.tabs.remove(tab.id);
      }
    }
  }

  return { success: true, message: `PR group updated with ${prUrls.length} PR(s).` };
}

// Call OpenAI API to categorize tabs
async function callOpenAI(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
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

  // Add existing groups information if merging
  if (existingGroups && existingGroups.length > 0) {
    const existingGroupsInfo = existingGroups.map((group, idx) => {
      const groupTabs = group.tabs.map(t => {
        const tabIndex = tabs.findIndex(tab => tab.id === t.id) + 1; // 1-based index
        return tabIndex > 0 ? tabIndex : null;
      }).filter(idx => idx !== null);
      
      return `Existing Group "${group.title}": Contains tabs ${groupTabs.join(', ')}`;
    }).join('\n');
    
    basePrompt += `\n\nExisting Groups (merge new tabs into these groups where appropriate):
${existingGroupsInfo}

IMPORTANT: When merging tabs into existing groups, use the EXACT group name from the existing group. You can also create new groups for tabs that don't fit into existing groups.`;
  }

  if (splitTabIndices && splitTabIndices.length > 0) {
    basePrompt += `\n\nSIDE-BY-SIDE SPLITS (these tab pairs/groups MUST stay together in the SAME group - never separate them):
${splitTabIndices.map((indices, i) => `- Split ${i + 1}: tabs ${indices.join(', ')}`).join('\n')}`;
  }

  const minSizeRule = minGroupSize > 0
    ? `- Each group must contain MORE than ${minGroupSize} tab(s). Never create a group with ${minGroupSize} or fewer tabs; put those tabs in "Misc".\n`
    : `- Never create a group with only one tab. All single tabs should be grouped into a group named "Misc".\n- Each group must contain at least 2 tabs (except for "Misc" which can contain multiple single tabs).\n`;
  basePrompt += `\n\nIMPORTANT RULES:
${minSizeRule}- If you have tabs that don't fit into any logical group, put them in "Misc".
- NEVER add or remove any tabs to the group named "BOOKMARKS" or "PRs". Leave these groups exactly as they are.
- Pinned tabs are never included in this list. Do not reference or create groups for pinned tabs.
- Tabs in a side-by-side split must be placed in the SAME group together. Never separate them or unsplit them.

${customInstructions ? `Additional instructions: ${customInstructions}\n` : ''}

Return ONLY valid JSON, no other text. Example format:
[{"groupName": "Work", "tabIndices": [1, 3, 5]}, {"groupName": "Social", "tabIndices": [2, 4]}, {"groupName": "Misc", "tabIndices": [6, 7]}]`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model || 'gpt-5-mini',
      messages: [
        {
          role: 'user',
          content: basePrompt
        }
      ],
      max_completion_tokens: 5000
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    console.error('[Smart Tab Organiser] OpenAI API error:', response.status, error);
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content?.trim();

  if (!content) {
    console.warn('[Smart Tab Organiser] OpenAI: no content in response. Full response:', {
      hasChoices: !!data.choices?.length,
      choicesLength: data.choices?.length ?? 0,
      firstChoice: data.choices?.[0] ? {
        message: data.choices[0].message,
        finish_reason: data.choices[0].finish_reason
      } : null,
      usage: data.usage,
      model: data.model
    });
    throw new Error('No response from OpenAI');
  }

  // Extract JSON from response (in case there's extra text)
  const jsonStr = extractJsonArray(content);
  if (!jsonStr) {
    console.warn('[Smart Tab Organiser] OpenAI: invalid format (no JSON array). Content preview:', content.slice(0, 200));
    throw new Error('Invalid response format from OpenAI');
  }

  return JSON.parse(jsonStr);
}

// Call Claude API to categorize tabs
async function callClaude(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
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

  // Add existing groups information if merging
  if (existingGroups && existingGroups.length > 0) {
    const existingGroupsInfo = existingGroups.map((group, idx) => {
      const groupTabs = group.tabs.map(t => {
        const tabIndex = tabs.findIndex(tab => tab.id === t.id) + 1; // 1-based index
        return tabIndex > 0 ? tabIndex : null;
      }).filter(idx => idx !== null);
      
      return `Existing Group "${group.title}": Contains tabs ${groupTabs.join(', ')}`;
    }).join('\n');
    
    basePrompt += `\n\nExisting Groups (merge new tabs into these groups where appropriate):
${existingGroupsInfo}

IMPORTANT: When merging tabs into existing groups, use the EXACT group name from the existing group. You can also create new groups for tabs that don't fit into existing groups.`;
  }

  if (splitTabIndices && splitTabIndices.length > 0) {
    basePrompt += `\n\nSIDE-BY-SIDE SPLITS (these tab pairs/groups MUST stay together in the SAME group - never separate them):
${splitTabIndices.map((indices, i) => `- Split ${i + 1}: tabs ${indices.join(', ')}`).join('\n')}`;
  }

  const minSizeRuleClaude = minGroupSize > 0
    ? `- Each group must contain MORE than ${minGroupSize} tab(s). Never create a group with ${minGroupSize} or fewer tabs; put those tabs in "Misc".\n`
    : `- Never create a group with only one tab. All single tabs should be grouped into a group named "Misc".\n- Each group must contain at least 2 tabs (except for "Misc" which can contain multiple single tabs).\n`;
  basePrompt += `\n\nIMPORTANT RULES:
${minSizeRuleClaude}- If you have tabs that don't fit into any logical group, put them in "Misc".
- NEVER add or remove any tabs to the group named "BOOKMARKS" or "PRs". Leave these groups exactly as they are.
- Pinned tabs are never included in this list. Do not reference or create groups for pinned tabs.
- Tabs in a side-by-side split must be placed in the SAME group together. Never separate them or unsplit them.

${customInstructions ? `Additional instructions: ${customInstructions}\n` : ''}

Return ONLY valid JSON, no other text. Example format:
[{"groupName": "Work", "tabIndices": [1, 3, 5]}, {"groupName": "Social", "tabIndices": [2, 4]}, {"groupName": "Misc", "tabIndices": [6, 7]}]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-haiku-4-5-20251001',
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
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    console.error('[Smart Tab Organiser] Claude API error:', response.status, error);
    throw new Error(error.error?.message || `Claude API error: ${response.status}`);
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
    throw new Error('No response from Claude');
  }

  // Extract JSON from response (in case there's extra text)
  const jsonStr = extractJsonArray(content);
  if (!jsonStr) {
    console.warn('[Smart Tab Organiser] Claude: invalid format (no JSON array). Content preview:', content.slice(0, 200));
    throw new Error('Invalid response format from Claude');
  }

  return JSON.parse(jsonStr);
}

// Call Gemini API to categorize tabs
async function callGemini(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null, minGroupSize = 1) {
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

  if (existingGroups && existingGroups.length > 0) {
    const existingGroupsInfo = existingGroups.map((group) => {
      const groupTabs = group.tabs.map(t => {
        const tabIndex = tabs.findIndex(tab => tab.id === t.id) + 1;
        return tabIndex > 0 ? tabIndex : null;
      }).filter(idx => idx !== null);
      return `Existing Group "${group.title}": Contains tabs ${groupTabs.join(', ')}`;
    }).join('\n');
    basePrompt += `\n\nExisting Groups (merge new tabs into these groups where appropriate):
${existingGroupsInfo}

IMPORTANT: When merging tabs into existing groups, use the EXACT group name from the existing group. You can also create new groups for tabs that don't fit into existing groups.`;
  }

  if (splitTabIndices && splitTabIndices.length > 0) {
    basePrompt += `\n\nSIDE-BY-SIDE SPLITS (these tab pairs/groups MUST stay together in the SAME group - never separate them):
${splitTabIndices.map((indices, i) => `- Split ${i + 1}: tabs ${indices.join(', ')}`).join('\n')}`;
  }

  const minSizeRuleGemini = minGroupSize > 0
    ? `- Each group must contain MORE than ${minGroupSize} tab(s). Never create a group with ${minGroupSize} or fewer tabs; put those tabs in "Misc".\n`
    : `- Never create a group with only one tab. All single tabs should be grouped into a group named "Misc".\n- Each group must contain at least 2 tabs (except for "Misc" which can contain multiple single tabs).\n`;
  basePrompt += `\n\nIMPORTANT RULES:
${minSizeRuleGemini}- If you have tabs that don't fit into any logical group, put them in "Misc".
- NEVER add or remove any tabs to the group named "BOOKMARKS" or "PRs". Leave these groups exactly as they are.
- Pinned tabs are never included in this list. Do not reference or create groups for pinned tabs.
- Tabs in a side-by-side split must be placed in the SAME group together. Never separate them or unsplit them.

${customInstructions ? `Additional instructions: ${customInstructions}\n` : ''}

Return ONLY valid JSON, no other text. Example format:
[{"groupName": "Work", "tabIndices": [1, 3, 5]}, {"groupName": "Social", "tabIndices": [2, 4]}, {"groupName": "Misc", "tabIndices": [6, 7]}]`;

  const modelId = model || 'gemini-2.0-flash';
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
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    console.error('[Smart Tab Organiser] Gemini API error:', response.status, error);
    throw new Error(error.error?.message || error.message || `Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!content) {
    console.warn('[Smart Tab Organiser] Gemini: no content in response. Full response:', {
      hasCandidates: !!data.candidates?.length,
      finishReason: data.candidates?.[0]?.finishReason,
      usage: data.usageMetadata
    });
    throw new Error('No response from Gemini');
  }

  const jsonStr = extractJsonArray(content);
  if (!jsonStr) {
    console.warn('[Smart Tab Organiser] Gemini: invalid format (no JSON array). Content preview:', content.slice(0, 200));
    throw new Error('Invalid response format from Gemini');
  }

  return JSON.parse(jsonStr);
}

// Organize tabs using AI
const ALWAYS_PRESERVED_GROUP_NAMES = ['BOOKMARKS', 'PRs'];
const PR_GROUP_TITLE = 'PRs';

async function organizeTabs(preserveGroups, mergeIntoExisting, customInstructions, preserveGroupsMinTabs = 1) {
  try {
    const minTabs = Math.max(0, parseInt(preserveGroupsMinTabs, 10) || 1);

    // Get AI settings
    const settings = await chrome.storage.local.get([
      'openaiKey', 'claudeKey', 'geminiKey', 'aiProvider',
      'openaiModel', 'claudeModel', 'geminiModel', 'customInstructionsOptions'
    ]);
    const provider = settings.aiProvider || 'openai';
    const openaiKey = settings.openaiKey?.trim();
    const claudeKey = settings.claudeKey?.trim();
    const geminiKey = settings.geminiKey?.trim();
    const openaiModel = settings.openaiModel || 'gpt-5-mini';
    const claudeModel = settings.claudeModel || 'claude-haiku-4-5-20251001';
    const geminiModel = settings.geminiModel || 'gemini-2.0-flash';
    
    // Use custom instructions from parameter, or fall back to saved options instructions
    const instructions = customInstructions || settings.customInstructionsOptions || '';

    // Validate API key
    if (provider === 'openai' && !openaiKey) {
      throw new Error('OpenAI API key not configured. Please set it in the options page.');
    }
    if (provider === 'claude' && !claudeKey) {
      throw new Error('Claude API key not configured. Please set it in the options page.');
    }
    if (provider === 'gemini' && !geminiKey) {
      throw new Error('Gemini API key not configured. Please set it in the options page.');
    }

    // Get all tabs in current window
    const tabs = await chrome.tabs.query({ currentWindow: true });
    
    // Filter out extension pages and invalid URLs
    const validTabs = tabs.filter(tab => {
      const url = tab.url || '';
      return !url.startsWith('chrome://') && 
             !url.startsWith('chrome-extension://') &&
             !url.startsWith('edge://') &&
             !url.startsWith('about:') &&
             url.startsWith('http');
    });

    if (validTabs.length === 0) {
      return {
        success: false,
        error: 'No valid tabs to organize'
      };
    }

    // Always know which groups are BOOKMARKS / PRs so we never touch them (regardless of settings)
    // Pinned tabs (Chrome-native) are excluded separately via tab.pinned
    const allGroups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
    const bookmarksGroupIds = new Set(
      allGroups.filter(g => (g.title || '').trim().toUpperCase() === 'BOOKMARKS').map(g => g.id)
    );
    const prGroupIds = new Set(
      allGroups.filter(g => (g.title || '').trim() === PR_GROUP_TITLE).map(g => g.id)
    );
    const alwaysPreservedGroupIds = new Set([...bookmarksGroupIds, ...prGroupIds]);

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
      if (groupTabs.length > 0) {
        await chrome.tabs.ungroup(groupTabs.map(t => t.id));
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

    // Re-query tabs after ungrouping so tab.groupId is up to date
    const tabsAfterUngroup = await chrome.tabs.query({ currentWindow: true });
    const validTabsAfterUngroup = tabsAfterUngroup.filter(tab => {
      const url = tab.url || '';
      return !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') &&
             !url.startsWith('edge://') && !url.startsWith('about:') && url.startsWith('http');
    });

    // Determine which tabs to send to AI
    // When merging, send all tabs so AI has full context
    // When preserving (but not merging), only send tabs not in a preserved group
    // Always exclude Chrome-pinned tabs, BOOKMARKS, and PRs
    let tabsForAI = mergeIntoExisting
      ? validTabsAfterUngroup
      : (preserveGroups
          ? validTabsAfterUngroup.filter(tab => !tab.groupId || tab.groupId === -1 || !preservedGroupIds.has(tab.groupId))
          : validTabsAfterUngroup);

    tabsForAI = tabsForAI.filter(tab => {
      if (tab.pinned) return false;
      if (bookmarksGroupIds.has(tab.groupId)) return false;
      if (prGroupIds.has(tab.groupId)) return false;
      return true;
    });

    if (tabsForAI.length === 0) {
      return {
        success: false,
        error: 'No tabs to organize'
      };
    }

    // Build split view info: tabs with same splitViewId must stay together (Chrome 140+)
    const splitMap = new Map();
    tabsForAI.forEach((tab, index) => {
      const svId = tab.splitViewId;
      if (svId !== undefined && svId !== -1) {
        if (!splitMap.has(svId)) splitMap.set(svId, []);
        splitMap.get(svId).push(index + 1); // 1-based index for AI
      }
    });
    const splitTabIndices = Array.from(splitMap.values()).filter(indices => indices.length >= 2);

    // Call AI API with existing groups info if merging
    let groups;
    const existingGroupsForAI = mergeIntoExisting ? existingGroupsInfo : null;
    
    if (provider === 'openai') {
      groups = await callOpenAI(openaiKey, openaiModel, tabsForAI, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    } else if (provider === 'claude') {
      groups = await callClaude(claudeKey, claudeModel, tabsForAI, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    } else {
      groups = await callGemini(geminiKey, geminiModel, tabsForAI, instructions, existingGroupsForAI, splitTabIndices, minTabs);
    }

    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error('Invalid response from AI: expected array of groups');
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

    // Never move tabs to another window: only operate on tabs in the current window
    const currentWindowId = tabs[0].windowId;
    const currentWindowTabIds = new Set(tabs.map(t => t.id));

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

      if (tabIds.length === 0) {
        continue;
      }

      // Handle single-tab groups: add to Misc
      if (tabIds.length === 1) {
        miscTabIds.push(...tabIds);
        usedTabIndices.add(tabIds[0]);
        continue;
      }

      // Mark tabs as used
      tabIds.forEach(id => usedTabIndices.add(id));

      // Check if we should merge into an existing group
      const groupNameLower = group.groupName.toLowerCase();
      const existingGroupId = existingGroupMap.get(groupNameLower);
      
      let groupId;
      if (existingGroupId) {
        // Merge into existing group (only tabs in current window)
        const existingTabs = await chrome.tabs.query({ groupId: existingGroupId });
        const existingTabIds = existingTabs
          .filter(t => t.windowId === currentWindowId)
          .map(t => t.id);
        const allTabIds = [...new Set([...existingTabIds, ...tabIds])].filter(id => currentWindowTabIds.has(id));
        await chrome.tabs.group({ groupId: existingGroupId, tabIds: allTabIds });
        groupId = existingGroupId;
        groupedCount += tabIds.length; // Only count newly added tabs
      } else {
        // Create new group (only current-window tabs)
        groupId = await chrome.tabs.group({ tabIds });
        
        // Pick a color not yet used; if all used, cycle through
        const available = allColors.filter(c => !usedColors.has(c));
        const color = available.length > 0 ? available[0] : allColors[groupCount % allColors.length];
        usedColors.add(color);
        
        await chrome.tabGroups.update(groupId, {
          title: group.groupName.substring(0, 20),
          color: color
        });
        
        groupedCount += tabIds.length;
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
    if (miscTabIds.length > 0) {
      const existingMiscGroupId = existingGroupMap.get('misc');
      
      if (existingMiscGroupId) {
        // Merge into existing Misc group (only current-window tabs)
        const existingTabs = await chrome.tabs.query({ groupId: existingMiscGroupId });
        const existingTabIds = existingTabs
          .filter(t => t.windowId === currentWindowId)
          .map(t => t.id);
        const allMiscTabIds = [...new Set([...existingTabIds, ...miscTabIds])].filter(id => currentWindowTabIds.has(id));
        await chrome.tabs.group({ groupId: existingMiscGroupId, tabIds: allMiscTabIds });
        groupedCount += miscTabIds.length;
      } else {
        // Create new Misc group (only current-window tabs)
        const miscIdsInWindow = miscTabIds.filter(id => currentWindowTabIds.has(id));
        if (miscIdsInWindow.length > 0) {
          const newMiscGroupId = await chrome.tabs.group({ tabIds: miscIdsInWindow });
          await chrome.tabGroups.update(newMiscGroupId, {
            title: 'Misc',
            color: 'grey'
          });
          groupedCount += miscIdsInWindow.length;
          groupCount++;
        }
      }
    }

    return {
      success: true,
      groupedCount,
      groupCount
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

// Ungroup all tabs (always skips BOOKMARKS and PRs groups; pinned tabs are unaffected)
async function ungroupTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length === 0) {
      return {
        success: false,
        error: 'No tabs found'
      };
    }

    // Get all groups in current window; never ungroup BOOKMARKS or PRs
    const groups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
    const alwaysPreservedIds = new Set(
      groups
        .filter(g => ALWAYS_PRESERVED_GROUP_NAMES.includes((g.title || '').trim().toUpperCase()))
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

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'closeDuplicates') {
    closeDuplicates(request.ignoreQuery, request.ignoreHash, request.reloadTabs)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep the message channel open for async response
  }
  
  if (request.action === 'reloadAllTabs') {
    reloadAllTabs()
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
    const preserveGroupsMinTabs = Math.max(0, parseInt(request.preserveGroupsMinTabs, 10) || 1);
    organizeTabs(request.preserveGroups, request.mergeIntoExisting || false, request.customInstructions, preserveGroupsMinTabs)
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
      const settings = await chrome.storage.local.get(['ignoreQuery', 'ignoreHash', 'reloadTabs']);
      const ignoreQuery = settings.ignoreQuery !== false;
      const ignoreHash = settings.ignoreHash !== false;
      const reloadTabs = settings.reloadTabs === true;
      await closeDuplicates(ignoreQuery, ignoreHash, reloadTabs);
      const result = await dedupeAndTidyPinned(ignoreQuery, ignoreHash);
      sendResponse(result);
    })();
    return true;
  }

  if (request.action === 'syncPrTabGroup') {
    syncPrTabGroup(request.windowId)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
