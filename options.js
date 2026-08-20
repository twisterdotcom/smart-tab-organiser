// Options page script

document.addEventListener('DOMContentLoaded', async () => {
  // Scroll to custom instructions when the URL includes its section hash.
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
  const fallbackOrderItem = document.getElementById('fallbackOrderItem');
  const fallbackOrderList = document.getElementById('fallbackOrderList');
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
  const refreshClosedIssueGroupBtn = document.getElementById('refreshClosedIssueGroupBtn');
  const refreshGithubLabelGroupsBtn = document.getElementById('refreshGithubLabelGroupsBtn');
  const githubTokenInput = document.getElementById('githubToken');
  const prGroupEnabledCheckbox = document.getElementById('prGroupEnabled');
  const closedIssueGroupEnabledCheckbox = document.getElementById('closedIssueGroupEnabled');
  const githubLabelGroupsEnabledCheckbox = document.getElementById('githubLabelGroupsEnabled');
  const githubLabelGroupNamesTextarea = document.getElementById('githubLabelGroupNames');
  const githubLabelGroupNamesWarning = document.getElementById('githubLabelGroupNamesWarning');
  const bookmarksGroupColorSelect = document.getElementById('bookmarksGroupColor');

  const RESERVED_GITHUB_LABEL_GROUP_NAMES = new Map([
    ['prs', 'PRs'],
    ['closed', 'Closed'],
    ['bookmarks', 'BOOKMARKS'],
    ['misc', 'Misc'],
  ]);

  function normalizeGitHubLabelGroupNames(value) {
    const lines = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? value.split(/\r?\n/)
        : [];
    const names = [];
    const seen = new Set();

    for (const line of lines) {
      if (typeof line !== 'string') continue;
      const name = line.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(name);
    }

    return names;
  }

  function updateGitHubLabelGroupNamesWarning(names) {
    const reservedNames = names
      .map(name => RESERVED_GITHUB_LABEL_GROUP_NAMES.get(name.toLowerCase()))
      .filter(Boolean);

    githubLabelGroupNamesWarning.hidden = reservedNames.length === 0;
    githubLabelGroupNamesWarning.textContent = reservedNames.length
      ? `The extension ignores these reserved names: ${reservedNames.join(', ')}.`
      : '';
  }

  function saveGitHubLabelGroupNames(updateTextarea = false) {
    const names = normalizeGitHubLabelGroupNames(githubLabelGroupNamesTextarea.value);
    if (updateTextarea) {
      githubLabelGroupNamesTextarea.value = names.join('\n');
    }
    updateGitHubLabelGroupNamesWarning(names);
    return chrome.storage.local.set({ githubLabelGroupNames: names });
  }

  function hasNormalizedGitHubLabelGroupNames(value, names) {
    return Array.isArray(value)
      && value.length === names.length
      && value.every((name, index) => name === names[index]);
  }

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
    'githubToken', 'prGroupEnabled', 'closedIssueGroupEnabled', 'githubLabelGroupsEnabled', 'githubLabelGroupNames',
    'bookmarksGroupColor', 'localBaseUrl', 'localModel'
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
  aiFallbackEnabledCheckbox.checked = settings.aiFallbackEnabled === true; // explicit opt-in
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
  if (Array.isArray(settings.pinnedUrls)) {
    pinnedUrlsTextarea.value = settings.pinnedUrls.join('\n');
  }
  if (settings.githubToken) {
    githubTokenInput.value = settings.githubToken;
  }
  prGroupEnabledCheckbox.checked = settings.prGroupEnabled === true;
  closedIssueGroupEnabledCheckbox.checked = settings.closedIssueGroupEnabled === true;
  githubLabelGroupsEnabledCheckbox.checked = settings.githubLabelGroupsEnabled === true;
  const loadedGitHubLabelGroupNames = normalizeGitHubLabelGroupNames(settings.githubLabelGroupNames);
  githubLabelGroupNamesTextarea.value = loadedGitHubLabelGroupNames.join('\n');
  updateGitHubLabelGroupNamesWarning(loadedGitHubLabelGroupNames);
  if (
    settings.githubLabelGroupNames !== undefined
    && !hasNormalizedGitHubLabelGroupNames(settings.githubLabelGroupNames, loadedGitHubLabelGroupNames)
  ) {
    chrome.storage.local.set({ githubLabelGroupNames: loadedGitHubLabelGroupNames });
  }
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
    local: 'Loopback model server'
  };
  const LOCAL_PROVIDERS_OPTIONS = ['chrome-ai', 'local'];

  // Row tags for each status describeProviderChain can report.
  const ORDER_TAG_TEXT = {
    primary: 'Primary — always first',
    ready: 'Ready',
    'no-key': 'No API key',
    'not-downloaded': 'Model not downloaded',
    'no-model-name': 'No model name',
    'cloud-opt-in-off': 'Needs cloud fallback opt-in',
    'not-after-cloud': 'Not used after a cloud primary',
    disabled: ''
  };

  function updateActiveProviderCard() {
    const primary = aiProviderSelect.value || 'openai';
    providerCards.forEach((card) => {
      card.classList.toggle('provider-card--active', card.dataset.provider === primary);
    });
  }

  // The cloud opt-in only applies to a local primary, and the order list
  // only means something with fallback on at all.
  function updateFallbackControlsVisibility() {
    const primary = aiProviderSelect.value || 'openai';
    const fallbackOn = aiFallbackEnabledCheckbox.checked;
    cloudFallbackRow.style.display = fallbackOn && LOCAL_PROVIDERS_OPTIONS.includes(primary) ? '' : 'none';
    fallbackOrderItem.style.display = fallbackOn ? '' : 'none';
  }

  async function moveFallbackProvider(order, index, delta) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    await chrome.storage.local.set({ aiFallbackOrder: next });
    refreshFallbackUi();
  }

  function renderFallbackOrder(desc) {
    fallbackOrderList.textContent = '';
    const statusByProvider = new Map(desc.entries.map((e) => [e.provider, e.status]));
    desc.order.forEach((provider, index) => {
      const status = statusByProvider.get(provider) || 'disabled';
      const inChain = status === 'primary' || status === 'ready';

      const row = document.createElement('li');
      row.className = 'fallback-order-row' + (inChain ? '' : ' fallback-order-row--inactive');

      const pos = document.createElement('span');
      pos.className = 'order-pos';
      pos.textContent = String(index + 1);

      const name = document.createElement('span');
      name.className = 'order-name';
      name.textContent = PROVIDER_LABELS_OPTIONS[provider] || provider;

      const tag = document.createElement('span');
      tag.className = 'order-tag'
        + (status === 'primary' ? ' order-tag--primary' : '')
        + (status === 'ready' ? ' order-tag--ready' : '');
      tag.textContent = ORDER_TAG_TEXT[status] || '';

      const btns = document.createElement('span');
      btns.className = 'order-btns';
      const makeArrow = (delta, glyph, direction) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'order-btn';
        btn.textContent = glyph;
        btn.title = `Move ${PROVIDER_LABELS_OPTIONS[provider] || provider} ${direction}`;
        btn.setAttribute('aria-label', btn.title);
        btn.disabled = delta < 0 ? index === 0 : index === desc.order.length - 1;
        btn.addEventListener('click', () => moveFallbackProvider(desc.order, index, delta));
        return btn;
      };
      btns.append(makeArrow(-1, '▲', 'up'), makeArrow(1, '▼', 'down'));

      row.append(pos, name, tag, btns);
      fallbackOrderList.append(row);
    });
  }

  function renderFallbackHint(desc) {
    if (!aiFallbackHintEl) return;
    const label = (p) => PROVIDER_LABELS_OPTIONS[p] || p;

    if (!desc.fallbackEnabled) {
      aiFallbackHintEl.textContent = `Fallback disabled — only ${label(desc.primary)} will be used.`;
      return;
    }

    const parts = [
      desc.chain.length > 1
        ? `Fallback order: ${desc.chain.map(label).join(' → ')}.`
        : `No fallback available — only ${label(desc.primary)} will be used.`
    ];

    const statusByProvider = new Map(desc.entries.map((e) => [e.provider, e.status]));
    if (desc.localPrimary) {
      if (statusByProvider.get('local') === 'no-model-name') {
        parts.push('Set a loopback model name to enable the local fallback.');
      }
      if (statusByProvider.get('chrome-ai') === 'not-downloaded') {
        parts.push('Chrome built-in AI joins the chain once its model is downloaded.');
      }
      if (aiAllowCloudFallbackCheckbox.checked) {
        parts.push(desc.chain.some((p) => !LOCAL_PROVIDERS_OPTIONS.includes(p))
          ? 'If a cloud fallback runs, tab titles and URLs are sent to that provider.'
          : 'Cloud fallback is allowed, but no cloud provider has an API key yet.');
      } else {
        parts.push('Cloud providers will never be used.');
      }
    } else if (desc.chain.length > 1) {
      parts.push('Cloud primaries never fall back to local providers.');
    } else {
      parts.push('Add an OpenAI, Claude or Gemini API key above to enable automatic fallback.');
    }
    aiFallbackHintEl.textContent = parts.join(' ');
  }

  // One source of truth: the service worker computes the chain exactly as organizing
  // will run it (buildProviderChain), and the order list + hint render from that.
  async function refreshFallbackUi() {
    try {
      const desc = await chrome.runtime.sendMessage({ action: 'describeProviderChain' });
      if (!desc || !desc.success) return;
      renderFallbackOrder(desc);
      renderFallbackHint(desc);
    } catch (error) {
      // Service worker unreachable — keep the current render.
    }
  }

  // Key inputs save on every keystroke; coalesce the recomputes.
  let fallbackUiTimer = null;
  function scheduleFallbackUiRefresh() {
    clearTimeout(fallbackUiTimer);
    fallbackUiTimer = setTimeout(refreshFallbackUi, 200);
  }

  function refreshProviderUi() {
    updateActiveProviderCard();
    updateFallbackControlsVisibility();
    scheduleFallbackUiRefresh();
  }

  aiProviderSelect.addEventListener('change', async () => {
    await chrome.storage.local.set({ aiProvider: aiProviderSelect.value });
    refreshProviderUi();
    if (aiProviderSelect.value === 'chrome-ai') {
      checkChromeAi();
    }
  });

  aiFallbackEnabledCheckbox.addEventListener('change', async () => {
    await chrome.storage.local.set({ aiFallbackEnabled: aiFallbackEnabledCheckbox.checked });
    updateFallbackControlsVisibility();
    scheduleFallbackUiRefresh();
  });

  aiAllowCloudFallbackCheckbox.addEventListener('change', async () => {
    await chrome.storage.local.set({ aiAllowCloudFallback: aiAllowCloudFallbackCheckbox.checked });
    scheduleFallbackUiRefresh();
  });

  // Refresh when an API key changes (fallback eligibility depends on which keys are present)
  [openaiKeyInput, claudeKeyInput, geminiKeyInput].forEach((input) => {
    input.addEventListener('input', scheduleFallbackUiRefresh);
  });
  refreshProviderUi();

  localBaseUrlInput.addEventListener('input', () => {
    chrome.storage.local.set({ localBaseUrl: localBaseUrlInput.value.trim() });
  });

  localModelInput.addEventListener('input', () => {
    chrome.storage.local.set({ localModel: localModelInput.value.trim() });
    scheduleFallbackUiRefresh(); // the local fallback chain depends on a model name being set
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

  // silent: refresh the download button and fallback UI without touching the status box.
  async function checkChromeAi({ silent = false } = {}) {
    checkChromeAiBtn.disabled = true;
    if (!silent) {
      chromeAiStatus.textContent = 'Checking on-device model...';
      chromeAiStatus.className = 'status info';
    }
    try {
      const result = await chrome.runtime.sendMessage({ action: 'checkChromeAI' });
      if (!result.success) {
        if (!silent) {
          chromeAiStatus.textContent = result.error || 'Could not check Chrome built-in AI';
          chromeAiStatus.className = 'status error';
        }
        return;
      }
      downloadChromeAiBtn.hidden = !(result.available && result.state !== 'available');
      if (!silent) {
        chromeAiStatus.textContent = result.message;
        chromeAiStatus.className = result.available
          ? (result.state === 'available' ? 'status success' : 'status info')
          : 'status error';
      }
    } catch (error) {
      if (!silent) {
        chromeAiStatus.textContent = 'Error: ' + error.message;
        chromeAiStatus.className = 'status error';
      }
    } finally {
      checkChromeAiBtn.disabled = false;
      scheduleFallbackUiRefresh(); // Nano availability affects the fallback chain
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
      scheduleFallbackUiRefresh(); // Nano can now join fallback chains
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
    const parsed = parseInt(preserveGroupsMinTabsInput.value, 10);
    const n = Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
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
  closedIssueGroupEnabledCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ closedIssueGroupEnabled: closedIssueGroupEnabledCheckbox.checked });
  });
  githubLabelGroupsEnabledCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ githubLabelGroupsEnabled: githubLabelGroupsEnabledCheckbox.checked });
  });
  githubLabelGroupNamesTextarea.addEventListener('input', () => {
    saveGitHubLabelGroupNames();
  });
  githubLabelGroupNamesTextarea.addEventListener('change', () => {
    saveGitHubLabelGroupNames(true);
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

  refreshClosedIssueGroupBtn.addEventListener('click', async () => {
    refreshClosedIssueGroupBtn.disabled = true;
    actionStatus.textContent = 'Checking GitHub issue tabs...';
    actionStatus.className = 'status info';
    try {
      const result = await chrome.runtime.sendMessage({ action: 'syncClosedIssueTabGroup' });
      if (result.success) {
        actionStatus.textContent = result.message || 'Closed group refreshed.';
        actionStatus.className = result.warning ? 'status info' : 'status success';
      } else {
        actionStatus.textContent = result.error || 'Failed to refresh Closed group';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      refreshClosedIssueGroupBtn.disabled = false;
    }
  });

  refreshGithubLabelGroupsBtn.addEventListener('click', async () => {
    refreshGithubLabelGroupsBtn.disabled = true;
    actionStatus.textContent = 'Deduplicating tabs and refreshing label groups...';
    actionStatus.className = 'status info';
    try {
      await saveGitHubLabelGroupNames(true);
      const result = await chrome.runtime.sendMessage({ action: 'syncGitHubLabelTabGroups' });
      if (result && result.success) {
        const messages = [result.message, result.warning]
          .filter(message => typeof message === 'string' && message.trim());
        actionStatus.textContent = messages.join('\n') || 'The extension refreshed the label groups.';
        actionStatus.className = result.warning ? 'status info' : 'status success';
      } else {
        const messages = result
          ? [result.error, result.warning, result.message]
            .filter(message => typeof message === 'string' && message.trim())
          : [];
        actionStatus.textContent = messages.join('\n') || 'The extension did not refresh the label groups.';
        actionStatus.className = 'status error';
      }
    } catch (error) {
      actionStatus.textContent = 'Error: ' + error.message;
      actionStatus.className = 'status error';
    } finally {
      refreshGithubLabelGroupsBtn.disabled = false;
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
    actionStatus.textContent = 'Deduplicating and organizing tabs with AI...';
    actionStatus.className = 'status info';

    try {
      const preserveGroups = preserveGroupsCheckbox.checked;
      const minTabsParsed = parseInt(preserveGroupsMinTabsInput.value, 10);
      const preserveGroupsMinTabs = Number.isFinite(minTabsParsed) && minTabsParsed >= 0 ? minTabsParsed : 1;
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

