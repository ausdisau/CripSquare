import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEO } from "@/components/SEO";
import type { ForumCategory } from "@shared/schema";

type ForumHit = {
  id: number;
  title: string;
  excerpt: string;
  categorySlug: string;
  categoryName: string;
  replyCount: number;
  isSolved: boolean;
  isLocked: boolean;
  isPinned: boolean;
  lastActivityAt: string | null;
};
type SearchResponse = {
  query: string; category: string | null; page: number;
  hasMore: boolean; results: ForumHit[];
};
type AnalyticsConsent = { optedIn: boolean };

function currentParams() {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

function pageLink(query: string, category: string, page: number): string {
  const params = new URLSearchParams({ q: query, page: String(page) });
  if (category) params.set("category", category);
  return "/forums/search?" + params.toString();
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(res.status === 404
    ? "Forum search is not enabled yet."
    : "Search could not be completed. Your query has not been sent elsewhere.");
  return res.json() as Promise<T>;
}

export default function ForumSearch() {
  const initial = useMemo(() => currentParams(), []);
  const query = initial.get("q") ?? "";
  const category = initial.get("category") ?? "";
  const pageValue = Number(initial.get("page") ?? 1);
  const page = Number.isSafeInteger(pageValue) && pageValue >= 1 ? pageValue : 1;

  const [term, setTerm] = useState(query);
  const [selectedCategory, setSelectedCategory] = useState(category);
  const client = useQueryClient();
  const valid = query.trim().length >= 2 && query.trim().length <= 120;

  const { data: categories } = useQuery<ForumCategory[]>({
    queryKey: ["/api/forums/categories"],
  });
  const { data, error, isPending, isFetching } = useQuery<SearchResponse>({
    queryKey: ["forum-bulletin-search", query, category, page],
    enabled: valid,
    retry: false,
    queryFn: () => getJson<SearchResponse>(
      "/api/forums/bulletin/search?" + new URLSearchParams({
        q: query, category, page: String(page),
      }).toString(),
    ),
  });
  const { data: consent } = useQuery<AnalyticsConsent>({
    queryKey: ["forum-bulletin-analytics-consent"],
    retry: false,
    queryFn: () => getJson<AnalyticsConsent>("/api/forums/bulletin/me/analytics-consent"),
  });
  const updateConsent = useMutation({
    mutationFn: async (optedIn: boolean) => {
      const res = await fetch("/api/forums/bulletin/me/analytics-consent", {
        method: "PUT",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optedIn }),
      });
      if (!res.ok) throw new Error("Could not update your preference.");
      return res.json() as Promise<AnalyticsConsent>;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["forum-bulletin-analytics-consent"] }),
  });

  return (
    <Layout>
      <SEO
        title="Search discussions — CripSquare"
        description="Find discussions in the CripSquare community bulletin board."
      />
      <main className="max-w-2xl space-y-5">
        <nav aria-label="Forum breadcrumb">
          <Link href="/forums" className="text-primary underline underline-offset-2 min-h-11 inline-flex items-center">
            Back to forum categories
          </Link>
        </nav>
        <div>
          <h1 className="text-2xl font-bold">Search community discussions</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Results are chronological, not personalised by an algorithm.
            Search only covers thread titles and opening posts for now.
          </p>
        </div>

        <form method="get" action="/forums/search" role="search" className="sm-card p-4 space-y-4">
          <div className="space-y-1">
            <label htmlFor="forum-search-term" className="block font-medium">Search words</label>
            <input
              id="forum-search-term"
              type="search"
              name="q"
              value={term}
              onChange={e => setTerm(e.target.value)}
              minLength={2}
              maxLength={120}
              required
              placeholder="e.g. accessible transport"
              className="w-full min-h-11 rounded-lg border border-input bg-background px-3 text-foreground"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="forum-search-category" className="block font-medium">Category (optional)</label>
            <select
              id="forum-search-category"
              name="category"
              value={selectedCategory}
              onChange={e => setSelectedCategory(e.target.value)}
              className="w-full min-h-11 rounded-lg border border-input bg-background px-3 text-foreground"
            >
              <option value="">All categories</option>
              {categories?.map(cat => (
                <option key={cat.id} value={cat.slug}>{cat.name}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="min-h-11 rounded-lg bg-primary px-5 py-2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            Search discussions
          </button>
        </form>

        <section aria-labelledby="forum-search-results">
          <h2 id="forum-search-results" className="text-lg font-semibold mb-3">Results</h2>
          {!valid ? (
            <p role="status" className="text-sm text-muted-foreground">
              Enter at least two characters to search the community.
            </p>
          ) : isPending || isFetching && !data ? (
            <p role="status">Searching discussions…</p>
          ) : error ? (
            <p role="alert">{error.message}</p>
          ) : data?.results.length === 0 ? (
            <p role="status">No matching threads. Try different words or another category.</p>
          ) : (
            <div className="space-y-3" aria-live="polite">
              <p className="text-sm text-muted-foreground">Page {page}; {data?.results.length ?? 0} results shown.</p>
              {data?.results.map(hit => (
                <article key={hit.id} className="sm-card p-4 space-y-2">
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{hit.categoryName}</span>
                    {hit.isPinned && <span>• Pinned</span>}
                    {hit.isLocked && <span>• Locked: no new replies</span>}
                    {hit.isSolved && <span>• Answered</span>}
                    <span>• {hit.replyCount} replies</span>
                  </div>
                  <h3 className="font-semibold">
                    <Link
                      href={"/forums/" + hit.categorySlug + "/" + hit.id}
                      className="text-primary underline underline-offset-2 min-h-11 inline-flex items-center"
                    >
                      {hit.title}
                    </Link>
                  </h3>
                  <p className="text-sm whitespace-pre-wrap break-words">{hit.excerpt}</p>
                </article>
              ))}
              <nav className="flex gap-3" aria-label="Search pages">
                {page > 1 && (
                  <Link href={pageLink(query, category, page - 1)}
                    className="min-h-11 px-4 py-2 rounded-lg border inline-flex items-center">
                    Previous page
                  </Link>
                )}
                {data?.hasMore && (
                  <Link href={pageLink(query, category, page + 1)}
                    className="min-h-11 px-4 py-2 rounded-lg border inline-flex items-center">
                    Next page
                  </Link>
                )}
              </nav>
            </div>
          )}
        </section>

        <section aria-labelledby="forum-privacy" className="sm-card p-4 space-y-3">
          <h2 id="forum-privacy" className="text-base font-semibold">Privacy and analytics</h2>
          <p className="text-sm text-muted-foreground">
            Community analytics are optional and off by default. If you opt in,
            we count limited usage events under a pseudonymous identifier.
            Discussion text, search words, health information and session recordings
            are never included in these forum events.
          </p>
          {consent && (
            <button
              type="button"
              disabled={updateConsent.isPending}
              onClick={() => updateConsent.mutate(!consent.optedIn)}
              className="min-h-11 rounded-lg border px-4 py-2 font-medium"
            >
              {consent.optedIn ? "Withdraw analytics permission" : "Allow limited usage analytics"}
            </button>
          )}
          {updateConsent.isError && <p role="alert">Preference not saved. Try again.</p>}
          <p role="status" className="text-sm">
            Preference: {consent?.optedIn ? "Opted in" : "Off or unavailable"}
          </p>
        </section>
      </main>
    </Layout>
  );
}
