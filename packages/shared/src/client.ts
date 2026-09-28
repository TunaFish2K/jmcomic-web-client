// Application DTOs for the existing PWA HTTP API. Protocol access lives in jmcomic-sdk.
export type SearchResult = {
  search_query: string;
  total: string;
} & (
  | {
      redirect_aid: string;
      content: [];
    }
  | {
      redirect_aid: never;
      content: {
        id: string;
        author: string;
        name: string;
      }[];
    }
);

export type Album = {
  id: string; name: string; images: string[]; description: string | null;
  totalViews: string; likes: string; series: { id: string; name: string; sort: string }[];
  seriesID: string; author: string[]; tags: string[]; works: string[]; actors: string[];
};
export type Photo = { id: string; name: string; images: { name: string; url: string }[] };
export type PhotoWithScrambleId = Photo & { scrambleId: number };

export function normalizeSearchResult(result: SearchResult): SearchResult {
  const redirectAid = (result as { redirect_aid?: unknown }).redirect_aid;
  if (
    redirectAid !== undefined &&
    redirectAid !== null &&
    String(redirectAid).trim()
  ) {
    return {
      ...result,
      search_query: String(result.search_query),
      total: String(result.total),
      redirect_aid: String(redirectAid),
      content: [],
    };
  }

  return {
    ...result,
    search_query: String(result.search_query),
    total: String(result.total),
    redirect_aid: undefined as never,
    content: result.content.map((item) => ({
      ...item,
      id: String(item.id),
    })),
  };
}

export function getSearchResultIds(result: SearchResult): string[] {
  return result.content.map((item) => item.id);
}

export function hasSameSearchResultIds(
  result: SearchResult,
  previousIds: string[],
): boolean {
  const resultIds = getSearchResultIds(result);
  if (resultIds.length === 0 || resultIds.length !== previousIds.length) {
    return false;
  }

  const sortedResultIds = [...resultIds].sort();
  const sortedPreviousIds = [...previousIds].sort();
  return sortedResultIds.every((id, index) => id === sortedPreviousIds[index]);
}
