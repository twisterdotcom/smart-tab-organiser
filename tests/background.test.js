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

test('GitHub label settings normalize names and apply Closed before label priority', () => {
  const { context } = loadBackground();

  assert.deepEqual(
    Array.from(context.normalizeGitHubLabelGroupNames([
      ' Overdue ', 'overdue', 'PRs', 'New Feature', 'Misc', '', 'Bug'
    ])),
    ['Overdue', 'New Feature', 'Bug']
  );

  const openIssue = { state: 'open', labels: ['Bug', { name: 'Overdue' }] };
  assert.equal(
    context.selectGitHubIssueGroup(openIssue, ['Overdue', 'Bug'], false),
    'Overdue'
  );
  assert.equal(
    context.selectGitHubIssueGroup({ ...openIssue, state: 'closed' }, ['Overdue', 'Bug'], true),
    'Closed'
  );
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
    githubManagedLabelGroupNames: [],
    closedIssueGroupEnabled: false,
    prGroupEnabled: false,
    ignoreQuery: true,
    ignoreHash: true,
    reloadTabs: false,
  };
  const tabs = [
    { id: 1, windowId: 1, index: 0, title: 'Issue 1 comment 11', url: 'https://github.com/Expensify/Expensify/issues/1#issuecomment-11', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 11 },
    { id: 2, windowId: 1, index: 1, title: 'Issue 1 comment 12', url: 'https://github.com/Expensify/Expensify/issues/1#issuecomment-12', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 12 },
    { id: 3, windowId: 1, index: 2, title: 'Issue 2', url: 'https://github.com/Expensify/Expensify/issues/2#issuecomment-42', groupId: -1, pinned: false, splitViewId: -1, lastAccessed: 13 },
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
    const group = groups.find(candidate => candidate.id === id);
    if (group) Object.assign(group, updates);
  };

  const issueData = {
    1: { state: 'open', labels: [{ name: 'Daily' }, { name: 'Bug' }, { name: 'Overdue' }] },
    2: { state: 'open', labels: [{ name: 'Weekly' }, { name: 'New Feature' }, { name: 'Overdue' }] },
    3: { state: 'open', labels: [{ name: 'Weekly' }, { name: 'New Feature' }] },
    4: { state: 'open', labels: [{ name: 'Monthly' }, { name: 'Bug' }] },
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
  assert.equal(groups.some(group => group.title === 'Daily'), false);

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
  assert.deepEqual(Array.from(settings.githubManagedLabelGroupNames), []);
});

test('Closed-only refresh does not assign enabled label groups', async () => {
  const { chrome, context } = loadBackground();
  const settings = {
    githubToken: 'github-token',
    githubLabelGroupsEnabled: true,
    githubLabelGroupNames: ['Bug'],
    githubManagedLabelGroupNames: [],
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
    githubManagedLabelGroupNames: [],
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
    githubManagedLabelGroupNames: [],
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
    githubManagedLabelGroupNames: [],
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
