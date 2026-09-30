# Privacy Policy for Smart Tab Organiser

**Last updated:** September 29, 2026

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

API keys and the GitHub token are authentication information. The extension stores them in the user's Chrome profile until the user removes them or uninstalls the extension.

The extension sends a credential only to the service that issued it. The extension sends credentials in request headers, not in request URLs.

Users can reduce financial risk by using dedicated provider keys with spending limits.

## Network use

### Core tab management

Duplicate removal, pinned-tab management, tab reloading, and local tab grouping do not contact a developer server. These features process tab data in Chrome.

### Cloud AI providers

Cloud AI is optional. When the user selects a cloud provider and starts AI organization, the extension sends data directly to that provider.

Provider fallback is off by default. If the user enables fallback, the extension can send the same data to each eligible provider that it attempts. A provider can receive the prompt even when its request fails.

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

### Custom OpenAI-compatible hosts

The OpenAI Compatible API Host option is optional. The user must provide a base URL and model name before the extension will use it.

API key use depends on the selected host. Some hosts require a key, and some self-hosted setups do not.

The extension requests host permission for a custom host only when the user tests that host or starts organization with it. The request is scoped to the configured host origin.

For custom hosts on the public internet, the extension requires HTTPS. The extension blocks public `http://` custom hosts to avoid sending prompts or credentials without transport encryption.

The extension allows `http://` only for hosts that cannot leave the user's own machine or local network: the statically permitted loopback hosts on the same computer (`localhost` and `127.0.0.1`), and private-network addresses — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10` (carrier-grade NAT, including Tailscale), `169.254.0.0/16`, and the IPv6 ranges `fc00::/7` and `fe80::/10`. Every private-network host still needs its own origin-scoped permission, which the user grants from the options page.

### Provider fallback

All provider fallback is off by default. The user must enable fallback before the extension attempts another provider.

A cloud primary can use another configured cloud provider as a fallback. A local primary requires a separate cloud-fallback setting before it can use a cloud provider.

The options page shows the provider order before the user starts organization.

### Chrome built-in AI

Chrome built-in AI processes the prompt on the user's computer. The extension does not send the prompt to the extension developer or a cloud AI API.

Chrome can download the local model from Google. Chrome controls that model download, and the download does not include tab data.

### Local model server

The local-model feature sends the AI prompt to a server on the user's own computer or local network. That is either a loopback host (`localhost`, `127.0.0.1`, or another address in `127.0.0.0/8`) or a private-network address as listed above, such as `192.168.1.20`. A server on another machine in the network requires the user to grant host access for that host from the options page.

The extension sends tab URLs without query parameters or fragments. URL paths can still contain personal or sensitive information.

The server configuration determines whether the server processes the prompt locally or forwards it elsewhere. The server also controls its logs and data retention.

The local server can use HTTP because the first network hop stays on the user's own machine or network. A request to a loopback host stays on the same computer. A request to a private-network host can be read by other devices on that local network, so it is unencrypted and should only be used on a network the user trusts. The extension does not permit any other `http://` host for this feature.

The extension developer does not receive local-model requests or responses.

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

- With OpenAI, Anthropic, or Google when the user starts cloud AI organization, including an enabled fallback
- With a configured custom OpenAI-compatible host when the user tests that host or starts AI organization with it
- With GitHub when the user enables or starts a GitHub group feature
- With a local model server when the user selects the local-model provider — on the same computer, or on the user's own network when they have granted host access for that host

The extension does not sell user data. It does not use user data for advertising, credit decisions, or unrelated profiling.

## Data retention and removal

Local settings and credentials remain until the user removes them or uninstalls the extension. The user can remove a credential by clearing its field on the options page.

Chrome removes extension-local storage when the user uninstalls the extension. A third-party provider can retain API data under its own terms and account settings.

## Security

Cloud AI and GitHub requests use HTTPS. Custom OpenAI-compatible hosts require HTTPS unless they are loopback hosts on the same computer or a private-network host, each of which needs its own granted origin permission. Local-model requests are restricted to loopback addresses and private-network addresses. Plain HTTP to a private-network host is unencrypted on that network; the server controls any later connection.

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
| Optional host permission (`https://*/*`) | Allow runtime, origin-scoped HTTPS access for a configured custom OpenAI-compatible host after a user gesture. |
| Optional host permission (`http://*/*`) | Allow runtime, origin-scoped HTTP access to a private-network host on the user's own network (for example `192.168.1.20` or `100.64.0.1`) after a user gesture. Chrome match patterns cannot express a private range, so the request is scoped to the single origin the user typed. The extension requests this only for private-network hosts and never for a public `http://` host. Loopback HTTP uses the static `localhost` and `127.0.0.1` permissions above. |
| `api.github.com` | Run optional GitHub PR, Closed, and issue-label group features. |
| `localhost` and `127.0.0.1` | Contact an optional model server on the same computer. |

## Chrome Web Store Limited Use

The use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Policy changes

The developer will update this policy when the extension's data practices change. The date at the top identifies the current version.

## Contact

For privacy questions or support, open an issue in the [Smart Tab Organiser support tracker](https://github.com/twisterdotcom/smart-tab-organiser/issues). Do not include credentials or private URLs in a public issue.
