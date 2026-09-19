# Release checklist

The checkout is prepared for an open-source release. Publication remains a maintainer action. Do not infer npm ownership, a GitHub URL, hosting configuration, trademark permission or a private contact address from the package name.

## Before the first public release

- Confirm the repository owner and real public remote. Add the verified `repository`, `bugs` and `homepage` fields to `package.json`.
- Confirm access to the intended npm package name and organization. Check the intended release version and update the changelog.
- Configure a private security-reporting channel and community contact. Replace the temporary directions in `SECURITY.md` and `CODE_OF_CONDUCT.md` with verified routes.
- Review the license, third-party notices, DCO requirements and provenance. Keep full dependency and font notices in distributed bundles where required.
- Enable branch protections and required CI/DCO checks. The repository workflow cannot enable hosting-side settings on its own.

## Verify the exact release tree

```sh
npm ci
npm ci --prefix examples/mcp
npm run check
npm run build:demo
npx playwright install --with-deps chromium firefox webkit
npm run test:e2e
npm run test:perf
npm test --prefix examples/mcp
node examples/mcp/live-smoke.mjs
npm run test:consumer
npm pack --dry-run
```

Inspect the tarball contents: compiled JavaScript, declarations, CSS, README, license, notices and AI documentation. The package must not contain private source documents, local drawings, tokens, browser artifacts or `node_modules`. Install the tarball into a clean consumer and exercise both `anniedrawing` and `anniedrawing/core`. Validate all declared package exports.

Test the demo with mouse, keyboard and a touch device; verify cancellation, undo/redo, pages, autosave recovery and file import/export. Test a keyboard-only first run and reduced-motion behavior. Check PNG export with embedded media and the explicit limitations of remote images/custom HTML. Browser timing is machine-dependent; record the environment with performance results.

Review `npm audit` and changes to locked dependencies. CI license approval does not establish absence of vulnerabilities. Check the actual generated docs and demo for private paths and unpublished claims.

## Publish only with authorization

After the owner authorizes the destination and version, create a signed-off release commit/tag, publish the reviewed tarball using the registry's trusted publishing or authenticated workflow, and deploy `site` as a static site if desired. Never put registry tokens in repository files. Verify the installed package and published demo after release, then update links to real destinations.

The MCP example is currently a private package inside this repository. Making it a separately published package requires replacing its relative `../../dist` imports with an explicit compatible `anniedrawing` dependency and independently reviewing its release contents.
