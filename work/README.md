# Active work

`work/` is the active run workspace. New or in-progress pipeline artifacts live
here while an operator or agent is still using them.

Completed run artifacts move to `internal/work_archive/` during librarian
maintenance. Operators should not need to inspect `internal/work_archive/` for
routine system operation; read archived runs only by explicit path when
reconstructing history, debugging a past run, or repairing citations.
