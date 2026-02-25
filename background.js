// Background service worker for Organise and Deduplicate Tabs extension

console.log('Organise and Deduplicate Tabs extension background service worker loaded');

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
  // Update badge on install/update
  updateBadge();
});

// Update badge when extension starts
updateBadge();

// Handle extension icon click - run deduplication, then optionally organize based on settings
chrome.action.onClicked.addListener(async () => {
  try {
    const settings = await chrome.storage.local.get([
      'ignoreQuery', 'ignoreHash', 'reloadTabs', 'organizeOnClick',
      'customInstructionsOptions', 'preserveGroups', 'mergeIntoExisting'
    ]);
    
    // Always deduplicate first
    const ignoreQuery = settings.ignoreQuery !== false; // default to true
    const ignoreHash = settings.ignoreHash !== false; // default to true
    const reloadTabs = settings.reloadTabs === true;
    await closeDuplicates(ignoreQuery, ignoreHash, reloadTabs);
    
    // Then organize tabs if enabled
    if (settings.organizeOnClick === true) {
      const preserveGroups = settings.preserveGroups !== false; // default to true
      const mergeIntoExisting = settings.mergeIntoExisting === true;
      const customInstructions = settings.customInstructionsOptions || '';
      await organizeTabs(preserveGroups, mergeIntoExisting, customInstructions);
    }
  } catch (error) {
    console.error('Error on extension icon click:', error);
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

// Update the badge text
async function updateBadge() {
  const duplicateCount = await countDuplicates();
  
  if (duplicateCount > 0) {
    // Set badge text (max 4 characters, Chrome will show "99+" for larger numbers)
    chrome.action.setBadgeText({ text: duplicateCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#FF4444' }); // Red badge
  } else {
    // Clear badge when no duplicates
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
function compareTabs(tab1, tab2, ignoreHash) {
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
      
      // Sort to find the best tab to keep
      // We want the one with the highest anchor number
      groupTabs.sort((a, b) => compareTabs(a, b, ignoreHash));
      
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

// Call OpenAI API to categorize tabs
async function callOpenAI(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null) {
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

  basePrompt += `\n\nIMPORTANT RULES:
- Never create a group with only one tab. All single tabs should be grouped into a group named "Misc".
- Each group must contain at least 2 tabs (except for "Misc" which can contain multiple single tabs).
- If you have tabs that don't fit into any logical group, put them in "Misc".
- NEVER add or remove any tabs to the group named "PINNED" or "BOOKMARKS". Leave these groups exactly as they are.
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
      temperature: 0.3,
      max_completion_tokens: 5000
    })
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }));
    throw new Error(error.error?.message || `OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content?.trim();
  
  if (!content) {
    throw new Error('No response from OpenAI');
  }

  // Extract JSON from response (in case there's extra text)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Invalid response format from OpenAI');
  }

  return JSON.parse(jsonMatch[0]);
}

// Call Claude API to categorize tabs
async function callClaude(apiKey, model, tabs, customInstructions, existingGroups = null, splitTabIndices = null) {
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

  basePrompt += `\n\nIMPORTANT RULES:
- Never create a group with only one tab. All single tabs should be grouped into a group named "Misc".
- Each group must contain at least 2 tabs (except for "Misc" which can contain multiple single tabs).
- If you have tabs that don't fit into any logical group, put them in "Misc".
- NEVER add or remove any tabs to the group named "PINNED" or "BOOKMARKS". Leave these groups exactly as they are.
- Tabs in a side-by-side split must be placed in the SAME group together. Never separate them or unsplit them.

${customInstructions ? `Additional instructions: ${customInstructions}\n` : ''}

Return ONLY valid JSON, no other text. Example format:
[{"groupName": "Work", "tabIndices": [1, 3, 5]}, {"groupName": "Social", "tabIndices": [2, 4]}, {"groupName": "Misc", "tabIndices": [6, 7]}]`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
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
    throw new Error(error.error?.message || `Claude API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.content[0]?.text?.trim();
  
  if (!content) {
    throw new Error('No response from Claude');
  }

  // Extract JSON from response (in case there's extra text)
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('Invalid response format from Claude');
  }

  return JSON.parse(jsonMatch[0]);
}

// Organize tabs using AI
async function organizeTabs(preserveGroups, mergeIntoExisting, customInstructions) {
  try {
    // Get AI settings
    const settings = await chrome.storage.local.get([
      'openaiKey', 'claudeKey', 'aiProvider',
      'openaiModel', 'claudeModel', 'customInstructionsOptions'
    ]);
    const provider = settings.aiProvider || 'openai';
    const openaiKey = settings.openaiKey?.trim();
    const claudeKey = settings.claudeKey?.trim();
    const openaiModel = settings.openaiModel || 'gpt-5-mini';
    const claudeModel = settings.claudeModel || 'claude-haiku-4-5-20251001';
    
    // Use custom instructions from parameter, or fall back to saved options instructions
    const instructions = customInstructions || settings.customInstructionsOptions || '';

    // Validate API key
    if (provider === 'openai' && !openaiKey) {
      throw new Error('OpenAI API key not configured. Please set it in the options page.');
    }
    if (provider === 'claude' && !claudeKey) {
      throw new Error('Claude API key not configured. Please set it in the options page.');
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

    // Get existing groups information
    let existingGroupIds = new Set();
    let existingGroupsInfo = [];
    
    if (preserveGroups || mergeIntoExisting) {
      const groups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
      
      for (const group of groups) {
        existingGroupIds.add(group.id);
        
        // If merging, get tabs in each existing group
        if (mergeIntoExisting) {
          const groupTabs = await chrome.tabs.query({ groupId: group.id });
          existingGroupsInfo.push({
            id: group.id,
            title: group.title,
            color: group.color,
            tabs: groupTabs
          });
        }
      }
    }

    // Determine which tabs to send to AI
    // When merging, send all tabs so AI has full context
    // When preserving (but not merging), only send ungrouped tabs
    const tabsForAI = mergeIntoExisting 
      ? validTabs  // Include all tabs when merging
      : (preserveGroups 
          ? validTabs.filter(tab => !tab.groupId || tab.groupId === -1)  // Only ungrouped if preserving
          : validTabs);  // All tabs if not preserving

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
      groups = await callOpenAI(openaiKey, openaiModel, tabsForAI, instructions, existingGroupsForAI, splitTabIndices);
    } else {
      groups = await callClaude(claudeKey, claudeModel, tabsForAI, instructions, existingGroupsForAI, splitTabIndices);
    }

    if (!Array.isArray(groups) || groups.length === 0) {
      throw new Error('Invalid response from AI: expected array of groups');
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

    // Create or update tab groups
    let groupedCount = 0;
    let groupCount = 0;
    const usedTabIndices = new Set();
    const miscTabIds = []; // Collect tabs for Misc group
    
    // Create a map of existing group names to group IDs for merging
    const existingGroupMap = new Map();
    if (mergeIntoExisting) {
      existingGroupsInfo.forEach(group => {
        existingGroupMap.set(group.title.toLowerCase(), group.id);
      });
    }

    // First pass: process groups with 2+ tabs
    for (const group of groups) {
      if (!group.groupName || !Array.isArray(group.tabIndices) || group.tabIndices.length === 0) {
        continue;
      }

      // Convert 1-based indices to tab IDs
      const tabIds = group.tabIndices
        .map(idx => {
          const tabIndex = idx - 1; // Convert to 0-based
          if (tabIndex >= 0 && tabIndex < tabsForAI.length) {
            return tabsForAI[tabIndex].id;
          }
          return null;
        })
        .filter(id => id !== null && !usedTabIndices.has(id));

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
        // Merge into existing group
        const existingTabs = await chrome.tabs.query({ groupId: existingGroupId });
        const existingTabIds = existingTabs.map(t => t.id);
        const allTabIds = [...new Set([...existingTabIds, ...tabIds])]; // Combine and deduplicate
        await chrome.tabs.group({ groupId: existingGroupId, tabIds: allTabIds });
        groupId = existingGroupId;
        groupedCount += tabIds.length; // Only count newly added tabs
      } else {
        // Create new group
        groupId = await chrome.tabs.group({ tabIds });
        
        // Set group title and color
        const colors = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
        const color = colors[groupCount % colors.length];
        
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
      // Add remaining tabs to Misc
      miscTabIds.push(...remainingTabs.map(t => t.id));
    }

    // Create or merge into Misc group if we have tabs for it
    if (miscTabIds.length > 0) {
      const existingMiscGroupId = existingGroupMap.get('misc');
      
      if (existingMiscGroupId) {
        // Merge into existing Misc group
        const existingTabs = await chrome.tabs.query({ groupId: existingMiscGroupId });
        const existingTabIds = existingTabs.map(t => t.id);
        const allMiscTabIds = [...new Set([...existingTabIds, ...miscTabIds])];
        await chrome.tabs.group({ groupId: existingMiscGroupId, tabIds: allMiscTabIds });
        groupedCount += miscTabIds.length;
      } else {
        // Create new Misc group
        const newMiscGroupId = await chrome.tabs.group({ tabIds: miscTabIds });
        await chrome.tabGroups.update(newMiscGroupId, {
          title: 'Misc',
          color: 'grey'
        });
        groupedCount += miscTabIds.length;
        groupCount++;
      }
    }

    return {
      success: true,
      groupedCount,
      groupCount
    };
  } catch (error) {
    console.error('Error organizing tabs:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// Ungroup all tabs
async function ungroupTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length === 0) {
      return {
        success: false,
        error: 'No tabs found'
      };
    }

    // Get all groups in current window
    const groups = await chrome.tabGroups.query({ windowId: tabs[0].windowId });
    
    // Ungroup all tabs
    let ungroupedCount = 0;
    for (const group of groups) {
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
    organizeTabs(request.preserveGroups, request.mergeIntoExisting || false, request.customInstructions)
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
});
