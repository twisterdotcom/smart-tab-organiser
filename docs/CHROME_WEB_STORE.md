# Chrome Web Store submission guide

This document contains the text and steps for the first Chrome Web Store submission.

## Build the upload package

1. Generate the icons after a source-image change:

   ```sh
   ./scripts/generate-icons.sh
   ```

2. Build the release ZIP:

   ```sh
   python3 scripts/build-release.py
   ```

3. Validate the listing images:

   ```sh
   python3 scripts/validate-store-assets.py
   ```

4. Load the extracted ZIP in a new Chrome profile.
5. Complete the manual tests in this document.
6. Upload the ZIP from `dist/` to the Developer Dashboard.

The build script includes only the approved package files. It validates the manifest, HTML, icons, ZIP contents, and common remote-code patterns.

The store-asset validator requires at least one real extension screenshot. It also validates the promotional image dimensions.

## Product details

### Name

Smart Tab Organiser

### Summary

Find duplicate tabs, maintain pinned and GitHub groups, and organize the current window with optional local or cloud AI.

### Single purpose

Smart Tab Organiser manages tabs in the active browser window. It finds duplicates, maintains selected groups, and organizes tabs by user-defined or AI-assisted rules.

### Detailed description

Smart Tab Organiser keeps a busy browser window under control.

Use the toolbar action to remove duplicate tabs and apply your pinned-tab list. The extension can keep the tab with the highest anchor number, such as the latest GitHub issue comment.

Use tab groups to separate work by topic. AI organization can use Chrome built-in AI, a local model server, or a cloud provider with your API key.

Optional GitHub features maintain a PRs group for open pull requests. The PR feature opens missing tabs for matching pull requests returned by GitHub. The extension can also move closed issue tabs into a Closed group.

Core tab management works without an account. The extension has no advertising, analytics, telemetry, or developer-operated server.

Cloud AI is optional. When you use it, the extension sends tab titles, sanitized URLs, custom instructions, and relevant group names to your selected provider.

## Category and language

- Primary category: Productivity
- Language: English
- Mature content: No

## Permission justifications

### `tabs`

The extension reads titles and URLs in the active window. It uses them to find duplicates and classify tabs.

User-started actions can close, reload, pin, move, and reorder tabs. `activeTab` is not sufficient because the features operate on multiple tabs.

### `storage`

The extension stores settings and optional credentials in `chrome.storage.local`. It does not use synchronized storage.

### `tabGroups`

The extension creates and updates tab groups. It also collapses, expands, and removes groups at the user's request.

### `notifications`

The extension shows progress, results, and errors for long-running tab operations.

### `contextMenus`

The extension adds user-started tab-management commands to its action menu.

### Host permissions for AI APIs

The extension contacts OpenAI, Anthropic, or Google only for cloud AI organization. The user selects a provider and supplies its API key.

### Host permission for `api.github.com`

When the user enables a GitHub group feature, the extension retrieves open pull requests, issue states, and issue label names.

The issue-label feature uses the existing per-issue GitHub REST request and the existing `api.github.com` host permission. It requires no new host permission.

### Host permissions for `localhost` and `127.0.0.1`

The extension contacts an optional model server on the same computer. It restricts this feature to loopback addresses.

## Remote-code declaration

Select **No, I am not using remote code**.

All executable code is in the extension package. API responses are data. The extension parses AI responses as group names and tab indices, and never executes them.

## Data-use disclosures

Select the dashboard categories that cover these data types:

- Personally identifiable information: The GitHub feature temporarily reads the authenticated GitHub username.
- Authentication information: The extension stores user-supplied API keys and a GitHub token locally.
- Web history: The extension reads current-window tab URLs and titles.
- Website content: The extension reads page titles, GitHub issue states, and GitHub issue label names.

Also disclose these user-provided values in the free-text fields:

- Custom AI instructions
- Pinned URL rules
- Provider and model settings
- Existing tab-group names used for AI organization
- GitHub issue label names in settings

The extension uses GitHub issue states and label names only during the current operation. It does not store GitHub API responses afterward.

The extension uses this data only for its tab-management purpose. It does not sell data or use data for advertising or credit decisions.

Privacy policy URL:

`https://github.com/twisterdotcom/smart-tab-organiser/blob/main/PRIVACY_POLICY.md`

## Support and homepage

- Homepage: `https://github.com/twisterdotcom/smart-tab-organiser`
- Support: `https://github.com/twisterdotcom/smart-tab-organiser/issues`

## Test instructions for reviewers

No account or API key is required for the core features.

1. Open two tabs with the same URL.
2. Click the extension icon.
3. Make sure that one duplicate closes.
4. Open the extension options page.
5. Add a public test URL to the pinned URL list.
6. Run **Deduplicate and tidy pinned tabs**.
7. Make sure that the matching tab is pinned.
8. Use the action menu to collapse and expand tab groups.

Cloud AI requires a user-supplied provider key. GitHub groups require a user-supplied GitHub token.

Chrome built-in AI requires a supported Chrome version, suitable hardware, and a downloaded local model. Local AI requires a loopback model server.

## Manual release tests

Use a new Chrome profile for these tests.

- Install the extracted release ZIP without an error.
- Open the options page and inspect its console.
- Inspect the extension service-worker console.
- Make sure that the options page makes no automatic external request.
- Test duplicate detection with query and fragment settings.
- Test pinned-tab creation, order changes, and soft rules.
- Make sure that stale PR tabs remain open after a PR-group refresh.
- Test valid, invalid, and missing GitHub tokens.
- Test each advertised AI provider that is available.
- Test provider fallback and the cloud-fallback opt-in.
- Test local-server rejection for a non-loopback address.
- Remove saved credentials and make sure that their fields stay empty.
- Uninstall the extension and make sure that its local settings are removed.

## Listing assets

Upload these files:

- Store icon: `icons/icon128.png`
- Small promotional image: `store-assets/promotional/small-promo-440x280.png`
- Marquee image: `store-assets/promotional/marquee-promo-1400x560.png` (optional)
- Screenshots from `store-assets/screenshots/`

The store requires at least one screenshot. Review each image for private data before upload.

## Account and publication

1. Register the Chrome Web Store developer account.
2. Pay the one-time registration fee.
3. Enable two-step verification.
4. Set the publisher name.
5. Verify the contact email.
6. Complete the applicable trader-status declaration.
7. Complete the Store Listing, Privacy, Distribution, and Test Instructions tabs.
8. Select deferred publication for the first review.
9. Submit the extension for review.
10. Publish the approved version within 30 days.
