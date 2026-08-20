# Smart Tab Organiser

A Chrome extension that **deduplicates tabs**, **tidies pinned tab lists**, maintains optional **GitHub tab groups**, and **organizes tabs with AI**. Duplicate handling can keep the tab with the highest anchor number, such as the latest GitHub issue comment.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-coming%20soon-lightgrey)](https://chromewebstore.google.com/)

## Privacy

- **Local storage**: Settings and optional credentials use `chrome.storage.local`. A credential goes only to its issuing service when you use that feature.
- **No analytics**: No telemetry or tracking from this extension.
- **AI on your computer**: Chrome built-in AI and loopback model servers keep tab data on your computer.
- **Optional cloud features**: Cloud AI and GitHub tab groups send data only after you configure a key and use the applicable feature.
- [Privacy Policy](PRIVACY_POLICY.md)
- [Release notes](RELEASE_NOTES.md)

## Key features

- **AI tab organization**: Group tabs with OpenAI, Anthropic, Google, Chrome built-in AI, or a loopback model server. Cloud providers use your API key.
- **Duplicate detection**: Same base URL with different anchors/hashes; optional ignore-query / ignore-hash rules; case-insensitive matching.
- **Pinned URL list**: Pin, unpin, and order tabs to match a list you define (runs with the toolbar action or combined flows).
- **GitHub tab groups** (optional): The extension maintains a **PRs** group and opens missing tabs for matching pull requests that GitHub returns.
  - Stale PR tabs leave the group but remain open.
  - The issue-label feature uses an optional ordered list of exact GitHub issue label names from settings.
  - Label matching is exact and case-insensitive. The first configured matching label wins.
  - If the **Closed** feature is enabled, a closed issue goes to **Closed** before label matching.
  - The extension does not create empty label groups. Pinned and split-view tabs remain unchanged.
- **Toolbar, context menu, and shortcut**: Left-click the icon, use the right-click menu, or press **⌘+Shift+O** (Mac) or **Ctrl+Shift+O** (Windows/Linux).

## AI on your computer (no provider API key)

Two of the five AI providers process tab data on your computer. Pick either one under **Options → Preferred AI Provider**.

> **Fallbacks stay on-device by default.** With fallback enabled, an on-device primary only retries the *other* on-device provider — the local server joins the chain when a model name is configured, and Chrome built-in AI joins only when its model is already downloaded (a fallback never triggers the multi-gigabyte download). Cloud providers join an on-device chain only if you explicitly enable **Allow server-based (cloud) fallbacks** in Options, because that fallback sends tab titles and URLs off your machine when it runs. Cloud primaries fall back only to other cloud providers you hold keys for — never silently to anything else. Eligible fallbacks are tried in the order you set under **Options → Fallback order** (your preferred provider always goes first); entries that can't run are shown greyed out with the reason.

### Chrome built-in AI (Gemini Nano)

Nothing to install — the model runs inside Chrome itself.

- Requires **Chrome 138+** on desktop, ~**22 GB** free disk space, and either **4 GB+ VRAM** or **16 GB+ RAM**.
- Chrome downloads the model (a few GB) on first use. Because the download can need a user gesture that a service worker doesn't have, use **Options → Check availability → Download model** to fetch it up front.
- Gemini Nano is smaller than cloud models, so grouping is coarser. The extension organizes tabs in **batches of 20** and merges matching group names.

### Local model (Ollama, LM Studio, llama.cpp, vLLM)

An OpenAI-compatible `/v1/chat/completions` endpoint can run on `localhost` or `127.0.0.1`. The extension rejects other network hosts.

1. Install a runtime and pull a model. For example, use `ollama pull llama3.1:8b`.
2. **Start the server so it accepts requests from extensions.** Ollama rejects unknown origins, so it must be launched with:

   ```bash
   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
   ```

   In LM Studio, enable CORS in the local server settings. llama.cpp's server allows this by default.
3. In Options, set the **server address** (default `http://localhost:11434/v1`). Then enter the exact model name that the server reports, such as `llama3.1:8b` or `qwen3:8b`. **Test connection** lists available models.

Notes:

- Local generation is slow. A 35B model takes roughly one minute for 12 tabs. Requests stop after three minutes. If a timeout occurs, use a smaller model or organize fewer tabs.
- Small models are less reliable at emitting bare JSON, so a stricter retry is attempted automatically before failing.

## Example: GitHub issue tabs

For tabs such as:

- `https://github.com/Expensify/Expensify/issues/573091`
- `https://github.com/Expensify/Expensify/issues/573091#issuecomment-3595795518`
- `https://github.com/Expensify/Expensify/issues/573091#issuecomment-3595796076`

With the applicable dedupe settings, the extension treats these tabs as one logical page. It keeps the tab with the **highest** anchor number and closes the others.

For example, settings can contain this optional ordered list of exact GitHub issue label names:

1. `Overdue`
2. `Daily`
3. `Bug`
4. `New Feature`

Label matching is exact and case-insensitive. The first configured matching label wins.

After normal dedupe, issues with `Overdue` go to **Overdue** first. Other issues go to **Daily**, **Bug**, or **New Feature**, as applicable.

An issue with `Bug` and `New Feature` goes to **Bug** because `Bug` appears first in settings.

If the **Closed** feature is enabled, a closed issue goes to **Closed** instead of a label group.

The extension does not create empty groups. Pinned and split-view tabs remain unchanged.

## Project structure

```
├── manifest.json          # Extension config and permissions
├── background.js          # Service worker (dedupe, pin tidy, AI, GitHub groups)
├── options.html/css/js    # Full settings (API keys, lists, PRs, AI)
├── icons/                 # Runtime icons at 16, 48, and 128 pixels
├── scripts/               # Icon, store-asset, and release builders
├── store-assets/          # Listing artwork and screenshots
├── docs/                  # Chrome Web Store submission guide
├── PRIVACY_POLICY.md
├── RELEASE_NOTES.md
└── README.md
```

## Install from source (local use)

### Requirements

- **Google Chrome**, **Microsoft Edge**, or another **Chromium** browser with unpacked extensions.
- For **cloud AI organization**: an API key from OpenAI, Anthropic, Google, or more than one provider.
- For **AI on your computer**: Chrome 138+ on supported hardware, or a loopback OpenAI-compatible server such as [Ollama](https://ollama.com). See [AI on your computer](#ai-on-your-computer-no-provider-api-key).
- For **GitHub tab groups**: a GitHub personal access token with access to the applicable repositories.

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
2. Set the **dedupe**, **pinned tab**, and **GitHub tab group** options that you want.
3. Under AI settings, choose a **provider**. Paste **API keys** only if you picked a cloud provider; the on-device options need no key.
4. Reload the extension after code changes: on `chrome://extensions` / `edge://extensions`, click **Reload** on the extension card.

## How to use

### Toolbar icon (default)

Left-click runs **dedupe** then **tidy pinned tabs** (see in-app Options for the exact behaviour). The badge can show duplicate counts depending on settings.


### Context menu

Right-click the extension icon. The menu entries appear in this order:

1. **Deduplicate AND organize tabs with AI**
2. **Reload all tabs**
3. **Collapse all tab groups**
4. **Expand all tab groups**
5. **Edit extension options**

### Keyboard

**⌘+Shift+O** (Mac) or **Ctrl+Shift+O** (Windows/Linux) triggers the **Organize tabs with AI** command when the shortcut is not taken by another extension or the browser.

## Development

- Edit files in this repository.
- On the extensions page, click **Reload** on the extension card.
- Use **Inspect views: service worker** and the options-page developer tools to debug.
- Run `./scripts/validate.sh` before a release.

## How dedupe works (simplified)

1. **Normalise** URLs using your settings (query/hash handling).
2. **Group** tabs by normalised URL.
3. **Pick a keeper**, such as the tab with the highest hash number or the most recent access time.
4. **Close** other tabs in the group.

## Permissions

| Permission | Why |
|------------|-----|
| `tabs` | Read tab URLs/titles, close tabs, reload, pin/unpin, reorder. |
| `storage` | Save settings and optional API tokens locally. |
| `tabGroups` | Create and update AI, PR, Closed, BOOKMARKS, and user-defined groups. |
| `notifications` | User feedback for long-running or batch actions (where implemented). |
| `contextMenus` | Right-click commands for duplicate removal and tab organization. |
| Host access for OpenAI, Anthropic, Gemini, GitHub | Used only for configured cloud AI and GitHub features. Cloud AI receives titles, sanitized URLs, custom instructions, and relevant group names. |
| Host access for `localhost` / `127.0.0.1` | Reaches a model server on the same computer. The extension rejects other network hosts. |

Details: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).

## Build a Chrome Web Store package

Run the release builder from the repository root:

```sh
python3 scripts/build-release.py
```

The builder creates a validated ZIP in `dist/`. See [the Chrome Web Store submission guide](docs/CHROME_WEB_STORE.md) for listing text and review steps.

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
