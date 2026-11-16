/**
 * Current AI provider models and recommended defaults (options page + service worker).
 * Bundled entries checked against provider documentation on 2026-11-16.
 * Discovery supplements this fallback list without changing the selected model.
 */
(function (g) {
  'use strict';

  /** @type {Record<string, { recommended: string, models: Array<{ id: string, label: string, description?: string }> }>} */
  var CATALOG = {
    openai: {
      recommended: 'gpt-6-luna',
      models: [
        { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: 'Flagship model' },
        { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', description: 'High-capability model' },
        { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', description: 'Balanced intelligence and speed' },
        { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: 'Low-cost text tasks' },
        { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: 'Flagship model for complex work' },
        { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: 'Balanced intelligence and cost' },
        { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: 'Fast, cost-sensitive workloads' },
        { id: 'gpt-5.6', label: 'GPT-5.6', description: 'Alias for GPT-5.6 Sol' },
        { id: 'gpt-5.5', label: 'GPT-5.5', description: 'Supported previous generation' },
        { id: 'gpt-5.4', label: 'GPT-5.4', description: 'Supported previous generation' },
        { id: 'gpt-5.4-mini', label: 'GPT-5.4 mini', description: 'Supported balanced tier' },
        { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano', description: 'Supported fast tier' },
        { id: 'gpt-5.2', label: 'GPT-5.2', description: 'Supported previous generation' },
        { id: 'gpt-4.1', label: 'GPT-4.1', description: 'Supported non-reasoning model' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', description: 'Fast non-reasoning model' },
        { id: 'gpt-4o', label: 'GPT-4o', description: 'Supported legacy model' },
        { id: 'gpt-4o-mini', label: 'GPT-4o mini', description: 'Supported legacy model' },
      ],
    },
    claude: {
      recommended: 'claude-haiku-5-5',
      models: [
        { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', description: 'High-capability model' },
        { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', description: 'Complex reasoning tasks' },
        { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', description: 'Balanced intelligence and speed' },
        { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', description: 'Fast, low-cost text tasks' },
        { id: 'claude-fable-5', label: 'Claude Fable 5', description: 'Most capable widely released model' },
        { id: 'claude-opus-5', label: 'Claude Opus 5', description: 'Complex agentic and enterprise work' },
        { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', description: 'Active previous generation' },
        { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', description: 'Active previous generation' },
        { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', description: 'Active previous generation' },
        { id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5', description: 'Active previous generation' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', description: 'Fast with high intelligence' },
        { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', description: 'Active previous generation' },
        { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5', description: 'Active previous generation' },
        { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', description: 'Fastest, cost-effective model' },
      ],
    },
    gemini: {
      recommended: 'gemini-3.5-flash-lite',
      models: [
        { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', description: 'Current Flash model' },
                { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', description: 'Deprecated alias for Gemini 3.8 Flash' },
        { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', description: 'Balanced speed and multimodal capability' },
        { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', description: 'Stable high-throughput baseline' },
        { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', description: 'Fast, cost-effective high-volume model' },
        { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', description: 'Stable previous budget tier' },
        { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', description: 'Current preview reasoning model' },
        { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', description: 'Supported preview model' },
        { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Stable previous generation' },
        { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', description: 'Stable previous budget tier' },
        { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', description: 'Stable previous reasoning model' },
      ],
    },
  };

  var discoveredModels = {};

  g.setDiscoveredModels = function (provider, models) {
    if (!CATALOG[provider]) return;
    discoveredModels[provider] = models.filter(function (model) {
      return model && typeof model.id === 'string' && model.id.trim();
    }).map(function (model) {
      return { id: model.id, label: model.label || model.id, description: model.description };
    });
  };

  g.getRecommendedModelId = function (provider) {
    return CATALOG[provider] ? CATALOG[provider].recommended : null;
  };

  g.listModelsForProvider = function (provider) {
    var entry = CATALOG[provider];
    if (!entry) return [];
    var combined = (discoveredModels[provider] || []).concat(entry.models);
    var seen = new Set();
    return combined.filter(function (model) {
      if (seen.has(model.id)) return false;
      seen.add(model.id);
      return true;
    }).map(function (model) { return Object.assign({}, model); });
  };

  g.findModelEntry = function (provider, modelId) {
    return g.listModelsForProvider(provider).find(function (m) {
      return m.id === modelId;
    });
  };

  /** A model missing from the bundled list can still be available to the user's account. */
  g.resolveStoredModel = function (provider, storedId) {
    var models = g.listModelsForProvider(provider);
    var recommended = g.getRecommendedModelId(provider);
    if (!models.length) return storedId || recommended || '';
    if (typeof storedId === 'string' && storedId.trim()) return storedId.trim();
    return recommended || models[0].id;
  };

  g.formatModelOptionLabel = function (model, provider) {
    var recommended = g.getRecommendedModelId(provider);
    var text = model.description ? model.label + ' (' + model.description + ')' : model.label;
    if (model.id === recommended) {
      return text + ' — Recommended';
    }
    return text;
  };

  g.populateModelSelect = function (selectEl, provider, selectedId) {
    if (!selectEl) return g.resolveStoredModel(provider, selectedId);
    var models = g.listModelsForProvider(provider);
    var resolved = g.resolveStoredModel(provider, selectedId);
    if (resolved && !models.some(function (model) { return model.id === resolved; })) {
      models.unshift({ id: resolved, label: resolved, description: 'Saved selection; availability not checked' });
    }
    selectEl.textContent = '';
    for (var i = 0; i < models.length; i++) {
      var model = models[i];
      var opt = document.createElement('option');
      opt.value = model.id;
      opt.textContent = g.formatModelOptionLabel(model, provider);
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
})(globalThis);
