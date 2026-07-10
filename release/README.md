# Pancreator release index

`index.json` maps a published harness version to the immutable Git commit that
contains its exact installable payload.

Publication uses two commits because a Git commit cannot contain its own hash:

1. create the release commit, including synchronized `VERSION`, npm package metadata, `CHANGELOG.md`, and installable files;
2. add the resulting `version -> commit` entry to `index.json` in a later metadata commit.

The current `2.14.0` worktree is intentionally unindexed until an operator creates
that release commit and then records it in a later metadata commit. A clean
release commit can be installed as an unindexed release candidate for validation;
dirty-checkout installs are development snapshots. Neither state can use
automatic updates until an indexed release is reinstalled.
