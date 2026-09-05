# Orca/Claude session spike — findings (2026-09-02, Orca 1.4.193, Claude Code 2.1.258)

Every step of `orca-session-spike.sh` passed. These facts fix the design of `bc-session.sh`.

1. **Worktree-per-issue works.** `orca worktree create --repo id:<repoId> --name issue-<n> --issue <n> --no-parent --json`
   creates `~/orca/workspaces/BrowserCity/issue-<n>` on branch `Abaudat/issue-<n>` (Orca prefixes the git user),
   based on `origin/master`. The worktree is then addressable as `--worktree issue:<n>` (verified with `issue:999`)
   and as `path:C:/Users/granb/orca/workspaces/BrowserCity/issue-<n>` (Windows-form path, see `posix2win`).
   `orca worktree rm --worktree issue:<n> --force` removes it and its terminals.
2. **Orca terminals are PowerShell.** `--command` is run by PowerShell; single quotes are fine for the `-n` name.
3. **Claude's `-n` name wins the tab title, prefixed with a state glyph.** `--title` is overwritten once Claude starts.
   `terminal list` shows `agentIdentity: "claude"` and `title: "✳ bc-tim #0 (cb5993d0)"`.
   So `bc-session state <uuid>` matches on the 8-char uuid prefix inside the title.
4. **The glyph is the working/idle signal.** `✳` = idle at the prompt; `◐ ◑ ◒ ◓` (spinner) = working.
   `lastOutputAt` keeps ticking even at an idle prompt (the TUI repaints), so it is only a fallback.
5. **`terminal wait --for tui-idle --timeout-ms 60000` returns `satisfied: true`** on a fresh Claude (~10 s)
   and on a resumed one. `send --enter` after that is received and answered. Not needed before later sends.
6. **Resume works in place.** After `terminal close`, `claude --resume <uuid> --agent tim -n '<same name>' --permission-mode bypassPermissions`
   in the same worktree path continues the conversation, keeps `@tim`, and restores the same title.
7. **No transcript until the first message.** `~/.claude/projects/C--Users-granb-orca-workspaces-BrowserCity-issue-<n>/<uuid>.jsonl`
   only appears after the first prompt. `--resume` of an unknown id prints `No conversation found with session ID: …`
   and exits to the shell. So `start` picks `--resume` when the transcript exists, else `--session-id`.
   Encoded cwd = Windows path with `:` `/` `\` replaced by `-` (`C:/Users/granb/orca/...` → `C--Users-granb-orca-...`).
8. **Orca restart shape (not exercised — this session runs inside Orca).** Treat `connected:false` or `orphaned:true`
   or no title match as `absent`; `ensure` then recreates the terminal with `start`.
9. `terminal read --json` returns `.result.terminal.tail[]` (screen lines) — useful for debugging, not for state.
