#!/usr/bin/env python3
"""Exact, JSON-safe canonicalisation for `spacetime sql --format json` output.

Why this exists rather than `jq`: `jq` re-serialises every number through an
IEEE double, so a `u64` (chunk_key, an auto_inc id) above 2^53 silently loses
precision the moment it passes through a `jq` filter -- confirmed empirically
against a real local SpacetimeDB 2.9.0 instance while building this script
(`chunk_key = 18446744073709551615` survives a raw `spacetime sql --format
json` response byte-for-byte, but does not survive `jq . `). Python's `json`
module decodes an integer literal with no `.`/`e` to an arbitrary-precision
`int` and re-emits it exactly the same way -- verified the same way. Every
numeric value in scripts/ops therefore passes through *this* file, never
`jq`, and never a step that could coerce it to `float` (docs/architecture.md,
"Backup").

Every subcommand reads one `spacetime sql --format json "SELECT * FROM t"`
response (a JSON array with exactly one object, `{"schema": ..., "rows":
[...]}`, per SpacetimeDB 2.9's own shape) from a file argument, or fails
loudly -- this is parsing an UNSTABLE CLI's output, and a shape it no longer
matches must be a hard error, never a quiet empty result.
"""
from __future__ import annotations

import json
import sys

# The two single-field Product wrappers `spacetime sql`'s JSON output uses
# for SpacetimeDB's special scalar-like types, and the Sum type wrapping a
# ScheduleAt -- see this file's module doc and docs/spikes/
# 1.4-backup-restore.md's "SQL cannot construct these" finding.
IDENTITY_FIELD = "__identity__"
CONNECTION_ID_FIELD = "__connection_id__"
TIMESTAMP_FIELD = "__timestamp_micros_since_unix_epoch__"
SCHEDULE_VARIANTS = {"Interval", "Time"}

SCALAR_TAGS = {
    "Bool": "BOOL",
    "U8": "U8",
    "U16": "U16",
    "U32": "U32",
    "U64": "U64",
    "U128": "U128",
    "U256": "U256",
    "I8": "I8",
    "I16": "I16",
    "I32": "I32",
    "I64": "I64",
    "I128": "I128",
    "I256": "I256",
    "F32": "F32",
    "F64": "F64",
    "String": "STRING",
}


def _force_utf8_stdio() -> None:
    # A non-ASCII seed string (emoji, per Quentin's direction) must round
    # trip exactly regardless of the host's default locale/codepage --
    # never left to whatever `PYTHONIOENCODING` happens to be.
    # `newline="\n"` too: on Windows, text-mode stdout otherwise translates
    # `\n` to `\r\n`, which would silently corrupt every line-oriented
    # file this toolchain writes and compares byte for byte (the dev box
    # is Windows 11 -- docs/architecture.md's Toolchain table).
    for stream in (sys.stdout, sys.stderr, sys.stdin):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", newline="\n")


def die(msg: str) -> "NoReturn":  # type: ignore[name-defined]
    print(f"canon.py: FAIL -- {msg}", file=sys.stderr)
    sys.exit(1)


