'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const MODEL_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'ai-models.js'), 'utf8');

function loadModelCatalog() {
  const context = {
    document: { createElement: () => ({ value: '', textContent: '' }) },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(MODEL_SOURCE, context, { filename: 'ai-models.js' });
  return context;
}

test('bundled catalogs include current models and low-cost defaults', () => {
  const context = loadModelCatalog();
  const expected = {
    openai: { recommended: 'gpt-6-luna', models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'] },
    claude: { recommended: 'claude-haiku-5-5', models: ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
    gemini: { recommended: 'gemini-3.5-flash-lite', models: ['gemini-3.8-flash', 'gemini-3.5-flash-lite'] },
  };
  for (const [provider, entry] of Object.entries(expected)) {
    assert.equal(context.getRecommendedModelId(provider), entry.recommended);
    const ids = Array.from(context.listModelsForProvider(provider), model => model.id);
    for (const id of entry.models) assert.ok(ids.includes(id), id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(context.resolveStoredModel(provider, ''), entry.recommended);
  }
  assert.equal(context.AI_MODEL_CATALOG, undefined);
});

test('saved IDs survive catalog changes in both Settings and the service worker', () => {
  const context = loadModelCatalog();
  for (const provider of ['openai', 'claude', 'gemini']) {
    assert.equal(context.resolveStoredModel(provider, 'new-account-model'), 'new-account-model');
    assert.equal(context.resolveStoredModel(provider, '  saved-model  '), 'saved-model');
  }
  assert.equal(context.resolveStoredModel('openai', 'gpt-5.6-terra'), 'gpt-5.6-terra');
  assert.equal(context.resolveStoredModel('gemini', 'gemini-3.7-flash'), 'gemini-3.7-flash');
});

test('returned lists and entries cannot mutate the catalog', () => {
  const context = loadModelCatalog();
  const original = context.listModelsForProvider('openai');
  const id = original[0].id;
  const length = original.length;
  original[0].id = 'changed';
  original.pop();
  assert.equal(context.listModelsForProvider('openai').length, length);
  assert.equal(context.listModelsForProvider('openai')[0].id, id);
});

test('discovery supplements and deduplicates the bundled list without changing defaults', () => {
  const context = loadModelCatalog();
  const models = [{ id: 'new-model', label: 'New model' }, { id: 'gpt-6-luna', label: 'Available Luna' }];
  context.setDiscoveredModels('openai', models);
  models[0].id = 'changed';
  const list = context.listModelsForProvider('openai');
  assert.equal(list[0].id, 'new-model');
  assert.equal(list.filter(model => model.id === 'gpt-6-luna').length, 1);
  assert.equal(context.getRecommendedModelId('openai'), 'gpt-6-luna');
  context.setDiscoveredModels('openai', []);
  assert.equal(context.findModelEntry('openai', 'new-model'), undefined);
});

test('selector retains saved selections absent from the bundled or discovered lists', () => {
  const context = loadModelCatalog();
  const options = [];
  const select = { textContent: '', value: '', appendChild: option => options.push(option) };
  assert.equal(context.populateModelSelect(select, 'gemini', 'gemini-future-flash'), 'gemini-future-flash');
  assert.equal(select.value, 'gemini-future-flash');
  assert.equal(options[0].value, 'gemini-future-flash');
  assert.match(options[0].textContent, /Saved selection/);
});

test('unknown providers have no bundled models', () => {
  const context = loadModelCatalog();
  assert.equal(context.getRecommendedModelId('unknown'), null);
  assert.equal(context.listModelsForProvider('unknown').length, 0);
});
