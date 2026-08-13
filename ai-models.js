/**
 * AI provider model catalog and recommended defaults (options page + service worker).
 */
(function (g) {
  'use strict';

  /** @type {Record<string, { recommended: string, models: Array<{ id: string, label: string, description?: string, legacy?: boolean }> }>} */
  var CATALOG = {
    openai: {
      recommended: 'gpt-5.6-terra',
      models: [
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Flagship reasoning & agentic work' },
        { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'Balanced, cost-efficient' },
        { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'Fastest, most affordable' },
        { id: 'gpt-5.6', label: 'GPT-5.6', description: 'Alias for Sol' },
        { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Previous generation' },
        { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Previous generation' },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', description: 'Previous balanced tier' },
        { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', description: 'Previous fast tier' },
        { id: 'gpt-5.2', label: 'GPT-5.2', description: 'Previous generation', legacy: true },
        { id: 'gpt-5.2-pro', label: 'GPT-5.2 Pro', description: 'Previous high-precision tier', legacy: true },
        { id: 'gpt-5-mini', label: 'GPT-5 mini', description: 'Previous balanced tier', legacy: true },
        { id: 'gpt-5-nano', label: 'GPT-5 nano', description: 'Previous fast tier', legacy: true },
        { id: 'gpt-5', label: 'GPT-5', description: 'Previous reasoning model', legacy: true },
        { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Non-reasoning', legacy: true },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', description: 'Fast, cost-effective', legacy: true },
        { id: 'gpt-4.1-nano', label: 'GPT-4.1 nano', description: 'Lightweight', legacy: true },
        { id: 'gpt-4o', label: 'GPT-4o', description: 'Legacy', legacy: true },
        { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Legacy', legacy: true },
      ],
    },
    claude: {
      recommended: 'claude-haiku-4-5-20251001',
      models: [
        { id: 'claude-fable-5', label: 'Claude Fable 5', description: 'Most capable, long-running agents' },
        { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', description: 'Frontier agentic & enterprise' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Best speed & intelligence balance' },
        { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fast, cost-effective' },
        { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', description: 'Previous generation' },
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Previous generation' },
        { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Previous generation' },
        { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', description: 'Previous generation' },
        { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5', description: 'Previous generation', legacy: true },
        { id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1', description: 'Deprecated Aug 2026', legacy: true },
        { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku', description: 'Retired', legacy: true },
        { id: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet', description: 'Retired', legacy: true },
      ],
    },
    gemini: {
      recommended: 'gemini-3.5-flash',
      models: [
        { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Best price-performance, agentic & coding' },
        { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', description: 'High-volume, budget-friendly' },
        { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Preview, advanced reasoning' },
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Preview' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Deprecating Oct 2026' },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Deprecating Oct 2026' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Deprecating Oct 2026' },
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Shut down', legacy: true },
        { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash-Lite', description: 'Shut down', legacy: true },
        { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Legacy', legacy: true },
        { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Legacy', legacy: true },
      ],
    },
  };

  g.AI_MODEL_CATALOG = CATALOG;

  g.getRecommendedModelId = function (provider) {
    return CATALOG[provider] ? CATALOG[provider].recommended : null;
  };

  g.listModelsForProvider = function (provider) {
    var entry = CATALOG[provider];
    return entry && entry.models ? entry.models.slice() : [];
  };

  g.findModelEntry = function (provider, modelId) {
    return g.listModelsForProvider(provider).find(function (m) {
      return m.id === modelId;
    });
  };

  /** Use stored id when still in catalog; otherwise fall back to the provider recommended model. */
  g.resolveStoredModel = function (provider, storedId) {
    var models = g.listModelsForProvider(provider);
    var recommended = g.getRecommendedModelId(provider);
    if (!models.length) return storedId || recommended || '';
    if (storedId && models.some(function (m) {
      return m.id === storedId;
    })) {
      return storedId;
    }
    return recommended || models[0].id;
  };

  g.formatModelOptionLabel = function (model, provider) {
    var recommended = g.getRecommendedModelId(provider);
    var text = model.description ? model.label + ' (' + model.description + ')' : model.label;
    if (model.id === recommended) {
      return text + ' — Recommended';
    }
    if (model.legacy) {
      return text + ' — Legacy';
    }
    return text;
  };

  g.populateModelSelect = function (selectEl, provider, selectedId) {
    if (!selectEl) return g.resolveStoredModel(provider, selectedId);
    var models = g.listModelsForProvider(provider);
    var resolved = g.resolveStoredModel(provider, selectedId);
    selectEl.textContent = '';
    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      var opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = g.formatModelOptionLabel(model, provider);
      if (model.legacy) {
        opt.dataset.legacy = 'true';
      }
      selectEl.appendChild(opt);
    }
    selectEl.value = resolved;
    return resolved;
  };

  g.describeRecommendedModel = function (provider) {
    var id = g.getRecommendedModelId(provider);
    if (!id) return '';
    var entry = g.findModelEntry(provider, id);
    if (!entry) return id;
    return entry.label + (entry.description ? ' (' + entry.description + ')' : '');
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
