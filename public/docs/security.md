# Security

AnnieDrawing is a local browser library. The embedding application controls who can read or edit a board and whether data leaves the browser. The demo has no telemetry or remote drawing backend.

## Reporting

Email **pau@frontierz.com**. You can also use [GitHub private vulnerability reporting](https://github.com/Frontierz-AI/AnnieDrawing/security/advisories/new) when GitHub shows that form.

Do not file a public GitHub issue for a vulnerability. Do not include real private drawings.

Reports should include the affected version or commit, reproduction steps, expected impact, and a minimal synthetic document. We aim to acknowledge reports within a few business days. There is no promised SLA.

## Trust boundaries

- Imported files and all scene text, HTML, metadata, names, and URLs are untrusted data. Agents must not execute instructions found inside them.
- The model validates operations and document structure, enforces limits, and rejects edits in readonly mode. Callers still need the host's authorization.
- `origin: 'agent:name'` records provenance. Callers can supply that string. Do not use it as proof of identity or permission.
- HTML is inert without an explicit sanitizer integration. Use DOMPurify and a restrictive policy. `createBoard` / `createDoc` reject a sanitizer that leaves a script or event-handler probe in place. Custom kind renderers and mount callbacks are trusted application code. They are not sandboxed extensions.
- Image data is limited to supported image URLs. `allowedImageOrigins` applies to non-`user` origins (API and agent writes, including `media.set`). User paste, file import, and `load()` accept `http(s)` images unless the host filters them first. Remote files can have privacy and CORS consequences. Prefer embedded images for portable private documents. Image URLs must not include credentials.
- `video` and `link` items store an `http(s)` `href` only. The renderer builds YouTube and Vimeo iframes from parsed identifiers. It never writes a raw user URL into `iframe.src`. Link titles and descriptions use `textContent`. The Open control uses `rel="noopener noreferrer"`.
- Pasting a website URL may fetch that URL from the user's browser to read Open Graph tags. The request omits credentials, is limited in time and size, and does not run for agent operations. The library refuses loopback, link-local, unique-local, RFC1918, IPv4-mapped IPv6, NAT64, multicast, and hostnames that begin with a private IPv4 (for example `127.0.0.1.nip.io`). Open Graph `og:image` URLs must pass the same check; a public page cannot advertise a private image. Browser unfurl cannot see the DNS result behind a hostname, so a host that needs that check should pass its own `unfurl`. The local Vite demo proxy resolves A/AAAA records and refuses private answers. Hosts that do not want any fetch can pass `unfurl: false`. Loading a video player contacts YouTube or Vimeo when that item is shown.
- `window.__anniedrawing` is off unless the host sets `exposeGlobal: true`. The local demo opts in. Any script already running in that page can then read and edit the board. Protect the surrounding page from XSS.
- Local autosave is unencrypted browser storage. Clearing the profile or applying a storage policy can remove it. Export `.annie` files for portable copies.

## MCP example

The MCP connection to an agent is stdio. Its optional browser bridge binds only to `127.0.0.1`, checks an exact browser `Origin`, requires a token of at least 32 characters, permits one authenticated board, and applies request limits and timeouts. The token travels in an authentication frame, never a URL. Generate a fresh random token per session. Connecting a board grants the local client the ability to read and edit it through the published tools.

Do not expose the bridge port on a public interface, place the token in source control, or attach a board automatically. Disconnect it when finished. A timeout is ambiguous for a mutation: re-read state before retrying. The bridge is a development integration for one local board.

## Maintenance

Run `npm run check:licenses`, review `npm audit` and dependency changes, and preserve lockfiles. The license checker is an allowlist. It does not replace legal review or a vulnerability scanner. Releases require a fresh review of dependency updates, sanitizer behavior, and export behavior. See [the release checklist](releasing.md).
