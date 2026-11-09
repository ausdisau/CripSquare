import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

type Consent = { optedIn: boolean };
const endpoint = "/api/forums/bulletin/me/analytics-consent";

async function getConsent(): Promise<Consent> {
  const res = await fetch(endpoint, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error("Privacy preference could not be loaded.");
  return res.json() as Promise<Consent>;
}

async function saveConsent(optedIn: boolean): Promise<Consent> {
  const res = await fetch(endpoint, {
    method: "PUT",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ optedIn }),
  });
  if (!res.ok) throw new Error("Preference not saved. Please try again.");
  return res.json() as Promise<Consent>;
}

export function ForumAnalyticsConsent() {
  const [feedback, setFeedback] = useState("");
  const queryClient = useQueryClient();
  const consent = useQuery({ queryKey: [endpoint], queryFn: getConsent, retry: false });
  const update = useMutation({
    mutationFn: saveConsent,
    onSuccess: (result) => {
      queryClient.setQueryData([endpoint], result);
      setFeedback(result.optedIn ? "Optional forum analytics enabled." : "Optional forum analytics disabled.");
    },
    onError: (error) => setFeedback(error instanceof Error ? error.message : "Preference not saved."),
  });

  return (
    <section aria-labelledby="forum-privacy-heading" className="sm-card mt-3 mb-5">
      <div className="sm-card-body">
        <h2 id="forum-privacy-heading" className="text-sm font-semibold">Your forum analytics choice</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Optional usage counts help improve forum search and discussion following. They do not
          contain your messages, search words, disability information, or account name.
          Choosing no does not affect participation. Previously sent events may remain under
          the analytics retention policy.
        </p>
        {consent.isPending ? (
          <p className="mt-2 text-sm" role="status">Loading your privacy preference…</p>
        ) : consent.isError ? (
          <p className="mt-2 text-sm" role="alert">Privacy preference is unavailable. Analytics remain disabled unless you previously opted in.</p>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-sm" aria-live="polite">
              Current choice: <strong>{consent.data?.optedIn ? "On" : "Off"}</strong>
            </span>
            <button
              type="button"
              className="min-h-11 rounded-lg border border-input px-4 py-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-pressed={consent.data?.optedIn === true}
              disabled={update.isPending}
              onClick={() => update.mutate(!consent.data?.optedIn)}
            >
              {update.isPending ? "Saving preference…" : consent.data?.optedIn ? "Turn optional analytics off" : "Turn optional analytics on"}
            </button>
          </div>
        )}
        <p className="mt-2 text-sm" role="status" aria-live="polite">{feedback}</p>
      </div>
    </section>
  );
}
