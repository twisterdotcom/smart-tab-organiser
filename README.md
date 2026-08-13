# Smart Tab Organiser

A Chrome extension that **deduplicates tabs** (including smart rules for hashes/anchors), **tidies pinned tab lists**, optionally maintains a **GitHub pull-request tab group**, and **organises tabs with AI** into groups. Duplicate handling can keep the tab with the highest anchor number (for example, the latest GitHub comment on an issue).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-coming%20soon-lightgrey)](https://chrome.google.com/webstore)

## Privacy

- **Local by default**: Settings and optional API tokens stay on your device (`chrome.storage.local`).
- **No analytics**: No telemetry or tracking from this extension.
- **Fully offline AI available**: Choosing Chrome built-in AI or a local model means tab titles and URLs never leave your computer.
- **Optional cloud features**: AI organisation and the PR tab group send data only when you configure keys and use those features—see [Privacy Policy](PRIVACY_POLICY.md).
- [Privacy Policy](PRIVACY_POLICY.md)

## Key features

- **AI tab organisation**: Group tabs with a cloud provider (OpenAI, Anthropic Claude, Google Gemini — you supply API keys in Options) or **entirely on-device** with Chrome's built-in Gemini Nano or a local Ollama / LM Studio / llama.cpp model.
- **Duplicate detection**: Same base URL with different anchors/hashes; optional ignore-query / ignore-hash rules; case-insensitive matching.
- **Pinned URL list**: Pin, unpin, and order tabs to match a list you define (runs with the toolbar action or combined flows).
- **GitHub PR tab group** (optional): Uses your GitHub token to open/update a group of PR tabs; integrates with dedupe logic when enabled.
- **Toolbar, context menu, and shortcut**: Left-click the icon, use the right-click menus, or **⌘+Shift+O** (Mac) / **Ctrl+Shift+O** (Windows/Linux) for the organise command (see `manifest.json` → `commands`).
- **Popup**: Close duplicates only, reload all tabs, AI organise, and related toggles.

## On-device AI (no API key, no network)

Two of the five AI providers run entirely on your own machine. Pick either one under **Options → Preferred AI Provider**.

> **Fallbacks stay on-device by default.** With fallback enabled, an on-device primary only retries the *other* on-device provider — the local server joins the chain when a model name is configured, and Chrome built-in AI joins only when its model is already downloaded (a fallback never triggers the multi-gigabyte download). Cloud providers join an on-device chain only if you explicitly enable **Allow server-based (cloud) fallbacks** in Options, because that fallback sends tab titles and URLs off your machine when it runs. Cloud primaries fall back only to other cloud providers you hold keys for — never silently to anything else. Eligible fallbacks are tried in the order you set under **Options → Fallback order** (your preferred provider always goes first); entries that can't run are shown greyed out with the reason.

### Chrome built-in AI (Gemini Nano)

Nothing to install — the model runs inside Chrome itself.

- Requires **Chrome 138+** on desktop, ~**22 GB** free disk space, and either **4 GB+ VRAM** or **16 GB+ RAM**.
- Chrome downloads the model (a few GB) on first use. Because the download can need a user gesture that a service worker doesn't have, use **Options → Check availability → Download model** to fetch it up front.
- Gemini Nano is far smaller than cloud models, so grouping is coarser. Tabs are organised in **batches of 20** to fit its context window, and batches sharing a group name are merged.

### Local model (Ollama, LM Studio, llama.cpp, vLLM)

Any local server with an OpenAI-compatible `/v1/chat/completions` endpoint works.

1. Install a runtime and pull a model, e.g. `ollama pull llama3.1:8b`.
2. **Start the server so it accepts requests from extensions.** Ollama rejects unknown origins, so it must be launched with:

   ```bash
   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
   ```

   In LM Studio, enable CORS in the local server settings. llama.cpp's server allows this by default.
3. In Options, set the **server address** (default `http://localhost:11434/v1`) and the **model name** exactly as your server reports it (`llama3.1:8b`, `qwen3:8b`, …). **Test connection** lists the models it can see.

Notes:

- Local generation is slow — a 35B model takes roughly a minute for a dozen tabs. Requests time out after 3 minutes, which keeps them inside Chrome's service worker lifetime; if you hit that, use a smaller model or organise fewer tabs.
- Small models are less reliable at emitting bare JSON, so a stricter retry is attempted automatically before failing.

## Example: GitHub issue tabs

For tabs like:

- `https://github.com/Expensify/Expensify/issues/573091`
- `https://github.com/Expensify/Expensify/issues/573091#issuecomment-3595795518`
- `https://github.com/Expensify/Expensify/issues/573091#issuecomment-3595796076`

The extension can treat these as one logical page, keep the tab with the **highest** anchor number, and close the others (depending on your settings).

## Project structure

```
├── manifest.json          # Extension config and permissions
├── background.js          # Service worker (dedupe, pin tidy, AI, PR group)
├── popup.html/css/js      # Toolbar popup
├── options.html/css/js    # Full settings (API keys, lists, PRs, AI)
├── icons/                 # 16, 48, 128
├── PRIVACY_POLICY.md
└── README.md
```

## Install from source (local use)

### Requirements

- **Google Chrome**, **Microsoft Edge**, or another **Chromium** browser with unpacked extensions.
- For **cloud AI organisation**: an API key from OpenAI, Anthropic, and/or Google (configured in **Extension options** after install).
- For **on-device AI organisation**: either Chrome 138+ on supported hardware (built-in Gemini Nano), or a local OpenAI-compatible server such as [Ollama](https://ollama.com) — no API key needed. See [On-device AI](#on-device-ai-no-api-key-no-network).
- For the **GitHub PR group**: a GitHub personal access token with appropriate repo scope (configured in Options).

### Steps

1. **Clone** this repository:

   ```bash
   git clone https://github.com/twisterdotcom/smart-tab-organiser.git
   cd smart-tab-organiser
   ```

2. Open the extensions page:

   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`

3. Turn on **Developer mode**.

4. Click **Load unpacked** and choose this folder (the directory that contains `manifest.json`).

5. **Pin the extension** (optional): use the puzzle icon → pin **Smart Tab Organiser** so the toolbar actions are easy to reach.

### First-time setup

1. Right-click the extension icon → **Options** (or open Options from the extensions list).
2. Set **dedupe / pin** preferences and any **pinned URL list** or **PR group** options you want.
3. Under AI settings, choose a **provider**. Paste **API keys** only if you picked a cloud provider; the on-device options need no key.
4. Reload the extension after code changes: on `chrome://extensions` / `edge://extensions`, click **Reload** on the extension card.

## How to use

### Toolbar icon (default)

Left-click runs **dedupe** then **tidy pinned tabs** (see in-app Options for the exact behaviour). The badge can show duplicate counts depending on settings.

### Popup

Click the icon (if it opens the popup—some setups run the action directly). From the popup you can **Close duplicates**, **Reload all tabs**, run **AI organise** when configured, and adjust common toggles.

### Context menu

Right-click the page or the extension icon (depending on browser) and use entries such as **Deduplicate and organize tabs with AI** or **Deduplicate and tidy pinned tabs**—wording matches your installed version.

### Keyboard

**⌘+Shift+O** (Mac) or **Ctrl+Shift+O** (Windows/Linux) triggers the **Organize tabs with AI** command when the shortcut is not taken by another extension or the browser.

## Development

- Edit files in this repo.
- On the extensions page, click **Reload** on the extension’s card.
- Use **Inspect views: service worker** (and popup/options devtools) to debug.

## How dedupe works (simplified)

1. **Normalise** URLs using your settings (query/hash handling).
2. **Group** tabs by normalised URL.
3. **Pick a keeper** (e.g. highest number in the hash, or most recently used as a fallback).
4. **Close** other tabs in the group.

## Permissions

| Permission | Why |
|------------|-----|
| `tabs` | Read tab URLs/titles, close tabs, reload, pin/unpin, reorder. |
| `storage` | Save settings and optional API tokens locally. |
| `tabGroups` | Create/update tab groups (AI organisation, PR group, bookmarks group, etc.). |
| `notifications` | User feedback for long-running or batch actions (where implemented). |
| `contextMenus` | Right-click commands for dedupe / organise flows. |
| Host access for OpenAI, Anthropic, Gemini, GitHub | Only used when you configure keys and invoke those features. |
| Host access for `localhost` / `127.0.0.1` | Reach a local model server (Ollama, LM Studio, llama.cpp) on your own machine. Never used unless you select the local provider. |

Details: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## Contributing

1. Fork the repository  
2. Create a branch (`git checkout -b feature/your-feature`)  
3. Commit and push  
4. Open a pull request  

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Built for people who live in the browser—especially anyone drowning in duplicate issue tabs and pull requests.

---

Made with care by [twisterdotcom](https://github.com/twisterdotcom)
