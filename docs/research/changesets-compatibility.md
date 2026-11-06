# Changesets compatibility with the ouch4ts release contract

Investigated on 2026-11-06 for [Investigate Changesets compatibility with the release contract](https://github.com/dumptruckman/ouch4ts/issues/14).
The implementation decision belongs to [Choose which release operations established tooling owns](https://github.com/dumptruckman/ouch4ts/issues/15).
This investigation changes no release workflow, publishing configuration, or production code.

## The useful native integration already exists

Keep the current division of responsibility unless a follow-up design demonstrates a concrete reduction in custom code. Changesets can reproduce the required version numbers and manage signed release PRs. Those capabilities do not replace the repository's publication and recovery contract. Stable versioning, changelog generation, and release PR management already use Changesets in `.github/workflows/release.yml` and `scripts/release/proposal.ts`.

The strongest new compatibility finding is that native snapshots support the exact preview format. However, the current implementation constructs that version with one template string and applies it with `npm version`. Native snapshots would require generated changeset inputs and snapshot configuration before the equivalent operation. Capability alone does not establish a simplification.

Evidence below has three limits. **Locally verified** means the saved fixture exercised the installed CLI. **Source verified** means official documentation or pinned upstream code establishes the behavior. The proposed division of responsibility is a design judgment. No live Actions run, release PR, npm publication, OIDC exchange, or provenance verification was performed.

## The comparison preserves the whole contract

The baseline is repository commit `30623c51e78f91c60d16a272f654a1e3ba843627`, especially `docs/releases.md`, `docs/release-recovery.md`, and the release adapter. The report-only branch starts from the earlier remote baseline `3e7563f434b0d7e44d30c26f60850f43016c90f9` and contains no implementation changes. Implementation paths refer to the exact inspected commit, for example `git show 30623c51e78f91c60d16a272f654a1e3ba843627:scripts/release/publish.ts`. Contributors select exactly one of `release:major`, `release:minor`, `release:patch`, or `no release`. They do not write changesets, release notes, or specially formatted commits. Recorded merges freeze those decisions. The largest pending bump determines the candidate version.

| Required behavior | Native compatibility | Responsibility that remains |
| --- | --- | --- |
| Labels only, frozen at merge | Changesets accepts generated files, rather than these label records | Freeze PR data and translate eligible records into changesets |
| Largest pending bump | Locally verified for patch, minor, and major combinations | Select the frozen pending set and validate its baseline |
| Eligible main merge publishes `<candidate>-preview.<original run ID>` to `preview` | Exact version locally verified with native snapshots | Determine eligibility, retain original run identity, and publish to the correct channel |
| One rolling stable PR per line | Source-verified branch-aware version action | Validate proposal identity, source, plan, label, and approval conditions |
| `no release` skips preview, refreshes an existing proposal, and alone creates none | CLI processes supplied changesets. Empty input exits 1 | Keep the release decisions and distinguish pending work from no work |
| Patch-only `maintenance/X.Y`, per-line proposals and channels | Version math locally verified. Branch-aware PRs and custom npm tags are source verified | Enforce patch-only labels, line ownership, and `preview-X.Y` and `release-X.Y` selection |
| `latest` never moves backward | Custom tags are supported | Keep monotonic channel checks and confirmed tag updates |
| Built-in `GITHUB_TOKEN` and npm OIDC only | Source verified for Actions and npm | Preserve permissions, environment, workflow identity, and source validation |
| Exact source, version, and tarball retained before publication | Native pack emits tarballs and a plan | Bind source and original run ID, verify distribution contents, and retain durable recovery assets |
| Ambiguous success verifies registry bytes, integrity, and provenance before completion | Stock publishing does not provide this check | Keep registry verification, conflict rejection, and recoverable progress records |
| Original-source retries and unfinished stable publication blocking its line | No equivalent state model in the inspected Actions | Keep predecessor traversal, recovery validation, and publication ordering |

These differences follow from the native [version action](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/src/run.ts), [mode selection](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/src/select-mode/index.ts), and [publish planning](https://github.com/changesets/changesets/blob/c9269c01af5f3f7463adc648890fc3a8a729dd18/packages/cli/src/commands/publish-plan/getPublishPlan.ts). Mode selection inspects changesets and registry publication state. It does not identify a frozen release proposal or an unfinished publication on a release line.

## Native versioning matches the version policy

The repository pins `@changesets/cli` 3.0.3 in `package.json` and `package-lock.json`. Its upstream release resolves to commit [`c9269c0`](https://github.com/changesets/changesets/tree/c9269c01af5f3f7463adc648890fc3a8a729dd18). The official [snapshot configuration](https://changesets.dev/guide/config#snapshot) supports `useCalculatedVersion: true` and `prereleaseTemplate: "{tag}"`. Together with `version --snapshot preview.1002`, these options produce the calculated candidate followed by exactly `-preview.1002`. No timestamp is necessary.

The [fixture](fixtures/changesets-compatibility.mjs) and its [saved results](fixtures/changesets-compatibility-results.json) contain ten explicit cases. They passed with Node `v24.22.1`, npm `11.19.1`, and Changesets `3.0.3`:

| Fixture input | Observed package version |
| --- | --- |
| `0.1.0` plus patch, snapshot `preview.1001` | `0.1.1-preview.1001` |
| `0.1.0` plus patch and minor, snapshot `preview.1002` | `0.2.0-preview.1002` |
| Same baseline, changes, and snapshot identifier in a fresh run | `0.2.0-preview.1002` |
| `0.1.0` plus patch, minor, and major | `1.0.0-preview.1003` |
| Stable patch and stable patch plus minor | `0.1.1` and `0.2.0` |
| No release inputs | Baseline `0.1.0`, expected exit status 1 |
| Pending patch followed by an omitted `no release` input | `0.1.1` |
| `maintenance/0.1` at `0.1.3`, patch preview and stable | `0.1.4-preview.1004` and `0.1.4` |

The repeated snapshot case proves version identity only. It does not prove identical tarball bytes or safe publication retries. The maintenance cases prove version calculation, not branch-policy enforcement. The adapter omits `no release` changeset inputs in the corresponding case.

Native versioning consumed every generated changeset. It left both the top-level lockfile version and `packages[""].version` at the baseline in every case. Therefore, the lockfile synchronization and version assertions in `versionProposal` remain necessary. The CLI's [version implementation](https://github.com/changesets/changesets/blob/c9269c01af5f3f7463adc648890fc3a8a729dd18/packages/cli/src/commands/version/index.ts) also rejects snapshot use in prerelease mode. Snapshots fit this investigation better than introducing persistent prerelease state.

To reproduce, select Node from the implementation checkout with `. "$HOME/.nvm/nvm.sh" && nvm use`. Then run the saved fixture from the research branch, passing the implementation checkout with its installed dependencies:

```sh
	node docs/research/fixtures/changesets-compatibility.mjs /path/to/checkout-with-node_modules
```

The fixture uses temporary Git repositories, a temporary npm cache, and offline mode. It does not publish. The research worktree itself does not have dependencies installed. The release workflow separately pins npm `12.2.1`, so these results do not establish npm 12 runtime behavior.

## Native Actions cover PR mechanics and finite artifact transfer

The current action pin, [`a45c4d5`](https://github.com/changesets/action/blob/a45c4d594aa4e2c509dc14a9f2b3b67ba3780d0d/action.yml), supports the workflow's existing `branch`, `version`, `title`, `commit`, and `commitMode` inputs. This is already native delegation.

On the investigation date, upstream main was `615034bb14e5d240e559f941ce9769beb5e14fb0`. The latest stable release was [v2.1.2](https://github.com/changesets/action/releases/tag/v2.1.2), resolving to commit `ae32849d5ba541f9ae29e40e22a623bc13562f51`. The following findings were checked against that stable source. A future upgrade can use its immutable commit rather than depend on main.

The [version subaction](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/version/action.yml) accepts a base branch and custom script. Its [implementation](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/src/run.ts) creates or updates `changeset-release/<branch>` using matching PR head and base branches. GitHub API pushes are the default and produce GitHub-signed commits. Switching the present integration to this subaction requires input and output changes, including `script`, `pr-base-branch`, `commit-message`, `pr-title`, and `pr-number`. The existing `commitMode` input is not part of that subaction. This is migration work, not a defect in the present pin. The root v2 action has its own input contract, so its inputs must be checked separately.

Native [pack](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/src/pack/index.ts) uploads the packed directory and returns an artifact ID. Native [publish](https://github.com/changesets/action/blob/ae32849d5ba541f9ae29e40e22a623bc13562f51/src/publish/index.ts) downloads that artifact and invokes CLI publishing with `--from-pack-dir`. Pack hardcodes 30 days of retention and exposes no retention input. That transfer mechanism cannot replace retained draft-release assets used after the rerun window.

One local pack case used an explicit `--from-publish-plan` to stay offline. It produced one tarball with the expected preview version and a plan containing its path, SHA-256 integrity, access, and `preview` tag. The native [pack source](https://github.com/changesets/changesets/blob/c9269c01af5f3f7463adc648890fc3a8a729dd18/packages/cli/src/commands/pack/index.ts) otherwise computes a plan through registry queries. That default behavior is a source finding, not a successful live test. The native plan contains no frozen source SHA or original run ID. Artifact-mode publishing also rejects a command-line tag override, so the plan must already contain the intended channel.

## Stock publication success is weaker than this contract

Default [publish planning](https://github.com/changesets/changesets/blob/c9269c01af5f3f7463adc648890fc3a8a729dd18/packages/cli/src/commands/publish-plan/getPublishPlan.ts) excludes a version if its string appears in the registry's versions list. It does not compare that version's artifact with retained bytes.

Artifact mode bypasses that planning step, but still lacks the required recovery check. The npm adapter [classifies already-published errors](https://github.com/changesets/changesets/blob/c9269c01af5f3f7463adc648890fc3a8a729dd18/packages/cli/src/lib/npm.ts) as `failed:already-published`. The [publisher](https://github.com/changesets/changesets/blob/c9269c01af5f3f7463adc648890fc3a8a729dd18/packages/cli/src/commands/publish/index.ts) tolerates that result without fetching and verifying registry tarball bytes or provenance. A stock successful exit therefore cannot authorize channel movement or GitHub finalization under ouch4ts's rules.

By comparison, `publishOrVerify` and `verifyRegistryArtifact` bind the registry version to retained integrity, downloaded bytes, repository, workflow, source commit, and provenance artifact digest. `retainArtifact` downloads the saved tarball before publication. These operations in `scripts/release/publish.ts` and `scripts/release/publication.ts` remain necessary even if a native command performs the actual upload.

Native Actions support the built-in GitHub token, and [npm trusted publishing](https://docs.npmjs.com/trusted-publishers) supports OIDC without a long-lived npm token. npm documents automatic provenance for public packages from public repositories. OIDC dist-tag management requires npm 11.21.0 or npm 12.2.0 and later within those release lines. The workflow's npm 12.2.1 meets that documented floor. The local fixture's npm 11.19.1 does not. None of this verifies the repository's live trusted publisher or its allowed operations.

## The proposed boundary favors measurable deletion

Keep native stable versioning, changelog generation, and signed release PR management. Retain `prepareProposal` as the translation from frozen PR records, `versionProposal` for lock synchronization and assertions, and `finishProposal` and `checkLabels` for repository-specific proposal checks. Keep `planRelease`'s frozen baseline, pending-set, and maintenance validation. Its small version calculation also serves as an independent assertion against generated output.

Keep `runContext`, `pushIdentity`, `loadRun`, the record schemas, and the merge recorder. Native mode selection cannot replace their original-source validation, predecessor history, immutable label decisions, and recovery rules. Keep `retainArtifact`, `publishOrVerify`, `verifyRegistryArtifact`, `moveChannels`, `canAdvanceChannel`, and `finalizeStable`. Their checks distinguish a recoverable publication from a conflicting one.

Native snapshots could replace preview version application, and native CLI pack could replace the `npm pack` invocation inside `packArtifact`. Neither presently justifies a refactor. Snapshot preparation adds steps around a version expression that is already small. Native pack still needs the distribution allowlist, license and required-file checks, installed CLI and API checks, SHA-512 registry binding, source metadata, and durable retention. A follow-up design should name the exact code it deletes and preserve those checks before choosing either replacement.

[Release Drafter](https://github.com/release-drafter/release-drafter) can generate release notes from merged PRs and labels. [Release Please](https://github.com/googleapis/release-please) builds release PRs around Conventional Commits by default. Neither is a drop-in replacement for the full label-only and publication-recovery contract established here. Switching tools would leave the hardest custom operations in place.

[Choose which release operations established tooling owns](https://github.com/dumptruckman/ouch4ts/issues/15) can now decide whether any specific replacement earns its migration cost. Live Actions, branch protection, npm OIDC, dist-tags, provenance, and interrupted-publication recovery remain untested by this investigation. Implementation and publishing remain outside its scope.
