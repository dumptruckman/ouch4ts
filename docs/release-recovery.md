# Recover a release

Keep later publication runs for the affected line stopped until its original run succeeds. Do not change a version to escape a failed publication. Other release lines can continue.

## Retry the original source run

1. Open the failed **Release** run and identify its source SHA and target branch.
2. Inspect the draft `record-<source SHA>` release. Its JSON body holds the frozen PR, predecessor, original run ID, release plan, and progress. For stable releases, inspect the `v<version>` draft too.
3. Correct the reported access, registry, channel, tag, or GitHub failure.
4. Rerun the original workflow. The checkout must equal the run's `GITHUB_SHA`. The workflow reuses the recorded version and retained `ouch4ts.tgz`, `publication.json`, and `SHA256SUMS` assets.
5. After it succeeds, rerun any later source runs that failed because their predecessor was unfinished. Process them in source order.

An ambiguous npm success is recoverable. If the registry has the same version, integrity, tarball bytes, and provenance source, the workflow completes channels and GitHub without republishing. A conflicting registry artifact fails permanently for that version. Investigate the conflict before changing the release plan.

The adapter checks the registry-held SLSA provenance's source commit, workflow, repository, and artifact digest. npm validates provenance attestations during publication. Local fake-service tests exercise source binding and retry behavior; they do not verify live npm OIDC access.

## Recover after GitHub's rerun window

1. Create or select a protected recovery source tag at the original source SHA. Allow that exact tag in the `npm-release` environment.
2. Dispatch `.github/workflows/release.yml` at that tag. Set its `branch` input to the original target, such as `main` or `maintenance/0.1`.
3. Check that the workflow's `GITHUB_SHA` equals the recorded source. The original run ID in the record still determines the preview version.
4. After recovery succeeds, remove the temporary environment allowance.

If the original run was canceled before planning, also set `recover_run` to that push run's ID and `recover_before` to the preceding processed source or baseline tag's commit. The adapter verifies the original run's source, branch, and workflow. It checks that every intervening first-parent commit belongs to the frozen merged PR, then checks predecessor completion. These inputs cannot change an existing plan.

Dispatching at a newer branch tip and checking out older code fails source validation. Do not override GitHub provenance variables.

GitHub can reject historical tag or release repair when the built-in token lacks workflow-file write access. Use your account with workflow-write access to repair the exact tag or release. Preserve the retained tarball and recorded source, then rerun the original source workflow. Do not add a PAT to the repository to bypass this restriction.

## Repair a release plan explicitly

Later label edits do not change frozen records. Before publication, inspect the affected draft record and all dependent plans. Record the intended correction and reason on the originating PR, then repair the record and rerun affected source runs in order. Clear a retained artifact only after confirming that its version has never reached npm. If a version exists on npm, preserve it and recover that publication first.

Do not delete merge records or the bootstrap tag. They establish release boundaries and prevent skipped work. Protect `v*`, recovery tags, and completed release assets from changes.
