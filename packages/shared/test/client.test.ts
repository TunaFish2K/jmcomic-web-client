import assert from "node:assert/strict";
import test from "node:test";
import {
  getSearchResultIds,
  normalizeSearchResult,
  type SearchResult,
} from "../src/client";

test("normalizes numeric direct-match album IDs", () => {
  const result = normalizeSearchResult({
    search_query: "1464352",
    total: 1,
    redirect_aid: 1464352,
    content: [],
  } as unknown as SearchResult);

  assert.equal(result.total, "1");
  assert.equal(result.redirect_aid, "1464352");
});

test("normalizes numeric IDs in regular search results", () => {
  const result = normalizeSearchResult({
    search_query: "test",
    total: 1,
    redirect_aid: null,
    content: [{ id: 123, author: "author", name: "name" }],
  } as unknown as SearchResult);

  assert.deepEqual(getSearchResultIds(result), ["123"]);
});
