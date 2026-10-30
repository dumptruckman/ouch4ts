# npm identity and publishing prerequisites

Researched on 2026-10-30 for [Research npm identity and publishing prerequisites](https://github.com/dumptruckman/ouch4ts/issues/3). This note records facts and proposals, not approved account setup. No packages, credentials, trusted publishers, or repository settings were created or changed.

## Recommendation

Use npm trusted publishing from a GitHub-hosted runner for automatic releases. It needs no npm repository secret. Keep version selection, npm publication, and GitHub release creation in the same merge-triggered workflow, or explicitly dispatch a second workflow. A tag or release created with `GITHUB_TOKEN` will not trigger a downstream publish workflow. Sources: [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [GitHub workflow triggering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

Choose the npm identity and first-release bootstrap with Jeremy before implementation depends on them. The smallest bootstrap is a human publishing the first reviewed analyzer version with interactive authentication, followed by OIDC releases. If the first real analyzer version must have CI provenance, a staged bootstrap can establish the package first, then CI can publish a different version with OIDC. The latter is a proposal assembled from documented behavior and has not been exercised. Both options avoid a persistent CI npm credential. Sources: [public package creation](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/), [new-package staging announcement, October 2, 2026](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/), [stage command semantics](https://docs.npmjs.com/cli/v12/commands/npm-stage/).

Two current requirements are easy to miss. New trusted publishers allow staging by default, so enable direct `npm publish` explicitly for unattended releases. A new configuration must complete a successful publish within two days or expire. The npm documentation last edited October 6, 2026 states both rules. [Trusted publisher configuration](https://docs.npmjs.com/trusted-publishers/)

## Identity checks and limits

The following read-only public registry requests returned HTTP 404 with `{"error":"Not found"}` on 2026-10-30:

| Candidate | Registry evidence | What would authorize publication |
| --- | --- | --- |
| `ouch4ts` | [Unscoped lookup](https://registry.npmjs.org/ouch4ts) | An npm account must successfully create the package, then maintainers control later versions. |
| `@dumptruckman/ouch4ts` | [User-scope lookup](https://registry.npmjs.org/@dumptruckman%2fouch4ts) | Control of the npm user or organization scope `dumptruckman`, which was not verified. |
| `@7factor/ouch4ts` | [Organization-scope lookup](https://registry.npmjs.org/@7factor%2fouch4ts) | Authorized membership and package access in the npm scope `7factor`, which was not verified. This is only a conditional company-owned alternative. |

A missing public package record proves neither availability nor Jeremy's ownership. npm applies naming and policy rules beyond the lookup, and a name may change status before publication. GitHub account ownership does not establish npm account or scope control. npm grants scopes to matching npm users or organizations. Sources: [package naming rules](https://docs.npmjs.com/package-name-guidelines/), [scope ownership](https://docs.npmjs.com/about-scopes/), [organization packages](https://docs.npmjs.com/creating-and-publishing-an-organization-scoped-package/).

Keep `ouch4ts` as the candidate that matches the existing manifest, subject to Jeremy's selection and successful publication. A scoped name is a separate package identity, not an automatic alias. The current root is a private workspace and the nested analyzer declares `ouch4ts@0.1.0`, Node `>=22`, and an `ouch4ts` executable. Those declarations are a local baseline, not settled release decisions. [Root manifest at research base](https://github.com/dumptruckman/ouch4ts/blob/3e7563f434b0d7e44d30c26f60850f43016c90f9/package.json), [analyzer manifest at research base](https://github.com/dumptruckman/ouch4ts/blob/3e7563f434b0d7e44d30c26f60850f43016c90f9/skills/ouch4ts/package.json)

Unscoped packages are public. Explicitly use `--access public` for the selected public package, including scoped alternatives. The general scoped-package guide says scoped packages default to private, while the npm 12 publish reference says new packages default to public. Explicit access avoids depending on this documentation mismatch. [Scopes and visibility](https://docs.npmjs.com/about-scopes/), [scoped public publishing](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [npm 12 publish options](https://docs.npmjs.com/cli/v12/commands/npm-publish/)

## Observed GitHub state

Read-only GitHub API checks on 2026-10-30 found:

| Setting | Observed result | Evidence |
| --- | --- | --- |
| Repository | `dumptruckman/ouch4ts`, public, default branch `main`, created October 27, 2026 | [Repository metadata](https://api.github.com/repos/dumptruckman/ouch4ts) |
| Actions | Enabled, all actions allowed, SHA pinning not required by this setting | [Actions permissions](https://api.github.com/repos/dumptruckman/ouch4ts/actions/permissions) |
| Default workflow token | Read permissions; approving PR reviews disabled | [Workflow permissions](https://api.github.com/repos/dumptruckman/ouch4ts/actions/permissions/workflow) |
| Classic `main` protection | API returned 404, `Branch not protected` | [Branch protection endpoint](https://api.github.com/repos/dumptruckman/ouch4ts/branches/main/protection) |
| Repository rulesets | Empty list | [Rulesets](https://api.github.com/repos/dumptruckman/ouch4ts/rulesets) |
| Deployment environments | Empty list | [Environments](https://api.github.com/repos/dumptruckman/ouch4ts/environments) |

Permission endpoints were read through the authorized `gh` CLI. Their links may require authentication. No secret names, secret values, npm account sessions, or token values were inspected. These observations do not promise future permissions or release success.

## Trusted publishing after package creation

npm supports GitHub Actions trusted publishing on GitHub-hosted runners. Self-hosted runners are unsupported. The documented baseline is npm `>=11.5.1` and Node `>=22.14.0`. The npm CLI detects OIDC automatically and uses it before falling back to traditional token authentication. Do not configure `NODE_AUTH_TOKEN` for this path. [Trusted publishing prerequisites and authentication](https://docs.npmjs.com/trusted-publishers/)

Proposed release runtime: use the repository's `.nvmrc` value `24.22.1` and explicitly install npm `12.2.1`, the registry's current latest version on the research date. Its actual engine requirement is `^22.22.2 || ^24.15.0 || >=26.0.0`, which `24.22.1` satisfies. The OIDC minimum alone does not guarantee compatibility with a newer npm release. Recheck the chosen versions before implementation. Use nvm for local Node work as required by the repository. [`.nvmrc` at research base](https://github.com/dumptruckman/ouch4ts/blob/3e7563f434b0d7e44d30c26f60850f43016c90f9/.nvmrc), [npm 12.2.1 metadata](https://registry.npmjs.org/npm/12.2.1), [latest metadata checked](https://registry.npmjs.org/npm/latest)

Proposed runner: `ubuntu-24.04`, a documented standard GitHub-hosted runner. Select Node explicitly rather than relying on the runner's preinstalled version. npm's current workflow example disables package-manager caching for release builds. [GitHub runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [npm workflow example](https://docs.npmjs.com/trusted-publishers/)

### Exact proposed npm trust settings

These values are proposals until the release workflow contract is approved:

| npm field | Proposed value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `dumptruckman` |
| Repository | `ouch4ts` |
| Workflow filename | `release.yml`, meaning `.github/workflows/release.yml` |
| Environment | `npm-release` |
| Allowed actions | Enable direct `npm publish`; allow staging as the service defaults require. Enable `npm dist-tag` only if release recovery or channel promotion needs separate tag commands. |

The workflow file must already exist. Enter only its filename in npm, including `.yml`; npm requires exact case-sensitive matching of the configured fields. Add `environment: npm-release` to the publish job if that environment is bound in npm. A saved configuration is not validated until publication succeeds. Configuration fields are fixed after creation, so replacing them requires deleting and recreating the connection. Complete the first successful publish within two days; recreate an expired configuration. [npm setup, expiry, and troubleshooting](https://docs.npmjs.com/trusted-publishers/)

The npm UI has no branch/ref selector in its documented GitHub fields. Enforce the release ref through GitHub: proposed environment `npm-release`, selected deployment branch `main`, no tag rule, and no required reviewer or wait timer for normal automatic releases. Bind npm to that environment and restrict the workflow trigger to approved merged code. GitHub environment restrictions match the run's `GITHUB_REF`, so choose branch/tag rules after choosing the trigger. Adding a required reviewer would make every publication wait for a human. These are proposed controls, not current settings. [npm trust fields](https://docs.npmjs.com/trusted-publishers/), [environment branch and tag restrictions](https://docs.github.com/en/actions/reference/deployments-and-environments), [environment administration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)

Do not paste a generic legacy `repo:owner/name:ref:...` subject into a custom policy. GitHub says repositories created after July 15, 2026 use immutable default subjects with owner and repository IDs; this repository was created later. Use npm's supported configuration fields. The OIDC token also carries workflow, ref, and environment claims, but their presence does not mean npm exposes arbitrary claim-policy controls. [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc), [repository creation metadata](https://api.github.com/repos/dumptruckman/ouch4ts)

Keep publication in the configured top-level workflow where practical. npm warns that reusable workflows and manual dispatch can validate the calling workflow's name rather than the workflow containing `npm publish`; both parent and child need `id-token: write`. Verify the actual calling filename for the chosen design. [npm troubleshooting](https://docs.npmjs.com/trusted-publishers/)

### Provenance and package settings

Trusted publication from GitHub Actions automatically attaches provenance when both repository and package are public. It does not need `--provenance`. A private source repository would prevent this even if the npm package remained public. The current public repository qualifies on visibility, but no release has been performed. Set the package's `repository.url` to the matching GitHub repository, for example `git+https://github.com/dumptruckman/ouch4ts.git`, preserving owner and repository case. [Automatic provenance and repository matching](https://docs.npmjs.com/trusted-publishers/), [provenance prerequisites](https://docs.npmjs.com/generating-provenance-statements/)

After verifying OIDC, set npm Publishing access to `Require two-factor authentication and disallow tokens`. npm explicitly says this blocks traditional tokens while trusted publishers continue to work. Do not choose stage-only trusted permissions for the agreed unattended cadence: stage approval always needs interactive 2FA. [npm publishing access](https://docs.npmjs.com/trusted-publishers/), [staging approval](https://docs.npmjs.com/staged-publishing/)

If a design runs separate `npm dist-tag` mutations, grant that trusted-publisher permission explicitly. OIDC dist-tag support requires npm 11.21.0+ or 12.2.0+ in their respective major lines. The permission is independent of publishing. A normal `npm publish --tag ...` chooses the published version's dist-tag; it does not require designing an extra tag-management step. `npm whoami` is not an OIDC permission check. Verify with the intended operation. [OIDC dist-tags](https://docs.npmjs.com/trusted-publishers/), [publish tag behavior](https://docs.npmjs.com/cli/v12/commands/npm-publish/)

## First-package bootstrap choices

A trusted publisher cannot create a nonexistent package by itself. `npm trust` requires an existing registry package, package write permission, and interactive account 2FA. A bypass-2FA granular token cannot configure this trust. The npm website setup likewise begins at an existing package's settings. [npm trust prerequisites](https://docs.npmjs.com/cli/v12/commands/npm-trust/), [website setup](https://docs.npmjs.com/trusted-publishers/)

Before either no-secret bootstrap, Jeremy must confirm the npm account and selected scope, verify the account email, enable 2FA, and complete an interactive local login such as `npm login --auth-type=web`. A new account requires verified email before publishing. Keep the login credential on the human's machine; do not copy `.npmrc` into the repository or CI. [Account requirements](https://docs.npmjs.com/creating-a-new-npm-user-account/), [2FA setup](https://docs.npmjs.com/configuring-two-factor-authentication/), [interactive login](https://docs.npmjs.com/accessing-npm-using-2fa/), [npm login credential storage](https://docs.npmjs.com/cli/v12/commands/npm-login/)

### A. Human publishes the first real analyzer version

1. Finish the root migration, agree the initial semver, and inspect and test the exact packed analyzer artifact.
2. Jeremy authenticates locally and publishes that reviewed artifact with explicit public access and interactive 2FA.
3. Configure the proposed npm trusted publisher and GitHub environment after the package exists.
4. Publish the next agreed version from the approved workflow within two days to validate OIDC, then disallow traditional tokens.

This is the simplest proposal. It needs no custom GitHub secret or npm granular token. Its first local release lacks GitHub CI provenance; later OIDC releases can have it. The next version must differ because a published name/version pair cannot be reused, even after unpublishing. Sources: [human direct publication](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/), [scoped public publication](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/), [immutable published versions](https://docs.npmjs.com/cli/v12/commands/npm-publish/), [cloud provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).

### B. Human stages a bootstrap, CI publishes the first real analyzer version

This proposal combines documented mechanisms. It remains unexercised and should be chosen only if Jeremy accepts its visible bootstrap state:

1. Use a reviewed package artifact with a distinct agreed bootstrap semver, for example `0.0.0-bootstrap.0` with dist-tag `bootstrap`. These are proposed values, not the release contract.
2. With Jeremy's local login, run `npm stage publish --access public --tag bootstrap`. npm creates a publicly visible `0.0.0-stage` placeholder. The bootstrap tarball stays private in the staged queue.
3. The new package now has settings. Configure the trusted publisher with direct publishing enabled and the GitHub environment binding.
4. Within two days, let the approved CI workflow build and publish the agreed real version, for example `0.1.0`, using OIDC. It must differ from the pending staged version. Normal publishing is allowed while other versions are staged. The real public CI release can receive automatic provenance.
5. After successful publication, Jeremy rejects the pending bootstrap stage with interactive 2FA, then verifies that the real version and intended dist-tag resolve correctly. Do not promote the bootstrap artifact as a release.

The October 2, 2026 announcement explicitly allows new-package staging with a local session and says settings and trusted publishing can be configured after creation. The staging guide documents the public placeholder. The CLI reference permits ordinary publishes with pending stages and forbids direct publication of the same staged semver. It also requires 2FA for rejection. These facts support the proposed sequence, but research did not publish anything to verify its end-to-end behavior. [New-package staging announcement](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/), [placeholder behavior](https://docs.npmjs.com/staged-publishing/), [stage version constraints and rejection](https://docs.npmjs.com/cli/v12/commands/npm-stage/), [automatic provenance](https://docs.npmjs.com/trusted-publishers/)

Merely creating the placeholder is not an available OUCH analyzer. The skill cutover must wait for a real version that passes clean-install checks. Approving a locally built stage as the first real version is another supported human path, but would retain human approval and lack GitHub build provenance. It offers no clear benefit over A for this project's first release. [Staged versions and approval](https://docs.npmjs.com/staged-publishing/), [provenance requirements](https://docs.npmjs.com/generating-provenance-statements/)

## GitHub credentials, tags, and every eligible merge

`GITHUB_TOKEN` is created automatically for each job and is scoped to this repository. It is not an npm credential and is not a secret Jeremy must create. OIDC authentication is a separate exchange using GitHub's automatically supplied OIDC request facilities. `id-token: write` allows requesting an ID token; it does not grant repository write access. [GitHub token lifecycle](https://docs.github.com/en/actions/concepts/security/github_token), [OIDC permissions](https://docs.github.com/en/actions/reference/security/oidc)

Proposed job permissions, subject to the final release design:

| Job operation | Required permission |
| --- | --- |
| Checkout and read source | `contents: read` |
| npm trusted publishing and provenance | `id-token: write` |
| Read merged PRs and labels through the API | `pull-requests: read` |
| Create tags, version commits, or GitHub releases | `contents: write` |
| Explicitly dispatch another workflow | `actions: write`, only if that design is selected |
| Publish to npm | No GitHub `packages: write`; that permission concerns GitHub Packages |

Declare permissions per job. The repository's current default is read; a release job must request the writes it needs. Unspecified permissions become `none` when some permissions are explicitly set. Avoid `write-all`. Sources: [workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions), [Git reference API](https://docs.github.com/en/rest/git/refs#create-a-reference), [release API](https://docs.github.com/en/rest/releases/releases#create-a-release), [dispatch API](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

Events caused by `GITHUB_TOKEN` generally do not start another workflow. In particular, pushing a version commit or tag, or creating/publishing a GitHub release with it, must not be expected to wake a `push` or `release` publisher. `workflow_dispatch` and `repository_dispatch` are explicit exceptions. Current docs also describe approval-required runs for some bot-created PR events, but those do not make tag/release chaining work. A separate GitHub App token or PAT can cause ordinary downstream events, at the cost of additional setup and credentials. [Exact event suppression rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

Recommended design constraint: publish in the original eligible-merge run and create the tag/release there. An explicit dispatch is also viable without a custom credential, provided it requests `actions: write` and configures `workflow_dispatch`. Do not introduce an App/PAT solely to make a bot-created tag wake npm publishing. Choose the event, merged-PR lookup, fork handling, retry state, and serialization in [Define automatic releases from PR labels](https://github.com/dumptruckman/ouch4ts/issues/6). GitHub documents merged-PR handling with `pull_request: closed` plus `merged == true`, but fork PR token restrictions make that an example rather than a complete release design. [Merged PR event and fork limits](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)

There is a separate release-target restriction. GitHub's release API says a target commit that modifies `.github/workflows/` relative to the current default branch requires `Workflows: write`, which `GITHUB_TOKEN` cannot obtain. Creating arbitrary release commits or releasing an earlier queued merge after newer workflow changes can therefore need more than `contents: write`. The reference API also lists permission sets with and without `Workflows: write`. Verify the selected target strategy during release-path validation; do not silently switch to the latest branch commit because an older target fails. [Release target and workflow permission rule](https://docs.github.com/en/rest/releases/releases#create-a-release), [Git reference permissions](https://docs.github.com/en/rest/git/refs#create-a-reference)

The current absence of branch protection and rulesets removes no future obligations. If version commits, tags, or release targets conflict with later rules, decide whether to avoid write-back, grant an approved actor access, or use an App. Do not widen repository settings implicitly. [Observed rulesets](https://api.github.com/repos/dumptruckman/ouch4ts/rulesets), [observed branch protection](https://api.github.com/repos/dumptruckman/ouch4ts/branches/main/protection)

## Granular-token fallback

This is a fallback for an existing package, not the proposed steady-state release path. Classic npm tokens are unsupported. A granular token can be restricted to selected packages or scopes, cannot exceed its owner's access, and can expire or be revoked. Organization-management access does not grant publishing access to the organization's packages. [npm token model](https://docs.npmjs.com/about-access-tokens/)

For direct unattended publication while still supported, Jeremy would create a granular token with package/scopes `Read and write (publish and stage)`, `Bypass 2FA` enabled, access only to the selected existing analyzer package, no organization governance access, and a short expiration. The package must permit granular tokens. A stage-only token cannot meet automatic publication because it returns `E_STAGE_REQUIRED` on direct publish and needs human 2FA approval for promotion. [Token creation settings](https://docs.npmjs.com/creating-and-viewing-access-tokens/), [package-level token restriction](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/), [stage-only limitations](https://docs.npmjs.com/about-access-tokens/)

Proposed repository secret only if this fallback is selected: `NPM_PUBLISH_TOKEN`. The publish step would map it to runtime environment variable `NODE_AUTH_TOKEN`. For token-based provenance, also grant `id-token: write` and use `npm publish --provenance --access public` on the hosted runner. This provenance permission does not turn the npm token into OIDC authentication. [Token-based provenance example](https://docs.npmjs.com/generating-provenance-statements/)

GitHub's September 29, 2025 announcement sets write-token defaults to seven days and a maximum of 90 days, so rotation is part of this fallback. More decisively, current npm documentation says direct publishing with granular tokens will be removed in January 2027. Treat that as npm's announced schedule, not a completed removal on the research date. This makes the fallback unsuitable as OUCH's durable automatic release mechanism. [Token lifetime announcement](https://github.blog/changelog/2025-09-29-strengthening-npm-security-important-changes-to-authentication-and-token-management/), [announced direct-token deprecation](https://docs.npmjs.com/about-access-tokens/)

For new-package CI bootstrap, npm now explicitly supports a local session or granular token, including stage-only, for staging. A package-specific token limited to a nonexistent unscoped package is not an established setup in the sources reviewed. Do not presume that an existing-package allowlist authorizes creation, or request all-package access just for convenience. Prefer the local-session bootstrap choices above. No token-based first-publish setup was tested. [New-package authentication support](https://github.blog/changelog/2026-10-02-npm-staged-publishing-now-supports-creating-new-packages/), [token allowlist selection](https://docs.npmjs.com/creating-and-viewing-access-tokens/)

CIDR restrictions are supported for granular tokens. Standard GitHub-hosted runners use many changing address ranges, so a developer's IP restriction will break hosted publication. Avoid choosing a fixed-IP requirement without a runner/network plan. [npm CIDR controls](https://docs.npmjs.com/creating-and-viewing-access-tokens/), [GitHub-hosted runner IP guidance](https://docs.github.com/en/actions/reference/runners/github-hosted-runners#ip-addresses)

## Setup inventory for the later human task

The inventory below is a proposal, not a request to configure anything during research.

| Category | Trusted publishing path | Granular-token fallback |
| --- | --- | --- |
| Automatic GitHub credentials | `GITHUB_TOKEN` and OIDC request facilities | `GITHUB_TOKEN`; OIDC request facilities if generating provenance |
| Custom repository secrets | None for public dependency installation and OIDC publication | Proposed `NPM_PUBLISH_TOKEN` |
| Public repository variables | None required. Put package identity in `package.json` and the agreed workflow values in version control. | None required |
| Runtime environment values | No `NODE_AUTH_TOKEN`; optional `GH_TOKEN` mapped from automatic `github.token` for `gh` | `NODE_AUTH_TOKEN` mapped from proposed secret; optional `GH_TOKEN` from automatic token |
| npm account | Verified email, 2FA, chosen package/scope access, human bootstrap | Same; human creates and rotates scoped granular token |
| npm package settings | Exact workflow/environment trust, direct publish enabled, validate within two days, then disallow traditional tokens | Permit granular publishing; selected token grants direct publish and bypasses 2FA |
| GitHub owner actions | Create proposed `npm-release` environment, select allowed release ref, enable the approved workflow permissions | Store proposed secret and grant the approved workflow permissions |

The trusted-publishing documentation requires separate read authentication only for private dependencies. The current manifest declares public dependencies, so do not invent `NPM_READ_TOKEN` for the present package. If private dependencies are later introduced, reassess that installation credential separately. [Private dependency limitation](https://docs.npmjs.com/trusted-publishers/), [current dependencies](https://github.com/dumptruckman/ouch4ts/blob/3e7563f434b0d7e44d30c26f60850f43016c90f9/skills/ouch4ts/package.json)

## Decisions still needed

These fit existing decision tickets rather than requiring new research tickets:

- [Define the npm package contract and first release](https://github.com/dumptruckman/ouch4ts/issues/4): select the npm identity and owning account/scope, initial real version, and whether first-real-version provenance justifies the staged placeholder bootstrap.
- [Define automatic releases from PR labels](https://github.com/dumptruckman/ouch4ts/issues/6): choose direct OIDC publication, workflow filename, trigger and environment/ref policy, and a tag/release target strategy that handles `GITHUB_TOKEN` restrictions and concurrent merges. Decide whether separate dist-tag mutations are needed.
- [Configure publishing access and complete the first npm release](https://github.com/dumptruckman/ouch4ts/issues/11): confirm actual npm account authority and carry out the approved bootstrap, trust validation, and package restriction. Pause before account changes or publication and give Jeremy the exact selected setup inventory.

Research establishes feasible mechanisms and current prerequisites. It does not establish name ownership, successful authentication, tarball correctness, or a successful publish. Those require the later approved setup and verification tasks.
