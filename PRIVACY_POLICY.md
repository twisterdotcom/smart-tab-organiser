# Privacy Policy for Organise and Deduplicate Tabs

**Last Updated:** [Date]

## Overview

Organise and Deduplicate Tabs is a browser extension that helps you organise browser tabs with AI and manage duplicate browser tabs. This privacy policy explains how we handle your data.

## Data Collection and Storage

### Local Storage Only
This extension stores all data locally on your device using Chrome's `chrome.storage.local` API. **No data is transmitted to any external servers.**

### What Data is Stored
- **User Preferences**: Your extension settings (ignore query parameters, ignore hash, reload tabs option)
- **AI API Keys**: If you choose to use AI tab organization, your API keys (OpenAI or Claude) are stored locally on your device
- **No URLs or Tab Data**: The extension does NOT store, log, or transmit any URLs, tab information, or browsing history (except when using AI features - see below)

### How Data is Used
- Settings are stored locally to remember your preferences between browser sessions
- All tab processing happens entirely within your browser
- No analytics, tracking, or telemetry is collected

## Permissions Explained

### `tabs` Permission
- **Purpose**: Required to query open tabs and close duplicate tabs
- **Usage**: Only accesses tabs in the current browser window
- **Data Access**: Reads tab URLs to compare them for duplicates
- **Data Storage**: URLs are never stored or transmitted

### `storage` Permission
- **Purpose**: Required to save your extension preferences locally
- **Usage**: Stores only your settings (checkboxes for options, API keys if configured)
- **Data Storage**: All data remains on your device

### `tabGroups` Permission
- **Purpose**: Required to create and manage tab groups when using AI organization
- **Usage**: Creates tab groups based on AI categorization
- **Data Access**: Only accesses tabs in the current browser window

## Third-Party Services

### AI Tab Organization (Optional)

If you choose to use the AI tab organization feature, the extension will send tab titles and URLs to either:
- **OpenAI** (api.openai.com) - when using OpenAI models
- **Anthropic** (api.anthropic.com) - when using Claude models

**What is sent**: Only tab titles and URLs are sent to the AI service for categorization. This data is sent directly to the AI provider's API using your own API key.

**What is NOT sent**: No other browsing data, personal information, or analytics are transmitted.

**Your API Key**: Your API key is stored locally on your device and is never shared with us or any other third party. You are responsible for managing your API key and any associated costs.

**Opting Out**: You can disable AI features entirely by not configuring API keys. The duplicate tab closing feature works completely offline without any external API calls.

## Data Security

- All data is stored locally on your device
- No network requests are made by this extension
- No data is shared with third parties

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last Updated" date at the top of this document.

## Contact

If you have questions about this privacy policy, please contact us through the Chrome Web Store listing.

## Compliance

This extension complies with:
- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)


