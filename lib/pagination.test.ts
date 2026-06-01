import { describe, it, expect } from "vitest";
import { paginate } from "@/lib/pagination";

const list = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("paginate", () => {
  it("returns the first page with correct from/to indices", () => {
    const r = paginate(list(57), 1, 25);
    expect(r.pageRows).toEqual(list(25));
    expect(r.totalPages).toBe(3);
    expect(r.currentPage).toBe(1);
    expect(r.from).toBe(1);
    expect(r.to).toBe(25);
    expect(r.total).toBe(57);
  });

  it("returns a partial last page", () => {
    const r = paginate(list(57), 3, 25);
    expect(r.pageRows).toEqual([51, 52, 53, 54, 55, 56, 57]);
    expect(r.from).toBe(51);
    expect(r.to).toBe(57);
  });

  it("clamps a page above the range to the last page", () => {
    const r = paginate(list(57), 99, 25);
    expect(r.currentPage).toBe(3);
    expect(r.from).toBe(51);
    expect(r.to).toBe(57);
  });

  it("clamps a page below 1 to the first page", () => {
    const r = paginate(list(57), 0, 25);
    expect(r.currentPage).toBe(1);
    expect(r.from).toBe(1);
  });

  it("handles an empty list as a single empty page", () => {
    const r = paginate<number>([], 1, 25);
    expect(r.pageRows).toEqual([]);
    expect(r.totalPages).toBe(1);
    expect(r.currentPage).toBe(1);
    expect(r.from).toBe(0);
    expect(r.to).toBe(0);
    expect(r.total).toBe(0);
  });

  it("guards against a non-positive page size", () => {
    const r = paginate(list(3), 1, 0);
    expect(r.pageRows).toEqual([1]);
    expect(r.totalPages).toBe(3);
  });

  it("handles an exact page boundary", () => {
    const r = paginate(list(50), 2, 25);
    expect(r.pageRows).toEqual(Array.from({ length: 25 }, (_, i) => i + 26));
    expect(r.totalPages).toBe(2);
    expect(r.to).toBe(50);
  });
});
