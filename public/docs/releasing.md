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

After the owner authorizes the destination and version, create a signed-off release commit and tag, and publish the reviewed tarball. Do not put registry tokens in repository files. Verify the installed package and the hosted demo after release.

The public site is the Vite demo (`npm run build:demo`). It is static files in `site/`. It does not run Node in production. Host it as its own Laravel Forge site next to the others on the Frontierz server (`docs.frontierz.com`, `rebost.ai`, `ssot.frontierz.com`). Do not attach a Forge daemon or PM2 process. Do not change the server-wide Node binary; `scripts/forge-deploy.sh` installs Node 24 under `~/.local` for this site only.

In Forge, create a new site `anniedrawing.com`:

1. Web directory: `/site` (not `/public`).
2. PHP version can stay the default; PHP is unused.
3. No queue worker, scheduler, or daemon.
4. Deploy script:

```sh
cd /home/forge/anniedrawing.com
git pull origin $FORGE_SITE_BRANCH
bash scripts/forge-deploy.sh
```

5. Nginx `location /` should be `try_files $uri $uri/ /index.html;` like the rebost.ai static site, not a PHP front controller.
6. Point DNS at this Forge server (currently `ssot.frontierz.com` / `165.22.207.153`), then issue the Let's Encrypt certificate in Forge.

`docs.frontierz.com` already runs `server.js` under PM2 (`site-3359372`). A separate nginx `server_name` for `anniedrawing.com` does not reload or replace that process.

The MCP example is a private package inside this repository. Publishing it separately requires replacing its relative `../../dist` imports with a compatible `anniedrawing` dependency and reviewing its release contents on their own.
