import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type BulletinThreadState = {
  isLocked: boolean;
  isPinned: boolean;
  subscribed: boolean;
  canModerate: boolean;
  notifications: "not_enabled";
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include", cache: "no-store", ...init,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(payload.message || "The requested forum action was not completed.");
  }
  return response.json() as Promise<T>;
}

export function useBulletinThreadState(threadId?: number) {
  return useQuery<BulletinThreadState>({
    queryKey: ["forum-bulletin-settings", threadId],
    queryFn: () => requestJson<BulletinThreadState>(
      "/api/forums/bulletin/threads/" + threadId + "/settings",
    ),
    enabled: Number.isSafeInteger(threadId) && (threadId ?? 0) > 0,
    retry: false,
  });
}

export function ForumThreadTools({ threadId }: { threadId: number }) {
  const { data: state, isError } = useBulletinThreadState(threadId);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const queryClient = useQueryClient();
  const base = "/api/forums/bulletin/threads/" + threadId;

  const subscription = useMutation({
    mutationFn: async (subscribe: boolean) =>
      requestJson<BulletinThreadState>(
        base + "/subscribe",
        { method: subscribe ? "POST" : "DELETE" },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forum-bulletin-settings", threadId] });
      setStatus("Your thread-following preference has been saved.");
    },
    onError: error => setStatus(error.message),
  });

  const moderation = useMutation({
    mutationFn: async (action: "lock" | "unlock" | "pin" | "unpin") =>
      requestJson<BulletinThreadState>(base + "/moderation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["forum-bulletin-settings", threadId] });
      setReason("");
      setStatus("Moderator action saved with an audit record.");
    },
    onError: error => setStatus(error.message),
  });

  // Bulletin feature flag off or schema not deployed: existing forum remains usable.
  if (!state || isError) return null;

  return (
    <section
      aria-label="Discussion controls"
      className="sm-card p-4 space-y-3"
    >
      <h2 className="font-semibold">Discussion controls</h2>
      <div className="flex flex-wrap gap-2 text-sm" aria-live="polite">
        {state.isPinned && <span className="rounded border px-2 py-1">Pinned by a moderator</span>}
        {state.isLocked && <span className="rounded border px-2 py-1">Locked: replies closed</span>}
        {!state.isLocked && <span>Open for replies</span>}
      </div>

      <button
        type="button"
        disabled={subscription.isPending}
        aria-pressed={state.subscribed}
        onClick={() => subscription.mutate(!state.subscribed)}
        className="min-h-11 rounded-lg border px-4 py-2 text-sm font-medium focus-visible:outline-2"
      >
        {state.subscribed ? "Unfollow discussion" : "Follow discussion"}
      </button>
      <p className="text-xs text-muted-foreground">
        Following adds this discussion to your personal list. Email and push
        notifications are not enabled.
      </p>

      {state.canModerate && (
        <div className="space-y-3 border-t pt-3">
          <h3 className="font-semibold">Moderator actions</h3>
          <label htmlFor={"moderation-reason-" + threadId} className="block text-sm font-medium">
            Explain the reason for this action (10–500 characters)
          </label>
          <textarea
            id={"moderation-reason-" + threadId}
            value={reason}
            onChange={event => setReason(event.target.value)}
            minLength={10}
            maxLength={500}
            rows={3}
            placeholder="Explain the rule or safety concern. This reason is recorded for review."
            className="w-full rounded-lg border border-input bg-background p-3"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button"
              disabled={moderation.isPending || reason.trim().length < 10}
              onClick={() => moderation.mutate(state.isLocked ? "unlock" : "lock")}
              className="min-h-11 rounded-lg border px-4 py-2 font-medium">
              {state.isLocked ? "Unlock replies" : "Lock replies"}
            </button>
            <button type="button"
              disabled={moderation.isPending || reason.trim().length < 10}
              onClick={() => moderation.mutate(state.isPinned ? "unpin" : "pin")}
              className="min-h-11 rounded-lg border px-4 py-2 font-medium">
              {state.isPinned ? "Unpin discussion" : "Pin discussion"}
            </button>
          </div>
        </div>
      )}
      <p role="status" aria-live="polite" className="text-sm">{status}</p>
    </section>
  );
}
