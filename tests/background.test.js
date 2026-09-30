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
  const listeners = [];
  return {
    addListener(listener) {
      listeners.push(listener);
    },
    async emit(...args) {
      for (const listener of listeners) await listener(...args);
    },
  };
}

function makeSseResponse(chunks) {
  const encoder = new TextEncoder();
  const encoded = chunks.map(chunk => encoder.encode(chunk));
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'text/event-stream; charset=utf-8' },
    body: {
      getReader: () => ({
        read: async () => index < encoded.length
          ? { value: encoded[index++], done: false }
          : { value: undefined, done: true },
      }),
    },
  };
}

function loadBackground() {
  const chrome = {
    action: {
      onClicked: eventStub(),
      setBadgeBackgroundColor: async () => {},
      setBadgeText: async () => {},
      setTitle: async () => {},
    },
    alarms: {
      create: async () => {},
      clear: async () => {},
      getAll: async () => [],
      onAlarm: eventStub(),
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
    permissions: {
      contains: async () => true,
      request: async () => true,
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
      onChanged: eventStub(),
    },
    tabGroups: {
      move: async () => {},
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
      onRemoved: eventStub(),
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
    TextDecoder,
    TextEncoder,
  };
  context.globalThis = context;
  context.self = context;

  vm.createContext(context);
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });
  return { chrome, context };
}

test('AI URLs exclude credentials, query parameters, and fragments', () => {
  const { context } = loadBackground();

  const result = context.sanitizeUrlForAi(
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
    1
  );

  assert.equal(result[0].groupName, 'Work');
  assert.ok(requestBody);
  assert.equal(requestBody.stream, true);
  const prompt = requestBody.messages[0].content;
  assert.match(prompt, /https:\/\/example\.com\/work/);
  assert.match(prompt, /https:\/\/example\.com\/docs/);
  assert.doesNotMatch(prompt, /token=secret|page=2|#one|#two/);
});

test('Claude and Gemini requests use their streaming APIs', async () => {
  const { context } = loadBackground();
  const tabs = [
    { title: 'One', url: 'https://example.com/one' },
    { title: 'Two', url: 'https://example.com/two' },
  ];
  let claudeBody = null;

  context.fetch = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    claudeBody = JSON.parse(init.body);
    return makeSseResponse([
      `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '[{"groupName":"Claude","tabIndices":[1,2]}]' } })}\n\n`,
    ]);
  };

  const claudeGroups = await context.callClaude('claude-key', 'claude-sonnet-5', tabs, '', null, 1);
  assert.equal(claudeBody.stream, true);
  assert.equal(claudeGroups[0].groupName, 'Claude');

  let geminiBody = null;
  context.fetch = async (url, init) => {
    assert.equal(
      url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.7-flash:streamGenerateContent?alt=sse'
    );
    geminiBody = JSON.parse(init.body);
    return makeSseResponse([
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '[{"groupName":"Gemini","tabIndices":[1,2]}]' }] } }] })}\n\n`,
    ]);
  };

  const geminiGroups = await context.callGemini('gemini-key', 'gemini-3.7-flash', tabs, '', null, 1);
  assert.equal('temperature' in geminiBody.generationConfig, false);
  assert.equal(geminiGroups[0].groupName, 'Gemini');
});

test('SSE parsing supports multiline data fields and standalone CR endings', async () => {
  const { context } = loadBackground();
  const events = [];
  const response = makeSseResponse([
    'data: {"value":\r',
    'data: 1}\r\r',
  ]);

  await context.readSseJsonEvents(response, event => events.push(event));

  assert.equal(events.length, 1);
  assert.equal(events[0].value, 1);
});

test('local model requests reject non-loopback hosts before fetch', async () => {
  const { context } = loadBackground();

  await assert.rejects(
    context.listLocalModels('http://192.168.1.20:11434/v1'),
    /must use http:\/\/localhost or http:\/\/127\.0\.0\.1/
  );
});

test('provider fallback is disabled until the user enables it', async () => {
  const { context } = loadBackground();

  const description = await context.describeProviderChain({
    aiProvider: 'openai',
    openaiKey: 'openai-key',
    claudeKey: 'claude-key',
  });

  assert.equal(description.fallbackEnabled, false);
  assert.deepEqual(Array.from(description.chain), ['openai']);
});

test('Chrome built-in AI remains configured without an API key', async () => {
  const { context } = loadBackground();

  assert.equal(await context.providerConfigurationStatus('chrome-ai', {}), 'ready');
});

test('custom OpenAI optional host access is restricted to HTTPS', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'manifest.json'),
    'utf8'
  ));

  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
});

test('custom OpenAI host normalization preserves explicit paths and defaults origin-only input to /v1', () => {
  const { context } = loadBackground();

  assert.equal(
    context.normalizeCustomOpenAIBaseUrl('api.example.com'),
    'https://api.example.com/v1'
  );
  assert.equal(
    context.normalizeCustomOpenAIBaseUrl('https://gateway.example.com/compat'),
    'https://gateway.example.com/compat'
  );
  assert.equal(
    context.normalizeCustomOpenAIBaseUrl('https://gateway.example.com/chat/completions?tenant=abc'),
    'https://gateway.example.com/?tenant=abc'
  );
});

test('custom OpenAI model listing accepts top-level arrays and string entries', async () => {
  const { chrome, context } = loadBackground();
  chrome.permissions.contains = async () => true;

  context.fetch = async (url) => {
    assert.equal(url, 'https://api.example.com/v1/models');
    return {
      ok: true,
      json: async () => ([
        'model-b',
        { id: 'model-a' },
        { name: 'model-c' },
      ]),
    };
  };

  const result = await context.listCustomOpenAIModels('https://api.example.com', '');
  assert.equal(result.baseUrl, 'https://api.example.com/v1');
  assert.deepEqual(Array.from(result.models), ['model-a', 'model-b', 'model-c']);
});

test('custom OpenAI calls support optional authorization and JSON or SSE responses', async () => {
  const { context } = loadBackground();
  const tabs = [{ title: 'One', url: 'https://example.com/one' }];
  const requests = [];

  context.fetch = async (url, init) => {
    requests.push({ url, init });
    if (requests.length === 1) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          choices: [{ message: { content: '[{"groupName":"JSON","tabIndices":[1]}]' } }],
        }),
      };
    }
    return makeSseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: '[{"groupName":"SSE","tabIndices":[1]}]' } }] })}\n\n`,
      'data: [DONE]\n\n',
    ]);
  };

  const jsonGroups = await context.callCustomOpenAI(
    'https://api.example.com/v1',
    '',
    'model-a',
    tabs,
    '',
    null,
    1
  );
  const sseGroups = await context.callCustomOpenAI(
    'https://api.example.com/v1',
    'custom-key',
    'model-a',
    tabs,
    '',
    null,
    1
  );

  assert.equal(requests[0].url, 'https://api.example.com/v1/chat/completions');
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(JSON.parse(requests[0].init.body).stream, true);
  assert.equal(jsonGroups[0].groupName, 'JSON');
  assert.equal(requests[1].init.headers.Authorization, 'Bearer custom-key');
  assert.equal(sseGroups[0].groupName, 'SSE');
});

