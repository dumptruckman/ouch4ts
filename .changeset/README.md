# Release inputs

Feature authors select one release label on their PR. The release adapter generates temporary `pr-<number>.md` inputs from frozen merge records. Changesets consumes these inputs when it prepares the rolling release PR.

Do not commit generated inputs or run `changeset add` for ordinary changes. See [release setup](../docs/release-setup.md) and [release recovery](../docs/release-recovery.md).
