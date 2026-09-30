# Release notes

## Unreleased

### Added

- Added a toolbar-click setting for GitHub label-group sync.
- Added Chrome colour selectors for each configured GitHub label and the PRs group.
- Allowed plain HTTP to private-network hosts (`10.x`, `172.16`–`172.31.x`, `192.168.x`, `100.64`–`100.127.x`, `169.254.x`, IPv6 `fc00::/7` and `fe80::/10`) for both the local model server and a custom OpenAI-compatible host. Each such host still needs its own host access, requested once from Options.

### Changed

- Configured settings now control label-group colours. GitHub label colours no longer control them.
- Managed groups now appear after pinned tabs in this order: BOOKMARKS, PRs, configured labels, Closed.
- Default label colours avoid the BOOKMARKS, PRs, and Closed colours until the available palette is full.
- Renamed "Loopback model server" to "Local model server", which it now describes more accurately.
- Added `http://*/*` as an optional host permission so a private-network host can be granted. Requests stay scoped to the single origin the user typed, and public `http://` hosts remain blocked.

### Privacy and security

- Documented that plain HTTP to a private-network host is unencrypted on the local network, unlike loopback traffic.

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
