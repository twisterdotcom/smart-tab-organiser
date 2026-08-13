// Popup script for Smart Tab Organiser extension

document.addEventListener('DOMContentLoaded', async () => {
  const closeDuplicatesBtn = document.getElementById('closeDuplicatesBtn');
  const reloadAllBtn = document.getElementById('reloadAllBtn');
  const organizeTabsBtn = document.getElementById('organizeTabsBtn');
  const tidyPinnedBtn = document.getElementById('tidyPinnedBtn');
  const ungroupTabsBtn = document.getElementById('ungroupTabsBtn');
  const status = document.getElementById('status');
  const ignoreQueryCheckbox = document.getElementById('ignoreQuery');
  const ignoreHashCheckbox = document.getElementById('ignoreHash');
  const reloadTabsCheckbox = document.getElementById('reloadTabs');
  const preserveGroupsCheckbox = document.getElementById('preserveGroups');
  const customInstructionsTextarea = document.getElementById('customInstructions');

  // Load saved settings
  const settings = await chrome.storage.local.get(['ignoreQuery', 'ignoreHash', 'reloadTabs', 'preserveGroups', 'customInstructions']);
  ignoreQueryCheckbox.checked = settings.ignoreQuery !== false; // default to true
  ignoreHashCheckbox.checked = settings.ignoreHash !== false; // default to true
  reloadTabsCheckbox.checked = settings.reloadTabs === true;
  preserveGroupsCheckbox.checked = settings.preserveGroups !== false; // default to true
  if (settings.customInstructions) {
    customInstructionsTextarea.value = settings.customInstructions;
  }

  // Save settings when changed and update badge
  ignoreQueryCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ ignoreQuery: ignoreQueryCheckbox.checked });
    chrome.runtime.sendMessage({ action: 'updateBadge' });
  });
  ignoreHashCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ ignoreHash: ignoreHashCheckbox.checked });
    chrome.runtime.sendMessage({ action: 'updateBadge' });
  });
  reloadTabsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ reloadTabs: reloadTabsCheckbox.checked });
  });
  
  preserveGroupsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ preserveGroups: preserveGroupsCheckbox.checked });
  });
  
  customInstructionsTextarea.addEventListener('input', () => {
    chrome.storage.local.set({ customInstructions: customInstructionsTextarea.value.trim() });
  });
  
  // Update badge when popup opens (in case tabs changed)
  chrome.runtime.sendMessage({ action: 'updateBadge' });

  // Close duplicates button
  closeDuplicatesBtn.addEventListener('click', async () => {
    closeDuplicatesBtn.disabled = true;
    status.textContent = 'Processing...';
    status.className = 'status info';

    try {
      const ignoreQuery = ignoreQueryCheckbox.checked;
      const ignoreHash = ignoreHashCheckbox.checked;
      const reloadTabs = reloadTabsCheckbox.checked;

      // Send message to background script to close duplicates
      const result = await chrome.runtime.sendMessage({
        action: 'closeDuplicates',
        ignoreQuery,
        ignoreHash,
        reloadTabs
      });

      if (result.success) {
        status.textContent = `Closed ${result.closedCount} duplicate tab(s). Kept ${result.keptCount} tab(s).`;
        status.className = 'status success';
      } else {
        status.textContent = result.error || 'An error occurred';
        status.className = 'status error';
      }
    } catch (error) {
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    } finally {
      closeDuplicatesBtn.disabled = false;
    }
  });

  // Reload all tabs button
  reloadAllBtn.addEventListener('click', async () => {
    reloadAllBtn.disabled = true;
    status.textContent = 'Reloading tabs...';
    status.className = 'status info';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'reloadAllTabs'
      });

      if (result.success) {
        status.textContent = `Reloaded ${result.reloadedCount} tab(s).`;
        status.className = 'status success';
      } else {
        status.textContent = result.error || 'An error occurred';
        status.className = 'status error';
      }
    } catch (error) {
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    } finally {
      reloadAllBtn.disabled = false;
    }
  });

  // Organize tabs button
  organizeTabsBtn.addEventListener('click', async () => {
    organizeTabsBtn.disabled = true;
    status.textContent = 'Organizing tabs with AI...';
    status.className = 'status info';

    try {
      const settings = await chrome.storage.local.get(['preserveGroups', 'mergeIntoExisting']);
      const preserveGroups = preserveGroupsCheckbox.checked;
      const mergeIntoExisting = settings.mergeIntoExisting === true;
      const customInstructions = customInstructionsTextarea.value.trim();

      const result = await chrome.runtime.sendMessage({
        action: 'organizeTabs',
        preserveGroups,
        mergeIntoExisting,
        customInstructions
      });

      if (result.success) {
        let msg = `Organized ${result.groupedCount} tab(s) into ${result.groupCount} group(s).`;
        if (result.fallbackInfo) {
          msg += ` Used ${result.providerUsedLabel} after ${result.fallbackInfo.primaryFailedLabel} failed (${result.fallbackInfo.primaryFailedSummary}).`;
        }
        status.textContent = msg;
        status.className = 'status success';
      } else {
        status.textContent = result.error || 'An error occurred';
        status.className = 'status error';
      }
    } catch (error) {
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    } finally {
      organizeTabsBtn.disabled = false;
    }
  });

  // Tidy pinned tabs button (dedupe + unpin non-matching, pin & order matching)
  tidyPinnedBtn.addEventListener('click', async () => {
    tidyPinnedBtn.disabled = true;
    status.textContent = 'Deduplicating and tidying pinned tabs...';
    status.className = 'status info';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'dedupeAndTidyPinned'
      });

      if (result.success) {
        status.textContent = result.message || 'Pinned tabs tidied.';
        status.className = 'status success';
      } else {
        status.textContent = result.error || 'An error occurred';
        status.className = 'status error';
      }
    } catch (error) {
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    } finally {
      tidyPinnedBtn.disabled = false;
    }
  });

  // Ungroup tabs button
  ungroupTabsBtn.addEventListener('click', async () => {
    ungroupTabsBtn.disabled = true;
    status.textContent = 'Ungrouping tabs...';
    status.className = 'status info';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'ungroupTabs'
      });

      if (result.success) {
        status.textContent = `Ungrouped ${result.ungroupedCount} tab(s).`;
        status.className = 'status success';
      } else {
        status.textContent = result.error || 'An error occurred';
        status.className = 'status error';
      }
    } catch (error) {
      status.textContent = 'Error: ' + error.message;
      status.className = 'status error';
    } finally {
      ungroupTabsBtn.disabled = false;
    }
  });
});
