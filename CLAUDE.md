# CLAUDE.md

## Delegation rule

Hand off token-heavy execution work to Codex instead of running it directly:
- Bulk file edits (repo-wide renames, mechanical multi-file changes)
- Well-specced builds (clear spec, no design decisions left)
- Bugs still failing after 2 fix attempts here

Invoke via the `codex` CLI (installed globally, v0.154.0).
