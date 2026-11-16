'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'local-model-picker.js'), 'utf8');
const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
const ADDRESS = 'http://localhost:11434';

class Element {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this.events = new Map();
    this._text = '';
    this._value = '';
    this.disabled = false;
    this.open = false;
  }

  get textContent() {
    return this._text + this.children.map(child => child.textContent).join('');
  }

  set textContent(text) {
    this._text = String(text);
    this.children = [];
    if (this.tagName === 'select') this._value = '';
  }

  get options() {
    return this.children.flatMap(child => child.tagName === 'option' ? [child] : child.options);
  }

  get value() {
    if (this.tagName === 'select' && !this.options.some(option => option.value === this._value)) return '';
    return this._value;
  }

  set value(value) {
    this._value = String(value);
    if (this.tagName === 'select' && !this.options.some(option => option.value === this._value)) this._value = '';
  }

  appendChild(child) {
    this.children.push(child);
    if (this.tagName === 'select' && this.options.length === 1) this._value = this.options[0].value;
    return child;
  }

  addEventListener(type, listener) {
    if (!this.events.has(type)) this.events.set(type, []);
    this.events.get(type).push(listener);
  }

  dispatch(type) {
    for (const listener of this.events.get(type) || []) listener({ type, target: this });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function result(overrides = {}) {
  return {
    success: true,
    models: ['qwen2.5:1.5b', 'custom:latest'],
    runningModels: ['qwen2.5:1.5b'],
    modelDetails: [{ id: 'qwen2.5:1.5b', sizeBytes: 986000000 }],
    serverType: 'ollama',
    version: '0.12.0',
    baseUrl: ADDRESS,
    ...overrides,
  };
}

function load(t, { model = 'saved:custom', replies = [], permission } = {}) {
  const calls = { messages: [], permissions: [], selected: [], refreshed: [], storage: [], network: [], execute: [], urls: [] };
  const elements = Object.fromEntries([
    'choices', 'model', 'address', 'refresh', 'status', 'suggestion', 'source',
    'pullCommand', 'serveCommand', 'macCommand', 'shell', 'setup',
  ].map(name => [name, new Element(name === 'choices' || name === 'shell' ? 'select' : 'div')]));
  for (const value of ['sh', 'powershell']) {
    const option = new Element('option');
    option.value = value;
    elements.shell.appendChild(option);
  }
  elements.model.value = model;
  elements.address.value = ADDRESS;
  const chrome = {
    runtime: {
      getURL: value => { calls.urls.push(value); return ORIGIN + '/' + value; },
      sendMessage: async message => {
        calls.messages.push({ ...message });
        assert.ok(replies.length, 'unexpected runtime message');
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
    storage: { local: {
      get: (...args) => { calls.storage.push(['get', ...args]); return Promise.resolve({}); },
      set: (...args) => { calls.storage.push(['set', ...args]); return Promise.resolve(); },
    } },
    scripting: { executeScript: (...args) => { calls.execute.push(args); } },
    downloads: { download: (...args) => { calls.network.push(['download', ...args]); } },
  };
  const context = vm.createContext({
    fetch: (...args) => { calls.network.push(['fetch', ...args]); throw new Error('direct network access is forbidden'); },
  });
  vm.runInContext(SOURCE, context, { filename: 'local-model-picker.js' });
  const picker = context.createLocalModelPicker({
    document: { createElement: tag => new Element(tag) },
    chrome,
    elements,
    requestPermission: async address => {
      calls.permissions.push(address);
      if (permission) await permission(address);
    },
    onSelect: id => calls.selected.push(id),
    onRefresh: () => calls.refreshed.push(true),
  });
  t.after(() => {
    assert.deepEqual(calls.network, [], 'must not fetch, POST, or download models');
    assert.deepEqual(calls.execute, [], 'setup commands must never execute');
    assert.deepEqual(calls.storage, [], 'picker must not read or write storage');
    for (const message of calls.messages) {
      assert.deepEqual(Object.keys(message).sort(), ['action', 'baseUrl']);
      assert.equal(message.action, 'listLocalModels', 'only model-list runtime messages are allowed');
    }
  });
  return { picker, elements, calls };
}

function options(env, prefix) {
  return env.elements.choices.options.filter(option => option.value.startsWith(prefix));
}

function choose(env, value) {
  env.elements.choices.value = value;
  assert.equal(env.elements.choices.value, value, 'choice must exist');
  env.elements.choices.dispatch('change');
}

test('construction renders bundled suggestions and origin-specific commands without network or permission requests', t => {
  const env = load(t);
  const { elements, calls } = env;
  assert.deepEqual(options(env, 'suggested:').map(option => [option.value, option.textContent]), [
    ['suggested:qwen2.5:1.5b', 'Qwen2.5 1.5B — pull 986 MB (view command)'],
    ['suggested:qwen2.5:3b', 'Qwen2.5 3B — pull 1.9 GB (view command)'],
    ['suggested:gemma3:1b', 'Gemma 3 1B — pull 806 MB (view command)'],
  ]);
  assert.equal(elements.choices.children[1].label, 'Ollama setup suggestions — not confirmed installed');
  assert.match(elements.suggestion.textContent, /Qwen2\.5 1\.5B:.*Approximate download: 986 MB/);
  assert.equal(elements.source.href, 'https://ollama.com/library/qwen2.5:1.5b');
  assert.equal(elements.source.textContent, 'Official model details and license');
  assert.equal(elements.pullCommand.textContent, 'ollama pull qwen2.5:1.5b');
  assert.equal(elements.serveCommand.textContent, 'OLLAMA_ORIGINS="' + ORIGIN + '" ollama serve');
  assert.equal(elements.macCommand.textContent, 'launchctl setenv OLLAMA_ORIGINS "' + ORIGIN + '"');
  assert.deepEqual(calls.urls, ['']);
  assert.deepEqual(calls.messages, []);
  assert.deepEqual(calls.permissions, []);
  assert.deepEqual(calls.selected, []);
  assert.deepEqual(calls.refreshed, []);
  assert.equal(elements.model.value, 'saved:custom');
  assert.equal(elements.choices.value, '');
  assert.equal(elements.setup.open, false);
});

test('refresh labels installed, loaded, suggested, and disk size without replacing a saved manual model', async t => {
  const env = load(t, { replies: [result({ models: ['qwen2.5:1.5b', 'custom:latest', 'qwen2.5:1.5b'] })] });
  await env.picker.refresh(false);
  assert.deepEqual(env.calls.messages, [{ action: 'listLocalModels', baseUrl: ADDRESS }]);
  assert.deepEqual(options(env, 'installed:').map(option => option.textContent), [
    'qwen2.5:1.5b — loaded, suggested, 1.0 GB on disk', 'custom:latest',
  ]);
  assert.equal(env.elements.choices.children[1].label, 'Installed in Ollama');
  assert.equal(options(env, 'suggested:').length, 2);
  assert.equal(env.elements.model.value, 'saved:custom');
  assert.equal(env.elements.choices.value, '');
  assert.equal(env.elements.choices.options[0].textContent, 'Manual or saved model: saved:custom');
  assert.match(env.elements.status.textContent, /Ollama 0\.12\.0 detected.*2 model\(s\) available/);
  assert.match(env.elements.status.textContent, /saved model is not in this list; your selection is unchanged/);
  assert.equal(env.elements.refresh.disabled, false);
  assert.deepEqual(env.calls.permissions, []);
  assert.deepEqual(env.calls.selected, []);
  assert.equal(env.calls.refreshed.length, 1);
});

test('only selecting an installed model calls onSelect', async t => {
  const env = load(t, { replies: [result()] });
  await env.picker.refresh();
  assert.deepEqual(env.calls.selected, []);
  choose(env, 'installed:qwen2.5:1.5b');
  assert.equal(env.elements.model.value, 'qwen2.5:1.5b');
  assert.deepEqual(env.calls.selected, ['qwen2.5:1.5b']);
  assert.equal(env.elements.status.textContent, 'Selected installed model: qwen2.5:1.5b.');
  choose(env, 'suggested:gemma3:1b');
  choose(env, '');
  env.elements.model.value = 'manual:other';
  env.elements.model.dispatch('input');
  env.elements.shell.value = 'powershell';
  env.elements.shell.dispatch('change');
  env.elements.address.dispatch('input');
  assert.deepEqual(env.calls.selected, ['qwen2.5:1.5b']);
});

test('suggestions only preview setup and never change the active model or storage', t => {
  const env = load(t);
  for (const [id, label] of [['qwen2.5:3b', 'Qwen2.5 3B'], ['gemma3:1b', 'Gemma 3 1B']]) {
    env.elements.setup.open = false;
    choose(env, 'suggested:' + id);
    assert.equal(env.elements.setup.open, true);
    assert.equal(env.elements.model.value, 'saved:custom');
    assert.ok(env.elements.suggestion.textContent.startsWith(label + ':'));
    assert.equal(env.elements.source.href, 'https://ollama.com/library/' + id);
    assert.equal(env.elements.pullCommand.textContent, 'ollama pull ' + id);
    assert.match(env.elements.status.textContent, /setup suggestion, not the active model/);
  }
  assert.deepEqual(env.calls.selected, []);
  assert.deepEqual(env.calls.messages, []);
});

test('manual input synchronizes the select and PowerShell preserves the current setup preview', async t => {
  const env = load(t, { replies: [result()] });
  await env.picker.refresh();
  env.elements.model.value = '  qwen2.5:1.5b  ';
  env.elements.model.dispatch('input');
  assert.equal(env.elements.choices.value, 'installed:qwen2.5:1.5b');
  env.elements.model.value = 'manual:new';
  env.elements.model.dispatch('input');
  assert.equal(env.elements.choices.value, '');
  assert.equal(env.elements.choices.options[0].textContent, 'Manual or saved model: manual:new');
  assert.equal(options(env, 'installed:').length, 2, 'rerender must replace, not append, choices');
  choose(env, 'suggested:gemma3:1b');
  env.elements.shell.value = 'powershell';
  env.elements.shell.dispatch('change');
  assert.equal(env.elements.serveCommand.textContent, '$env:OLLAMA_ORIGINS = "' + ORIGIN + '"\nollama serve');
  assert.equal(env.elements.pullCommand.textContent, 'ollama pull gemma3:1b');
  env.elements.shell.value = 'sh';
  env.elements.shell.dispatch('change');
  assert.equal(env.elements.serveCommand.textContent, 'OLLAMA_ORIGINS="' + ORIGIN + '" ollama serve');
  assert.deepEqual(env.calls.selected, []);
});

test('address input invalidates pending successes and errors without overwriting a newer reply', async t => {
  for (const staleError of [false, true]) {
    const pending = deferred();
    const env = load(t, { replies: [result(), pending.promise, result({ models: ['new:model'], baseUrl: 'http://localhost:1234', serverType: 'openai' })] });
    await env.picker.refresh();
    const oldRefresh = env.picker.refresh();
    assert.equal(env.elements.refresh.disabled, true);
    env.elements.address.value = 'http://localhost:1234';
    env.elements.address.dispatch('input');
    assert.equal(options(env, 'installed:').length, 0);
    assert.equal(env.elements.refresh.disabled, false);
    assert.match(env.elements.status.textContent, /Server address changed/);
    await env.picker.refresh();
    const status = env.elements.status.textContent;
    if (staleError) pending.reject(new Error('obsolete failure'));
    else pending.resolve(result({ models: ['obsolete:model'] }));
    await oldRefresh;
    assert.deepEqual(options(env, 'installed:').map(option => option.value), ['installed:new:model']);
    assert.equal(env.elements.choices.children[1].label, 'Available on this server');
    assert.equal(env.elements.status.textContent, status);
    assert.match(status, /OpenAI-compatible server detected at http:\/\/localhost:1234/);
    assert.equal(env.elements.model.value, 'saved:custom');
    assert.deepEqual(env.calls.selected, []);
  }
});

test('failed or malformed refreshes clear stale installed choices but keep the saved model', async t => {
  for (const [reply, error] of [
    [new Error('connection refused'), /connection refused/],
    [{ success: false, error: 'permission missing' }, /permission missing/],
    [null, /Could not reach/],
    [result({ models: ['valid', 42] }), /invalid model list/],
  ]) {
    const env = load(t, { model: 'qwen2.5:1.5b', replies: [result(), reply] });
    await env.picker.refresh();
    assert.equal(env.elements.choices.value, 'installed:qwen2.5:1.5b');
    await env.picker.refresh();
    assert.equal(options(env, 'installed:').length, 0);
    assert.equal(options(env, 'suggested:').length, 3);
    assert.equal(env.elements.model.value, 'qwen2.5:1.5b');
    assert.equal(env.elements.choices.value, '');
    assert.match(env.elements.status.textContent, error);
    assert.match(env.elements.status.textContent, /saved model is unchanged/);
    assert.equal(env.elements.status.className, 'status error');
    assert.equal(env.elements.refresh.disabled, false);
    assert.deepEqual(env.calls.selected, []);
  }
});

test('automatic refresh never prompts; the refresh button waits for manual permission', async t => {
  const permission = deferred();
  const finished = deferred();
  const env = load(t, { replies: [result(), finished.promise], permission: () => permission.promise });
  await env.picker.refresh(false);
  assert.deepEqual(env.calls.permissions, []);
  env.elements.address.value = '  ' + ADDRESS + '  ';
  env.elements.refresh.dispatch('click');
  assert.deepEqual(env.calls.permissions, [ADDRESS]);
  assert.equal(env.calls.messages.length, 1, 'must wait for permission before listing');
  assert.equal(env.elements.refresh.disabled, true);
  permission.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.calls.messages.length, 2);
  finished.resolve(result());
  // The click handler does not return the refresh promise.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.elements.refresh.disabled, false);
  assert.equal(env.calls.refreshed.length, 2);
  assert.deepEqual(env.calls.selected, []);
});

test('permission failure and address changes while permission is pending do not send list requests', async t => {
  const denied = load(t, { permission: () => { throw new Error('permission denied'); } });
  await denied.picker.refresh(true);
  assert.deepEqual(denied.calls.messages, []);
  assert.match(denied.elements.status.textContent, /permission denied/);
  assert.equal(denied.elements.refresh.disabled, false);

  const permission = deferred();
  const env = load(t, { permission: () => permission.promise });
  const pending = env.picker.refresh(true);
  env.elements.address.value = 'http://localhost:1234';
  env.elements.address.dispatch('input');
  permission.resolve();
  await pending;
  assert.deepEqual(env.calls.messages, []);
  assert.match(env.elements.status.textContent, /Server address changed/);
  assert.deepEqual(env.calls.selected, []);
});

test('refresh uses the current selection when it changes while discovery is pending', async t => {
  for (const current of ['custom:latest', 'manual:pending']) {
    const reply = deferred();
    const env = load(t, { replies: [reply.promise] });
    const pending = env.picker.refresh();
    env.elements.model.value = current;
    env.elements.model.dispatch('input');
    reply.resolve(result());
    await pending;
    assert.equal(env.elements.model.value, current);
    assert.equal(env.elements.choices.value, current === 'custom:latest' ? 'installed:custom:latest' : '');
    assert.equal(env.elements.status.textContent.includes('saved model is not in this list'), current === 'manual:pending');
    assert.equal(env.elements.choices.options[0].textContent, 'Manual or saved model: ' + current);
    assert.deepEqual(env.calls.selected, []);
  }
});