test('custom OpenAI HTTP errors retain status and actionable provider detail', async () => {
  const { context } = loadBackground();
  context.fetch = async () => ({
    ok: false,
    status: 422,
    text: async () => JSON.stringify({ error: { message: 'unsupported max_tokens' } }),
  });

  let thrownError = null;
  await assert.rejects(
    context.callCustomOpenAI(
      'https://api.example.com/v1',
      'custom-key',
      'model-a',
      [{ title: 'One', url: 'https://example.com/one' }],
      '',
      null,
      1
    ),
    (error) => {
      thrownError = error;
      return error.status === 422 && error.message === 'unsupported max_tokens';
    }
  );

  const classification = context.classifyAiError(thrownError);
  const message = context.buildMultiProviderErrorMessage([
    { provider: 'custom-openai', classification },
  ]);
  assert.equal(classification.type, 'unknown');
  assert.match(message, /HTTP 422/);
  assert.match(message, /unsupported max_tokens/);
});

test('custom OpenAI retries share one total timeout', async () => {
  const { context } = loadBackground();
  const clockValues = [0, 0, 180001];
  let fetchCount = 0;
  context.Date = { now: () => clockValues.shift() ?? 180001 };
  context.fetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: 'not valid grouping JSON' } }] }),
    };
  };

  let thrownError = null;
  await assert.rejects(
    context.callProvider(
      'custom-openai',
      {
        customOpenaiBaseUrl: 'https://api.example.com/v1',
        customOpenaiModel: 'model-a',
      },
      [{ title: 'One', url: 'https://example.com/one' }],
      '',
      null,
      1
    ),
    (error) => {
      thrownError = error;
      return /timed out after 180s/.test(error.message);
    }
  );

  assert.equal(fetchCount, 1);
  assert.equal(context.classifyAiError(thrownError).type, 'timeout');
});

test('custom OpenAI chain status reports missing model separately from missing key', async () => {
  const { context } = loadBackground();

  const description = await context.describeProviderChain({
    aiProvider: 'openai',
    openaiKey: 'openai-key',
    aiFallbackEnabled: true,
    aiFallbackOrder: ['custom-openai', 'claude'],
    customOpenaiBaseUrl: 'https://api.example.com/v1',
  });

  const customEntry = description.entries.find((entry) => entry.provider === 'custom-openai');
  assert.equal(customEntry.status, 'missing-model-name');
});

test('custom OpenAI chain marks missing host permission as not ready', async () => {
  const { chrome, context } = loadBackground();
  chrome.permissions.contains = async () => false;

  const description = await context.describeProviderChain({
    aiProvider: 'openai',
    openaiKey: 'openai-key',
    aiFallbackEnabled: true,
    aiFallbackOrder: ['custom-openai', 'claude'],
    customOpenaiBaseUrl: 'https://api.example.com/v1',
    customOpenaiModel: 'test-model',
    claudeKey: 'claude-key',
  });

  const customEntry = description.entries.find((entry) => entry.provider === 'custom-openai');
  assert.equal(customEntry.status, 'missing-host-permission');
  assert.deepEqual(Array.from(description.chain), ['openai', 'claude']);
});

test('organizeTabs requests custom host permission before any grouping mutation', async () => {
  const { chrome, context } = loadBackground();
  const tabs = [
    { id: 1, index: 0, pinned: false, groupId: -1, windowId: 1, title: 'One', url: 'https://example.com/one' },
    { id: 2, index: 1, pinned: false, groupId: -1, windowId: 1, title: 'Two', url: 'https://example.com/two' },
  ];
  const callOrder = [];

  chrome.storage.local.get = async () => ({
    aiProvider: 'custom-openai',
    aiFallbackEnabled: false,
    customOpenaiBaseUrl: 'https://api.example.com/v1',
    customOpenaiModel: 'model-a',
    customOpenaiKey: 'key',
  });
  chrome.permissions.contains = async () => {
    callOrder.push('contains');
    return false;
  };
  chrome.permissions.request = async () => {
    callOrder.push('request');
    return false;
  };
  chrome.tabs.query = async (queryInfo = {}) => {
    if (Object.prototype.hasOwnProperty.call(queryInfo, 'groupId')) return [];
    return tabs.map((tab) => ({ ...tab }));
  };
  chrome.tabGroups.query = async () => [];
  chrome.tabs.ungroup = async () => {
    callOrder.push('ungroup');
  };
  context.fetch = async () => {
    throw new Error('fetch should not run when permission is denied');
  };

  const result = await context.organizeTabs(false, false, '', 1, 1, []);
  assert.equal(result.success, false);
  assert.match(result.error, /OpenAI Compatible API Host is not configured\./);
  assert.match(result.error, /Fetch models/);
  assert.equal(callOrder.includes('ungroup'), false);
  assert.equal(callOrder.includes('request'), true);
  assert.equal(callOrder.at(-1), 'contains');
});

test('custom OpenAI base URL keeps query values with trailing slashes', () => {
  const { context } = loadBackground();

  assert.equal(
    context.normalizeCustomOpenAIBaseUrl('https://api.example.com/v1?sig=abc/'),
    'https://api.example.com/v1?sig=abc/'
  );
});

test('local model responses stream before they are parsed', async () => {
  const { context } = loadBackground();
  const encoder = new TextEncoder();
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: '[{"groupName":"Local","tabIndices":' } }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: { content: '[1,2]}]' } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].map(chunk => encoder.encode(chunk));
  let requestBody = null;

  context.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    let index = 0;
    return {
      ok: true,
      headers: { get: () => 'text/event-stream; charset=utf-8' },
      body: {
        getReader: () => ({
          read: async () => index < chunks.length
            ? { value: chunks[index++], done: false }
            : { value: undefined, done: true },
        }),
      },
    };
  };

  const groups = await context.callLocalModel(
    'http://localhost:11434/v1',
    'test-model',
    [
      { title: 'One', url: 'https://example.com/one' },
      { title: 'Two', url: 'https://example.com/two' },
    ],
    '',
    null,
    1
  );

  assert.equal(requestBody.stream, true);
  assert.equal(groups[0].groupName, 'Local');
  assert.deepEqual(Array.from(groups[0].tabIndices), [1, 2]);
});

