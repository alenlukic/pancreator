# @pancreator/worktree

This package is retained as a compatibility stub after removal of parallel
feature-delivery checkout support.

Feature-delivery runs now operate as single runs in the main checkout. The CLI no
longer creates or leases isolated run directories for parallel delivery, and
`pan batch run` is disabled. Do not add new code that depends on this package to
create feature-delivery checkouts.
