// Options page script

document.addEventListener('DOMContentLoaded', async () => {
  const ignoreQueryCheckbox = document.getElementById('ignoreQuery');
  const ignoreHashCheckbox = document.getElementById('ignoreHash');
  const reloadTabsCheckbox = document.getElementById('reloadTabs');
  const testBtn = document.getElementById('testBtn');
  const reloadAllBtn = document.getElementById('reloadAllBtn');
  const actionStatus = document.getElementById('actionStatus');
  const openaiKeyInput = document.getElementById('openaiKey');
  const claudeKeyInput = document.getElementById('claudeKey');
  const aiProviderSelect = document.getElementById('aiProvider');
  const openaiModelSelect = document.getElementById('openaiModel');
  const claudeModelSelect = document.getElementById('claudeModel');
  const customInstructionsOptions = document.getElementById('customInstructionsOptions');
  const preserveGroupsCheckbox = document.getElementById('preserveGroups');
  const mergeIntoExistingCheckbox = document.getElementById('mergeIntoExisting');
  const organizeOnClickCheckbox = document.getElementById('organizeOnClick');
  const organizeTabsBtn = document.getElementById('organizeTabsBtn');
  const ungroupTabsBtn = document.getElementById('ungroupTabsBtn');

  // Load saved settings
  const settings = await chrome.storage.local.get([
    'ignoreQuery', 'ignoreHash', 'reloadTabs', 
    'openaiKey', 'claudeKey', 'aiProvider',
    'openaiModel', 'claudeModel', 'customInstructionsOptions', 
    'preserveGroups', 'mergeIntoExisting', 'organizeOnClick'
  ]);
  ignoreQueryCheckbox.checked = settings.ignoreQuery !== false; // default to true
  ignoreHashCheckbox.checked = settings.ignoreHash !== false; // default to true
  reloadTabsCheckbox.checked = settings.reloadTabs === true;
  
  // Load AI settings
  if (settings.openaiKey) {
    openaiKeyInput.value = settings.openaiKey;
  }
  if (settings.claudeKey) {
    claudeKeyInput.value = settings.claudeKey;
  }
  aiProviderSelect.value = settings.aiProvider || 'openai';
  openaiModelSelect.value = settings.openaiModel || 'gpt-5-mini';
  claudeModelSelect.value = settings.claudeModel || 'claude-haiku-4-5-20251001';
  if (settings.customInstructionsOptions) {
    customInstructionsOptions.value = settings.customInstructionsOptions;
  }
  preserveGroupsCheckbox.checked = settings.preserveGroups !== false; // default to true
  mergeIntoExistingCheckbox.checked = settings.mergeIntoExisting === true;
  organizeOnClickCheckbox.checked = settings.organizeOnClick === true;

  // Save settings when changed
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
  
  // Save AI settings
  openaiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ openaiKey: openaiKeyInput.value.trim() });
  });
  
  claudeKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ claudeKey: claudeKeyInput.value.trim() });
  });
  
  aiProviderSelect.addEventListener('change', () => {
    chrome.storage.local.set({ aiProvider: aiProviderSelect.value });
  });
  
  openaiModelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ openaiModel: openaiModelSelect.value });
  });
  
  claudeModelSelect.addEventListener('change', () => {
    chrome.storage.local.set({ claudeModel: claudeModelSelect.value });
  });
  
  customInstructionsOptions.addEventListener('input', () => {
    chrome.storage.local.set({ customInstructionsOptions: customInstructionsOptions.value.trim() });
  });
  
  preserveGroupsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ preserveGroups: preserveGroupsCheckbox.checked });
  });
  
  mergeIntoExistingCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ mergeIntoExisting: mergeIntoExistingCheckbox.checked });
  });
  
  organizeOnClickCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ organizeOnClick: organizeOnClickCheckbox.checked });
  });

  // Test duplicate detection
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    actionStatus.textContent = 'Checking for duplicates...';
    actionStatus.className = 'status info';

    try {
      // Get duplicate count
      const result = await chrome.runtime.sendMessage({ action: 'getDuplicateCount' });
      
      if (result.success) {
        if (result.count > 0) {
          actionStatus.textContent = `Found ${result.count} duplicate tab(s) that would be closed.`;
          actionStatus.className = 'status info';
        } else {
          actionStatus.textContent = 'No duplicate tabs found.';
          actionStatus.className = 'status success';
        }
      } else {
        actionStatus.textContent = result.error || 'An error occurred';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      testBtn.disabled = false;
    }
  });

  // Reload all tabs
  reloadAllBtn.addEventListener('click', async () => {
    reloadAllBtn.disabled = true;
    actionStatus.textContent = 'Reloading tabs...';
    actionStatus.className = 'status info';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'reloadAllTabs'
      });

      if (result.success) {
        actionStatus.textContent = `Reloaded ${result.reloadedCount} tab(s).`;
        actionStatus.className = 'status success';
      } else {
        actionStatus.textContent = result.error || 'An error occurred';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      reloadAllBtn.disabled = false;
    }
  });

  // Organize tabs button
  organizeTabsBtn.addEventListener('click', async () => {
    organizeTabsBtn.disabled = true;
    actionStatus.textContent = 'Organizing tabs with AI...';
    actionStatus.className = 'status info';

    try {
      const preserveGroups = preserveGroupsCheckbox.checked;
      const mergeIntoExisting = mergeIntoExistingCheckbox.checked;
      const customInstructions = customInstructionsOptions.value.trim();

      const result = await chrome.runtime.sendMessage({
        action: 'organizeTabs',
        preserveGroups,
        mergeIntoExisting,
        customInstructions
      });

      if (result.success) {
        actionStatus.textContent = `Organized ${result.groupedCount} tab(s) into ${result.groupCount} group(s).`;
        actionStatus.className = 'status success';
      } else {
        actionStatus.textContent = result.error || 'An error occurred';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      organizeTabsBtn.disabled = false;
    }
  });

  // Ungroup tabs button
  ungroupTabsBtn.addEventListener('click', async () => {
    ungroupTabsBtn.disabled = true;
    actionStatus.textContent = 'Ungrouping tabs...';
    actionStatus.className = 'status info';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'ungroupTabs'
      });

      if (result.success) {
        actionStatus.textContent = `Ungrouped ${result.ungroupedCount} tab(s).`;
        actionStatus.className = 'status success';
      } else {
        actionStatus.textContent = result.error || 'An error occurred';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      ungroupTabsBtn.disabled = false;
    }
  });
});

