# Privacy Policy for Smart Tab Organiser

**Last updated:** August 20, 2026

## Overview

Smart Tab Organiser manages tabs in the current browser window. It can remove duplicate tabs, manage pinned tabs, maintain GitHub groups, and organize tabs with AI.

The developer does not operate a server for this extension. The extension has no analytics, advertising, telemetry, or user account.

## Data that the extension handles

### Tab data

The extension reads these properties for tabs in the current window:

- The tab title and URL
- The pinned state and position
- The tab-group identifier and group name
- The last-accessed value, when Chrome provides it

The extension uses this data to compare, close, reload, pin, move, and group tabs. It does not read page bodies, cookies, form values, or browsing history from other windows.

A tab title or URL can contain personal or sensitive information. A URL can include this information in its path, query parameters, or fragment.

### Settings and user-provided content

The extension stores these values in `chrome.storage.local`:

- Duplicate-detection settings
- Pinned URL rules
- Tab-group settings
- AI provider and model settings
- Custom AI instructions
- Optional API keys and a GitHub token

Chrome stores this data in storage that belongs to the extension. The extension does not synchronize this data through `chrome.storage.sync`.

### Authentication information

API keys and the GitHub token are authentication information. The extension stores them locally until the user removes them or uninstalls the extension.

The extension sends a credential only to the service that issued it. The extension sends credentials in request headers, not in request URLs.

## Network use

### Core tab management

Duplicate removal, pinned-tab management, tab reloading, and local tab grouping do not contact a developer server. These features process tab data in Chrome.

### Cloud AI providers

Cloud AI is optional. When the user selects a cloud provider and starts AI organization, the extension sends data directly to that provider.

The request can include:

- Tab titles
- Tab URLs without query parameters or fragments
- Custom AI instructions
- Relevant existing group names and sample tab titles

The URL path can still contain personal or sensitive information. The extension does not send page bodies, cookies, or form values.

The selected provider processes the request under its own terms and privacy policy:

- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy/)
- [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
- [Google Privacy Policy](https://policies.google.com/privacy)

The user's provider account controls API costs and provider-side retention. The extension developer does not receive these requests or responses.

### Cloud fallback

Cloud fallback is off by default for an on-device primary provider. The user must enable cloud fallback before an on-device failure can send tab data to a cloud provider.

A cloud primary can use another configured cloud provider as a fallback. The options page shows the provider order before the user starts organization.

### Chrome built-in AI

Chrome built-in AI processes the prompt on the user's computer. The extension does not send the prompt to the extension developer or a cloud AI API.

Chrome can download the local model from Google. Chrome controls that model download, and the download does not include tab data.

### Local model server

The local-model feature sends the AI prompt to `localhost` or `127.0.0.1`. This loopback request goes to software on the same computer, such as Ollama or LM Studio.

The local server can use HTTP because the traffic stays on the same computer. The extension does not permit a local-model address on another computer or network host.

The local server controls its own logs and data retention. The extension developer does not receive local-model requests or responses.

### GitHub API

GitHub tab groups are optional. When the user enables them, the extension contacts `api.github.com` with the user's GitHub token.

The PR group feature:

- Requests the authenticated GitHub username
- Searches for open pull requests authored by that user
- Searches for open pull requests that request that user's review
- Receives pull-request URLs from GitHub
- Opens missing tabs for matching pull requests returned by GitHub and places them in the PRs group

The Closed and issue-label group features use the existing per-issue GitHub REST request. The extension sends a repository name and issue number from each GitHub issue tab.

GitHub returns the current issue state and label names. The extension does not store the GitHub username or GitHub API responses after the operation.

The issue-label feature uses the existing `api.github.com` host permission. It requires no new host permission.

GitHub processes requests under the [GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

## Data sharing

The extension shares data only for the user-facing features described in this policy:

- With OpenAI, Anthropic, or Google when the user starts cloud AI organization
- With GitHub when the user enables or starts a GitHub group feature
- With a loopback model server when the user selects the local-model provider

The extension does not sell user data. It does not use user data for advertising, credit decisions, or unrelated profiling.

## Data retention and removal

Local settings and credentials remain until the user removes them or uninstalls the extension. The user can remove a credential by clearing its field on the options page.

Chrome removes extension-local storage when the user uninstalls the extension. A third-party provider can retain API data under its own terms and account settings.

## Security

Cloud AI and GitHub requests use HTTPS. Local-model requests are restricted to loopback addresses on the same computer.

The extension package contains all executable code. It does not download or execute remote JavaScript or WebAssembly.

## Permissions

| Permission | Use |
| --- | --- |
| `tabs` | Read tab titles and URLs, then close, reload, pin, move, or reorder tabs. |
| `storage` | Store settings and optional credentials in extension-local storage. |
| `tabGroups` | Create, update, collapse, expand, and remove tab groups. |
| `notifications` | Show progress, results, and errors for user-started operations. |
| `contextMenus` | Add tab-management commands to the extension action menu. |
| AI API hosts | Send user-started requests to the selected cloud AI provider. |
| `api.github.com` | Run optional GitHub PR, Closed, and issue-label group features. |
| `localhost` and `127.0.0.1` | Contact an optional model server on the same computer. |

## Chrome Web Store Limited Use

The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Policy changes

The developer will update this policy when the extension's data practices change. The date at the top identifies the current version.

## Contact

For privacy questions or support, open an issue in the [Smart Tab Organiser support tracker](https://github.com/twisterdotcom/smart-tab-organiser/issues). Do not include credentials or private URLs in a public issue.
