#!/usr/bin/env bash
# Shared path derivation for the precheck scripts. See team-charter.md §8.
#
# The precheck runs under cmd.exe with an environment predating the tool
# installs, so PATH holds none of jq, gh, orca or claude-rate-monitor. Every
# binary must therefore be reached by absolute path -- and every one of those
# paths must be *derived*, because a script that names one user's home stops
# working the first time the repo moves, and it stops by exiting non-zero,
# which reads as "nothing to do" rather than as a fault.

stamp() { date -u "+%Y-%m-%dT%H:%M:%SZ"; }

# Windows hands us backslashed drive paths; the shell wants /c/... . Done in
# bash rather than with cygpath so this depends on no tool it has not proven.
winpath() {
  # The quoted '\' matters: ${p//\//} silently substitutes nothing in bash 5.
  local p="${1//'\'//}"
  case "$p" in
    [A-Za-z]:/*) printf '/%s%s' "$(printf '%s' "${p%%:*}" | tr 'A-Z' 'a-z')" "${p#*:}" ;;
    *)           printf '%s' "$p" ;;
  esac
}

# Orca's selectors take Windows-form paths ("C:/Users/..."), not the /c/... form
# bash works in. Handing Orca the bash form returns selector_not_found -- with
# exit 0 and an ok:false body, so it reads as "no terminals" rather than as an
# error, and the team looks idle when it is merely unaddressable.
posix2win() {
  case "$1" in
    /[A-Za-z]/*) printf '%s:%s' "$(printf '%s' "$1" | cut -c2 | tr 'a-z' 'A-Z')" "$(printf '%s' "$1" | cut -c3-)" ;;
    *)           printf '%s' "$1" ;;
  esac
}

# Candidates first, PATH only as a last resort: PATH is the thing the precheck
# environment is known to be missing, so it may confirm a tool but is never
# relied on to supply one.
resolve() { # $1 command name, $2.. candidate absolute paths (globs allowed)
  local name="$1"; shift
  local candidate match found=""
  # An empty IFS keeps pathname expansion -- the jq package directory is a glob
  # -- while switching off field splitting, so "C:/Program Files/..." stays one
  # path rather than three. Splitting it is how a resolver silently finds
  # nothing and the caller reports a missing tool that is sitting right there.
  local oldifs="$IFS"; IFS=
  for candidate in "$@"; do
    for match in $candidate; do
      [ -x "$match" ] && { found="$match"; break 2; }
    done
  done
  IFS="$oldifs"
  [ -n "$found" ] || found="$(command -v "$name" 2>/dev/null)"
  [ -n "$found" ] && [ -x "$found" ] && { printf '%s' "$found"; return 0; }
  return 1
}

# --- where durable state lives ----------------------------------------------
# One directory, derived from the user rather than from whichever worktree
# happened to run. The obvious rule -- "beside the worktree" -- gives a
# different path per worktree: an Orca workspace lands it under
# .../BrowserCity/, while the main checkout at D:/Projects/BrowserCity lands it
# in D:/Projects/, next to unrelated repositories. A watchdog that must find
# the reason files cannot chase a moving target, and Scotty's automation runs
# in a different worktree from the one these scripts were authored in.
bc_state_dir() {
  local dir="${BC_STATE_DIR:-${WIN_PROFILE:-$HOME}/.browsercity}"
  mkdir -p "$dir" 2>/dev/null
  printf '%s' "$dir"
}

WIN_ROAMING="$(winpath "${APPDATA:-}")"
WIN_LOCAL="$(winpath "${LOCALAPPDATA:-}")"
WIN_PROFILE="${HOME:-$(winpath "${USERPROFILE:-}")}"

resolve_jq() {
  resolve jq \
    "${WIN_LOCAL:+$WIN_LOCAL/Microsoft/WinGet/Packages/jqlang.jq_*/jq.exe}" \
    "${WIN_LOCAL:+$WIN_LOCAL/Microsoft/WinGet/Links/jq.exe}" \
    "/c/ProgramData/chocolatey/bin/jq.exe" \
    "/usr/bin/jq"
}

resolve_gh() {
  resolve gh \
    "/c/Program Files/GitHub CLI/gh.exe" \
    "/c/Program Files (x86)/GitHub CLI/gh.exe" \
    "${WIN_LOCAL:+$WIN_LOCAL/Programs/GitHub CLI/gh.exe}"
}

resolve_orca() {
  resolve orca \
    "${WIN_LOCAL:+$WIN_LOCAL/Programs/orca/resources/bin/orca.exe}" \
    "${WIN_PROFILE:+$WIN_PROFILE/AppData/Local/Programs/orca/resources/bin/orca.exe}"
}

resolve_rate_monitor() {
  resolve claude-rate-monitor \
    "${WIN_ROAMING:+$WIN_ROAMING/npm/claude-rate-monitor}" \
    "${WIN_PROFILE:+$WIN_PROFILE/AppData/Roaming/npm/claude-rate-monitor}"
}
