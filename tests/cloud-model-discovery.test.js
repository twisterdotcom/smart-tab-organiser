'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'cloud-model-discovery.js'), 'utf8');
const KEY = 'secret-api-key';

function load(pages, overrides = {}) {
  const calls = [];
  const timers = [];
  const cleared = [];
  const context = {
    AbortController,
    fetch: async (url, options) => {
      calls.push({ url, options });
      const page = pages.shift();
      if (page instanceof Error) throw page;
      if (typeof page === 'function') return page(url, options);
      assert.notEqual(page, undefined, 'unexpected request');
      return { ok: true, json: async () => page };
    },
    setTimeout: (callback, delay) => {
      const timer = { callback, delay };
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => cleared.push(timer),
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'cloud-model-discovery.js' });
  return { discover: context.fetchCloudModels, calls, timers, cleared };
}

function ids(models) {
  return Array.from(models, model => model.id);
}

function claude(data, extra = {}) {
  return { data: data.map(id => ({ id })), has_more: false, ...extra };
}

function gemini(names, extra = {}) {
  return {
    models: names.map(name => ({ name: 'models/' + name, supportedGenerationMethods: ['generateContent'] })),
    ...extra,
  };
}

test('OpenAI uses the official GET endpoint and a conservative allowlist', async () => {
  const allowed = [
    'gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna',
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6', 'gpt-5.4-mini',
    'gpt-5.4-nano', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'gpt-5-chat-latest',
    'gpt-4o-2024-08-06', 'gpt-4.1-mini-2025-04-14', 'o1', 'o3', 'o4-mini',
    'o3-mini-2025-01-31', 'o4', 'gpt-10', 'gpt-9',
  ];
  const excluded = [
    'gpt-5-pro', 'o1-pro', 'o3-pro', 'gpt-5o', 'gpt-4o-realtime-preview',
    'gpt-4o-audio-preview', 'gpt-4o-mini-search-preview', 'gpt-5-codex',
    'gpt-image-1', 'chatgpt-image-latest', 'text-embedding-3-small', 'whisper-1',
    'tts-1', 'gpt-5-transcribe', 'gpt-5-unknown', 'gpt-5-mini-extra',
  ];
  const env = load([{ data: [...allowed, ...excluded, allowed[0]].map(id => ({ id })) }]);
  const models = await env.discover('openai', KEY);
  assert.deepEqual(new Set(ids(models)), new Set(allowed));
  assert.equal(models.length, allowed.length);
  assert.ok(ids(models).indexOf('gpt-10') < ids(models).indexOf('gpt-9'));
  for (const model of models) {
    assert.equal(model.label, model.id);
    assert.equal(model.description, 'Provider-listed model; compatibility not tested');
  }
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(env.calls[0].options.method, 'GET');
  assert.equal(env.calls[0].options.headers.Authorization, 'Bearer ' + KEY);
  assert.equal(env.calls[0].options.signal.aborted, false);
  assert.equal(env.calls[0].options.redirect, 'error');
  assert.equal(env.timers.length, 1);
  assert.equal(env.timers[0].delay, 15000);
  assert.deepEqual(env.cleared, env.timers);
});

