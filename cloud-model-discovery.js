(function (g) {
  'use strict';

  var OPENAI_ID = /^(?:gpt-(?:\d+(?:\.\d+)*|4o)(?:-(?:astra|sol|terra|luna|mini|nano))?(?:-chat-latest)?|o[134](?:-mini)?)(?:-\d{4}-\d{2}-\d{2})?$/;
  var GEMINI_SPECIALIZED = /image|audio|tts|live|embedding|robotic/i;

  g.fetchCloudModels = async function (provider, apiKey) {
    if (!['openai', 'claude', 'gemini'].includes(provider)) {
      throw new Error('Unsupported cloud model provider.');
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('An API key is required for model discovery.');
    }

    var controller = new AbortController();
    var failureMessage = 'Cloud model discovery failed.';
    var timer;
    function fail(message) {
      failureMessage = message;
      throw new Error(message);
    }
    function malformed() {
      fail('The provider returned malformed model data.');
    }
    function nonemptyString(value) {
      return typeof value === 'string' && value.trim().length > 0;
    }

    async function discover() {
      var models = new Map();
      var cursors = new Set();
      var cursor = '';
      var headers;
      var baseUrl;
      if (provider === 'openai') {
        baseUrl = 'https://api.openai.com/v1/models';
        headers = { Authorization: 'Bearer ' + apiKey };
      } else if (provider === 'claude') {
        baseUrl = 'https://api.anthropic.com/v1/models?limit=100';
        headers = {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        };
      } else {
        baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000';
        headers = { 'x-goog-api-key': apiKey };
      }

      for (var page = 0; page < 20; page++) {
        controller.signal.throwIfAborted();
        var url = baseUrl;
        if (cursor) {
          url += (provider === 'claude' ? '&after_id=' : '&pageToken=') + encodeURIComponent(cursor);
        }
        var response = await fetch(url, {
          method: 'GET', headers: headers, signal: controller.signal, redirect: 'error',
        });
        if (!response.ok) fail('The provider rejected the model discovery request.');
        var body = await response.json();
        controller.signal.throwIfAborted();
        if (!body || typeof body !== 'object' || Array.isArray(body)) malformed();
        var entries = provider === 'gemini' ? body.models : body.data;
        if (!Array.isArray(entries)) malformed();
        if (!entries.length) fail('The provider returned an empty model page.');

        for (var entry of entries) {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) malformed();
          var id = provider === 'gemini' ? entry.name : entry.id;
          if (!nonemptyString(id) || id !== id.trim()) malformed();
          var label = id;
          if (provider === 'openai') {
            if (!OPENAI_ID.test(id)) continue;
          } else if (provider === 'claude') {
            if (!/^claude-/.test(id)) continue;
            var lifecycle = entry.lifecycle;
            var status = typeof lifecycle === 'string' ? lifecycle : lifecycle && lifecycle.status;
            status = status || entry.lifecycle_status;
            if (typeof status === 'string' && /^(retired|deprecated)$/i.test(status)) continue;
            if (entry.display_name !== undefined && !nonemptyString(entry.display_name)) malformed();
            label = entry.display_name || id;
          } else {
            id = id.replace(/^models\//, '');
            if (!Array.isArray(entry.supportedGenerationMethods)
                || !entry.supportedGenerationMethods.every(function (method) { return typeof method === 'string'; })) malformed();
            if (!/^gemini-/.test(id) || GEMINI_SPECIALIZED.test(id)
                || !entry.supportedGenerationMethods.includes('generateContent')) continue;
            if (entry.displayName !== undefined && !nonemptyString(entry.displayName)) malformed();
            label = entry.displayName || id;
          }
          if (!models.has(id)) {
            var model = { id: id, label: label };
            if (provider === 'openai') model.description = 'Provider-listed model; compatibility not tested';
            models.set(id, model);
          }
        }

        var next = '';
        if (provider === 'claude') {
          if (typeof body.has_more !== 'boolean') malformed();
          if (body.has_more) {
            if (!nonemptyString(body.last_id)) malformed();
            next = body.last_id;
          }
        } else if (provider === 'gemini' && body.nextPageToken !== undefined) {
          if (typeof body.nextPageToken !== 'string') malformed();
          next = body.nextPageToken;
        }
        if (!next) {
          if (!models.size) fail('The provider returned no compatible models.');
          return Array.from(models.values()).sort(function (a, b) {
            return b.id.localeCompare(a.id, 'en', { numeric: true });
          });
        }
        if (cursors.has(next)) fail('Model discovery returned a repeated page cursor.');
        cursors.add(next);
        cursor = next;
      }
      fail('Model discovery exceeded the 20-page limit.');
    }

    try {
      // The deadline includes every page and JSON body, not just response headers.
      var timeout = new Promise(function (_, reject) {
        timer = setTimeout(function () {
          controller.abort();
          reject(new Error('Cloud model discovery timed out.'));
        }, 15000);
      });
      return await Promise.race([discover(), timeout]);
    } catch (_) {
      // Provider bodies and transport errors can contain credentials. Never forward them.
      throw new Error(controller.signal.aborted ? 'Cloud model discovery timed out.' : failureMessage);
    } finally {
      clearTimeout(timer);
    }
  };
})(globalThis);