test('local model retries share one total timeout', async () => {
  const { context } = loadBackground();
  const clockValues = [0, 0, 180001];
  let fetchCount = 0;
  context.Date = { now: () => clockValues.shift() ?? 180001 };
  context.fetch = async () => {
    fetchCount++;
    return {
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: 'not valid grouping JSON' } }] }),
    };
  };

  await assert.rejects(
    context.callLocalModel(
      'http://localhost:11434/v1',
      'test-model',
      [{ title: 'One', url: 'https://example.com/one' }],
      '',
      null,
      1
    ),
    /timed out after 180s/
  );
  assert.equal(fetchCount, 1);
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
    prGroupColor: 'purple',
    ignoreQuery: true,
    ignoreHash: true,
  });
  chrome.windows.get = async (id) => ({ id });
  const prGroup = { id: 27, title: 'PRs', color: 'blue' };
  chrome.tabGroups.query = async () => [{ ...prGroup }];
  chrome.tabGroups.update = async (id, updates) => {
    assert.equal(id, prGroup.id);
    Object.assign(prGroup, updates);
  };
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
  assert.equal(prGroup.color, 'purple');
});

test('configured GitHub label colors are validated and use distinct defaults', () => {
  const { context } = loadBackground();
  const colors = context.resolveGitHubLabelGroupColors({
    bookmarksGroupColor: 'yellow',
    prGroupColor: 'blue',
    githubLabelGroupNames: ['Overdue', 'Bug', 'New Feature', 'Docs', 'Help', 'Design'],
    githubLabelGroupColors: {
      BUG: 'orange',
      overdue: 'teal',
    },
  });

  assert.equal(colors.get('overdue'), 'red');
  assert.equal(colors.get('bug'), 'orange');
  assert.equal(colors.get('new feature'), 'green');
  assert.equal(colors.get('docs'), 'purple');
  assert.equal(colors.get('help'), 'cyan');
  assert.equal(colors.get('design'), 'pink');
  assert.equal(new Set(colors.values()).size, 6);
  assert.equal(Array.from(colors.values()).includes('yellow'), false);
  assert.equal(Array.from(colors.values()).includes('blue'), false);
  assert.equal(Array.from(colors.values()).includes('grey'), false);

  const specialNameColors = context.resolveGitHubLabelGroupColors({
    githubLabelGroupNames: ['__proto__'],
    githubLabelGroupColors: Object.fromEntries([['__proto__', 'orange']]),
  });
  assert.equal(specialNameColors.get('__proto__'), 'orange');

  const scopedDescriptors = context.getManagedTabGroupDescriptors({
    githubLabelGroupsEnabled: true,
    closedIssueGroupEnabled: true,
    githubLabelGroupNames: ['Bug'],
  }, { includeLabelGroups: false });
  assert.deepEqual(Array.from(scopedDescriptors, descriptor => descriptor.title), [
    'BOOKMARKS', 'PRs', 'Closed'
  ]);
});

test('toolbar click passes the label-group sync preference to either click mode', async () => {
  const { chrome, context } = loadBackground();
  const calls = [];
  let settings = { organizeOnClick: false, githubLabelGroupsOnClick: false };
  chrome.storage.local.get = async () => ({ ...settings });
  context.runDedupeAndTidyPinned = async (windowId, options) => calls.push({ mode: 'tidy', windowId, options });
  context.runOrganizeWithFeedback = async (windowId, options) => calls.push({ mode: 'organize', windowId, options });

  await chrome.action.onClicked.emit({ windowId: 7 });
  assert.equal(calls[0].mode, 'tidy');
  assert.equal(calls[0].windowId, 7);
  assert.equal(calls[0].options.includeLabelGroups, false);

  settings = { organizeOnClick: true };
  await chrome.action.onClicked.emit({ windowId: 8 });
  assert.equal(calls[1].mode, 'organize');
  assert.equal(calls[1].windowId, 8);
  assert.equal(calls[1].options.includeLabelGroups, true);
});

test('the toolbar label gate leaves Closed and manual label sync available', async () => {
  const { chrome, context } = loadBackground();
  const settings = {
    githubToken: 'github-token',
    prGroupEnabled: false,
    closedIssueGroupEnabled: true,
    githubLabelGroupsEnabled: true,
    githubLabelGroupNames: ['Bug'],
    githubManagedLabelGroupNamesByWindow: {},
  };
  const calls = [];
  chrome.storage.local.get = async () => ({ ...settings });
  context.syncGitHubIssueTabGroups = async (windowId, overrides) => {
    calls.push({ windowId, overrides });
    return { success: true, preservedTabIds: [] };
  };

  await context.syncEnabledGitHubTabGroups(1, {
    includePr: false,
    includeIssues: true,
    includeLabelGroups: false,
  });
  assert.equal(calls[0].overrides.closedIssueGroupEnabled, true);
  assert.equal(calls[0].overrides.githubLabelGroupsEnabled, false);

  await context.syncGitHubLabelTabGroups(1);
  assert.equal(calls[1].overrides.githubLabelGroupsEnabled, true);

  const prCalls = [];
  settings.prGroupEnabled = true;
  context.syncPrTabGroup = async (windowId, presentationOptions) => {
    prCalls.push({ windowId, presentationOptions });
    return { success: true };
  };
  await context.syncEnabledGitHubTabGroups(1, {
    includePr: true,
    includeIssues: false,
    includeLabelGroups: false,
  });
  assert.equal(prCalls[0].presentationOptions.includeLabelGroups, false);
});

