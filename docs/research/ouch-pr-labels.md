# Multiverse PR labels and npm release options

Research for [Research Multiverse PR labels and semantic versioning](https://github.com/dumptruckman/ouch4ts/issues/2), under [Release OUCH as a standalone npm package](https://github.com/dumptruckman/ouch4ts/issues/1). Inspected 2026-10-30. This note records source behavior and candidate adaptations. It does not choose release-channel or eligibility policy.

## Findings

Multiverse requires exactly one of `release:major`, `release:minor`, `release:patch`, or `no release` on PRs targeting `main`. Commit subjects and PR titles do not determine the bump. Its automatic workflow runs on pushes to `main` and creates GitHub prereleases. Stable releases require manual dispatch or promotion. The four labels can carry over to OUCH, but copying the release action would also copy its Maven version convention, mutable tag targeting, missing concurrency control, and retry gaps. [Label workflow][mv-labels], [push workflow][mv-main], [release action][sr-source]

Jeremy has already chosen an MIT root npm tool, the existing CLI and typed API, a retained BSD-0-Clause skill, and publication on every eligible merge. These are constraints from the map, not findings about Multiverse. They rule out replacing the merge cadence with batched release PRs. [Map][map]

## Inspected revisions

Moving action refs were resolved at inspection time. These SHAs describe this investigation, not every historical workflow run.

| Repository | Inspected ref | Commit SHA |
| --- | --- | --- |
| `Multiverse/Multiverse-Core` | `main` | [`34185b90a940065456ae078220b9b1716a899f4c`][mv-tree] |
| `mheap/github-action-required-labels` | `v2` | [`7b0461786d3bd0c6a8487e9b57814ba3e2c00227`][labels-tree] |
| `benwoo1110/semantic-release-action` | `v1` | [`a0d69ba482c6757773a36d52fc43ba9f5ee4778a`][sr-tree] |
| `intuit/auto` | `main`, candidate only | [`fc18021f300a58f6bb6ee4c1e894756c7e533d27`][auto-tree] |

I read the Multiverse label workflow, automatic prerelease workflow, manual release and promotion workflows, both layers of reusable GitHub-release workflows, and platform-upload workflows. The versioning action runs `dist/index.js`; I checked that executable and `dist/endpoints.js` against its TypeScript source. The label action exposes only a bundled executable at the inspected revision, so its bundled entry point is the source for the validation details below. Checkout, Java, Gradle setup, artifact upload, Javadoc deployment, and downstream platform upload actions do not select PR labels or calculate the release version. [Release wrapper][mv-wrapper], [release implementation][mv-generic], [platform wrapper][mv-platforms], [platform implementation][mv-platform-generic], [action metadata][sr-metadata], [executable][sr-dist], [label executable][labels-dist]

GitHub REST, Actions concurrency, npm publish, and SemVer documentation were read live on 2026-10-30. Their links are not pinned repository snapshots. [GitHub releases][gh-releases], [concurrency][gh-concurrency], [npm publish][npm-publish], [SemVer 2.0.0][semver]

## Exact label contract

The PR check runs for `opened`, `labeled`, `unlabeled`, and `synchronize` events against `main`. It invokes `mheap/github-action-required-labels@v2` with `mode: exactly`, `count: 1`, and these four labels. It counts only matches in that list, so unrelated labels are allowed. Comparisons are exact and case-sensitive. Because the workflow supplies `GITHUB_TOKEN`, the action reads current labels through the API rather than the event's label snapshot. Its label-list request does not paginate. [Label workflow][mv-labels], [label executable, entry point][labels-entry]

| Choice | PR validation | Automatic release action |
| --- | --- | --- |
| `release:major` | Valid alone among the four choices | Select major bump |
| `release:minor` | Valid alone among the four choices | Select minor bump |
| `release:patch` | Valid alone among the four choices | Select patch bump |
| `no release` | Valid alone among the four choices | No recognized bump, so skip release |
| None of the four | Fails | Skip release |
| Multiple bump labels | Fails | Skip release, no highest-bump precedence |
| `no release` plus exactly one bump label | Fails | Bump label still wins if the check was bypassed |

The last row is a mismatch between validation and publication. The release action never tests for the literal `no release`; it recognizes only the three bump labels. Missing or multiple bump labels log an error and return no release, setting `release_created=false`. They do not call `setFailed` on those paths. `norelease` is a separate action input value, not another PR label, and the Multiverse callers do not use it. [Release action, `getVersionBumpAction` and `getVersionBumpActionFromPRLabel`][sr-source]

The YAML defines a check. Enforcing it before merge also requires repository rules or branch protection that require the check. This research did not inspect those settings, so it does not claim bypasses are impossible. The listed event set contains neither `reopened` nor `edited`. [Label workflow][mv-labels]

There are no automatic file-path rules in this release chain. A skill-only, documentation-only, CI-only, or tool-code PR receives the same label treatment. `no release` suppresses the current release attempt; it does not remove those changes from a later package or automatically exclude that PR from future generated notes. The latter follows from creating no tag at the skipped commit and supplying no note-exclusion configuration. [Push workflow][mv-main], [release action][sr-source], [Multiverse `.github` tree][mv-tree], [GitHub releases][gh-releases]

## How a merged PR becomes a release

1. A push to `main` calls `call.github_release.yml` with `release_mode: prerelease` and `version_bump: prlabel`.
2. That wrapper calls `generic.github_release.yml`. It checks out the event ref, runs the Gradle test build, and calls the versioning action only after success.
3. The action queries PRs associated with `github.context.sha` and uses only the first result. It does not aggregate labels across every commit in the push, paginate PR associations, check each PR's merge state/base branch, or analyze Conventional Commits.
4. After selecting one bump label, it reads one page of up to 100 repository tags, parses them, and chooses the numerically highest parsed version. The base is not the latest GitHub release, the npm manifest version, or the last tag reachable from the tested commit.
5. It creates a GitHub release with `generate_release_notes: true`. It supplies no `target_commitish`. GitHub therefore creates a new tag at the default branch's current head; an existing tag keeps its target. This can differ from the checked-out and tested event SHA.
6. Only after creating that release does the workflow publish to Maven, build/upload the JAR, and deploy Javadoc. A successful release also starts the selected platform uploads.

These steps come from the [push workflow][mv-main], [release workflow][mv-generic], [release action][sr-source], [endpoint definitions][sr-endpoints], and [GitHub release API][gh-releases]. No npm publication occurs in the reference.

A direct push with no associated PR skips the release and logs an error. A push containing several commits consults only its tip SHA. A direct push that does have a PR association is not explicitly rejected. These are source behaviors, not proposed OUCH eligibility rules. [Release action][sr-source]

The action requests GitHub-generated release notes rather than parsing commit-message conventions. It passes no explicit previous tag or custom notes file. The inspected Multiverse `.github` tree has no `release.yml` or `release.yaml`, so default GitHub notes configuration applies. The bump labels are not configured changelog sections. [Release action][sr-source], [Multiverse tree][mv-tree], [GitHub notes API][gh-releases]

## Version calculation

The action has its own version class, unrelated to the standard npm `semantic-release` plugin pipeline. It supports unprefixed `X.Y.Z`, `X.Y.Z-pre`, and `X.Y.Z-pre.N` tags. A stable version sorts above a prerelease with the same numeric base. It chooses the highest parsed tag across the returned page, including prereleases and tags without GitHub releases. With no tags it fails with `No releases found.` There is no first-release bootstrap. [Action source][sr-source], [action dependencies][sr-package]

For a stable base, major increments major and resets minor/patch; minor increments minor and resets patch; patch increments patch. Prerelease mode appends `-pre`, then subsequent compatible prereleases increment the suffix. The examples below were verified against `getNextVersion` and its four helpers from the inspected executable. A temporary offline harness checked 24 transitions and three parser/publish edge cases without running the release entry point. [Version functions][sr-source]

| Base | Bump | Prerelease mode | Stable mode |
| --- | --- | --- | --- |
| `1.2.3` | major | `2.0.0-pre` | `2.0.0` |
| `1.2.3` | minor | `1.3.0-pre` | `1.3.0` |
| `1.2.3` | patch | `1.2.4-pre` | `1.2.4` |
| `2.0.0-pre.4` | major | `2.0.0-pre.5` | `2.0.0` |
| `2.0.0-pre.4` | minor or patch | `2.0.0-pre.5` | `2.0.0` |
| `1.3.0-pre.4` | minor or patch | `1.3.0-pre.5` | `1.3.0` |
| `1.3.0-pre.4` | major | `2.0.0-pre` | `2.0.0` |
| `1.2.4-pre.4` | patch | `1.2.4-pre.5` | `1.2.4` |
| `1.2.4-pre.4` | minor | `1.3.0-pre` | `1.3.0` |
| `0.2.3` | major | `1.0.0-pre` | `1.0.0` |

An already-open prerelease series absorbs equal or smaller bump requests. The action infers its level from whether minor/patch are zero. It does not retain the label that opened that series. Thus a major label on `2.0.0-pre.4` does not create `3.0.0-pre`; stable mode can simply graduate the current series. There is no special major-zero rule. [Version functions][sr-source]

The parser is not a strict SemVer parser. It uses `parseInt`, accepts missing or malformed numeric fields through zero fallback, ignores extra numeric components, and rejects prerelease identifiers other than `pre`. For example, a conventional `v1.2.3` tag becomes numeric `0.2.3`, and an `-rc.1` tag aborts parsing. Build metadata is not modeled. Copying this parser into an npm publisher would introduce avoidable errors. [Parser and `Version` constructor][sr-source], [SemVer grammar][semver]

For Maven publication, every prerelease of a numeric base produces the same `publish_version`, such as `1.3.0-SNAPSHOT`, even when GitHub tags advance through `1.3.0-pre`, `1.3.0-pre.1`, and `1.3.0-pre.2`. npm permanently reserves each package-name/version pair after publication, even after unpublishing. An npm adaptation needs a unique package version per eligible merge and an explicit distribution tag for its chosen channel. A GitHub prerelease flag does not set npm's distribution tag. [Version output][sr-source], [npm publish][npm-publish]

## Stable releases and promotion

`dispatch.create_release.yml` lets a maintainer choose `prerelease` or `release` and an explicit `major`, `minor`, or `patch` bump. It bypasses PR-label lookup. `dispatch.promote_release.yml` requires an input containing `pre`, checks out that tag, and invokes `release_mode: promote`. The action verifies the existing GitHub release is a prerelease and calculates stable output using a patch graduation, which strips the suffix for the supported series. It creates another release rather than mutating the prerelease. [Manual creation][mv-create], [promotion workflow][mv-promote], [promotion action][sr-source]

Promotion has the same tag-targeting gap as automatic creation. The build checks out the requested prerelease, but `doRelease` omits its commit as `target_commitish`, so a new stable tag defaults to the default branch's current head. The stable tag and uploaded artifact can therefore describe different commits. [Release workflow][mv-generic], [release action][sr-source], [GitHub release API][gh-releases]

## Gaps for publication on every eligible merge

| Concern | Reference behavior | Required consideration for OUCH |
| --- | --- | --- |
| Release channel | Automatic prereleases; manual stable releases | Decide stable-on-merge versus a prerelease channel and any graduation path. Every eligible merge must still publish. |
| Label eligibility | Premerge check and release action disagree on mixed `no release`/bump labels | Revalidate all four choices in publication code. Decide invalid-label failure behavior. |
| Skill-only changes | No file-based exclusion | Decide whether `no release` alone controls suppression or whether package-path eligibility also applies. Do not silently invent a path rule. |
| Merge identity | First PR associated with the tip SHA | Define accepted merge methods and associate the specific merged PR with the exact built commit. |
| No-PR pushes | Skip if association absent; no explicit prohibition | Decide whether direct pushes are forbidden, skipped, or require an explicit recovery path. |
| Concurrent merges | No concurrency group or durable release queue in this chain | Serialize version allocation and publication; retain every eligible merge and its order. |
| Retries | Reads current labels/tags and calculates another version | Persist a merge-to-version decision and resume partial work without duplicate publication. |
| Tags | Highest parsed tag from one page, any branch; target defaults to current branch head | Establish version authority, tag format, strict SemVer filtering, and exact commit targeting. |
| First release | Fails without a seed tag | Choose the first public version and bootstrap procedure. |
| Before `1.0.0` | Major label increments `0.y.z` to `1.0.0` | Decide whether to preserve literal bumps or define a separate initial-development policy. |
| Release notes | GitHub defaults, implicit comparison range | Choose note grouping/exclusions and the previous publication boundary. |
| Partial publication | GitHub release exists before Maven publish/build/upload | Define recoverable states across npm publish, tags, and GitHub release creation. |

The reference column is supported by the preceding pinned workflow/action sources. The OUCH column lists design work, not decisions already made.

A simple `concurrency` group with `cancel-in-progress: false` is insufficient to retain all merge runs under GitHub's default behavior. The default `queue: single` replaces an older pending run with the newer one. Current GitHub Actions also supports `queue: max`, retaining up to 100 pending runs, with excess runs canceled. Its FIFO order follows when runs start waiting, not when merges were dispatched. A strict every-merge implementation still needs merge-order checks, failure recovery, and reconciliation of missing runs. [GitHub concurrency documentation][gh-concurrency]

The reference action also has no idempotency record keyed to a PR or commit. If release creation succeeds and Maven publication fails, rerunning the job observes the new tag and calculates the next version. Concurrent runs can select the same next tag and race at creation. These are consequences of the source's read-tags, calculate, create-release sequence. Current labels can also change between an original run and a retry. [Release action][sr-source], [release workflow][mv-generic]

`no release` does not promise that a commit will never ship. Later releases normally contain earlier merged changes. The decision should define it as suppressing publication for that merge, unless Jeremy asks for stronger exclusion. That distinction matters for retained skill files and documentation as well as source code. This is a proposed clarification based on the reference sequence, not an added eligibility rule.

## Candidate npm approaches

### A small workflow with explicit release state

Use GitHub Actions plus a small typed release script. Read the merged PR and validate exactly one of the four labels, map the three bump labels to strict SemVer operations, build the chosen commit, publish with npm, and create a matching tag/release. Keep version allocation and retry state explicit. GitHub provides release creation, exact `target_commitish`, generated notes, and an explicit previous-tag input through its notes API; npm provides publication and distribution tags. [GitHub release API][gh-releases], [npm publish][npm-publish], [SemVer][semver]

This is a proposed design, not an existing implementation. It makes preserving the four-label contract straightforward and avoids release commits on `main` if version edits occur only in the build workspace. The project would own merge ordering, bootstrap, per-merge state, partial-failure repair, and tests for those rules. It would also need the independently researched npm authentication and package setup.

### Auto with renamed labels and an independent strict gate

Auto is a label-driven npm release tool. Its configuration can replace default labels with `noDefaultLabels: true` and map the four exact names to `major`, `minor`, `patch`, and `skip`. Its npm plugin versions and publishes a single root package, and `shipit` selects stable releases on the base branch or prereleases on configured branches. This can implement publication on merge without Conventional Commit subjects. [Auto label configuration][auto-config], [Auto version logic][auto-semver], [Auto shipit implementation][auto-source], [npm plugin][auto-npm]

It is not a drop-in copy of the Multiverse contract. Auto defaults unlabeled changes to patch, chooses the highest bump across the unreleased range, and makes `skip` override other labels on the newest PR. Its normal npm flow creates version/changelog commits and pushes them with tags. Its own quick-merge documentation warns against merging while publication runs because of duplicate-version and push races. A strict four-choice gate and deliberate serialization/recovery would still be needed, and range-based processing must not collapse several eligible merges into one publication. [Auto version logic][auto-semver], [release range calculation][auto-release], [npm plugin][auto-npm], [quick merges][auto-quick]

Auto's inspected npm plugin checks token environment variables and normally writes npm token configuration; its documentation assumes a token. Compatibility with the chosen npm trusted-publishing setup would need verification rather than assuming the token-oriented defaults meet it. [npm plugin authentication][auto-npm], [npm plugin documentation][auto-npm-doc]

Both candidates can use the required labels. The first owns a smaller set of explicit project rules; the second supplies more release machinery while bringing defaults and Git commits that need accommodation. Selecting one belongs in the release-design decision ticket.

## Decisions left for the map

The existing release-design ticket can resolve these together: automatic stable versus prerelease publication, the first version and pre-1.0 bump meaning, skill-only eligibility, no-PR pushes, the exact merged commit, ordered processing of rapid merges, version/tag authority, retry state, release-note boundaries, and the implementation choice. Publication on every eligible merge is already settled. None of these unknowns requires a new research ticket merely to repeat this evidence.

No source, CI, repository settings, npm settings, or package contents were changed during this investigation. The only repository artifact is this note on a research branch. No package was published and no PR was opened.

[map]: https://github.com/dumptruckman/ouch4ts/issues/1
[mv-tree]: https://github.com/Multiverse/Multiverse-Core/tree/34185b90a940065456ae078220b9b1716a899f4c/.github
[mv-labels]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/pr.require_label.yml
[mv-main]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/main.prerelease.yml
[mv-wrapper]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/call.github_release.yml
[mv-generic]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/generic.github_release.yml
[mv-create]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/dispatch.create_release.yml
[mv-promote]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/dispatch.promote_release.yml
[mv-platforms]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/call.platform_uploads.yml
[mv-platform-generic]: https://github.com/Multiverse/Multiverse-Core/blob/34185b90a940065456ae078220b9b1716a899f4c/.github/workflows/generic.platform_uploads.yml
[labels-tree]: https://github.com/mheap/github-action-required-labels/tree/7b0461786d3bd0c6a8487e9b57814ba3e2c00227
[labels-dist]: https://github.com/mheap/github-action-required-labels/blob/7b0461786d3bd0c6a8487e9b57814ba3e2c00227/dist/index.js
[labels-entry]: https://github.com/mheap/github-action-required-labels/blob/7b0461786d3bd0c6a8487e9b57814ba3e2c00227/dist/index.js#L19912-L20030
[sr-tree]: https://github.com/benwoo1110/semantic-release-action/tree/a0d69ba482c6757773a36d52fc43ba9f5ee4778a
[sr-metadata]: https://github.com/benwoo1110/semantic-release-action/blob/a0d69ba482c6757773a36d52fc43ba9f5ee4778a/action.yml
[sr-dist]: https://github.com/benwoo1110/semantic-release-action/blob/a0d69ba482c6757773a36d52fc43ba9f5ee4778a/dist/index.js
[sr-source]: https://github.com/benwoo1110/semantic-release-action/blob/a0d69ba482c6757773a36d52fc43ba9f5ee4778a/src/index.ts
[sr-endpoints]: https://github.com/benwoo1110/semantic-release-action/blob/a0d69ba482c6757773a36d52fc43ba9f5ee4778a/src/endpoints.ts
[sr-package]: https://github.com/benwoo1110/semantic-release-action/blob/a0d69ba482c6757773a36d52fc43ba9f5ee4778a/package.json
[gh-releases]: https://docs.github.com/en/rest/releases/releases#create-a-release
[gh-concurrency]: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency
[npm-publish]: https://docs.npmjs.com/cli/v11/commands/npm-publish/
[semver]: https://semver.org/spec/v2.0.0.html
[auto-tree]: https://github.com/intuit/auto/tree/fc18021f300a58f6bb6ee4c1e894756c7e533d27
[auto-config]: https://github.com/intuit/auto/blob/fc18021f300a58f6bb6ee4c1e894756c7e533d27/docs/pages/docs/configuration/autorc.mdx
[auto-semver]: https://github.com/intuit/auto/blob/fc18021f300a58f6bb6ee4c1e894756c7e533d27/packages/core/src/semver.ts
[auto-source]: https://github.com/intuit/auto/blob/fc18021f300a58f6bb6ee4c1e894756c7e533d27/packages/core/src/auto.ts
[auto-release]: https://github.com/intuit/auto/blob/fc18021f300a58f6bb6ee4c1e894756c7e533d27/packages/core/src/release.ts
[auto-npm]: https://github.com/intuit/auto/blob/fc18021f300a58f6bb6ee4c1e894756c7e533d27/plugins/npm/src/index.ts
[auto-npm-doc]: https://github.com/intuit/auto/blob/fc18021f300a58f6bb6ee4c1e894756c7e533d27/plugins/npm/README.md
[auto-quick]: https://github.com/intuit/auto/blob/fc18021f300a58f6bb6ee4c1e894756c7e533d27/docs/pages/docs/welcome/quick-merge.mdx