test('Claude paginates with last_id, deduplicates, labels, and filters lifecycle', async () => {
  const env = load([
    claude(['claude-sonnet-4-9', 'unrelated'], { has_more: true, last_id: 'cursor /?&' }),
    { data: [
      { id: 'claude-sonnet-4-10', display_name: 'Sonnet 4.10' },
      { id: 'claude-sonnet-4-9' },
      { id: 'claude-retired', lifecycle: 'retired' },
      { id: 'claude-deprecated', lifecycle: { status: 'deprecated' } },
      { id: 'claude-old', lifecycle_status: 'retired' },
      { id: 'claude-active', lifecycle: { status: 'active' } },
    ], has_more: false },
  ]);
  const models = await env.discover('claude', KEY);
  assert.deepEqual(ids(models), ['claude-sonnet-4-10', 'claude-sonnet-4-9', 'claude-active']);
  assert.equal(models[0].label, 'Sonnet 4.10');
  assert.equal(env.calls[0].url, 'https://api.anthropic.com/v1/models?limit=100');
  assert.equal(env.calls[1].url, 'https://api.anthropic.com/v1/models?limit=100&after_id=cursor%20%2F%3F%26');
  assert.deepEqual({ ...env.calls[0].options.headers }, {
    'x-api-key': KEY,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  assert.equal(env.calls[1].options.signal, env.calls[0].options.signal);
  assert.equal(env.timers.length, 1);
  assert.deepEqual(env.cleared, env.timers);
});

test('Gemini paginates, strips models/, and requires general generateContent models', async () => {
  const specialized = ['image', 'audio', 'tts', 'live', 'embedding', 'robotics'];
  const first = gemini([
    'gemini-2.5-flash', 'gemini-2.5-pro', ...specialized.map(kind => 'gemini-3-' + kind + '-preview'),
    'imagen-4', 'gemma-3',
  ], { nextPageToken: 'token +/&' });
  first.models.push({ name: 'models/gemini-embedding', supportedGenerationMethods: ['embedContent'] });
  first.models.push({ name: 'models/gemini-no-generate', supportedGenerationMethods: ['countTokens'] });
  const second = gemini(['gemini-2.5-flash', 'gemini-3-flash-preview'], { nextPageToken: '' });
  second.models[1].displayName = 'Gemini 3 Flash';
  const env = load([first, second]);
  const models = await env.discover('gemini', KEY);
  assert.deepEqual(ids(models), ['gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash']);
  assert.equal(models[0].label, 'Gemini 3 Flash');
  assert.equal(env.calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000');
  assert.equal(env.calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=token%20%2B%2F%26');
  assert.deepEqual({ ...env.calls[0].options.headers }, { 'x-goog-api-key': KEY });
  assert.equal(env.calls[1].options.signal, env.calls[0].options.signal);
});

test('filtered-only intermediate pages can lead to compatible results', async () => {
  const env = load([
    claude(['other-model'], { has_more: true, last_id: 'other-model' }),
    claude(['claude-sonnet-5']),
  ]);
  assert.deepEqual(ids(await env.discover('claude', KEY)), ['claude-sonnet-5']);
});

test('invalid providers and missing keys reject without making requests', async () => {
  const env = load([]);
  for (const provider of ['custom', '__proto__', KEY, null]) {
    await assert.rejects(env.discover(provider, KEY), /Unsupported cloud model provider/);
  }
  for (const key of ['', '  ', null, 123]) {
    await assert.rejects(env.discover('openai', key), /API key is required/);
  }
  assert.equal(env.calls.length, 0);
  assert.equal(env.timers.length, 0);
});

test('HTTP, network, and JSON failures never expose keys or response bodies', async () => {
  for (const page of [
    new Error('transport exposed ' + KEY),
    () => ({ ok: false, status: 401, statusText: KEY, json: () => assert.fail('must not read error body') }),
    () => ({ ok: true, json: async () => { throw new Error('body exposed ' + KEY); } }),
  ]) {
    const env = load([page]);
    await assert.rejects(env.discover('openai', KEY), error => {
      assert.ok(!String(error).includes(KEY));
      assert.equal(error.cause, undefined);
      return true;
    });
    assert.deepEqual(env.cleared, env.timers);
  }
});

test('malformed and empty pages reject rather than return partial results', async () => {
  const cases = [
    ['openai', null], ['openai', []], ['openai', {}], ['openai', { data: {} }],
    ['openai', { data: [] }], ['openai', { data: [null] }],
    ['openai', { data: [{ id: 4 }] }], ['openai', { data: [{ id: ' ' }] }],
    ['openai', { data: [{ id: 'gpt-5' }, { id: '' }] }],
    ['claude', { data: [{ id: 'claude-5' }], has_more: 'yes' }],
    ['claude', claude(['claude-5'], { has_more: true })],
    ['claude', claude(['claude-5'], { has_more: true, last_id: 123 })],
    ['gemini', { models: [] }], ['gemini', { models: [{ name: 'models/gemini-3' }] }],
    ['gemini', { models: [{ name: 'models/gemini-3', supportedGenerationMethods: 'generateContent' }] }],
    ['gemini', gemini(['gemini-3'], { nextPageToken: null })],
  ];
  for (const [provider, body] of cases) {
    const env = load([body]);
    await assert.rejects(env.discover(provider, KEY), /malformed|empty/);
    assert.deepEqual(env.cleared, env.timers);
  }
  for (const provider of ['claude', 'gemini']) {
    const pages = provider === 'claude'
      ? [claude(['claude-5'], { has_more: true, last_id: 'next' }), claude([])]
      : [gemini(['gemini-3'], { nextPageToken: 'next' }), gemini([])];
    const env = load(pages);
    await assert.rejects(env.discover(provider, KEY), /empty/);
  }
});

test('empty compatible results reject for every provider', async () => {
  for (const [provider, page] of [
    ['openai', { data: [{ id: 'gpt-5-pro' }] }],
    ['claude', claude(['not-claude'])],
    ['gemini', gemini(['gemini-3-image'])],
  ]) {
    await assert.rejects(load([page]).discover(provider, KEY), /no compatible models/);
  }
});

test('pagination rejects repeated cursors, including cycles', async () => {
  for (const provider of ['claude', 'gemini']) {
    const pages = ['a', 'b', 'a'].map(cursor => provider === 'claude'
      ? claude(['claude-5'], { has_more: true, last_id: cursor })
      : gemini(['gemini-3'], { nextPageToken: cursor }));
    const env = load(pages);
    await assert.rejects(env.discover(provider, KEY), /repeated page cursor/);
    assert.equal(env.calls.length, 3);
    assert.deepEqual(env.cleared, env.timers);
  }
});

test('pagination allows 20 pages but rejects a required 21st page', async () => {
  for (const provider of ['claude', 'gemini']) {
    for (const continues of [false, true]) {
      const pages = Array.from({ length: 20 }, (_, i) => {
        const more = i < 19 || continues;
        return provider === 'claude'
          ? claude(['claude-5'], { has_more: more, last_id: 'cursor-' + i })
          : gemini(['gemini-3'], more ? { nextPageToken: 'cursor-' + i } : {});
      });
      const env = load(pages);
      if (continues) await assert.rejects(env.discover(provider, KEY), /20-page limit/);
      else assert.equal((await env.discover(provider, KEY)).length, 1);
      assert.equal(env.calls.length, 20);
      assert.equal(env.timers.length, 1);
      assert.deepEqual(env.cleared, env.timers);
    }
  }
});

test('the overall 15-second deadline aborts pending fetches and clears its timer', async () => {
  const env = load([(_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(KEY)), { once: true });
  })]);
  const pending = env.discover('openai', KEY);
  assert.equal(env.timers[0].delay, 15000);
  assert.equal(env.calls[0].options.signal.aborted, false);
  env.timers[0].callback();
  await assert.rejects(pending, /timed out/);
  assert.equal(env.calls[0].options.signal.aborted, true);
  assert.deepEqual(env.cleared, env.timers);
});

test('the same deadline includes later pages and stalled JSON bodies', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const env = load([
    gemini(['gemini-3'], { nextPageToken: 'next' }),
    () => ({ ok: true, json: () => { started(); return new Promise(() => {}); } }),
  ]);
  const pending = env.discover('gemini', KEY);
  await ready;
  assert.equal(env.calls.length, 2);
  assert.equal(env.timers.length, 1);
  env.timers[0].callback();
  await assert.rejects(pending, /timed out/);
  assert.equal(env.calls[1].options.signal.aborted, true);
  assert.deepEqual(env.cleared, env.timers);
});
