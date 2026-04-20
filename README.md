# Organise and Deduplicate Tabs

A Chrome Extension that organises tabs with AI and closes duplicate tabs, including those with different anchors/hashes. When duplicates are found, it keeps the tab with the highest anchor number (e.g., the latest GitHub comment).

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-coming%20soon-lightgrey)](https://chrome.google.com/webstore)

## 🔒 Privacy

- **100% Local**: All data stored locally on your device
- **No Tracking**: No analytics, telemetry, or external requests
- **Open Source**: Full source code available for review
- [Privacy Policy](PRIVACY_POLICY.md)

## ✨ Key Features

- **AI-Powered Tab Organization**: Organise your tabs into logical groups using OpenAI (GPT-5.2, GPT-5 mini, GPT-4.1, and more), Claude (Claude Opus 4.6, Sonnet 4.6, Haiku 4.5, and more), or Gemini (Gemini 2.0 Flash, 1.5 Flash, 1.5 Pro, and more)
- **Smart Duplicate Detection**: Detects duplicate tabs even when they have different anchors/hashes
- **Case-Insensitive Matching**: Handles URLs with different cases (e.g., `Expensify` vs `expensify`)
- **Works with Suspended Tabs**: Detects duplicates even in inactive tabs (Arc browser compatible)
- **Anchor Number Comparison**: Automatically keeps the tab with the highest number in the anchor (e.g., `#issuecomment-3595796076` vs `#issuecomment-3595795518`)
- **Visual Badge**: See duplicate count at a glance in the extension icon
- **Configurable Options**:
  - Ignore query parameters when comparing URLs
  - Ignore hash when comparing (but still uses it to determine which tab to keep)
  - Option to reload remaining tabs after closing duplicates
  - Custom instructions for AI tab organization
  - Choose between multiple AI models
  - Toggle extension icon behavior (organize tabs vs close duplicates)
- **Reload All Tabs**: Quick button to reload all tabs in the current window
- **Tab Grouping**: Create and manage tab groups with AI assistance

## Example Use Case

For GitHub issue tabs like:
- `https://github.com/Expensify/Expensify/issues/573091`
- `https://github.com/Expensify/Expensify/issues/573091#issuecomment-3595795518`
- `https://github.com/Expensify/Expensify/issues/573091#issuecomment-3595796076`

The extension will:
1. Recognize these as duplicates (same base URL)
2. Keep only: `https://github.com/Expensify/Expensify/issues/573091#issuecomment-3595796076` (highest anchor number)
3. Close the other two tabs

## 📁 Project Structure

```
├── manifest.json          # Extension configuration and permissions
├── background.js          # Background service worker (tab management logic)
├── popup.html/css/js      # Extension popup interface with settings
├── options.html/css/js    # Options/settings page
├── icons/                 # Extension icons (16x16, 48x48, 128x128)
├── PRIVACY_POLICY.md      # Privacy policy
└── README.md              # This file
```

## 🚀 Installation

### From Source (Development)

1. Clone this repository:
   ```bash
   git clone https://github.com/twisterdotcom/close-duplicate-tabs.git
   cd close-duplicate-tabs
   ```

2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the extension directory
6. The extension should now be loaded

### From Chrome Web Store (Coming Soon)

The extension will be available on the Chrome Web Store soon. Check back for updates!

## How to Use

### Closing Duplicate Tabs

1. Click the extension icon in your Chrome toolbar
2. Configure your preferences:
   - **Ignore query parameters**: When enabled, URLs with different query strings are treated as duplicates
   - **Ignore hash when comparing**: When enabled, URLs are compared without their hash, but the hash is still used to determine which tab to keep (highest number)
   - **Reload remaining tabs**: When enabled, remaining tabs will be reloaded after closing duplicates
3. Click "Close Duplicates" to remove duplicate tabs
4. Use "Reload All Tabs" to refresh all tabs in the current window

### AI Tab Organization

1. Go to the extension options page (right-click extension icon → Options)
2. Configure your AI API keys (OpenAI, Claude, or Gemini)
3. Select your preferred model and provider
4. Optionally add custom instructions (e.g., "group by domain" or "group by topic")
5. Click "Organize Tabs with AI" in the options page, or use the "Organize Tabs" button in the popup
6. The AI will analyze your tabs and create logical groups automatically

## Development

- Make changes to the files
- Go to `chrome://extensions/` and click the refresh icon on your extension card
- Test your changes

## How It Works

1. **URL Normalization**: URLs are normalized based on your settings (removing query/hash for comparison)
2. **Grouping**: Tabs are grouped by their normalized URL
3. **Anchor Extraction**: For each group, the extension extracts numbers from the anchor/hash
4. **Selection**: The tab with the highest anchor number is kept (or most recently accessed if no anchors)
5. **Cleanup**: All other tabs in the group are closed

## 🔐 Permissions

- **`tabs`**: Required to query open tabs and close duplicate tabs. Only accesses tabs in the current browser window.
- **`storage`**: Used to save your extension preferences locally. Only stores settings, no URLs or browsing data.

See [Privacy Policy](PRIVACY_POLICY.md) for detailed information.

## 🤝 Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built for developers and power users who manage many browser tabs
- Inspired by the need to clean up duplicate GitHub issue tabs

---

Made with ❤️ by [twisterdotcom](https://github.com/twisterdotcom)
