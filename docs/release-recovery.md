# Recover a release

Keep later publication runs for the affected line stopped until its original run
succeeds. Preserve the recorded version. Other release lines can continue.

## Retry the original source run

1. Open the failed **Release** run.
2. Identify its source SHA and target branch.
3. Inspect the draft `record-<source SHA>` release. For stable releases, inspect
   the `v<version>` draft too. See [publication records and retries](releases.md#publication-records-and-retries)
   for the record fields and retained artifacts.
4. Correct the reported access, registry, channel, tag, or GitHub failure.
5. Confirm that the checkout equals the original run's `GITHUB_SHA`.
6. Rerun the original workflow. The workflow reuses the recorded version and
   retained artifacts.
7. After it succeeds, rerun later source runs that failed because their
   predecessor was unfinished. Process them in source order.

If the workflow reports a conflicting registry artifact, investigate the conflict
before changing the release plan.

After `npm publish` succeeds, the workflow waits up to 20 minutes for the
registry tarball and provenance. If verification times out, wait for the version
to appear on npm, then rerun the original workflow.

After updating an npm dist-tag, the workflow checks the registry for up to five
minutes. It logs stale or missing tag values while waiting and the confirmed
version on success. If confirmation times out, check the tags with
`npm dist-tag ls ouch4ts` and rerun the original workflow. It verifies the
retained package and skips tags that already point to the intended or a newer version.

## Recover after GitHub's rerun window

1. Create or select a protected recovery source tag at the original source SHA.
2. Allow that exact tag in the `npm-release` environment.
3. Prepare the workflow inputs before dispatch:

   - Set `branch` to the original target, such as `main` or `maintenance/0.1`.
   - If the original run was canceled before planning, set `recover_run` to that
     push run's ID. Set `recover_before` to the preceding processed source commit
     or the baseline tag's commit.

4. Dispatch `.github/workflows/release.yml` at the recovery tag with those inputs.
5. Check that the workflow's `GITHUB_SHA` equals the recorded source.
6. After recovery succeeds, remove the temporary environment allowance.

The original run ID still determines the preview version. For an unplanned run,
the adapter verifies the original source, branch, and workflow. It checks that
every intervening first-parent commit belongs to the recorded merged PR, then
checks predecessor completion. Recovery inputs cannot change an existing plan.

Dispatch at the original source, without overriding GitHub provenance variables.
A newer branch tip with an older checkout fails source validation.

If GitHub rejects a historical tag or release repair because the built-in token
lacks workflow-file write access, use your account with that access. Repair the
exact tag or release. Preserve the retained tarball and recorded source, then
rerun the original source workflow. Do not add a personal access token to the
repository to bypass this restriction.

## Repair a release plan explicitly

Later label edits do not change recorded plans. Before publication, follow these
steps:

1. Inspect the affected draft record and all dependent plans.
2. Record the intended correction and reason on the originating PR.
3. Check whether the version exists on npm. If it does, preserve the artifact
   and recover that publication before repairing the plan.
4. Repair the record. Clear a retained artifact only after confirming that its
   version has never reached npm.
5. Rerun affected source runs in order.

Preserve merge records and the bootstrap tag. They establish release boundaries
and prevent skipped work. Protect `v*`, recovery tags, and completed release assets
from changes.