test('managed groups are colored and ordered before unrelated groups', async () => {
  const { chrome, context } = loadBackground();
  const groups = new Map([
    [10, { id: 10, title: 'Bug', color: 'blue' }],
    [11, { id: 11, title: 'Other', color: 'pink' }],
    [12, { id: 12, title: 'prs', color: 'grey' }],
    [13, { id: 13, title: 'bookmarks', color: 'red' }],
    [14, { id: 14, title: 'Overdue', color: 'yellow' }],
    [15, { id: 15, title: 'Closed', color: 'green' }],
  ]);
  let groupOrder = [10, 11, 12, 13, 14, 15];
  let moveCount = 0;
  const currentTabs = () => [
    { id: 1, windowId: 1, index: 0, groupId: -1, pinned: true },
    ...groupOrder.map((groupId, index) => ({
      id: groupId + 100,
      windowId: 1,
      index: index + 1,
      groupId,
      pinned: false,
    })),
  ];

  chrome.storage.local.get = async () => ({
    bookmarksGroupColor: 'yellow',
    prGroupColor: 'purple',
    githubLabelGroupsEnabled: true,
    closedIssueGroupEnabled: true,
    githubLabelGroupNames: ['Overdue', 'Missing', 'Bug'],
    githubLabelGroupColors: { overdue: 'red', bug: 'cyan' },
  });
  chrome.tabs.query = async () => currentTabs().map(tab => ({ ...tab }));
  chrome.tabGroups.query = async () => Array.from(groups.values(), group => ({ ...group }));
  chrome.tabGroups.update = async (id, updates) => Object.assign(groups.get(id), updates);
  chrome.tabGroups.move = async (id, { index }) => {
    moveCount++;
    groupOrder = groupOrder.filter(groupId => groupId !== id);
    groupOrder.splice(Math.max(0, index - 1), 0, id);
    return { ...groups.get(id) };
  };

  await context.reconcileManagedTabGroups(1);
  assert.deepEqual(groupOrder.map(id => groups.get(id).title), [
    'BOOKMARKS', 'PRs', 'Overdue', 'Bug', 'Closed', 'Other'
  ]);
  assert.equal(groups.get(13).color, 'yellow');
  assert.equal(groups.get(12).color, 'purple');
  assert.equal(groups.get(14).color, 'red');
  assert.equal(groups.get(10).color, 'cyan');
  assert.equal(groups.get(15).color, 'grey');

  const firstMoveCount = moveCount;
  assert.equal(firstMoveCount > 0, true);
  await context.reconcileManagedTabGroups(1);
  assert.deepEqual(groupOrder.map(id => groups.get(id).title), [
    'BOOKMARKS', 'PRs', 'Overdue', 'Bug', 'Closed', 'Other'
  ]);
  assert.equal(moveCount, firstMoveCount);
});

test('GitHub label settings normalize names and apply Closed before label priority', () => {
  const { context } = loadBackground();

  assert.deepEqual(
    Array.from(context.normalizeGitHubLabelGroupNames([
      ' Overdue ', 'overdue', 'PRs', 'New Feature', 'Misc', '', 'Bug'
    ])),
    ['Overdue', 'New Feature', 'Bug']
  );

  const openIssue = { state: 'open', labels: ['Bug', { name: 'Overdue', color: 'd73a4a' }] };
  const openGroup = context.selectGitHubIssueGroup(openIssue, ['Overdue', 'Bug'], false);
  assert.equal(openGroup.title, 'Overdue');
  assert.equal(Object.hasOwn(openGroup, 'color'), false);

  const closedGroup = context.selectGitHubIssueGroup(
    { ...openIssue, state: 'closed' },
    ['Overdue', 'Bug'],
    true
  );
  assert.equal(closedGroup.title, 'Closed');
  assert.equal(Object.hasOwn(closedGroup, 'color'), false);
  assert.equal(
    context.selectGitHubIssueGroup({ ...openIssue, isPullRequest: true }, ['Overdue', 'Bug'], true),
    null
  );
});

