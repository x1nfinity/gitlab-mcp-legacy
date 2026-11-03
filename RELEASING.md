# Releasing

`@x1nfinity` maintains and manually publishes `gitlab-mcp-legacy` from
[the GitHub repository](https://github.com/x1nfinity/gitlab-mcp-legacy).
This fork is based on `zereight/gitlab-mcp` v2.3.19. Keep the upstream MIT
copyright and license notices in every source and package distribution.

## Supported versions

The latest release on the 0.1.x line receives bug and security fixes. Upgrade
older releases before reporting a defect. Report vulnerabilities through
[GitHub private vulnerability reporting](https://github.com/x1nfinity/gitlab-mcp-legacy/security/advisories/new);
see [SECURITY.md](SECURITY.md) for security controls and compatibility boundaries.

## Prepare and verify

Start from a clean `main` checkout. For a package release, keep the version in
`package.json`, `package-lock.json`, and `server.json` aligned, and review the
release notes and compatibility guide. Documentation-only maintenance can be
committed and pushed independently of a package release.

Use the Node version in `.nvmrc` (`fnm use`) and npm with the checked-in lockfile:

```sh
npm ci --ignore-scripts
npm run build
npx tsc --noEmit
GITLAB_DISABLE_VERSION_CHECK=true node --import tsx/esm --test \
  --experimental-test-isolation=none --test-concurrency=1 \
  test/gitlab-11-response-schema.test.ts test/test-gitlab-11-core.ts \
  test/server/version.test.ts test/mcp-server-name.test.ts \
  test/utils/version-check.test.ts
npm run check:runtime-deps
npm run release:mcp-registry -- --check
```

The tests use local mocks. Follow the compatibility guide for acceptance against
a real GitLab installation. Wait for all tests to finish before packing:

```sh
release_dir="$(mktemp -d)"
npm pack --json --pack-destination "$release_dir"
```

With the current npm 10, `npm pack` runs `prepare` even with `--ignore-scripts`.
`prepare` rebuilds and replaces `build/`, so pack and tests must run serially.

## Review and publish

1. Inspect the tarball's file list with `tar -tzf <tarball>` and review its
   contents, package metadata, compatibility guide, example, and MIT license.
   Check that credentials, private URLs, and local configuration are absent.
2. Install that tarball into a separate temporary directory with
   `npm install --ignore-scripts <absolute-tarball-path>` and run
   `./node_modules/.bin/gitlab-mcp-legacy --help` there. Keep the reviewed
   tarball and record `shasum` and `integrity` from the pack JSON.
3. The maintainer reviews and creates the release commit, tags its exact source
   as `v<version>`, and pushes `main` and that tag to
   `x1nfinity/gitlab-mcp-legacy`. Review the Legacy CI result for the commit.
4. The maintainer uses their own npm account with 2FA to publish the reviewed
   tarball, completing interactive authentication when prompted:
   `npm publish <absolute-tarball-path> --access public --registry=https://registry.npmjs.org/`.
5. Compare `dist.integrity` and `dist.shasum` with the pack JSON using
   `npm view gitlab-mcp-legacy@<version> dist.integrity dist.shasum --registry=https://registry.npmjs.org/`.
   Check `dist-tags.latest` in the same public registry. From a fresh temporary
   directory, run
   `npx --yes --registry=https://registry.npmjs.org/ gitlab-mcp-legacy@<version> --help`.
   Add the package version and verification result to the GitHub release notes.

Published npm versions and release tags stay immutable. Fix a package regression
with a new patch version and repeat the review and verification above.
