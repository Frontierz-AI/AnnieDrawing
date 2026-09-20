# Contributing

Read [AGENTS.md](AGENTS.md), run the demo, and keep each change to one understandable improvement.

Use Node.js 24 or newer to develop this repository, and `npm ci`. `npm run dev` starts the demo on port 5173. For a code change, run `npm run check`. For interface changes, also build the demo and run the browser checks. Document the behavior you changed, the checks you actually ran, and any known limits. Add a regression test when it protects an invariant.

## Independent work and dependency policy

Write original code from AnnieDrawing's requirements and public platform documentation. Do not copy, port, translate, or paraphrase another drawing editor's source, even if you believe its license permits it. Do not keep another editor's source open while implementing equivalent functionality here. Tell reviewers where any third-party material came from and add its notice before submission.

Dependencies must have a reviewed, compatible license. The default library is limited to five runtime dependencies and 100 KiB gzipped, including CSS. Optional integrations belong in separate entry points. Development tools should not leak into the runtime. Fonts, fixtures, and icons need compatible provenance too.

## Developer Certificate of Origin

By signing a commit you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/): you created the contribution or have the right to submit it under this project's license, and you understand that the contribution and sign-off are public.

```sh
git commit -s
```

The trailer must identify the contributor who can make that certification:

```text
Signed-off-by: Your Name <you@example.com>
```

Never add someone else's sign-off or invent a contributor identity. CI checks for a sign-off on non-merge pull request commits. Maintainers may ask for provenance details. An automated check cannot verify authorship itself.

## Review expectations

Preserve the JSON format and the atomic operations contract. Keep the headless model free of DOM access. Test rollback, undo, and connector bindings when changing document operations. Test keyboard, cancellation, and focus when changing input. Check light and dark themes and narrow screens for visible UI work. Explain new public APIs in `docs/api.md` and keep AI-facing documentation current.

Comment only when a name does not make the contract obvious. Keep comments short. Prefer a regression test for an invariant (atomic apply, undo, connector detach, locks, input cancellation) over a test that restates the implementation.

Follow the [code of conduct](CODE_OF_CONDUCT.md). Share minimal reproductions without secrets or private drawings. Report security concerns to pau@frontierz.com using [SECURITY.md](SECURITY.md). Do not post an exploit and sensitive data in public.