test('dedupe runs before GitHub issue labels and assigns the first matching group', async () => {
  const { chrome, context } = loadBackground();
  const settings = {
    githubToken: 'github-token',
    githubLabelGroupsEnabled: true,
    githubLabelGroupNames: ['Overdue', 'Daily', 'Bug', 'New Feature'],
    githubLabelGroupColors: {
      overdue: 'purple',
      daily: 'pink',
      bug: 'orange',
      'new feature': 'cyan',
    },
    githubManagedLabelGroupNamesByWindow: {},
    closedIssueGroupEnabled: false,
    prGroupEnabled: false,
    ignoreQuery: true,
    ignoreHash: true,
    reloadTabs: false,
  };
  const tabs = [
    { id: 1, windowId: 1, index: 0, title: 'Issue 1 comment 11', url: 'https://github.com/Expensify/Expensify/issues/1#issuecomment-11', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 11 },
    { id: 2, windowId: 1, index: 1, title: 'Issue 1 comment 12', url: 'https://github.com/Expensify/Expensify/issues/1#issuecomment-12', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 12 },
    { id: 3, windowId: 1, index: 2, title: 'Issue 2', url: 'https://github.com/example/other-repo/issues/2#issuecomment-42', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 13 },
    { id: 4, windowId: 1, index: 3, title: 'Issue 3', url: 'https://github.com/Expensify/Expensify/issues/3#issuecomment-99', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 14 },
    { id: 5, windowId: 1, index: 4, title: 'Issue 4', url: 'https://github.com/Expensify/Expensify/issues/4#issuecomment-101', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 15 },
  ];
  const groups = [];
  const events = [];
  let nextGroupId = 100;

  chrome.storage.local.get = async () => ({ ...settings });
  chrome.storage.local.set = async (updates) => Object.assign(settings, updates);
  chrome.windows.get = async (id) => ({ id });
  chrome.tabs.query = async (query) => {
    if (Number.isInteger(query.groupId)) {
      return tabs.filter(tab => tab.groupId === query.groupId).map(tab => ({ ...tab }));
    }
    if (query.windowId === 1 || query.currentWindow === true) {
      return tabs.map(tab => ({ ...tab }));
    }
    return [];
  };
  chrome.tabs.get = async (id) => {
    const tab = tabs.find(candidate => candidate.id === id);
    if (!tab) throw new Error(`No tab with id: ${id}`);
    return { ...tab };
  };
  chrome.tabs.remove = async (id) => {
    events.push(`remove:${id}`);
    const index = tabs.findIndex(tab => tab.id === id);
    if (index >= 0) tabs.splice(index, 1);
  };
  chrome.tabs.group = async ({ groupId, tabIds }) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    let resolvedGroupId = groupId;
    if (!Number.isInteger(resolvedGroupId)) {
      resolvedGroupId = nextGroupId++;
      groups.push({ id: resolvedGroupId, title: '', color: 'grey' });
    }
    for (const id of ids) {
      const tab = tabs.find(candidate => candidate.id === id);
      if (tab) tab.groupId = resolvedGroupId;
    }
    return resolvedGroupId;
  };
  chrome.tabs.ungroup = async (ids) => {
    for (const id of ids) {
      const tab = tabs.find(candidate => candidate.id === id);
      if (tab) tab.groupId = -1;
    }
  };
  chrome.tabGroups.query = async () => groups.map(group => ({ ...group }));
  chrome.tabGroups.update = async (id, updates) => {
    const validColors = new Set(['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange']);
    if (updates.color !== undefined) assert.equal(validColors.has(updates.color), true);
    const group = groups.find(candidate => candidate.id === id);
    if (group) Object.assign(group, updates);
  };

  const issueData = {
    1: { state: 'open', labels: [{ name: 'Daily', color: 'fbca04' }, { name: 'Bug', color: '0e8a16' }, { name: 'Overdue', color: 'd73a4a' }] },
    2: { state: 'open', labels: [{ name: 'Weekly', color: '5319e7' }, { name: 'New Feature', color: '0075ca' }, { name: 'Overdue', color: '0075ca' }] },
    3: { state: 'open', labels: [{ name: 'Weekly', color: '5319e7' }, { name: 'New Feature', color: '0075ca' }] },
    4: { state: 'open', labels: [{ name: 'Monthly', color: 'fbca04' }, { name: 'Bug', color: '0e8a16' }] },
  };
  context.fetch = async (url) => {
    const match = url.match(/\/issues\/(\d+)$/);
    if (!match) throw new Error(`Unexpected URL: ${url}`);
    const issueNumber = Number(match[1]);
    events.push(`fetch:${issueNumber}`);
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => issueData[issueNumber],
    };
  };

  const result = await context.dedupeAndSyncGitHubLabelTabGroups(1);

  assert.equal(result.success, true);
  assert.equal(result.duplicateClosedCount, 1);
  assert.deepEqual(tabs.map(tab => tab.id), [2, 3, 4, 5]);
  assert.ok(events.indexOf('remove:1') < events.findIndex(event => event.startsWith('fetch:')));
  assert.equal(events.filter(event => event.startsWith('fetch:')).length, 4);

  const tabIdsByGroupTitle = Object.fromEntries(groups
    .filter(group => group.title)
    .map(group => [
      group.title,
      tabs.filter(tab => tab.groupId === group.id).map(tab => tab.id).sort((a, b) => a - b),
    ]));
  assert.deepEqual(tabIdsByGroupTitle, {
    Overdue: [2, 3],
    'New Feature': [4],
    Bug: [5],
  });
  assert.equal(groups.find(group => group.title === 'Overdue').color, 'purple');
  assert.equal(groups.find(group => group.title === 'New Feature').color, 'cyan');
  assert.equal(groups.find(group => group.title === 'Bug').color, 'orange');
  assert.equal(groups.some(group => group.title === 'Daily'), false);

  const overdueGroup = groups.find(group => group.title === 'Overdue');
  overdueGroup.color = 'grey';
  const recolorResult = await context.syncGitHubIssueTabGroups(1);
  assert.equal(recolorResult.success, true);
  assert.equal(recolorResult.movedCount, 0);
  assert.equal(overdueGroup.color, 'purple');

  const groupTitleForTab = (tabId) => {
    const tab = tabs.find(candidate => candidate.id === tabId);
    return groups.find(group => group.id === tab.groupId)?.title || null;
  };

  issueData[4].state = 'closed';
  settings.closedIssueGroupEnabled = true;
  const requestsBeforeClosedSync = events.filter(event => event.startsWith('fetch:')).length;
  const closedResult = await context.syncGitHubIssueTabGroups(1);
  assert.equal(closedResult.success, true);
  assert.equal(events.filter(event => event.startsWith('fetch:')).length - requestsBeforeClosedSync, 4);
  assert.equal(groupTitleForTab(5), 'Closed');

  issueData[4].state = 'open';
  await context.syncGitHubIssueTabGroups(1);
  assert.equal(groupTitleForTab(5), 'Bug');

  settings.githubLabelGroupNames = ['Bug', 'Overdue', 'New Feature'];
  await context.syncGitHubIssueTabGroups(1);
  assert.equal(groupTitleForTab(2), 'Bug');
  assert.equal(groupTitleForTab(3), 'Overdue');

  settings.githubLabelGroupNames = ['Escalated'];
  tabs.find(tab => tab.id === 2).pinned = true;
  tabs.find(tab => tab.id === 3).splitViewId = 17;
  await context.syncGitHubIssueTabGroups(1);
  assert.equal(groupTitleForTab(2), 'Bug');
  assert.equal(groupTitleForTab(3), 'Overdue');
  assert.equal(groupTitleForTab(4), null);
  assert.equal(groupTitleForTab(5), null);

  tabs.find(tab => tab.id === 2).pinned = false;
  tabs.find(tab => tab.id === 3).splitViewId = -1;
  await context.syncGitHubIssueTabGroups(1);
  assert.equal(tabs.every(tab => tab.groupId === -1), true);
  assert.deepEqual(Object.keys(settings.githubManagedLabelGroupNamesByWindow), []);
});

test('Closed-only refresh does not assign enabled label groups', async () => {
  const { chrome, context } = loadBackground();
  const settings = {
    githubToken: 'github-token',
    githubLabelGroupsEnabled: true,
    githubLabelGroupNames: ['Bug'],
    githubManagedLabelGroupNamesByWindow: {},
    closedIssueGroupEnabled: false,
  };
  const tabs = [
    { id: 21, windowId: 1, url: 'https://github.com/example/project/issues/1', groupId: -1, pinned: false, splitViewId: -1 },
    { id: 22, windowId: 1, url: 'https://github.com/example/project/issues/2', groupId: -1, pinned: false, splitViewId: -1 },
  ];
  const groups = [];

  chrome.storage.local.get = async () => ({ ...settings });
  chrome.storage.local.set = async (updates) => Object.assign(settings, updates);
  chrome.windows.get = async (id) => ({ id });
  chrome.tabs.query = async (query) => {
    if (Number.isInteger(query.groupId)) return tabs.filter(tab => tab.groupId === query.groupId).map(tab => ({ ...tab }));
    return tabs.map(tab => ({ ...tab }));
  };
  chrome.tabs.get = async (id) => ({ ...tabs.find(tab => tab.id === id) });
  chrome.tabs.group = async ({ groupId, tabIds }) => {
    const resolvedGroupId = Number.isInteger(groupId) ? groupId : 300;
    if (!groups.some(group => group.id === resolvedGroupId)) groups.push({ id: resolvedGroupId, title: '', color: 'grey' });
    for (const tabId of tabIds) tabs.find(tab => tab.id === tabId).groupId = resolvedGroupId;
    return resolvedGroupId;
  };
  chrome.tabs.ungroup = async (ids) => {
    for (const tabId of ids) tabs.find(tab => tab.id === tabId).groupId = -1;
  };
  chrome.tabGroups.query = async () => groups.map(group => ({ ...group }));
  chrome.tabGroups.update = async (id, updates) => Object.assign(groups.find(group => group.id === id), updates);
  context.fetch = async (url) => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({
      state: url.endsWith('/issues/2') ? 'closed' : 'open',
      labels: [{ name: 'Bug' }],
    }),
  });

  const result = await context.syncClosedIssueTabGroup(1);
  assert.equal(result.success, true);
  assert.equal(result.labelMatchedCount, 0);
  assert.equal(tabs.find(tab => tab.id === 21).groupId, -1);
  assert.equal(groups.find(group => group.id === tabs.find(tab => tab.id === 22).groupId).title, 'Closed');
  assert.equal(groups.some(group => group.title === 'Bug'), false);
});

