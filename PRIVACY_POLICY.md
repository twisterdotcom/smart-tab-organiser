# Privacy Policy for Smart Tab Organiser

**Last Updated:** August 12, 2026

## Overview

Smart Tab Organiser is a browser extension that helps you deduplicate tabs, tidy pinned tab lists, optionally manage a GitHub pull-request tab group, and optionally organise tabs with AI. This privacy policy explains how we handle your data.

## Data Collection and Storage

### Local storage
This extension stores preferences and optional secrets (API keys, GitHub tokens) on your device using Chrome's `chrome.storage.local` API. **We do not operate a server** for this extension; there is no account or backend run by the developer that receives your browsing data.

### What data is stored
- **User preferences**: Options such as ignore query parameters, ignore hash, reload-after-dedupe, pinned URL lists, PR group settings, etc.
- **Optional secrets**: If you enable them, API keys (OpenAI, Claude, Gemini) and/or a GitHub personal access token are stored **only** on your device.

### How data is used
- Settings are read locally to control how the extension behaves.
- **Core deduplication and pinned-tab tidy** can run without sending tab data to any third party, as long as you do not use AI or GitHub-powered features.
- **No analytics, tracking, or telemetry** from the extension author is collected.

### Tab data and network requests
- Tab **URLs and titles** may be sent **only when you use optional features** that require cloud APIs (see **Third-party services** below). Otherwise, tab data is processed in the browser and is not transmitted to us or to those APIs.
- **On-device AI providers send nothing over the network.** If you select **Chrome built-in AI** or a **local model**, tab titles and URLs are processed on your own computer only — by Chrome's bundled Gemini Nano model, or by a server you run yourself (see **On-device AI** below).

## Permissions Explained

### `tabs` Permission
- **Purpose**: Required to query, reorder, pin/unpin, reload, and close tabs as part of dedupe, pin tidy, and optional organise flows
- **Usage**: Only accesses tabs in the current browser window
- **Data Access**: Reads tab URLs and titles as needed for those features
- **Data Storage**: The extension does not persist URLs or titles to disk beyond normal browser tab state; optional AI/GitHub features may send titles/URLs to those third parties only when you use them (see above)

### `storage` Permission
- **Purpose**: Required to save your extension preferences locally
- **Usage**: Stores only your settings (checkboxes for options, API keys if configured)
- **Data Storage**: All data remains on your device

### `tabGroups` Permission
- **Purpose**: Required to create and manage tab groups when using AI organization
- **Usage**: Creates tab groups based on AI categorization
- **Data Access**: Only accesses tabs in the current browser window

### `notifications` Permission
- **Purpose**: Optional user-visible notices for some batch or long-running operations
- **Usage**: Shows browser notifications when relevant; no notification content is sent to external servers by this extension

### `contextMenus` Permission
- **Purpose**: Adds browser context menu entries for dedupe and organise actions
- **Usage**: Menu actions trigger the same in-browser logic as the toolbar and options UI

## Third-Party Services

### AI Tab Organization (Optional)

If you choose a **cloud** AI provider for tab organization, the extension will send tab titles and URLs to either:
- **OpenAI** (api.openai.com) - when using OpenAI models
- **Anthropic** (api.anthropic.com) - when using Claude models
- **Google** (generativelanguage.googleapis.com) - when using Gemini models

**What is sent**: Only tab titles and URLs are sent to the AI service for categorization. This data is sent directly to the AI provider's API using your own API key.

**What is NOT sent**: No other browsing data, personal information, or analytics are transmitted.

**Your API Key**: Your API key is stored locally on your device and is never shared with us or any other third party. You are responsible for managing your API key and any associated costs.

**Opting Out**: You can disable AI features entirely by not configuring API keys, or avoid third parties altogether by selecting an on-device provider. Core deduplication and pinned-tab tidy do not call OpenAI, Anthropic, or Google.

### On-device AI (optional, no third party)

Two AI providers involve **no third-party service and no network transmission of tab data**:

- **Chrome built-in AI (Gemini Nano)**: Categorization runs inside Chrome using a model Chrome downloads and stores on your device. Tab titles and URLs are passed to that local model only. The model download itself is performed by Chrome from Google's servers and is not initiated or observed by the extension author; it contains no tab data.
- **Local model (Ollama, LM Studio, llama.cpp, and similar)**: Tab titles and URLs are sent to a server **you** run, at an address you specify (by default `http://localhost:11434/v1` on your own machine). The extension requests host access to `localhost` and `127.0.0.1` for this purpose and makes no such request unless you select this provider. Where that data goes is entirely determined by the server you point it at; if you configure a non-local address, the data will go there.

No API key is required for either option, and neither sends anything to the extension author.

### GitHub API (optional)

If you configure a **GitHub personal access token** and use the pull-request tab group (or related) features, the extension contacts **api.github.com** using **your** token to search for pull requests and build/update tabs. **What is sent**: HTTP requests authorised by your token (for example, user identity and search queries for open PRs as implemented in the extension). **What is not sent to us**: Nothing is sent to the extension author; requests go from your browser to GitHub only.

You can opt out by removing the token and disabling PR-related options.

## Data Security

- Preferences and keys remain in **local extension storage** on your device unless you export them yourself.
- **Network requests** are made **only** for optional features: cloud AI providers when you use AI organisation with one selected, and GitHub when you use GitHub-related features with a token configured. Dedupe-only usage, and AI organisation with an on-device provider, do not require those calls.
- The extension author does not receive your tab data, keys, or tokens.

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last Updated" date at the top of this document.

## Contact

If you have questions about this privacy policy, please contact us through the Chrome Web Store listing.

## Compliance

This extension complies with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)


