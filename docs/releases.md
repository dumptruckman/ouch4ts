# Release process

The release workflows turn merged PR labels into npm previews and stable
packages. Publishing runs only when the repository variable `RELEASES_ENABLED`
is `true`. The [setup guide](release-setup.md) covers the initial publication,
branch protections, and npm trusted publisher.

## Previews and stable releases

Each PR selects one [release label](development.md#select-a-release-label).
After an eligible merge to `main`, the workflow publishes an npm preview under
`preview`. A rolling Changesets PR gathers pending changes using their highest
requested bump. Merging a current, approved release PR publishes the stable
package. A `no release` merge refreshes a pending proposal without publishing a
preview.

The release adapter generates temporary changeset inputs from recorded merge
data. Feature authors do not write those files. Later label edits do not change
an existing release record.

## Maintenance branches

Maintenance branches use `maintenance/<major>.<minor>` and accept only patch
releases or `no release`. Their npm channels are `preview-<major>.<minor>` and
`release-<major>.<minor>`. The `latest` channel never moves backward. Backports
are manual.

## Publication records and retries

A draft `record-<source SHA>` release stores the PR, predecessor, original run ID,
release plan, and progress. Stable publications also have a `v<version>` release.
Retained `ouch4ts.tgz`, `publication.json`, and `SHA256SUMS` assets bind a retry to
the same artifact and source.

If npm accepted a publication but the workflow did not finish, a retry checks the
registry version, integrity, tarball bytes, and provenance source. Matching data
allows the workflow to finish channel and GitHub updates without republishing.
A conflicting artifact permanently blocks that version.

The release adapter checks the source commit, workflow, repository, and artifact
digest in the registry's SLSA provenance. npm validates provenance attestations
during publication. Local fake-service tests cover source checks and retries.
They do not verify live npm OIDC access.

Later publication runs on an affected line wait for an unfinished stable
publication. Other release lines can continue. The
[recovery guide](release-recovery.md) covers retries, expired rerun windows, and
explicit plan repairs.

## Workflow configuration

The workflows use the built-in `GITHUB_TOKEN` and npm trusted publishing. They
require no repository secret, personal access token, GitHub App, private key, or
`NODE_AUTH_TOKEN`.

The authoritative runner, Node, npm, and token-permission settings are in
[release.yml](../.github/workflows/release.yml). Publication uses the `npm-release`
environment. Actions read access verifies the original push run during recovery.
PR CI has read-only permissions and no publishing environment.