test('a tab that navigates during grouping is removed from the managed group', async () => {
  const { chrome, context } = loadBackground();
  const settings = {
    githubToken: 'github-token',
    githubLabelGroupsEnabled: true,
    githubLabelGroupNames: ['Bug'],
    githubManagedLabelGroupNamesByWindow: {},
    closedIssueGroupEnabled: false,
  };
  const tab = {
    id: 31,
    windowId: 1,
    url: 'https://github.com/example/project/issues/1',
    groupId: -1,
    pinned: false,
    splitViewId: -1,
  };
  const groups = [];

  chrome.storage.local.get = async () => ({ ...settings });
  chrome.storage.local.set = async (updates) => Object.assign(settings, updates);
  chrome.windows.get = async (id) => ({ id });
  chrome.tabs.query = async () => [{ ...tab }];
  chrome.tabs.get = async () => ({ ...tab });
  chrome.tabs.group = async () => {
    tab.groupId = 400;
    tab.url = 'https://example.com/navigated';
    groups.push({ id: 400, title: '', color: 'grey' });
    return 400;
  };
  chrome.tabs.ungroup = async () => { tab.groupId = -1; };
  chrome.tabGroups.query = async () => groups.map(group => ({ ...group }));
  chrome.tabGroups.update = async (id, updates) => Object.assign(groups.find(group => group.id === id), updates);
  context.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ state: 'open', labels: [{ name: 'Bug' }] }),
  });

  const result = await context.syncGitHubIssueTabGroups(1);
  assert.equal(result.success, true);
  assert.equal(result.movedCount, 0);
  assert.equal(tab.groupId, -1);
});

test('managed GitHub label history remains scoped to each window', async () => {
  const { chrome, context } = loadBackground();
  const settings = {
    githubLabelGroupsEnabled: true,
    githubLabelGroupNames: [],
    githubManagedLabelGroupNamesByWindow: { 2: ['Bug'] },
  };
  chrome.storage.local.get = async () => ({ ...settings });
  chrome.storage.local.set = async (updates) => Object.assign(settings, updates);

  await context.setManagedGitHubLabelGroupNames(1, ['Overdue']);
  assert.deepEqual(Array.from(settings.githubManagedLabelGroupNamesByWindow['1']), ['Overdue']);
  assert.deepEqual(settings.githubManagedLabelGroupNamesByWindow['2'], ['Bug']);

  await context.setManagedGitHubLabelGroupNames(1, []);
  assert.equal(settings.githubManagedLabelGroupNamesByWindow['1'], undefined);
  assert.deepEqual(settings.githubManagedLabelGroupNamesByWindow['2'], ['Bug']);
  assert.equal(context.getAlwaysPreservedGroupNames(settings, 1).has('BUG'), false);
  assert.equal(context.getAlwaysPreservedGroupNames(settings, 2).has('BUG'), true);
});

