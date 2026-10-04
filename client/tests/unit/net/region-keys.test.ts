// Story 4.8: a reconnect reconciles region rows by the primary key declared
// in `REGION_KEY_COLUMNS`; each declaration is checked against the bindings'
// own primary-key metadata, so a table whose key moves or is composite fails.
import { describe, expect, it } from "vitest";
import { tables } from "../../../src/net/bindings";
import {
  REGION_KEY_COLUMNS,
  REGION_TABLE_NAMES,
  regionRowKey,
} from "../../../src/net/region-subscription";

interface ColumnMeta {
  columnMetadata: { isPrimaryKey?: boolean };
}

/** The primary-key columns of a table, from the bindings. */
function primaryKeys(columns: Record<string, ColumnMeta>): string[] {
  return Object.entries(columns)
    .filter(([, c]) => c.columnMetadata.isPrimaryKey === true)
    .map(([name]) => name);
}

function declaredKeyIsTheSolePrimaryKey(columns: Record<string, ColumnMeta>, declared: string) {
  const keys = primaryKeys(columns);
  return keys.length === 1 && keys[0] === declared;
}

describe("REGION_KEY_COLUMNS", () => {
  it.each(REGION_TABLE_NAMES)("%s: the declared column is the table's sole primary key", (name) => {
    const columns = (tables[name] as unknown as { columns: Record<string, ColumnMeta> }).columns;
    expect(declaredKeyIsTheSolePrimaryKey(columns, REGION_KEY_COLUMNS[name])).toBe(true);
  });

  it("negative control: a wrong column, or a composite key, is refused", () => {
    const columns = (tables.placedObject as unknown as { columns: Record<string, ColumnMeta> })
      .columns;
    expect(declaredKeyIsTheSolePrimaryKey(columns, "defId")).toBe(false);
    const composite = {
      ...columns,
      defId: { columnMetadata: { isPrimaryKey: true } },
    };
    expect(declaredKeyIsTheSolePrimaryKey(composite, "objectId")).toBe(false);
  });

  it("reads a row's key from the declared column", () => {
    expect(regionRowKey("placedObject", { objectId: 7n, defId: 9 })).toBe("7");
    expect(regionRowKey("roomArea", { areaId: 3n })).toBe("3");
  });
});
