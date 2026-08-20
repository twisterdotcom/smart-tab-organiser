# Release notes

## 1.3.1 — August 20, 2026

### Changed

- Updated OpenAI, Anthropic, and Gemini selectors to current stable models.
- Added Claude Opus 5, Gemini 3.7 Flash, Gemini 3.6 Flash, and Gemini 3.5 Flash-Lite.
- Removed retired, deprecated, and endpoint-incompatible model choices.
- Made provider fallback an explicit opt-in.
- Streamed loopback model responses to stay within the Chrome service-worker fetch limit.
- Removed Gemini sampling parameters that Google deprecated.
- Removed the default keyboard shortcut because it conflicted with a Chrome shortcut.

### Cleanup

- Removed obsolete submission instructions, asset READMEs, and one-time image generators.
- Removed unreachable split-view AI logic and stale popup message handling.
- Removed unused pinned-URL, GitHub storage, and model-catalog compatibility code.
- Simplified PR-group updates and duplicate-tab comparison logic.

### Privacy and security

- Clarified that each attempted fallback provider can receive the AI prompt.
- Clarified that loopback server configuration controls any later data forwarding.
- Sanitized URLs for every AI provider.
- Added guidance for dedicated provider keys with spending limits.

### Validation

- All 19 automated tests pass.
- Manifest V3, HTML, icons, store images, package contents, and remote-code checks pass.

## 1.3.0 — August 20, 2026

### Added

- Added optional GitHub issue groups that use an ordered list of label names.
- Added exact, case-insensitive label matching.
- Added priority matching. The first configured label that matches an issue selects its group.
- Added a **Dedupe and refresh label groups** action.
- Added cleanup for removed labels, reopened issues, and tabs that leave a GitHub issue page.

### Changed

- GitHub issue grouping now runs after duplicate removal.
- The **Closed** group takes priority over configured label groups.
- The AI action on the Options page now removes duplicate tabs before organization.
- GitHub issue state and label groups now share one metadata request for each unique issue.

### Reliability

- Pinned and split-view tabs remain unchanged.
- Managed GitHub groups remain unchanged during AI organization and **Ungroup All**.
- Tabs remain unchanged when GitHub does not return their issue details.
- The extension validates tab state before and after each group change.
- GitHub issue refreshes run in order for each browser window.

### Privacy and permissions

- The feature uses the existing `https://api.github.com/*` host permission.
- The release adds no Chrome permissions.
- GitHub returns issue states and label names. The extension does not store API responses after an operation.

### Validation

- All 11 automated tests pass.
- Manifest V3, HTML, icon, package-content, and remote-code checks pass.
