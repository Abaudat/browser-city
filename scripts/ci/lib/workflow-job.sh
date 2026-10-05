#!/usr/bin/env bash
# workflow_job_block <workflow-file> <job> -- a top-level job's block: from
# its "  <job>:" line up to (not including) the next "  <other>:" line.
workflow_job_block() {
  awk -v name="$2" '
    $0 ~ "^  " name ":$" { inblock = 1; print; next }
    inblock && /^  [A-Za-z0-9_-]+:$/ { inblock = 0 }
    inblock { print }
  ' "$1"
}
