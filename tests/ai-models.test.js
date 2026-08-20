'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const MODEL_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'ai-models.js'),
  'utf8'
);

function loadModelCatalog() {
  const context = {
    document: {
      createElement: () => ({ value: '', textContent: '' }),
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(MODEL_SOURCE, context, { filename: 'ai-models.js' });
  return context;
}

test('model selectors contain only the current supported catalog', () => {
  const context = loadModelCatalog();
  const expected = {
    openai: {
      recommended: 'gpt-5.6-terra',
      models: [
        'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6',
        'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2',
        'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini',
      ],
    },
    claude: {
      recommended: 'claude-haiku-4-5-20251001',
      models: [
        'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7',
        'claude-opus-4-6', 'claude-opus-4-5-20251101', 'claude-sonnet-5',
        'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001',
      ],
    },
    gemini: {
      recommended: 'gemini-3.7-flash',
      models: [
        'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash',
        'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview',
        'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
        'gemini-2.5-pro',
      ],
    },
  };

  for (const [provider, entry] of Object.entries(expected)) {
    assert.equal(context.getRecommendedModelId(provider), entry.recommended);
    assert.deepEqual(
      Array.from(context.listModelsForProvider(provider), model => model.id),
      entry.models
    );
  }
  assert.equal(context.AI_MODEL_CATALOG, undefined);
});

test('retired stored model IDs migrate while active IDs remain selected', () => {
  const context = loadModelCatalog();

  assert.equal(context.resolveStoredModel('openai', 'gpt-5.2-pro'), 'gpt-5.6-terra');
  assert.equal(context.resolveStoredModel('claude', 'claude-opus-4-1-20250805'), 'claude-haiku-4-5-20251001');
  assert.equal(context.resolveStoredModel('gemini', 'gemini-2.0-flash'), 'gemini-3.7-flash');
  assert.equal(context.resolveStoredModel('openai', 'gpt-5.6'), 'gpt-5.6');
  assert.equal(context.resolveStoredModel('claude', 'claude-opus-4-8'), 'claude-opus-4-8');
  assert.equal(context.resolveStoredModel('gemini', 'gemini-3.1-flash-lite'), 'gemini-3.1-flash-lite');
});

test('model lists cannot be changed through the public helper', () => {
  const context = loadModelCatalog();
  const models = context.listModelsForProvider('openai');
  models.pop();

  assert.deepEqual(
    Array.from(context.listModelsForProvider('openai'), model => model.id),
    [
      'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6',
      'gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.2',
      'gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini',
    ]
  );
});
