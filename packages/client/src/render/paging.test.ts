import { test, expect } from "bun:test";
import { pageCount, clampPage, indexForDigit, pageSlice } from "./paging";

test("pageCount groups by 9 and is at least 1", () => {
  expect(pageCount(0)).toBe(1);
  expect(pageCount(9)).toBe(1);
  expect(pageCount(10)).toBe(2);
  expect(pageCount(19)).toBe(3);
});

test("clampPage bounds a page index into range", () => {
  expect(clampPage(-1, 30)).toBe(0);
  expect(clampPage(99, 30)).toBe(3); // 30 items -> 4 pages (0..3)
  expect(clampPage(2, 30)).toBe(2);
});

test("indexForDigit maps page + digit to an absolute index", () => {
  expect(indexForDigit(0, 1, 30)).toBe(0);
  expect(indexForDigit(0, 9, 30)).toBe(8);
  expect(indexForDigit(1, 1, 30)).toBe(9);
  expect(indexForDigit(2, 5, 30)).toBe(22);
});

test("indexForDigit returns -1 past the end or out of 1..9", () => {
  expect(indexForDigit(3, 4, 30)).toBe(-1); // would be index 30, == count
  expect(indexForDigit(0, 0, 30)).toBe(-1);
  expect(indexForDigit(0, 10, 30)).toBe(-1);
});

test("pageSlice clips the final page", () => {
  expect(pageSlice(0, 30)).toEqual({ start: 0, end: 9 });
  expect(pageSlice(3, 30)).toEqual({ start: 27, end: 30 });
});
