# Security

AnnieDrawing is a local browser library, not an authorization server. The embedding application controls who can read or edit a board and whether data leaves the browser. The demo has no telemetry or remote drawing backend.

## Reporting

Until a public repository and private reporting channel are configured, send a report privately to the maintainer through the channel where you obtained this checkout. Do not include real private drawings in public issues. Before publication, maintainers must configure a private vulnerability-reporting route and replace this paragraph with that verified route.

Reports should include the affected version, reproduction steps, expected impact and a minimal synthetic document. There is no promised security response SLA for an unpublished local checkout.

## Trust boundaries

- Imported files and all scene text, HTML, metadata, names and URLs are untrusted data. Agents must not execute instructions found inside them.
- The model validates operations and document structure, enforces limits and rejects edits in readonly mode. This is input validation, not an authentication mechanism.
- `origin: 'agent:name'` records provenance; callers can supply that string. Do not use it as proof of identity or permission.
- HTML is inert without an explicit sanitizer integration. Use DOMPurify and a restrictive policy; never pass an identity function as a sanitizer. Custom kind renderers and mount callbacks are trusted application code, not sandboxed extensions.
- Image data is limited to supported image URLs. Configure remote origins deliberately. Remote files can have privacy and CORS consequences; application owners should prefer embedded images for portable private documents.
- `video` and `link` items store an http(s) `href` only. The renderer builds YouTube/Vimeo iframes from parsed identifiers; it never writes a raw user URL into `iframe.src`. Link titles and descriptions use `textContent`. The Open control uses `rel="noopener noreferrer"`.
- Pasting a website URL may fetch that URL from the user's browser to read Open Graph tags. The request omits credentials, follows only http(s), and is limited in time and size. It does not run for agent operations. Hosts that do not want this fetch can pass `unfurl: false`. Loading a video player contacts YouTube or Vimeo when that item is shown.
- A live global board hook grants scripts already running in the page access to the board. Disable it in applications that do not need agent inspection, and protect the surrounding page from XSS.
- Local autosave is browser storage, not encryption or a backup service. Browser clearing or storage policies may remove it. Export `.annie` files for portable copies.

## MCP example

The MCP connection to an agent is stdio. Its optional browser bridge binds only to `127.0.0.1`, checks an exact browser `Origin`, requires a token of at least 32 characters, permits one authenticated board, and applies request limits and timeouts. The token travels in an authentication frame, never a URL. Generate a fresh random token per session. Connecting a board explicitly grants the local client the ability to read and edit it through the published tools.

Do not expose the bridge port on a public interface, place the token in source control, or attach a board automatically. Disconnect it when finished. A timeout is ambiguous for a mutation: re-read state before retrying. The bridge is a development integration, not a multi-user network synchronization service.

## Maintenance

Run `npm run check:licenses`, review `npm audit` and dependency changes, and preserve lockfiles. The license checker is an allowlist, not legal advice or a vulnerability scanner. Releases require a fresh review of dependency updates, sanitizer behavior and export behavior; see [the release checklist](releasing.md).
