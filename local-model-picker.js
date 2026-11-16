(function (g) {
  'use strict';

  // Reviewed against the official Ollama library on 2026-11-16, not benchmark rankings.
  var SUGGESTIONS = [
    {
      id: 'qwen2.5:1.5b', label: 'Qwen2.5 1.5B', download: '986 MB',
      description: 'Suggested starting point. Small download; the Qwen2.5 family emphasizes JSON output. Apache 2.0 license.',
      source: 'https://ollama.com/library/qwen2.5:1.5b',
    },
    {
      id: 'qwen2.5:3b', label: 'Qwen2.5 3B', download: '1.9 GB',
      description: 'Larger alternative from the same JSON-oriented family. Uses the Qwen license, not Apache 2.0.',
      source: 'https://ollama.com/library/qwen2.5:3b',
    },
    {
      id: 'gemma3:1b', label: 'Gemma 3 1B', download: '806 MB',
      description: 'Lightweight text-only alternative. Check JSON output on your tabs. Gemma terms apply.',
      source: 'https://ollama.com/library/gemma3:1b',
    },
  ];

  g.createLocalModelPicker = function (config) {
    var doc = config.document;
    var api = config.chrome;
    var elements = config.elements;
    var installed = [];
    var running = [];
    var modelDetails = [];
    var generation = 0;
    var serverType = '';
    var previewId = SUGGESTIONS[0].id;
    var origin = api.runtime.getURL('').replace(/\/$/, '');

    function suggestionFor(id) {
      return SUGGESTIONS.find(function (model) { return model.id === id; });
    }

    function option(parent, value, label) {
      var item = doc.createElement('option');
      item.value = value;
      item.textContent = label;
      parent.appendChild(item);
      return item;
    }

    function showSetup(id) {
      var suggestion = suggestionFor(id) || suggestionFor(previewId) || SUGGESTIONS[0];
      previewId = suggestion.id;
      elements.suggestion.textContent = suggestion.label + ': ' + suggestion.description +
        ' Approximate download: ' + suggestion.download + '. Runtime memory use is higher.';
      elements.source.href = suggestion.source;
      elements.source.textContent = 'Official model details and license';
      elements.pullCommand.textContent = 'ollama pull ' + suggestion.id;
      elements.serveCommand.textContent = elements.shell.value === 'powershell'
        ? '$env:OLLAMA_ORIGINS = "' + origin + '"\nollama serve'
        : 'OLLAMA_ORIGINS="' + origin + '" ollama serve';
      elements.macCommand.textContent = 'launchctl setenv OLLAMA_ORIGINS "' + origin + '"';
    }

    function render() {
      var chosen = elements.model.value.trim();
      elements.choices.textContent = '';
      option(elements.choices, '', chosen ? 'Manual or saved model: ' + chosen : 'Choose an installed model or view setup suggestions');
      if (installed.length) {
        var available = doc.createElement('optgroup');
        available.label = serverType === 'ollama' ? 'Installed in Ollama' : 'Available on this server';
        installed.forEach(function (id) {
          var details = modelDetails.find(function (model) { return model.id === id; });
          var extra = [];
          if (running.includes(id)) extra.push('loaded');
          if (suggestionFor(id)) extra.push('suggested');
          if (details && Number.isFinite(details.sizeBytes) && details.sizeBytes > 0) {
            extra.push((details.sizeBytes / 1e9).toFixed(1) + ' GB on disk');
          }
          option(available, 'installed:' + id, id + (extra.length ? ' — ' + extra.join(', ') : ''));
        });
        elements.choices.appendChild(available);
      }
      var suggested = doc.createElement('optgroup');
      suggested.label = 'Ollama setup suggestions — not confirmed installed';
      SUGGESTIONS.filter(function (model) { return !installed.includes(model.id); }).forEach(function (model) {
        option(suggested, 'suggested:' + model.id, model.label + ' — pull ' + model.download + ' (view command)');
      });
      if (suggested.children.length) elements.choices.appendChild(suggested);
      elements.choices.value = installed.includes(chosen) ? 'installed:' + chosen : '';
      showSetup(suggestionFor(chosen) ? chosen : previewId);
    }

    function invalidate() {
      generation++;
      installed = [];
      running = [];
      modelDetails = [];
      serverType = '';
      elements.refresh.disabled = false;
      elements.status.textContent = 'Server address changed. Select Test connection / Refresh models.';
      elements.status.className = 'status info';
      render();
    }

    async function refresh(requestPermission) {
      var currentGeneration = ++generation;
      var address = elements.address.value.trim();
      function isCurrent() {
        return currentGeneration === generation && elements.address.value.trim() === address;
      }
      elements.refresh.disabled = true;
      elements.status.textContent = 'Detecting the local model server…';
      elements.status.className = 'status info';
      try {
        // Automatic detection never opens a permission prompt or scans other addresses.
        if (requestPermission) await config.requestPermission(address);
        if (!isCurrent()) return;
        var result = await api.runtime.sendMessage({ action: 'listLocalModels', baseUrl: address });
        if (!isCurrent()) return;
        if (!result || !result.success) throw new Error(result && result.error || 'Could not reach the local model server.');
        if (!Array.isArray(result.models) || !result.models.every(function (id) { return typeof id === 'string' && id; })) {
          throw new Error('The local server returned an invalid model list.');
        }
        installed = Array.from(new Set(result.models));
        running = Array.isArray(result.runningModels) ? result.runningModels : [];
        modelDetails = Array.isArray(result.modelDetails) ? result.modelDetails : [];
        serverType = result.serverType;
        render();
        var label = serverType === 'ollama' ? 'Ollama' + (result.version ? ' ' + result.version : '') : 'OpenAI-compatible server';
        var chosen = elements.model.value.trim();
        var warning = chosen && !installed.includes(chosen) ? ' The saved model is not in this list; your selection is unchanged.' : '';
        elements.status.textContent = label + ' detected at ' + result.baseUrl + '. ' + installed.length +
          ' model(s) available.' + (!installed.length ? ' No models are installed. See the Ollama setup commands below.' : '') + warning;
        elements.status.className = 'status ' + (warning || !installed.length ? 'info' : 'success');
      } catch (error) {
        if (!isCurrent()) return;
        installed = [];
        running = [];
        modelDetails = [];
        serverType = '';
        render();
        elements.status.textContent = error.message + ' Your saved model is unchanged. See the setup commands below.';
        elements.status.className = 'status error';
      } finally {
        if (isCurrent()) elements.refresh.disabled = false;
        config.onRefresh();
      }
    }

    elements.choices.addEventListener('change', function () {
      var value = elements.choices.value;
      if (value.startsWith('installed:')) {
        var id = value.slice('installed:'.length);
        if (!installed.includes(id)) return;
        elements.model.value = id;
        config.onSelect(id);
        if (suggestionFor(id)) showSetup(id);
        elements.status.textContent = 'Selected installed model: ' + id + '.';
        elements.status.className = 'status success';
      } else if (value.startsWith('suggested:')) {
        var suggestion = suggestionFor(value.slice('suggested:'.length));
        if (!suggestion) return;
        showSetup(suggestion.id);
        elements.setup.open = true;
        elements.status.textContent = suggestion.id + ' is a setup suggestion, not the active model. Run its pull command, then refresh and select it.';
        elements.status.className = 'status info';
      }
    });
    elements.model.addEventListener('input', render);
    elements.address.addEventListener('input', invalidate);
    elements.shell.addEventListener('change', function () { showSetup(previewId); });
    elements.refresh.addEventListener('click', function () { refresh(true); });
    render();
    return { refresh: refresh, invalidate: invalidate };
  };
})(globalThis);
