import { describe, it, expect } from "vitest";
import { reduceFilesPersisted } from "../files-persisted";

describe("reduceFilesPersisted", () => {
  it("appends new files to persistedFiles", () => {
    const store = { persistedFiles: ["/a"] } as { persistedFiles: string[] };
    reduceFilesPersisted(
      { type: "files_persisted", run_id: "r", _seq: 1, files: ["/b", "/c"] } as never,
      null,
      store as never,
      false,
    );
    expect(store.persistedFiles).toEqual(["/a", "/b", "/c"]);
  });

  it("caps persistedFiles at 500 (drops oldest first)", () => {
    const existing = Array.from({ length: 498 }, (_, i) => `/old-${i}`);
    const store = { persistedFiles: existing } as { persistedFiles: string[] };
    reduceFilesPersisted(
      { type: "files_persisted", run_id: "r", _seq: 1, files: ["/n1", "/n2", "/n3"] } as never,
      null,
      store as never,
      false,
    );
    expect(store.persistedFiles.length).toBe(500);
    expect(store.persistedFiles[0]).toBe("/old-1"); // oldest 1 dropped
    expect(store.persistedFiles[497]).toBe("/n1");
    expect(store.persistedFiles[498]).toBe("/n2");
    expect(store.persistedFiles[499]).toBe("/n3");
  });

  it("treats missing files as empty array (graceful no-op)", () => {
    const store = { persistedFiles: ["/a"] } as { persistedFiles: string[] };
    reduceFilesPersisted(
      { type: "files_persisted", run_id: "r", _seq: 1 } as never,
      null,
      store as never,
      false,
    );
    expect(store.persistedFiles).toEqual(["/a"]);
  });

  it("handles non-array files defensively", () => {
    const store = { persistedFiles: ["/a"] } as { persistedFiles: string[] };
    reduceFilesPersisted(
      // @ts-expect-error testing defensive guard
      { type: "files_persisted", run_id: "r", _seq: 1, files: "not-an-array" },
      null,
      store as never,
      false,
    );
    expect(store.persistedFiles).toEqual(["/a"]);
  });
});