def load_response(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        die(f"could not read {path}: {e}")
    try:
        doc = json.loads(text)
    except json.JSONDecodeError as e:
        die(f"{path} is not valid JSON ('spacetime sql --format json' output drifted?): {e}")
    if not isinstance(doc, list) or len(doc) != 1 or not isinstance(doc[0], dict):
        die(f"{path}: expected a one-element JSON array of one object, got: {type(doc).__name__}")
    obj = doc[0]
    if "schema" not in obj or "rows" not in obj:
        die(f"{path}: response has no 'schema'/'rows' keys -- 'spacetime sql --format json' shape drifted")
    return obj


def column_type_tag(algebraic_type: dict) -> str:
    """Reduces one column's `algebraic_type` JSON to a short tag this
    toolchain knows how to render as a SQL literal, or 'OTHER' -- callers
    treat 'OTHER' as a hard failure (a column type the generator/renderer
    cannot fill is exactly the gap Tim's direction says must fail loudly,
    not silently skip)."""
    if not isinstance(algebraic_type, dict) or len(algebraic_type) != 1:
        return "OTHER"
    (key, val), = algebraic_type.items()
    if key in SCALAR_TAGS:
        return SCALAR_TAGS[key]
    if key == "Product":
        elements = val.get("elements", [])
        if len(elements) == 1:
            name = elements[0].get("name", {}).get("some")
            if name == IDENTITY_FIELD:
                return "IDENTITY"
            if name == CONNECTION_ID_FIELD:
                return "CONNECTION_ID"
            if name == TIMESTAMP_FIELD:
                return "TIMESTAMP"
        return "OTHER"
    if key == "Sum":
        variants = val.get("variants", [])
        names = {v.get("name", {}).get("some") for v in variants}
        if names == SCHEDULE_VARIANTS:
            return "SCHEDULE"
        return "OTHER"
    return "OTHER"


def cmd_columns(path: str) -> None:
    obj = load_response(path)
    for el in obj["schema"]["elements"]:
        name = el.get("name", {}).get("some")
        if name is None:
            die(f"{path}: a column has no name")
        print(name)


def cmd_columns_normalized(path: str) -> None:
    obj = load_response(path)
    for el in obj["schema"]["elements"]:
        name = el.get("name", {}).get("some")
        if name is None:
            die(f"{path}: a column has no name")
        print(normalize_name(name))


def cmd_coltypes(path: str) -> None:
    obj = load_response(path)
    for el in obj["schema"]["elements"]:
        print(column_type_tag(el.get("algebraic_type", {})))


def unwrap_field(tag: str, value):
    """Reduces one row's raw field value (as `spacetime sql --format json`
    encodes it) to the plain scalar this toolchain sorts/renders -- e.g. an
    Identity's `["0xabc..."]` becomes `"0xabc..."`. Never touches a value
    through anything that could lose integer precision."""
    if tag in ("IDENTITY", "CONNECTION_ID", "TIMESTAMP"):
        if not isinstance(value, list) or len(value) != 1:
            die(f"expected a one-element wrapper for a {tag} field, got: {value!r}")
        return value[0]
    return value


def sort_key(value):
    # Every primary key in this schema is a plain non-negative integer
    # (u8/u32/u64, `#[primary_key]`, first column -- docs/architecture.md's
    # "Schema" section) -- Python's `int` comparison is exact at any width.
    if isinstance(value, bool) or not isinstance(value, int):
        die(f"the primary key column's value is not a plain integer: {value!r}")
    return value


def cmd_rows_canonical(path: str) -> None:
    obj = load_response(path)
    tags = [column_type_tag(el.get("algebraic_type", {})) for el in obj["schema"]["elements"]]
    rows = obj["rows"]
    plain_rows = []
    for row in rows:
        if len(row) != len(tags):
            die(f"{path}: a row has {len(row)} fields, the schema has {len(tags)}")
        plain_rows.append([unwrap_field(t, v) for t, v in zip(tags, row)])
    plain_rows.sort(key=lambda r: sort_key(r[0]))
    for row in plain_rows:
        print(json.dumps(row, separators=(",", ":"), ensure_ascii=False))


def sql_literal(tag: str, value) -> str:
    if tag in ("U8", "U16", "U32", "U64", "U128", "U256", "I8", "I16", "I32", "I64", "I128", "I256"):
        if isinstance(value, bool) or not isinstance(value, int):
            die(f"expected an integer for a {tag} field, got: {value!r}")
        return str(value)
    if tag == "BOOL":
        if not isinstance(value, bool):
            die(f"expected a bool, got: {value!r}")
        return "true" if value else "false"
    if tag == "STRING":
        if not isinstance(value, str):
            die(f"expected a string, got: {value!r}")
        return "'" + value.replace("'", "''") + "'"
    if tag in ("IDENTITY", "CONNECTION_ID"):
        if not isinstance(value, str) or not value.startswith("0x"):
            die(f"expected a '0x...' hex literal for a {tag} field, got: {value!r}")
        # `spacetime sql --format json` trims leading zero *nibbles* when
        # it renders an Identity/ConnectionId, which can leave an odd
        # number of hex digits (e.g. `0xdbba4`, 5 digits) -- confirmed
        # empirically to be rejected as an INSERT literal ("cannot be
        # parsed as type U256") even though the CLI itself produced it.
        # Left-padding back to the type's full width (32 bytes = 64 hex
        # digits for both Identity and ConnectionId in SpacetimeDB 2.9)
        # is always safe and always round-trips (docs/spikes/
        # 1.4-backup-restore.md).
        digits = value[2:]
        return "0x" + digits.rjust(64, "0")
    die(f"no SQL literal exists for a {tag} field -- SpacetimeDB 2.9's SQL INSERT cannot construct "
        f"this type (see docs/spikes/1.4-backup-restore.md)")


def cmd_row_tuple(coltypes_csv: str, row_json: str) -> None:
    tags = coltypes_csv.split(",") if coltypes_csv else []
    row = json.loads(row_json)
    if len(row) != len(tags):
        die(f"row has {len(row)} fields, coltypes has {len(tags)}")
    literals = [sql_literal(t, v) for t, v in zip(tags, row)]
    print("(" + ",".join(literals) + ")")


def normalize_name(name: str) -> str:
    # SpacetimeDB inserts an underscore at a letter/digit boundary when it
    # echoes a column name back (observed empirically: `x0` -> `x_0`) --
    # comparing names with underscores stripped is robust to that without
    # having to model the exact rule.
    return name.replace("_", "").lower()


def cmd_snapshot_tables(path: str) -> None:
    with open(path, "r", encoding="utf-8") as f:
        snap = json.load(f)
    for t in snap["tables"]:
        scheduled = "1" if t.get("scheduled_reducer") else "0"
        print(f"{t['accessor']}\t{scheduled}")


def cmd_snapshot_columns(path: str, accessor: str) -> None:
    with open(path, "r", encoding="utf-8") as f:
        snap = json.load(f)
    for t in snap["tables"]:
        if t["accessor"] == accessor:
            for c in t["columns"]:
                print(normalize_name(c["name"]))
            return
    die(f"{path}: no table named '{accessor}'")


def cmd_normalize(name: str) -> None:
    print(normalize_name(name))


def cmd_row_count(path: str) -> None:
    obj = load_response(path)
    print(len(obj["rows"]))


def cmd_describe_tables(path: str) -> None:
    """`spacetime describe <db> --json`'s own table list -- the ground
    truth Tim's direction says to cross-check the snapshot against, never a
    hand-written list."""
    with open(path, "r", encoding="utf-8") as f:
        doc = json.load(f)
    sections = doc.get("sections")
    if not isinstance(sections, list):
        die(f"{path}: no 'sections' array -- 'spacetime describe --json' shape drifted")
    for s in sections:
        if "Tables" in s:
            for t in s["Tables"]:
                print(t["source_name"])
            return
    die(f"{path}: no 'Tables' section found")


EDGE_VALUES = {
    "u8": [0, 255, 42],
    "u16": [0, 65535, 1000],
    "u32": [0, 4294967295, 12345],
    "u64": [0, 18446744073709551615, 9223372036854775808],
    "i8": [-128, 127, 0],
    "i16": [-32768, 32767, 0],
    "i32": [-2147483648, 2147483647, 0],
    "i64": [-9223372036854775808, 9223372036854775807, 0],
    "bool": [True, False],
    "String": [
        "",
        "adversarial: '\"quote\"'\tTAB\nNEWLINE pipe|emoji\U0001F600",
        "plain seed value",
    ],
}
SCALAR_TY_TO_TAG = {
    "u8": "U8", "u16": "U16", "u32": "U32", "u64": "U64",
    "i8": "I8", "i16": "I16", "i32": "I32", "i64": "I64",
    "String": "STRING", "bool": "BOOL",
}


def edge_value(ty: str, row_index: int):
    values = EDGE_VALUES.get(ty)
    if values is None:
        die(f"seed-edge-rows: no edge-value generator for type '{ty}' -- a new column type must be "
            f"taught to this generator before it can be seeded/restored (Tim's direction: a type the "
            f"generator cannot fill fails loudly, never silently)")
    return values[row_index % len(values)]


def cmd_seed_tuples(snapshot_path: str, accessor: str, n: str, base_offset: str) -> None:
    """seed-tuples <snapshot.json> <accessor> <n> <base-offset> -- n rows'
    worth of SQL literal tuples for `accessor`, one per line, schema-driven
    (never a hand-written per-table row): an auto_inc primary key is
    always `0` (let SpacetimeDB assign it); a non-auto_inc primary key or
    a `#[unique]` column gets a synthetic, collision-free value derived
    from `base-offset` + the row index; every other column cycles through
    EDGE_VALUES for its type. A column whose type this generator has no
    entry for is a hard failure, not a silent skip."""
    with open(snapshot_path, "r", encoding="utf-8") as f:
        snap = json.load(f)
    table = next((t for t in snap["tables"] if t["accessor"] == accessor), None)
    if table is None:
        die(f"{snapshot_path}: no table named '{accessor}'")
    n = int(n)
    base = int(base_offset)
    tuples = []
    for i in range(n):
        fields = []
        for col in table["columns"]:
            ty = col["ty"]
            if ty in ("Identity",):
                fields.append("IDENTITY:0x" + format(base + i, "064x"))
                continue
            if ty in ("Timestamp", "ScheduleAt"):
                die(f"'{accessor}.{col['name']}' is a {ty} column -- seed-edge-rows never seeds one "
                    f"directly (SpacetimeDB 2.9's SQL INSERT cannot construct it); only a reducer can, "
                    f"and none exists for this table yet")
            tag = SCALAR_TY_TO_TAG.get(ty)
            if tag is None:
                die(f"no SQL literal renderer for type '{ty}' on '{accessor}.{col['name']}'")
            if col.get("primary_key") and col.get("auto_inc"):
                value = 0
            elif col.get("primary_key") or col.get("unique"):
                value = base + i
            else:
                value = edge_value(ty, i)
            fields.append(f"{tag}:{json.dumps(value)}")
        literals = []
        for spec in fields:
            tag, _, raw = spec.partition(":")
            if tag == "IDENTITY":
                literals.append(raw)
            else:
                literals.append(sql_literal(tag, json.loads(raw)))
        tuples.append("(" + ",".join(literals) + ")")
    # Joined here, in one `print`, never left to a shell-side `paste`/
    # newline-per-tuple convention: a seeded String can contain a real
    # newline byte (Quentin's adversarial-value direction), and a SQL
    # string literal is allowed to span lines -- a newline-delimited
    # join would misread that byte as a tuple separator (confirmed
    # empirically while building this generator).
    print(",".join(tuples))


def cmd_row_tuples_file(coltypes_csv: str, rows_path: str, start: str, count: str) -> None:
    """row-tuples-file <coltypes-csv> <rows.jsonl> <start> <count> -- like
    `row-tuple`, but renders `count` rows starting at line `start` (0-based)
    of a rows-canonical file in one process, printing one comma-joined
    VALUES blob. restore-world.sh calls this once per batch, never once
    per row -- a `python3` process per row does not scale (confirmed
    empirically: ~20,000 individual invocations took minutes; one call per
    batch of hundreds does not)."""
    tags = coltypes_csv.split(",") if coltypes_csv else []
    start = int(start)
    count = int(count)
    tuples = []
    with open(rows_path, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            if i < start:
                continue
            if i >= start + count:
                break
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            if len(row) != len(tags):
                die(f"row {i} has {len(row)} fields, coltypes has {len(tags)}")
            literals = [sql_literal(t, v) for t, v in zip(tags, row)]
            tuples.append("(" + ",".join(literals) + ")")
    print(",".join(tuples))


def cmd_write_manifest(out_path: str, kv_pairs) -> None:
    """write-manifest <out.json> <key=value...> tables=<tables.json-file>
    -- every scalar field is a plain `key=value` pair; the one nested
    field (`tables`, per-table row counts and file sha256) is written to
    its own small JSON file by the caller and referenced by path so this
    command never has to parse shell-quoted JSON."""
    manifest = {}
    tables_file = None
    for pair in kv_pairs:
        key, _, value = pair.partition("=")
        if key == "tables_file":
            tables_file = value
        elif key.endswith("_int"):
            manifest[key[:-4]] = int(value)
        else:
            manifest[key] = value
    if tables_file:
        with open(tables_file, "r", encoding="utf-8") as f:
            manifest["tables"] = json.load(f)
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2, sort_keys=True, ensure_ascii=False)
        f.write("\n")


def main(argv):
    _force_utf8_stdio()
    if len(argv) < 2:
        die("usage: canon.py <columns|coltypes|rows-canonical|row-tuple> ...")
    cmd = argv[1]
    if cmd == "columns":
        cmd_columns(argv[2])
    elif cmd == "columns-normalized":
        cmd_columns_normalized(argv[2])
    elif cmd == "coltypes":
        cmd_coltypes(argv[2])
    elif cmd == "rows-canonical":
        cmd_rows_canonical(argv[2])
    elif cmd == "row-tuple":
        cmd_row_tuple(argv[2], argv[3])
    elif cmd == "row-count":
        cmd_row_count(argv[2])
    elif cmd == "snapshot-tables":
        cmd_snapshot_tables(argv[2])
    elif cmd == "snapshot-columns":
        cmd_snapshot_columns(argv[2], argv[3])
    elif cmd == "normalize":
        cmd_normalize(argv[2])
    elif cmd == "describe-tables":
        cmd_describe_tables(argv[2])
    elif cmd == "write-manifest":
        cmd_write_manifest(argv[2], argv[3:])
    elif cmd == "seed-tuples":
        cmd_seed_tuples(argv[2], argv[3], argv[4], argv[5])
    elif cmd == "row-tuples-file":
        cmd_row_tuples_file(argv[2], argv[3], argv[4], argv[5])
    else:
        die(f"unknown subcommand: {cmd}")


if __name__ == "__main__":
    main(sys.argv)