test('partial GitHub errors preserve failed tabs from AI and managed groups from Ungroup All', async () => {
  const { chrome, context } = loadBackground();
  const settings = {
    githubToken: 'github-token',
    githubLabelGroupsEnabled: true,
    githubLabelGroupNames: ['Bug'],
    closedIssueGroupEnabled: false,
    prGroupEnabled: false,
    ignoreQuery: true,
    ignoreHash: true,
    reloadTabs: false,
    openaiKey: 'openai-key',
    openaiModel: 'test-model',
    aiProvider: 'openai',
    aiFallbackEnabled: false,
    preserveGroups: false,
    mergeIntoExisting: false,
    sortTabsWithinGroupsByTitle: false,
  };
  const tabs = [
    { id: 11, windowId: 1, index: 0, title: 'Bug issue', url: 'https://github.com/example/project/issues/1', groupId: -1, pinned: false, splitViewId: -1 },
    { id: 12, windowId: 1, index: 1, title: 'Private issue', url: 'https://github.com/example/project/issues/2', groupId: 250, pinned: false, splitViewId: -1 },
    { id: 13, windowId: 1, index: 2, title: 'Docs one', url: 'https://example.com/docs/one', groupId: -1, pinned: false, splitViewId: -1 },
    { id: 14, windowId: 1, index: 3, title: 'Docs two', url: 'https://example.com/docs/two', groupId: -1, pinned: false, splitViewId: -1 },
  ];
  const groups = [{ id: 250, title: '', color: 'grey' }];
  let nextGroupId = 200;

  chrome.storage.local.get = async () => ({ ...settings });
  chrome.storage.local.set = async (updates) => Object.assign(settings, updates);
  chrome.windows.get = async (id) => ({ id });
  chrome.tabs.query = async (query) => {
    if (Number.isInteger(query.groupId)) {
      return tabs.filter(tab => tab.groupId === query.groupId).map(tab => ({ ...tab }));
    }
    if (query.windowId === 1 || query.currentWindow === true) {
      return tabs.map(tab => ({ ...tab }));
    }
    return [];
  };
  chrome.tabs.get = async (id) => {
    const tab = tabs.find(candidate => candidate.id === id);
    if (!tab) throw new Error(`No tab with id: ${id}`);
    return { ...tab };
  };
  chrome.tabs.group = async ({ groupId, tabIds }) => {
    const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
    let resolvedGroupId = groupId;
    if (!Number.isInteger(resolvedGroupId)) {
      resolvedGroupId = nextGroupId++;
      groups.push({ id: resolvedGroupId, title: '', color: 'grey' });
    }
    for (const id of ids) {
      const tab = tabs.find(candidate => candidate.id === id);
      if (tab) tab.groupId = resolvedGroupId;
    }
    return resolvedGroupId;
  };
  chrome.tabs.ungroup = async (ids) => {
    for (const id of ids) {
      const tab = tabs.find(candidate => candidate.id === id);
      if (tab) tab.groupId = -1;
    }
  };
  chrome.tabGroups.query = async () => groups.filter(group => tabs.some(tab => tab.groupId === group.id)).map(group => ({ ...group }));
  chrome.tabGroups.update = async (id, updates) => {
    const group = groups.find(candidate => candidate.id === id);
    if (group) Object.assign(group, updates);
  };

  context.fetch = async (url) => {
    if (url.endsWith('/issues/1')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ state: 'open', labels: [{ name: 'Bug' }] }),
      };
    }
    if (url.endsWith('/issues/2')) {
      return {
        ok: false,
        status: 404,
        headers: { get: () => null },
        json: async () => ({ message: 'Not Found' }),
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const githubResult = await context.syncGitHubIssueTabGroups(1);
  assert.equal(githubResult.success, true);
  assert.deepEqual(Array.from(githubResult.preservedTabIds), [12]);
  assert.equal(groups.find(group => group.id === tabs.find(tab => tab.id === 11).groupId)?.title, 'Bug');
  assert.equal(tabs.find(tab => tab.id === 12).groupId, 250);

  let aiPrompt = '';
  context.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    const requestBody = JSON.parse(init.body);
    aiPrompt = requestBody.messages[0].content;
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '[{"groupName":"Docs","tabIndices":[1,2]}]' } }],
      }),
    };
  };

  const organizeResult = await context.organizeTabs(false, false, '', 0, 1, githubResult.preservedTabIds);
  assert.equal(organizeResult.success, true);
  assert.doesNotMatch(aiPrompt, /Private issue|github\.com\/example\/project\/issues\/2/);
  assert.match(aiPrompt, /Docs one/);
  assert.match(aiPrompt, /Docs two/);
  assert.equal(tabs.find(tab => tab.id === 12).groupId, 250);

  const bugGroupId = groups.find(group => group.title === 'Bug').id;
  const docsGroupId = groups.find(group => group.title === 'Docs').id;
  const ungroupResult = await context.ungroupTabs();
  assert.equal(ungroupResult.success, true);
  assert.equal(tabs.find(tab => tab.id === 11).groupId, bugGroupId);
  assert.equal(tabs.some(tab => tab.groupId === docsGroupId), false);

  const navigatedTab = tabs.find(tab => tab.id === 11);
  const eventTab = { ...navigatedTab };
  navigatedTab.url = 'https://example.com/not-an-issue';
  const removedFromManagedGroup = await context.removeNavigatedTabFromManagedGitHubGroup(
    navigatedTab.id,
    navigatedTab.url,
    eventTab
  );
  assert.equal(removedFromManagedGroup, true);
  assert.equal(navigatedTab.groupId, -1);
});

// Auto-organize tests drive the registered listeners with a controllable clock.
function setupAutoOrganize(settings) {
  const { chrome, context } = loadBackground();
  const state = { settings: { ...settings }, timers: [], alarms: new Map(), cleared: [], runs: [] };
  const windowTabs = new Map([
    [1, [{ id: 11, windowId: 1, url: 'https://example.com/one' }]],
    [2, [{ id: 21, windowId: 2, url: 'https://example.com/two' }]],
  ]);
  chrome.storage.local.get = async () => ({ ...state.settings });
  chrome.tabs.query = async (query) => (windowTabs.get(query?.windowId) || []).map(tab => ({ ...tab }));
  chrome.alarms.create = (name, options) => { state.alarms.set(name, options); };
  chrome.alarms.clear = (name) => { state.cleared.push(name); state.alarms.delete(name); };
  chrome.alarms.getAll = async () => Array.from(state.alarms.keys(), name => ({ name }));
  context.setTimeout = (callback, ms) => {
    const timer = { callback, ms, cleared: false };
    state.timers.push(timer);
    return timer;
  };
  context.clearTimeout = (timer) => { if (timer) timer.cleared = true; };
  context.runOrganizeWithFeedback = async (windowId) => { state.runs.push(windowId); };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const activeTimers = () => {
    const autoTimers = new Set(vm.runInContext('Array.from(autoOrganizeTimers.values())', context));
    return state.timers.filter(timer => !timer.cleared && autoTimers.has(timer));
  };
  const fireTimers = async () => {
    for (const timer of activeTimers()) {
      timer.cleared = true;
      timer.callback();
    }
    await flush();
  };
  return { chrome, context, state, windowTabs, flush, activeTimers, fireTimers };
}

test('auto-organize does nothing when the setting was never enabled', async () => {
  const world = setupAutoOrganize({});
  await world.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await world.flush();
  assert.equal(world.activeTimers().length, 0);
  assert.equal(world.state.alarms.size, 0);
  assert.deepEqual(world.state.runs, []);
});

test('disabling auto-organize cancels a queued timer before it runs', async () => {
  const world = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 5 });
  await world.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await world.flush();
  assert.equal(world.activeTimers().length, 1);
  assert.equal(world.activeTimers()[0].ms, 5000);

  world.state.settings.autoOrganizeEnabled = false;
  await world.chrome.storage.onChanged.emit({ autoOrganizeEnabled: { newValue: false, oldValue: true } }, 'local');
  await world.flush();

  assert.equal(world.activeTimers().length, 0);
  await world.fireTimers();
  assert.deepEqual(world.state.runs, []);
});

test('disable then re-enable cancels alarms, including ones from before a worker restart', async () => {
  const world = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 60 });
  await world.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await world.flush();
  assert.equal(world.state.alarms.get('autoOrganize_1')?.delayInMinutes, 1);
  // Simulates an alarm persisted by Chrome from a previous service-worker lifetime.
  world.state.alarms.set('autoOrganize_2', { delayInMinutes: 1 });

  world.state.settings.autoOrganizeEnabled = false;
  await world.chrome.storage.onChanged.emit({ autoOrganizeEnabled: { newValue: false, oldValue: true } }, 'local');
  await world.flush();
  assert.equal(world.state.alarms.size, 0);

  world.state.settings.autoOrganizeEnabled = true;
  await world.chrome.storage.onChanged.emit({ autoOrganizeEnabled: { newValue: true, oldValue: false } }, 'local');
  await world.flush();
  assert.equal(world.state.alarms.size, 0);
  assert.deepEqual(world.state.runs, []);
});

