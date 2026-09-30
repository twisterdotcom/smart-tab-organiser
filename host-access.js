/**
 * Which hosts may be reached over plain HTTP (options page + service worker).
 *
 * Every AI request carries tab titles and URLs, so the extension only speaks
 * `http://` to hosts that cannot leave the user's own machine or local network:
 *   - loopback: `localhost`, `*.localhost`, `127.0.0.0/8`, `::1`
 *   - private networks: RFC 1918 (`10/8`, `172.16/12`, `192.168/16`),
 *     RFC 6598 CGNAT `100.64/10` (Tailscale and similar), RFC 3927 link-local
 *     `169.254/16`, IPv6 unique local `fc00::/7` and link-local `fe80::/10`
 * Every other host must use HTTPS. Loopback is the only group the manifest
 * permits up front; the private ranges still need an origin-scoped permission
 * the user grants from the options page.
 */
(function (g) {
  'use strict';

  var ALLOWED_HTTP_HOSTS_HINT = 'HTTP is allowed only for localhost or 127.0.0.1, '
    + 'or a private-network address (10.x, 172.16-31.x, 192.168.x, 100.64-127.x, 169.254.x, '
    + 'and IPv6 fc00::/7 or fe80::/10).';

  /** Strip the brackets `URL` keeps around IPv6 hosts, plus any zone id. */
  function normalizeHostname(hostname) {
    var value = String(hostname || '').trim().toLowerCase();
    if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
    return value.split('%')[0];
  }

  /** Parse a dotted-quad IPv4 literal, rejecting anything else (names, leading zeros). */
  function parseIpv4(value) {
    var parts = value.split('.');
    if (parts.length !== 4) return null;
    var octets = [];
    for (var i = 0; i < parts.length; i++) {
      if (!/^(?:0|[1-9]\d{0,2})$/.test(parts[i])) return null;
      var octet = Number(parts[i]);
      if (octet > 255) return null;
      octets.push(octet);
    }
    return octets;
  }

  function isPrivateIpv4Octets(octets) {
    var a = octets[0];
    var b = octets[1];
    if (a === 10) return true;                            // RFC 1918 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;    // RFC 1918 172.16.0.0/12
    if (a === 192 && b === 168) return true;              // RFC 1918 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true;    // RFC 6598 100.64.0.0/10
    if (a === 169 && b === 254) return true;              // RFC 3927 169.254.0.0/16
    return false;
  }

  function isPrivateIpv4(value) {
    var octets = parseIpv4(value);
    return !!octets && isPrivateIpv4Octets(octets);
  }

  function isLoopbackIpv4(value) {
    var octets = parseIpv4(value);
    return !!octets && octets[0] === 127;
  }

  /** Expand any IPv6 form into its eight 16-bit groups, or null if it is not one. */
  function parseIpv6(value) {
    if (!value.includes(':')) return null;
    var text = value;
    // `URL` serializes an embedded IPv4 tail in hex, but accept the dotted form too.
    var embedded = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (embedded) {
      var octets = parseIpv4(embedded[2]);
      if (!octets) return null;
      text = embedded[1]
        + ((octets[0] << 8) | octets[1]).toString(16) + ':'
        + ((octets[2] << 8) | octets[3]).toString(16);
    }

    var halves = text.split('::');
    if (halves.length > 2) return null;
    var head = halves[0] ? halves[0].split(':') : [];
    var tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
    var gap = 8 - head.length - tail.length;
    if (halves.length === 2 ? gap < 0 : gap !== 0) return null;

    var groups = head.concat(new Array(gap > 0 ? gap : 0).fill('0'), tail);
    if (groups.length !== 8) return null;
    var numbers = [];
    for (var i = 0; i < groups.length; i++) {
      if (!/^[0-9a-f]{1,4}$/.test(groups[i])) return null;
      numbers.push(parseInt(groups[i], 16));
    }
    return numbers;
  }

  /** True for the private-network ranges above, given eight 16-bit groups. */
  function isPrivateIpv6Groups(groups) {
    var head = groups[0];
    // ::ffff:192.168.1.5 is an IPv4 address wearing an IPv6 hat; judge the IPv4 part.
    var zeroPrefixed = groups[5] === 0xffff
      && groups.slice(0, 5).every(function (group) { return group === 0; });
    if (zeroPrefixed) {
      return isPrivateIpv4Octets([
        groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff,
      ]);
    }
    if ((head & 0xfe00) === 0xfc00) return true;           // fc00::/7 unique local
    if ((head & 0xffc0) === 0xfe80) return true;           // fe80::/10 link-local
    return false;
  }

  function isPrivateIpv6(value) {
    var groups = parseIpv6(value);
    return !!groups && isPrivateIpv6Groups(groups);
  }

  function isLoopbackIpv6(value) {
    var groups = parseIpv6(value);
    if (!groups) return false;
    // ::1, and ::ffff:127.0.0.1
    if (groups[7] !== 1) return false;
    return groups.slice(0, 7).every(function (group) { return group === 0; })
      || (groups[5] === 0xffff
        && groups.slice(0, 5).every(function (group) { return group === 0; })
        && (groups[6] >> 8) === 127);
  }

  /** True for `localhost`, `*.localhost`, `127.0.0.0/8`, and IPv6 loopback. */
  function isLoopbackHostname(hostname) {
    var value = normalizeHostname(hostname);
    if (!value) return false;
    if (value === 'localhost' || value.endsWith('.localhost')) return true;
    return isLoopbackIpv4(value) || isLoopbackIpv6(value);
  }

  /** True for the private-network ranges listed at the top of this file. */
  function isPrivateNetworkHostname(hostname) {
    var value = normalizeHostname(hostname);
    if (!value) return false;
    return isPrivateIpv4(value) || isPrivateIpv6(value);
  }

  /** Whether an `http://` URL to this host may be used without transport encryption. */
  function allowsPlainHttpUrl(urlObj) {
    if (String(urlObj?.protocol || '').toLowerCase() !== 'http:') return false;
    return isLoopbackHostname(urlObj?.hostname) || isPrivateNetworkHostname(urlObj?.hostname);
  }

  /**
   * Which hosts the local model provider may talk to: this computer or the local
   * network, on HTTP or HTTPS. A public host belongs to the OpenAI Compatible
   * provider instead, which has its own key and permission handling.
   */
  function allowsLocalProviderUrl(urlObj) {
    var protocol = String(urlObj?.protocol || '').toLowerCase();
    if (protocol === 'http:') return allowsPlainHttpUrl(urlObj);
    if (protocol === 'https:') {
      return isLoopbackHostname(urlObj?.hostname) || isPrivateNetworkHostname(urlObj?.hostname);
    }
    return false;
  }

  /**
   * Loopback origins already covered by `host_permissions`, so they never need a
   * runtime permission request. Kept narrow on purpose: `127.0.0.2` and `::1` are
   * loopback but absent from the manifest, so they take the permission path.
   */
  function isStaticallyAllowedUrl(urlObj) {
    if (!isLoopbackHostname(urlObj?.hostname)) return false;
    if (String(urlObj?.protocol || '').toLowerCase() !== 'http:') return false;
    var host = normalizeHostname(urlObj?.hostname);
    return host === 'localhost' || host === '127.0.0.1';
  }

  /** The Chrome match pattern covering one origin. */
  function originPattern(urlObj) {
    return urlObj.protocol + '//' + urlObj.host + '/*';
  }

  g.HostAccess = {
    ALLOWED_HTTP_HOSTS_HINT: ALLOWED_HTTP_HOSTS_HINT,
    allowsLocalProviderUrl: allowsLocalProviderUrl,
    allowsPlainHttpUrl: allowsPlainHttpUrl,
    isLoopbackHostname: isLoopbackHostname,
    isPrivateNetworkHostname: isPrivateNetworkHostname,
    isStaticallyAllowedUrl: isStaticallyAllowedUrl,
    normalizeHostname: normalizeHostname,
    originPattern: originPattern,
  };
})(globalThis);