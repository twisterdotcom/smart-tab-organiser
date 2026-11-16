'use strict';

const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { TextEncoder } = require('node:util');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'options.js'), 'utf8');
const START = SOURCE.indexOf('  async function refreshCloudModelList(');
const END = SOURCE.indexOf('\n  for (const control of cloudModelControls)', START);
assert.ok(START >= 0 && END > START, 'refreshCloudModelList extraction boundaries must exist');
// Extract the actual function so these tests exercise options.js without mocking
// unrelated options-page initialization or adding a production-only test export.
const REFRESH_SOURCE = SOURCE.slice(START, END);
const NOW = 1800000000000;
const MODEL_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
const KEY = 'test-api-key';
const CACHED_MODELS = [{ id: 'cached-model', label: 'Cached model' }];
const NEW_MODELS = [{ id: 'new-model', label: 'New model' }];

async function fingerprint(key) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return Buffer.from(digest).toString('hex');
}

async function cache(overrides = {}) {
  return {
    fingerprint: await fingerprint(KEY),
    models: CACHED_MODELS,
    updatedAt: NOW - 1000,
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function load({ provider = 'openai', key = KEY, cached, fetchModels, get, set } = {}) {
  const calls = { get: [], set: [], fetch: [], discovered: [], populate: [], hint: [] };
  const control = {
    provider,
    input: { value: key },
    select: { value: 'custom-selected-model', options: ['bundled-model', 'custom-selected-model'] },
    hint: {},
    button: { disabled: false },
    status: { textContent: '' },
  };
  const context = vm.createContext({
    crypto: { subtle: { digest: (...args) => webcrypto.subtle.digest(...args) } },
    TextEncoder,
    Uint8Array,
    Date: class extends Date { static now() { return NOW; } },
    MODEL_CACHE_MAX_AGE,
    chrome: { storage: { local: {
      get: async cacheKey => {
        calls.get.push(cacheKey);
        return get ? get(cacheKey) : { [cacheKey]: cached };
      },
      set: async value => {
        calls.set.push(value);
        if (set) await set(value);
      },
    } } },
    fetchCloudModels: async (...args) => {
      calls.fetch.push(args);
      return fetchModels ? fetchModels(...args) : NEW_MODELS;
    },
    setDiscoveredModels: (...args) => calls.discovered.push(args),
    populateModelSelect: (select, modelProvider, selected) => {
      calls.populate.push([select, modelProvider, selected]);
      // Simulate rebuilding a select: only an explicitly restored value survives.
      select.value = '';
      select.options = ['rebuilt-model', selected];
      select.value = selected;
    },
    updateModelRecommendedHint: (...args) => calls.hint.push(args),
  });
  vm.runInContext(REFRESH_SOURCE, context, { filename: 'options.js' });
  return { refresh: force => context.refreshCloudModelList(control, force), control, calls };
}

function assertRendered(env, models, index = 0) {
  const { calls, control } = env;
  assert.deepEqual(calls.discovered[index], [control.provider, models]);
  assert.deepEqual(calls.populate[index], [control.select, control.provider, 'custom-selected-model']);
  assert.deepEqual(calls.hint[index], [control.provider, control.hint, control.select]);
  assert.equal(control.select.value, 'custom-selected-model');
}

for (const provider of ['openai', 'claude', 'gemini']) {
  test(`${provider}: fresh cache for the matching credential avoids the network`, async () => {
    const env = load({ provider, key: `  ${KEY}  `, cached: await cache() });
    await env.refresh();
    assert.deepEqual(env.calls.get, [`${provider}ModelCatalog`]);
    assert.equal(env.calls.fetch.length, 0);
    assert.equal(env.calls.set.length, 0);
    assert.equal(env.calls.discovered.length, 1);
    assertRendered(env, CACHED_MODELS);
    assert.match(env.control.status.textContent, /Cached model list\. Last checked: .+/);
    assert.equal(env.control.button.disabled, false);
  });
}

test('cache at its expiry boundary is rendered and then refreshed', async () => {
  const env = load({ cached: await cache({ updatedAt: NOW - MODEL_CACHE_MAX_AGE }) });
  await env.refresh();
  assert.deepEqual(env.calls.fetch, [['openai', KEY]]);
  assert.equal(env.calls.discovered.length, 2);
  assertRendered(env, CACHED_MODELS);
  assertRendered(env, NEW_MODELS, 1);
  assert.equal(env.calls.set.length, 1);
  const saved = env.calls.set[0].openaiModelCatalog;
  assert.equal(saved.fingerprint, await fingerprint(KEY));
  assert.equal(saved.models, NEW_MODELS);
  assert.equal(saved.updatedAt, NOW);
  assert.ok(!JSON.stringify(env.calls.set).includes(KEY), 'cache must not store the API key');
  assert.match(env.control.status.textContent, /Model list updated: .+/);
  assert.equal(env.control.button.disabled, false);
});

test('force bypasses a fresh matching cache', async () => {
  const env = load({ cached: await cache() });
  await env.refresh(true);
  assert.deepEqual(env.calls.fetch, [['openai', KEY]]);
  assert.equal(env.calls.set.length, 1);
  assertRendered(env, CACHED_MODELS);
  assertRendered(env, NEW_MODELS, 1);
  assert.match(env.control.status.textContent, /Model list updated:/);
  assert.equal(env.control.button.disabled, false);
});

test('a fresh cache for another credential is not rendered or reused', async () => {
  const env = load({ cached: await cache({ fingerprint: await fingerprint('old-key') }) });
  await env.refresh();
  assert.deepEqual(env.calls.fetch, [['openai', KEY]]);
  assert.equal(env.calls.discovered.length, 1);
  assertRendered(env, NEW_MODELS);
  assert.equal(env.calls.set[0].openaiModelCatalog.fingerprint, await fingerprint(KEY));
});

test('missing or whitespace-only keys do not access storage or the network', async () => {
  for (const key of ['', '  \t ']) {
    const env = load({ key });
    const before = structuredClone(env.control.select);
    await env.refresh();
    for (const entries of Object.values(env.calls)) assert.equal(entries.length, 0);
    assert.deepEqual(env.control.select, before);
    assert.match(env.control.status.textContent, /Add an API key/);
    assert.equal(env.control.button.disabled, false);
  }
});

test('network and storage errors leave the selector unchanged and show useful status', async t => {
  for (const stage of ['fetchModels', 'get', 'set']) {
    await t.test(stage, async () => {
      const env = load({ [stage]: async () => { throw new Error('request failed'); } });
      const before = structuredClone(env.control.select);
      await env.refresh();
      assert.deepEqual(env.control.select, before);
      assert.equal(env.calls.discovered.length, 0);
      assert.equal(env.calls.populate.length, 0);
      assert.equal(env.calls.hint.length, 0);
      assert.match(env.control.status.textContent, /Could not refresh models/);
      assert.match(env.control.status.textContent, /saved or bundled list is still available/);
      assert.match(env.control.status.textContent, /Check the API key and try again/);
      assert.equal(env.control.button.disabled, false);
    });
  }
});

test('a response arriving after a key edit is ignored', async () => {
  const started = deferred();
  const response = deferred();
  const env = load({ fetchModels: () => { started.resolve(); return response.promise; } });
  const before = structuredClone(env.control.select);
  const refresh = env.refresh();
  await started.promise;
  assert.equal(env.control.button.disabled, true);
  env.control.input.value = 'edited-api-key';
  // Match the input handler's UI reset; an obsolete request must not undo it.
  env.control.button.disabled = false;
  env.control.status.textContent = 'API key changed. Select Refresh models to update the list.';
  response.resolve(NEW_MODELS);
  await refresh;
  assert.deepEqual(env.control.select, before);
  assert.equal(env.calls.set.length, 0);
  assert.equal(env.calls.discovered.length, 0);
  assert.equal(env.calls.populate.length, 0);
  assert.equal(env.calls.hint.length, 0);
  assert.equal(env.control.status.textContent, 'API key changed. Select Refresh models to update the list.');
  assert.equal(env.control.button.disabled, false);
});

test('refresh preserves the selection made while a network request is pending', async () => {
  const started = deferred();
  const response = deferred();
  const env = load({ fetchModels: () => { started.resolve(); return response.promise; } });
  const refresh = env.refresh();
  await started.promise;
  env.control.select.value = 'new-user-selection';
  response.resolve(NEW_MODELS);
  await refresh;
  assert.equal(env.calls.populate.length, 1);
  assert.equal(env.calls.populate[0][2], 'new-user-selection');
  assert.equal(env.control.select.value, 'new-user-selection');
  assert.equal(env.control.button.disabled, false);
});
