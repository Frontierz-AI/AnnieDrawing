# Release checklist

Publication is a maintainer action. The repository URL, issue tracker, and private contacts are pau@frontierz.com plus this GitHub project. The npm package is `anniedrawing`.

## Before publishing a version

- Confirm access to the `anniedrawing` npm package. Check the intended release version and update the changelog.
- Keep SECURITY.md and CODE_OF_CONDUCT.md pointed at pau@frontierz.com, and keep GitHub private vulnerability reporting enabled.
- Review the license, third-party notices, DCO requirements, and provenance. Keep full dependency and font notices in distributed bundles where required.
- Keep branch protection, required CI, Dependabot, and secret scanning enabled on the public repository.

## Verify the release tree

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

Inspect the tarball: compiled JavaScript, declarations, CSS, README, license, notices, changelog, and AI documentation. The package must not contain private source documents, local drawings, tokens, browser artifacts, or `node_modules`. Install the tarball into a clean consumer and exercise `anniedrawing` and `anniedrawing/core`. Validate all declared package exports.

Test the demo with mouse, keyboard, and a touch device. Check cancellation, undo and redo, pages, autosave recovery, and file import and export. Test a keyboard-only first run and reduced-motion behavior. Check PNG export with embedded media, and the limits of remote images and custom HTML. Browser timing depends on the machine. Record the environment with performance results.

Review `npm audit` and changes to locked dependencies. CI license approval does not mean the tree has no vulnerabilities. Check the generated docs and demo for private paths.

## Publish only with authorization

After the owner authorizes the destination and version, create a signed-off release commit and tag, publish the reviewed tarball using the registry's trusted publishing or authenticated workflow, and deploy `site` as a static site if that is part of the release. Do not put registry tokens in repository files. Verify the installed package and published demo after release, then update links to the real destinations.

The MCP example is a private package inside this repository. Publishing it separately requires replacing its relative `../../dist` imports with a compatible `anniedrawing` dependency and reviewing its release contents on their own.
