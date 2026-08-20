'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const BACKGROUND_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'background.js'),
  'utf8'
);

function eventStub() {
  return { addListener() {} };
}

function loadBackground() {
  const chrome = {
    action: {
      onClicked: eventStub(),
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
      setTitle: async () => {},
    },
    commands: { onCommand: eventStub() },
    contextMenus: {
      onClicked: eventStub(),
      create() {},
      removeAll(callback) { callback(); },
      update: async () => {},
    },
    notifications: {
      clear: async () => {},
      create: async () => {},
    },
    runtime: {
      getURL: (relativePath) => `chrome-extension://test/${relativePath}`,
      onInstalled: eventStub(),
      onMessage: eventStub(),
      openOptionsPage: async () => {},
    },
    storage: {
      local: {
        get: async () => ({}),
        set: async () => {},
      },
    },
    tabGroups: {
      query: async () => [],
      update: async () => {},
    },
    tabs: {
      get: async (id) => ({ id }),
      group: async () => 1,
      move: async () => {},
      onActivated: eventStub(),
      onCreated: eventStub(),
      onRemoved: eventStub(),
      onUpdated: eventStub(),
      query: async () => [],
      reload: async () => {},
      remove: async () => {},
      ungroup: async () => {},
      update: async () => {},
    },
    windows: {
      get: async (id) => ({ id }),
      getCurrent: async () => ({ id: 1 }),
      getLastFocused: async () => ({ id: 1 }),
      onFocusChanged: eventStub(),
    },
  };

  const context = {
    AbortController,
    URL,
    chrome,
    clearInterval,
    clearTimeout,
    console: {
      error() {},
      log() {},
      warn() {},
    },
    fetch: async () => {
      throw new Error('Unexpected fetch');
    },
    importScripts() {},
    resolveStoredModel: (_provider, model) => model || 'test-model',
    setInterval,
    setTimeout,
  };
  context.globalThis = context;
  context.self = context;

  vm.createContext(context);
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });
  return { chrome, context };
}

test('cloud AI URLs exclude credentials, query parameters, and fragments', () => {
  const { context } = loadBackground();

  const result = context.sanitizeUrlForCloudAi(
    'https://user:secret@example.com/private/path?token=abc#message-42'
  );

  assert.equal(result, 'https://example.com/private/path');
});

test('the OpenAI request body receives only sanitized URLs', async () => {
  const { context } = loadBackground();
  let requestBody = null;

  context.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(init.headers.Authorization, 'Bearer openai-key');
    requestBody = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '[{"groupName":"Work","tabIndices":[1,2]}]',
          },
        }],
      }),
    };
  };

  const result = await context.callProvider(
    'openai',
    { openaiKey: 'openai-key', openaiModel: 'test-model' },
    [
      { title: 'One', url: 'https://example.com/work?token=secret#one' },
      { title: 'Two', url: 'https://example.com/docs?page=2#two' },
    ],
    '',
    null,
    null,
    1
  );

  assert.equal(result[0].groupName, 'Work');
  assert.ok(requestBody);
  const prompt = requestBody.messages[0].content;
  assert.match(prompt, /https:\/\/example\.com\/work/);
  assert.match(prompt, /https:\/\/example\.com\/docs/);
  assert.doesNotMatch(prompt, /token=secret|page=2|#one|#two/);
});

test('local model requests reject non-loopback hosts before fetch', async () => {
  const { context } = loadBackground();

  await assert.rejects(
    context.listLocalModels('http://192.168.1.20:11434/v1'),
    /must use http:\/\/localhost or http:\/\/127\.0\.0\.1/
  );
});

test('an empty PR result ungroups managed tabs without closing them', async () => {
  const { chrome, context } = loadBackground();
  const ungrouped = [];
  let removeCalled = false;

  chrome.storage.local.get = async () => ({
    githubToken: 'github-token',
    prGroupEnabled: true,
    ignoreQuery: true,
    ignoreHash: true,
  });
  chrome.windows.get = async (id) => ({ id });
  chrome.tabGroups.query = async () => [{ id: 17, title: 'PRs' }];
  chrome.tabs.query = async (query) => {
    if (query.groupId === 17) {
      return [
        { id: 101, url: 'https://github.com/example/project/pull/1', splitViewId: -1 },
        { id: 102, url: 'https://github.com/example/project/pull/2', splitViewId: -1 },
        { id: 103, url: 'https://github.com/example/project/pull/3', splitViewId: 7 },
        { id: 104, url: 'https://notgithub.com/example/project/pull/4', splitViewId: -1 },
      ];
    }
    return [];
  };
  chrome.tabs.ungroup = async (ids) => {
    ungrouped.push(...ids);
  };
  chrome.tabs.remove = async () => {
    removeCalled = true;
  };

  context.fetch = async (url) => {
    if (url === 'https://api.github.com/user') {
      return { ok: true, json: async () => ({ login: 'example-user' }) };
    }
    if (url.startsWith('https://api.github.com/search/issues')) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await context.syncPrTabGroup(9);

  assert.equal(result.success, true);
  assert.deepEqual(ungrouped, [101, 102]);
  assert.equal(removeCalled, false);
  assert.match(result.message, /without closing them/);
});

test('PR refresh ungroups only stale non-split PR tabs', async () => {
  const { chrome, context } = loadBackground();
  const currentPr = {
    id: 201,
    url: 'https://github.com/example/project/pull/1',
    splitViewId: -1,
  };
  const stalePr = {
    id: 202,
    url: 'https://github.com/example/project/pull/2',
    splitViewId: -1,
  };
  const splitPr = {
    id: 203,
    url: 'https://github.com/example/project/pull/3',
    splitViewId: 8,
  };
  const unrelatedTab = {
    id: 204,
    url: 'https://notgithub.com/example/project/pull/4',
    splitViewId: -1,
  };
  const ungrouped = [];

  chrome.storage.local.get = async () => ({
    githubToken: 'github-token',
    prGroupEnabled: true,
    ignoreQuery: true,
    ignoreHash: true,
  });
  chrome.windows.get = async (id) => ({ id });
  chrome.tabGroups.query = async () => [{ id: 27, title: 'PRs' }];
  chrome.tabs.query = async (query) => {
    if (query.windowId === 12 || query.groupId === 27) {
      return [currentPr, stalePr, splitPr, unrelatedTab];
    }
    return [];
  };
  chrome.tabs.ungroup = async (ids) => {
    ungrouped.push(...ids);
  };
  chrome.tabs.remove = async () => {
    assert.fail('PR refresh must not close tabs');
  };

  context.fetch = async (url) => {
    if (url === 'https://api.github.com/user') {
      return { ok: true, json: async () => ({ login: 'example-user' }) };
    }
    if (url.includes('author%3Aexample-user')) {
      return {
        ok: true,
        json: async () => ({
          items: [{
            repository_url: 'https://api.github.com/repos/example/project',
            number: 1,
          }],
        }),
      };
    }
    if (url.startsWith('https://api.github.com/search/issues')) {
      return { ok: true, json: async () => ({ items: [] }) };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await context.syncPrTabGroup(12);

  assert.equal(result.success, true);
  assert.deepEqual(ungrouped, [202]);
});
