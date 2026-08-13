// Options page script

document.addEventListener('DOMContentLoaded', async () => {
  // Scroll to custom instructions when opened via "Edit prompt"
  if (window.location.hash === '#custom-instructions') {
    const el = document.getElementById('custom-instructions');
    if (el) el.scrollIntoView();
  }
  const ignoreQueryCheckbox = document.getElementById('ignoreQuery');
  const ignoreHashCheckbox = document.getElementById('ignoreHash');
  const reloadTabsCheckbox = document.getElementById('reloadTabs');
  const testBtn = document.getElementById('testBtn');
  const reloadAllBtn = document.getElementById('reloadAllBtn');
  const actionStatus = document.getElementById('actionStatus');
  const openaiKeyInput = document.getElementById('openaiKey');
  const claudeKeyInput = document.getElementById('claudeKey');
  const geminiKeyInput = document.getElementById('geminiKey');
  const aiProviderSelect = document.getElementById('aiProvider');
  const aiFallbackEnabledCheckbox = document.getElementById('aiFallbackEnabled');
  const aiFallbackHintEl = document.getElementById('aiFallbackHint');
  const openaiModelSelect = document.getElementById('openaiModel');
  const claudeModelSelect = document.getElementById('claudeModel');
  const geminiModelSelect = document.getElementById('geminiModel');
  const openaiModelRecommendedEl = document.getElementById('openaiModelRecommended');
  const claudeModelRecommendedEl = document.getElementById('claudeModelRecommended');
  const geminiModelRecommendedEl = document.getElementById('geminiModelRecommended');
  const localBaseUrlInput = document.getElementById('localBaseUrl');
  const localModelInput = document.getElementById('localModel');
  const testLocalModelBtn = document.getElementById('testLocalModelBtn');
  const localModelStatus = document.getElementById('localModelStatus');
  const checkChromeAiBtn = document.getElementById('checkChromeAiBtn');
  const downloadChromeAiBtn = document.getElementById('downloadChromeAiBtn');
  const chromeAiStatus = document.getElementById('chromeAiStatus');
  const aiAllowCloudFallbackCheckbox = document.getElementById('aiAllowCloudFallback');
  const cloudFallbackRow = document.getElementById('cloudFallbackRow');
  const providerCards = document.querySelectorAll('.provider-card[data-provider]');

  function updateModelRecommendedHint(provider, hintEl, selectEl) {
    if (!hintEl || !selectEl) return;
    const recommendedId = globalThis.getRecommendedModelId(provider);
    const isRecommended = selectEl.value === recommendedId;
    hintEl.textContent = isRecommended
      ? `Using the recommended model: ${globalThis.describeRecommendedModel(provider)}.`
      : `Recommended: ${globalThis.describeRecommendedModel(provider)} (${recommendedId}).`;
  }

  function wireModelSelect(selectEl, provider, hintEl, storageKey) {
    selectEl.addEventListener('change', () => {
      chrome.storage.local.set({ [storageKey]: selectEl.value });
      updateModelRecommendedHint(provider, hintEl, selectEl);
    });
  }

  wireModelSelect(openaiModelSelect, 'openai', openaiModelRecommendedEl, 'openaiModel');
  wireModelSelect(claudeModelSelect, 'claude', claudeModelRecommendedEl, 'claudeModel');
  wireModelSelect(geminiModelSelect, 'gemini', geminiModelRecommendedEl, 'geminiModel');
  const customInstructionsOptions = document.getElementById('customInstructionsOptions');
  const preserveGroupsCheckbox = document.getElementById('preserveGroups');
  const preserveGroupsMinTabsInput = document.getElementById('preserveGroupsMinTabs');
  const preserveGroupsMinTabsRow = document.getElementById('preserveGroupsMinTabsRow');
  const preserveGroupsMinTabsWarning = document.getElementById('preserveGroupsMinTabsWarning');
  const mergeIntoExistingCheckbox = document.getElementById('mergeIntoExisting');
  const sortTabsWithinGroupsByTitleCheckbox = document.getElementById('sortTabsWithinGroupsByTitle');
  const organizeOnClickCheckbox = document.getElementById('organizeOnClick');
  const organizeTabsBtn = document.getElementById('organizeTabsBtn');
  const tidyPinnedBtn = document.getElementById('tidyPinnedBtn');
  const ungroupTabsBtn = document.getElementById('ungroupTabsBtn');
  const pinnedUrlsTextarea = document.getElementById('pinnedUrls');
  const refreshPrGroupBtn = document.getElementById('refreshPrGroupBtn');
  const githubTokenInput = document.getElementById('githubToken');
  const prGroupEnabledCheckbox = document.getElementById('prGroupEnabled');
  const bookmarksGroupColorSelect = document.getElementById('bookmarksGroupColor');

  // Show/hide password for API key inputs
  document.querySelectorAll('.toggle-password').forEach((btn) => {
    btn.addEventListener('click', () => {
      const wrapper = btn.closest('.input-with-toggle');
      const input = wrapper && wrapper.querySelector('input[type="password"], input[type="text"]');
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      btn.classList.toggle('revealed', isPassword);
      const currentLabel = btn.getAttribute('aria-label') || ' key';
      const suffix = currentLabel.startsWith('Show ') ? currentLabel.slice(5) : currentLabel.startsWith('Hide ') ? currentLabel.slice(5) : 'key';
      const newLabel = isPassword ? `Hide ${suffix}` : `Show ${suffix}`;
      btn.setAttribute('aria-label', newLabel);
      btn.setAttribute('title', newLabel);
    });
  });

  // Load saved settings
  const settings = await chrome.storage.local.get([
    'ignoreQuery', 'ignoreHash', 'reloadTabs',
    'openaiKey', 'claudeKey', 'geminiKey', 'aiProvider', 'aiFallbackEnabled', 'aiAllowCloudFallback',
    'openaiModel', 'claudeModel', 'geminiModel', 'customInstructionsOptions',
    'preserveGroups', 'preserveGroupsMinTabs', 'mergeIntoExisting', 'sortTabsWithinGroupsByTitle', 'organizeOnClick', 'pinnedUrls',
    'githubToken', 'prGroupEnabled', 'bookmarksGroupColor', 'localBaseUrl', 'localModel'
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
  if (settings.geminiKey) {
    geminiKeyInput.value = settings.geminiKey;
  }
  aiProviderSelect.value = settings.aiProvider || 'openai';
  aiFallbackEnabledCheckbox.checked = settings.aiFallbackEnabled !== false; // default to true
  aiAllowCloudFallbackCheckbox.checked = settings.aiAllowCloudFallback === true; // default off — explicit opt-in
  const openaiResolved = globalThis.populateModelSelect(openaiModelSelect, 'openai', settings.openaiModel);
  const claudeResolved = globalThis.populateModelSelect(claudeModelSelect, 'claude', settings.claudeModel);
  const geminiResolved = globalThis.populateModelSelect(geminiModelSelect, 'gemini', settings.geminiModel);
  localBaseUrlInput.value = settings.localBaseUrl || '';
  localModelInput.value = settings.localModel || '';
  updateModelRecommendedHint('openai', openaiModelRecommendedEl, openaiModelSelect);
  updateModelRecommendedHint('claude', claudeModelRecommendedEl, claudeModelSelect);
  updateModelRecommendedHint('gemini', geminiModelRecommendedEl, geminiModelSelect);
  if (
    openaiResolved !== settings.openaiModel ||
    claudeResolved !== settings.claudeModel ||
    geminiResolved !== settings.geminiModel
  ) {
    chrome.storage.local.set({
      openaiModel: openaiResolved,
      claudeModel: claudeResolved,
      geminiModel: geminiResolved,
    });
  }
  if (settings.customInstructionsOptions) {
    customInstructionsOptions.value = settings.customInstructionsOptions;
  }
  preserveGroupsCheckbox.checked = settings.preserveGroups !== false; // default to true
  const savedMinTabs = settings.preserveGroupsMinTabs;
  preserveGroupsMinTabsInput.value = savedMinTabs !== undefined && savedMinTabs !== '' ? Number(savedMinTabs) : 1;
  updatePreserveGroupsMinTabsVisibility();
  updatePreserveGroupsMinTabsWarning();
  mergeIntoExistingCheckbox.checked = settings.mergeIntoExisting === true;
  sortTabsWithinGroupsByTitleCheckbox.checked = settings.sortTabsWithinGroupsByTitle === true;
  organizeOnClickCheckbox.checked = settings.organizeOnClick === true;
  if (settings.pinnedUrls && Array.isArray(settings.pinnedUrls)) {
    pinnedUrlsTextarea.value = settings.pinnedUrls.join('\n');
  } else if (typeof settings.pinnedUrls === 'string') {
    pinnedUrlsTextarea.value = settings.pinnedUrls;
  }
  if (settings.githubToken) {
    githubTokenInput.value = settings.githubToken;
  }
  prGroupEnabledCheckbox.checked = settings.prGroupEnabled === true;
  bookmarksGroupColorSelect.value = settings.bookmarksGroupColor || 'yellow';

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
  
  geminiKeyInput.addEventListener('input', () => {
    chrome.storage.local.set({ geminiKey: geminiKeyInput.value.trim() });
  });
  
  const PROVIDER_LABELS_OPTIONS = {
    openai: 'OpenAI',
    claude: 'Claude',
    gemini: 'Gemini',
    'chrome-ai': 'Chrome built-in AI',
    local: 'Local model'
  };
  const ON_DEVICE_PROVIDERS_OPTIONS = ['chrome-ai', 'local'];
  const CLOUD_PROVIDERS_OPTIONS = ['openai', 'claude', 'gemini'];

  // Last Chrome AI availability state reported by the service worker
  // ('available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported' | null = not checked yet).
  let chromeAiState = null;

  function updateActiveProviderCard() {
    const primary = aiProviderSelect.value || 'openai';
    providerCards.forEach((card) => {
      card.classList.toggle('provider-card--active', card.dataset.provider === primary);
    });
  }

  // The cloud-fallback opt-in only means something when the primary is on-device.
  function updateCloudFallbackRowVisibility() {
    const primary = aiProviderSelect.value || 'openai';
    cloudFallbackRow.style.display = ON_DEVICE_PROVIDERS_OPTIONS.includes(primary) ? '' : 'none';
  }

  // Mirrors buildProviderChain in background.js so the hint shows the order that will actually run.
  function updateFallbackHint() {
    if (!aiFallbackHintEl) return;
    const primary = aiProviderSelect.value || 'openai';
    const label = (p) => PROVIDER_LABELS_OPTIONS[p] || p;

    if (!aiFallbackEnabledCheckbox.checked) {
      aiFallbackHintEl.textContent = `Fallback disabled — only ${label(primary)} will be used.`;
      return;
    }

    const keys = {
      openai: openaiKeyInput.value.trim(),
      claude: claudeKeyInput.value.trim(),
      gemini: geminiKeyInput.value.trim(),
    };
    const cloudWithKeys = CLOUD_PROVIDERS_OPTIONS.filter((p) => keys[p]);

    if (ON_DEVICE_PROVIDERS_OPTIONS.includes(primary)) {
      const chain = [primary];
      const notes = [];
      if (primary === 'chrome-ai') {
        if (localModelInput.value.trim()) {
          chain.push('local');
        } else {
          notes.push('Set a Local model name to enable the on-device fallback.');
        }
      } else {
        if (chromeAiState === 'available') {
          chain.push('chrome-ai');
        } else {
          notes.push('Chrome built-in AI joins the chain once its model is downloaded.');
        }
      }
      let cloudNote = 'Cloud providers will never be used.';
      if (aiAllowCloudFallbackCheckbox.checked) {
        if (cloudWithKeys.length > 0) {
          chain.push(...cloudWithKeys);
          cloudNote = 'If a cloud fallback runs, tab titles and URLs are sent to that provider.';
        } else {
          cloudNote = 'Cloud fallback is allowed, but no cloud provider has an API key yet.';
        }
      }
      const order = chain.length > 1
        ? `Fallback order: ${chain.map(label).join(' → ')}.`
        : `No fallback available — only ${label(primary)} will be used.`;
      aiFallbackHintEl.textContent = [order, ...notes, cloudNote].join(' ');
      return;
    }

    const fallbacks = cloudWithKeys.filter((p) => p !== primary);
    if (fallbacks.length === 0) {
      aiFallbackHintEl.textContent = 'No fallback providers configured — add an OpenAI, Claude or Gemini API key above to enable automatic fallback.';
      return;
    }
    aiFallbackHintEl.textContent = `Fallback order: ${label(primary)} → ${fallbacks.map(label).join(' → ')}. Cloud primaries never fall back to on-device providers.`;
  }

  function refreshProviderUi() {
    updateActiveProviderCard();
    updateCloudFallbackRowVisibility();
    updateFallbackHint();
  }

  aiProviderSelect.addEventListener('change', () => {
    chrome.storage.local.set({ aiProvider: aiProviderSelect.value });
    refreshProviderUi();
    if (aiProviderSelect.value === 'chrome-ai') {
      checkChromeAi();
    }
  });

  aiFallbackEnabledCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ aiFallbackEnabled: aiFallbackEnabledCheckbox.checked });
    updateFallbackHint();
  });

  aiAllowCloudFallbackCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ aiAllowCloudFallback: aiAllowCloudFallbackCheckbox.checked });
    updateFallbackHint();
  });

  // Also refresh the hint when an API key changes (fallback list depends on which keys are present)
  [openaiKeyInput, claudeKeyInput, geminiKeyInput].forEach((input) => {
    input.addEventListener('input', updateFallbackHint);
  });
  refreshProviderUi();

  localBaseUrlInput.addEventListener('input', () => {
    chrome.storage.local.set({ localBaseUrl: localBaseUrlInput.value.trim() });
  });

  localModelInput.addEventListener('input', () => {
    chrome.storage.local.set({ localModel: localModelInput.value.trim() });
    updateFallbackHint(); // the on-device fallback chain depends on a model name being set
  });

  // Ask the service worker to check the local server, so the result reflects
  // the context that actually organizes tabs.
  testLocalModelBtn.addEventListener('click', async () => {
    testLocalModelBtn.disabled = true;
    localModelStatus.textContent = 'Connecting to local model server...';
    localModelStatus.className = 'status info';
    try {
      const result = await chrome.runtime.sendMessage({
        action: 'listLocalModels',
        baseUrl: localBaseUrlInput.value.trim()
      });
      if (!result.success) {
        localModelStatus.textContent = result.error || 'Could not reach the local model server';
        localModelStatus.className = 'status error';
        return;
      }
      if (result.models.length === 0) {
        localModelStatus.textContent = `Connected to ${result.baseUrl}, but no models are installed. Pull one first (e.g. "ollama pull llama3.1:8b").`;
        localModelStatus.className = 'status error';
        return;
      }
      const chosen = localModelInput.value.trim();
      const known = result.models.includes(chosen);
      localModelStatus.textContent = `Connected to ${result.baseUrl}. Available: ${result.models.join(', ')}.` +
        (chosen && !known ? ` Warning: "${chosen}" is not in that list.` : '');
      localModelStatus.className = chosen && !known ? 'status info' : 'status success';
    } catch (error) {
      localModelStatus.textContent = 'Error: ' + error.message;
      localModelStatus.className = 'status error';
    } finally {
      testLocalModelBtn.disabled = false;
    }
  });

  // silent: refresh chromeAiState (for the fallback hint) without touching the status box.
  async function checkChromeAi({ silent = false } = {}) {
    checkChromeAiBtn.disabled = true;
    if (!silent) {
      chromeAiStatus.textContent = 'Checking on-device model...';
      chromeAiStatus.className = 'status info';
    }
    try {
      const result = await chrome.runtime.sendMessage({ action: 'checkChromeAI' });
      if (!result.success) {
        chromeAiState = null;
        if (!silent) {
          chromeAiStatus.textContent = result.error || 'Could not check Chrome built-in AI';
          chromeAiStatus.className = 'status error';
        }
        return;
      }
      chromeAiState = result.state;
      downloadChromeAiBtn.hidden = !(result.available && result.state !== 'available');
      if (!silent) {
        chromeAiStatus.textContent = result.message;
        chromeAiStatus.className = result.available
          ? (result.state === 'available' ? 'status success' : 'status info')
          : 'status error';
      }
    } catch (error) {
      chromeAiState = null;
      if (!silent) {
        chromeAiStatus.textContent = 'Error: ' + error.message;
        chromeAiStatus.className = 'status error';
      }
    } finally {
      checkChromeAiBtn.disabled = false;
      updateFallbackHint(); // the on-device fallback chain depends on this state
    }
  }

  checkChromeAiBtn.addEventListener('click', checkChromeAi);

  // Chrome can require a user gesture to start the first model download, which the
  // service worker never has — so start it here, from a real click.
  downloadChromeAiBtn.addEventListener('click', async () => {
    if (typeof LanguageModel === 'undefined') {
      chromeAiStatus.textContent = 'Chrome built-in AI is not available in this browser.';
      chromeAiStatus.className = 'status error';
      return;
    }
    downloadChromeAiBtn.disabled = true;
    chromeAiStatus.textContent = 'Starting download... this can take several minutes. Keep this page open.';
    chromeAiStatus.className = 'status info';
    try {
      const session = await LanguageModel.create({
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => {
            chromeAiStatus.textContent = `Downloading Gemini Nano: ${Math.round((e.loaded || 0) * 100)}%`;
          });
        }
      });
      session.destroy();
      chromeAiStatus.textContent = 'Gemini Nano is downloaded and ready to use on this device.';
      chromeAiStatus.className = 'status success';
      downloadChromeAiBtn.hidden = true;
      chromeAiState = 'available';
      updateFallbackHint();
    } catch (error) {
      chromeAiStatus.textContent = 'Download failed: ' + error.message;
      chromeAiStatus.className = 'status error';
    } finally {
      downloadChromeAiBtn.disabled = false;
    }
  });

  // Check availability up front: loudly (status box) when Chrome AI is the primary,
  // silently otherwise — the fallback hint needs the state either way.
  checkChromeAi({ silent: aiProviderSelect.value !== 'chrome-ai' });

  customInstructionsOptions.addEventListener('input', () => {
    chrome.storage.local.set({ customInstructionsOptions: customInstructionsOptions.value.trim() });
  });
  
  function updatePreserveGroupsMinTabsVisibility() {
    const visible = preserveGroupsCheckbox.checked;
    preserveGroupsMinTabsRow.style.display = visible ? '' : 'none';
    preserveGroupsMinTabsInput.disabled = !visible;
  }

  function updatePreserveGroupsMinTabsWarning() {
    const n = parseInt(preserveGroupsMinTabsInput.value, 10);
    preserveGroupsMinTabsWarning.style.display = (!isNaN(n) && n > 3) ? '' : 'none';
  }

  preserveGroupsCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ preserveGroups: preserveGroupsCheckbox.checked });
    updatePreserveGroupsMinTabsVisibility();
  });

  preserveGroupsMinTabsInput.addEventListener('input', () => {
    const raw = preserveGroupsMinTabsInput.value.trim();
    const n = raw === '' ? 1 : Math.max(0, parseInt(raw, 10));
    if (!isNaN(n)) {
      chrome.storage.local.set({ preserveGroupsMinTabs: n });
      preserveGroupsMinTabsInput.value = n;
    }
    updatePreserveGroupsMinTabsWarning();
  });

  preserveGroupsMinTabsInput.addEventListener('change', () => {
    const n = Math.max(0, parseInt(preserveGroupsMinTabsInput.value, 10) || 1);
    preserveGroupsMinTabsInput.value = n;
    chrome.storage.local.set({ preserveGroupsMinTabs: n });
    updatePreserveGroupsMinTabsWarning();
  });
  
  mergeIntoExistingCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ mergeIntoExisting: mergeIntoExistingCheckbox.checked });
  });

  sortTabsWithinGroupsByTitleCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ sortTabsWithinGroupsByTitle: sortTabsWithinGroupsByTitleCheckbox.checked });
  });
  
  organizeOnClickCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ organizeOnClick: organizeOnClickCheckbox.checked });
  });

  pinnedUrlsTextarea.addEventListener('input', () => {
    const lines = pinnedUrlsTextarea.value.split('\n').map(s => s.trim()).filter(Boolean);
    chrome.storage.local.set({ pinnedUrls: lines });
  });

  bookmarksGroupColorSelect.addEventListener('change', () => {
    chrome.storage.local.set({ bookmarksGroupColor: bookmarksGroupColorSelect.value });
  });

  githubTokenInput.addEventListener('input', () => {
    chrome.storage.local.set({ githubToken: githubTokenInput.value.trim() });
  });
  prGroupEnabledCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ prGroupEnabled: prGroupEnabledCheckbox.checked });
  });

  // Refresh PR group button
  refreshPrGroupBtn.addEventListener('click', async () => {
    refreshPrGroupBtn.disabled = true;
    actionStatus.textContent = 'Refreshing PR group...';
    actionStatus.className = 'status info';
    try {
      const result = await chrome.runtime.sendMessage({ action: 'syncPrTabGroup' });
      if (result.success) {
        actionStatus.textContent = result.message || 'PR group refreshed.';
        actionStatus.className = 'status success';
      } else {
        actionStatus.textContent = result.error || 'Failed to refresh PR group';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      refreshPrGroupBtn.disabled = false;
    }
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
      const preserveGroupsMinTabs = Math.max(0, parseInt(preserveGroupsMinTabsInput.value, 10) || 1);
      const mergeIntoExisting = mergeIntoExistingCheckbox.checked;
      const customInstructions = customInstructionsOptions.value.trim();

      const result = await chrome.runtime.sendMessage({
        action: 'organizeTabs',
        preserveGroups,
        preserveGroupsMinTabs,
        mergeIntoExisting,
        customInstructions
      });

      if (result.success) {
        let msg = `Organized ${result.groupedCount} tab(s) into ${result.groupCount} group(s).`;
        if (result.fallbackInfo) {
          msg += ` Used ${result.providerUsedLabel} after ${result.fallbackInfo.primaryFailedLabel} failed (${result.fallbackInfo.primaryFailedSummary}).`;
        }
        actionStatus.textContent = msg;
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

  // Deduplicate and tidy pinned tabs button
  tidyPinnedBtn.addEventListener('click', async () => {
    tidyPinnedBtn.disabled = true;
    actionStatus.textContent = 'Deduplicating and tidying pinned tabs...';
    actionStatus.className = 'status info';

    try {
      const result = await chrome.runtime.sendMessage({
        action: 'dedupeAndTidyPinned'
      });

      if (result.success) {
        actionStatus.textContent = result.message || 'Pinned tabs tidied.';
        actionStatus.className = 'status success';
      } else {
        actionStatus.textContent = result.error || 'An error occurred';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      tidyPinnedBtn.disabled = false;
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

