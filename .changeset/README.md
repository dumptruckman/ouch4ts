# Release inputs

Feature authors select one [release label](../docs/development.md#select-a-release-label)
on their PR. The release adapter generates temporary `pr-<number>.md` inputs from
recorded merge data. Changesets consumes these inputs to prepare the rolling
release PR.

For ordinary changes, leave this directory to the release adapter. Do not commit
generated inputs or run `changeset add`. See the [release process](../docs/releases.md),
[release setup](../docs/release-setup.md), and [release recovery](../docs/release-recovery.md).
