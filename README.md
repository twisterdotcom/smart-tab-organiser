# Smart Tab Organiser

A Chrome extension that **deduplicates tabs** (including smart rules for hashes/anchors), **tidies pinned tab lists**, optionally maintains a **GitHub pull-request tab group**, and **organises tabs with AI** into groups. Duplicate handling can keep the tab with the highest anchor number (for example, the latest GitHub comment on an issue).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-coming%20soon-lightgrey)](https://chrome.google.com/webstore)

## Privacy

- **Local by default**: Settings and optional API tokens stay on your device (`chrome.storage.local`).
- **No analytics**: No telemetry or tracking from this extension.
- **Optional cloud features**: AI organisation and the PR tab group send data only when you configure keys and use those features—see [Privacy Policy](PRIVACY_POLICY.md).
- [Privacy Policy](PRIVACY_POLICY.md)

## Key features

- **AI tab organisation**: Group tabs with OpenAI, Anthropic Claude, or Google Gemini (you supply API keys in Options).
- **Duplicate detection**: Same base URL with different anchors/hashes; optional ignore-query / ignore-hash rules; case-insensitive matching.
- **Pinned URL list**: Pin, unpin, and order tabs to match a list you define (runs with the toolbar action or combined flows).
- **GitHub PR tab group** (optional): Uses your GitHub token to open/update a group of PR tabs; integrates with dedupe logic when enabled.
- **Toolbar, context menu, and shortcut**: Left-click the icon, use the right-click menus, or **⌘+Shift+O** (Mac) / **Ctrl+Shift+O** (Windows/Linux) for the organise command (see `manifest.json` → `commands`).
- **Popup**: Close duplicates only, reload all tabs, AI organise, and related toggles.

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
- For **AI organisation**: an API key from OpenAI, Anthropic, and/or Google (configured in **Extension options** after install).
- For the **GitHub PR group**: a GitHub personal access token with appropriate repo scope (configured in Options).

### Steps

1. **Clone** this repository (the GitHub repo name may still be `close-duplicate-tabs`; the clone URL is whatever your remote shows):

   ```bash
   git clone https://github.com/twisterdotcom/close-duplicate-tabs.git
   cd close-duplicate-tabs
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
3. Under AI settings, paste **API keys** only if you plan to use AI organisation.
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
