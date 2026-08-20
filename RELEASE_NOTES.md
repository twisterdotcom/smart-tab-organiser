# Release notes

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
