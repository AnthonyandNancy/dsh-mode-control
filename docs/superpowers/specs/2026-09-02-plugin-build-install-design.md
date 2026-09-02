# Plugin Build and GitHub Install Reliability Design

## Goal

Ensure a plugin checked out from GitHub is rebuilt from source before it is packaged or installed, so `lib/index.js` and `lib/client.js` cannot silently remain stale or omit the expected `__ModuleLoader__` registration.

## Scope

This change is limited to the plugin's build, package validation, and GitHub-source installation documentation. It does not change the plugin's host behavior, UI behavior, DSH loader protocol, or Cordis patch semantics.

## Design

1. Split the existing host build into an explicit `build:host` script while retaining `scripts/build.sh` as the host compiler.
2. Make `npm run build` run host compilation followed by the existing `build:client` tsdown compilation.
3. Add a clean-build helper that removes `lib` before rebuilding, preventing an old client bundle from surviving a partial or host-only build.
4. Add a deterministic `scripts/validate-client.mjs` check. It reads `package.json`, verifies `exports["./client"]` resolves to an existing file, checks that the generated client contains exactly one `window.__ModuleLoader__.load` call and the package name as its registration ID, and executes the wrapper with a mocked loader to confirm the factory can materialize with the declared React external.
5. Make `prepack` run the clean canonical build and validator. `npm pack` therefore always regenerates and validates artifacts before creating a tarball.
6. Document the GitHub-source installation workflow: update source, remove old build output, install dependencies, run the canonical build, pack the newly generated tarball, and install only that tarball. Direct installation of an old tarball or an unbuilt source directory is explicitly disallowed.

## Compatibility

The package name, `./client` export, loader registration protocol, runtime dependencies, and plugin functionality remain unchanged. Existing users must reinstall a newly rebuilt package once; old tarballs are not retroactively repaired. The scripts use Node's cross-platform filesystem APIs and invoke the existing shell host build unchanged.

## Acceptance Criteria

- A clean checkout with no `lib` can run `npm run build` and produce both host and client artifacts.
- `npm pack` invokes a fresh build and fails if the client wrapper is missing, duplicated, or registered under the wrong ID.
- A valid package includes `lib/index.js`, the validated `lib/client.js`, `cordis.patch.yml`, and declarations.
- The README gives an agent-usable GitHub installation sequence that never reuses stale `lib` output.
- Existing unit tests remain green, and new validation tests cover missing client output, wrong loader ID, duplicate registration, and valid registration.
