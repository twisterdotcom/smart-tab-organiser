'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const HOST_ACCESS_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'host-access.js'),
  'utf8'
);

function loadHostAccess() {
  const context = { URL };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(HOST_ACCESS_SOURCE, context, { filename: 'host-access.js' });
  return context.HostAccess;
}

test('plain HTTP is allowed for loopback and private-network hosts', () => {
  const hostAccess = loadHostAccess();
  const allowed = [
    'http://localhost:11434/v1',
    'http://LOCALHOST:11434/v1',
    'http://box.localhost:11434/v1',
    'http://127.0.0.1:11434/v1',
    'http://127.0.0.53:11434/v1',
    'http://[::1]:11434/v1',
    'http://10.0.0.4:8000/v1',
    'http://10.255.255.254:8000/v1',
    'http://172.16.0.9:8000/v1',
    'http://172.31.255.254:8000/v1',
    'http://192.168.1.20:11434/v1',
    'http://192.168.0.1:8000/v1',
    'http://100.64.0.1:11434/v1',   // Tailscale
    'http://100.127.255.254:11434/v1',
    'http://169.254.10.10:8000/v1',
    'http://[fd00::1]:11434/v1',    // IPv6 unique local
    'http://[fc00::abcd]:11434/v1',
    'http://[fe80::1]:11434/v1',    // IPv6 link-local
    'http://[::ffff:192.168.1.20]:11434/v1',
    'http://[0:0:0:0:0:ffff:c0a8:114]:11434/v1',
    'http://[::ffff:7f00:1]:11434/v1',   // IPv4-mapped loopback
    'http://[fdff::1]:11434/v1',          // last address in fc00::/7
  ];

  for (const url of allowed) {
    assert.equal(hostAccess.allowsPlainHttpUrl(new URL(url)), true, url);
  }
});

test('plain HTTP is refused for public hosts and near misses', () => {
  const hostAccess = loadHostAccess();
  const refused = [
    'http://example.com/v1',
    'http://8.8.8.8:80/v1',
    'http://[2001:4860:4860::8888]/v1',
    'http://ollama.example.com/v1',
    'http://10.0.0.4.example.com/v1',
    'http://172.15.0.9:8000/v1',   // just below RFC 1918 172.16.0.0/12
    'http://172.32.0.9:8000/v1',   // just above it
    'http://192.169.1.20:11434/v1',
    'http://100.63.255.255:11434/v1', // just below RFC 6598 100.64.0.0/10
    'http://100.128.0.1:11434/v1',    // just above it
    'http://169.253.10.10:8000/v1',
    'http://11.0.0.4:8000/v1',
    'http://[fe00::1]:11434/v1',    // just above fc00::/7
    'http://[fec0::1]:11434/v1',    // site-local, deprecated
    'http://[::ffff:8.8.8.8]:11434/v1',
    'http://[::]:11434/v1',         // unspecified, not loopback
    'https://192.168.1.20:11434/v1', // HTTPS never needs this allowance
  ];

  for (const url of refused) {
    assert.equal(hostAccess.allowsPlainHttpUrl(new URL(url)), false, url);
  }

  for (const hostname of ['1.2.3.4.5', '10.0.0.256', '10', '010.0.0.1', '', 'example.com', null]) {
    assert.equal(hostAccess.isPrivateNetworkHostname(hostname), false, String(hostname));
    assert.equal(hostAccess.isLoopbackHostname(hostname), false, String(hostname));
  }
});

test('only manifest loopback origins skip the runtime permission request', () => {
  const hostAccess = loadHostAccess();
  const staticOrigins = ['http://localhost:11434/v1', 'http://127.0.0.1:11434/v1'];
  const needsPermission = [
    'http://box.localhost:11434/v1',
    'http://127.0.0.2:11434/v1',
    'http://[::1]:11434/v1',
    'http://192.168.1.20:11434/v1',
    'http://10.0.0.4:8000/v1',
    'https://api.example.com/v1',
  ];

  for (const url of staticOrigins) {
    assert.equal(hostAccess.isStaticallyAllowedUrl(new URL(url)), true, url);
  }
  for (const url of needsPermission) {
    assert.equal(hostAccess.isStaticallyAllowedUrl(new URL(url)), false, url);
  }
});

test('origin patterns cover the host and port that were requested', () => {
  const hostAccess = loadHostAccess();

  assert.equal(hostAccess.originPattern(new URL('http://192.168.1.20:11434/v1')), 'http://192.168.1.20:11434/*');
  assert.equal(hostAccess.originPattern(new URL('https://api.example.com/v1')), 'https://api.example.com/*');
  assert.equal(hostAccess.originPattern(new URL('http://[::1]:11434/v1')), 'http://[::1]:11434/*');
});

test('the local model provider is limited to this computer and the local network', () => {
  const hostAccess = loadHostAccess();
  const allowed = [
    'http://localhost:11434/v1',
    'http://192.168.1.20:11434/v1',
    'https://localhost:11434/v1',
    'https://192.168.1.9:11434/v1',
  ];
  const refused = [
    'https://models.example.com/v1',
    'http://models.example.com/v1',
    'ftp://192.168.1.20/v1',
  ];

  for (const url of allowed) {
    assert.equal(hostAccess.allowsLocalProviderUrl(new URL(url)), true, url);
  }
  for (const url of refused) {
    assert.equal(hostAccess.allowsLocalProviderUrl(new URL(url)), false, url);
  }
});

test('the HTTP hint names the ranges a user can act on', () => {
  const { ALLOWED_HTTP_HOSTS_HINT } = loadHostAccess();

  for (const fragment of ['localhost', '127.0.0.1', '10.x', '172.16-31.x', '192.168.x', '100.64-127.x']) {
    assert.ok(ALLOWED_HTTP_HOSTS_HINT.includes(fragment), fragment);
  }
});