test('a tab opened near the deadline leaves exactly one pending run', async () => {
  const world = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 5 });
  const pendingReads = [];
  world.chrome.storage.local.get = () => new Promise(resolve => pendingReads.push(resolve));

  await world.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await world.chrome.tabs.onCreated.emit({ id: 12, windowId: 1 });
  // Resolve the settings reads out of order: the older scheduling must not install a timer.
  pendingReads[1]({ ...world.state.settings });
  pendingReads[0]({ ...world.state.settings });
  await world.flush();

  assert.equal(world.activeTimers().length, 1);
  world.chrome.storage.local.get = async () => ({ ...world.state.settings });
  await world.fireTimers();
  assert.deepEqual(world.state.runs, [1]);
});

test('delays of 30 seconds or more use alarms; shorter delays use a timer', async () => {
  const atThreshold = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 30 });
  await atThreshold.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await atThreshold.flush();
  assert.equal(atThreshold.state.alarms.get('autoOrganize_1')?.delayInMinutes, 0.5);
  assert.equal(atThreshold.activeTimers().length, 0);

  await atThreshold.chrome.alarms.onAlarm.emit({ name: 'autoOrganize_1' });
  await atThreshold.flush();
  assert.deepEqual(atThreshold.state.runs, [1]);

  const belowThreshold = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 29 });
  await belowThreshold.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await belowThreshold.flush();
  assert.equal(belowThreshold.state.alarms.size, 0);
  assert.equal(belowThreshold.activeTimers()[0].ms, 29000);
});

test('each window is scheduled and organized independently', async () => {
  const world = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 5 });
  const pendingReads = [];
  world.chrome.storage.local.get = () => new Promise(resolve => pendingReads.push(resolve));

  await world.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await world.chrome.tabs.onCreated.emit({ id: 21, windowId: 2 });
  for (const resolve of pendingReads) resolve({ ...world.state.settings });
  await world.flush();

  assert.equal(world.activeTimers().length, 2);
  world.chrome.storage.local.get = async () => ({ ...world.state.settings });
  await world.fireTimers();
  assert.deepEqual([...world.state.runs].sort(), [1, 2]);
});

test('a loading first tab is scheduled and organized once its URL commits', async () => {
  const world = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 5 });
  world.windowTabs.set(3, [{ id: 31, windowId: 3, url: '', pendingUrl: 'https://example.com/new' }]);

  await world.chrome.tabs.onCreated.emit({ id: 31, windowId: 3, pendingUrl: 'https://example.com/new' });
  await world.flush();
  assert.equal(world.activeTimers().length, 1);

  world.windowTabs.set(3, [{ id: 31, windowId: 3, url: 'https://example.com/new' }]);
  await world.fireTimers();
  assert.deepEqual(world.state.runs, [3]);
});

test('a window without organizable tabs at the deadline is not organized', async () => {
  const world = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 5 });
  world.windowTabs.set(4, [{ id: 41, windowId: 4, url: 'chrome://newtab/' }]);

  await world.chrome.tabs.onCreated.emit({ id: 41, windowId: 4 });
  await world.flush();
  await world.fireTimers();
  assert.deepEqual(world.state.runs, []);
});

test('a deadline during another organization is retried when that run finishes', async () => {
  const world = setupAutoOrganize({ autoOrganizeEnabled: true, autoOrganizeDelay: 5 });
  const realRun = world.context.runOrganizeWithFeedback;
  vm.runInContext('isOrganizing = true', world.context);

  await world.chrome.tabs.onCreated.emit({ id: 11, windowId: 1 });
  await world.flush();
  await world.fireTimers();
  assert.deepEqual(world.state.runs, []);
  assert.equal(vm.runInContext('autoOrganizePending.get(1)', world.context), true);

  // The active organization finishes; its cleanup must reschedule the queued window.
  vm.runInContext('isOrganizing = false', world.context);
  delete world.context.runOrganizeWithFeedback;
  await vm.runInContext('runOrganizeWithFeedback', world.context)(1);
  world.context.runOrganizeWithFeedback = realRun;
  await world.flush();

  assert.equal(world.activeTimers().length, 1);
  await world.fireTimers();
  assert.deepEqual(world.state.runs, [1]);
});

function withChromeAiResponses(context, responses) {
  const prompts = [];
  context.LanguageModel = {
    availability: async () => 'available',
    create: async () => ({
      prompt: async (prompt, options) => {
        prompts.push({ prompt, options });
        return responses[prompts.length - 1];
      },
      destroy() {},
    }),
  };
  return prompts;
}

test('Chrome AI keeps valid groups when a constrained response has empty groups', async () => {
  const { context } = loadBackground();
  const prompts = withChromeAiResponses(context, [
    '[{"groupName":"Docs","tabIndices":[1,2]},{"groupName":"Nothing","tabIndices":[]}]',
  ]);
  const tabs = [
    { title: 'Docs one', url: 'https://example.com/one' },
    { title: 'Docs two', url: 'https://example.com/two' },
  ];

  const groups = await context.callChromeAI(tabs, '', null, 1);

  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].options.responseConstraint.type, 'array');
  assert.deepEqual(JSON.parse(JSON.stringify(groups)), [{ groupName: 'Docs', tabIndices: [1, 2] }]);
});

test('Chrome AI tolerates an empty batch and shifts later batch indices', async () => {
  const { context } = loadBackground();
  const batchSize = vm.runInContext('CHROME_AI_TABS_PER_BATCH', context);
  const tabs = Array.from({ length: batchSize + 2 }, (_, i) => ({
    title: `Tab ${i + 1}`,
    url: `https://example.com/${i + 1}`,
  }));
  withChromeAiResponses(context, ['[]', '[{"groupName":"Tail","tabIndices":[1,"2"]}]']);

  const groups = await context.callChromeAI(tabs, '', null, 1);

  assert.deepEqual(
    JSON.parse(JSON.stringify(groups)),
    [{ groupName: 'Tail', tabIndices: [batchSize + 1, batchSize + 2] }]
  );
});

test('Chrome AI still rejects responses that are not tab groups', async () => {
  const { context } = loadBackground();
  withChromeAiResponses(context, ['{"message":"sorry"}']);
  await assert.rejects(
    context.callChromeAI([{ title: 'A', url: 'https://example.com/' }], '', null, 1),
    /Invalid response format from Chrome built-in AI/
  );
});
