import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Layout } from "@/components/Layout";
import { SEO } from "@/components/SEO";
import { formatDistanceToNow } from "date-fns";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Form, FormField, FormItem, FormControl, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { ArrowUp, CheckCircle, ChevronLeft, Flag, Image, Lightbulb, MessageSquare, X } from "lucide-react";
import type { ForumThread, ForumReply, ForumCategory } from "@shared/schema";
import { ReportDialog } from "@/components/ReportDialog";
import { ForumThreadTools, useBulletinThreadState } from "@/components/ForumThreadTools";

type ReplyWithAuthor = ForumReply & {
  author: { id?: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null };
};
type ThreadDetail = ForumThread & {
  author: { id?: string; firstName: string | null; lastName: string | null; profileImageUrl: string | null };
  replies: ReplyWithAuthor[];
  category?: ForumCategory;
};

type VoteBulkData = { votedIds: number[] };

const replySchema = z.object({
  body: z.string().min(1, "Reply cannot be empty"),
  imageUrl0: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  imageUrl1: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  imageUrl2: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  imageUrl3: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
});
type ReplyFormValues = z.infer<typeof replySchema>;

function AuthorAvatar({
  author,
  size = "sm",
}: {
  author: { firstName: string | null; lastName: string | null; profileImageUrl: string | null };
  size?: "sm" | "md";
}) {
  const initials = `${author.firstName?.[0] || ""}${author.lastName?.[0] || ""}`.toUpperCase();
  const sizeClass = size === "md" ? "h-10 w-10" : "h-8 w-8";
  return (
    <Avatar className={`${sizeClass} shrink-0 rounded-full`}>
      <AvatarImage src={author.profileImageUrl || undefined} />
      <AvatarFallback className="bg-primary/10 text-primary text-xs font-bold rounded-full">
        {initials || "?"}
      </AvatarFallback>
    </Avatar>
  );
}

function ImageLightbox({ urls, onClose, startIndex }: { urls: string[]; onClose: () => void; startIndex: number }) {
  const [current, setCurrent] = useState(startIndex);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
      data-testid="lightbox-overlay"
    >
      <div
        className="relative max-w-3xl max-h-[90vh] flex flex-col items-center"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-white hover:text-white/70 transition-colors"
          data-testid="button-lightbox-close"
          aria-label="Close lightbox"
        >
          <X className="h-7 w-7" />
        </button>
        <img
          src={urls[current]}
          alt={`Image ${current + 1} of ${urls.length}`}
          className="max-h-[80vh] max-w-full rounded-lg object-contain"
          data-testid="lightbox-image"
        />
        {urls.length > 1 && (
          <div className="flex items-center gap-3 mt-3">
            {urls.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                data-testid={`button-lightbox-thumb-${i}`}
                className={cn(
                  "h-2 w-2 rounded-full transition-colors",
                  i === current ? "bg-white" : "bg-white/40"
                )}
                aria-label={`Go to image ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MediaGallery({ urls }: { urls: string[] }) {
  const [lightboxOpen, setLightboxOpen] = useState<number | null>(null);
  if (!urls || urls.length === 0) return null;
  return (
    <>
      <div className="mt-3 flex gap-2 flex-wrap">
        {urls.map((url, i) => (
          <button
            key={i}
            onClick={() => setLightboxOpen(i)}
            data-testid={`button-media-thumb-${i}`}
            aria-label={`View image ${i + 1}`}
            className="h-24 w-24 rounded-xl border border-border/50 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <img
              src={url}
              alt={`attachment ${i + 1}`}
              className="h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
      {lightboxOpen !== null && (
        <ImageLightbox
          urls={urls}
          startIndex={lightboxOpen}
          onClose={() => setLightboxOpen(null)}
        />
      )}
    </>
  );
}

export function UpvoteButton({
  entityType,
  entityId,
  count,
  voted,
  disabled,
  onVote,
}: {
  entityType: "thread" | "reply";
  entityId: number;
  count: number;
  voted: boolean;
  disabled?: boolean;
  onVote: () => void;
}) {
  return (
    <button
      onClick={onVote}
      disabled={disabled}
      data-testid={`button-vote-${entityType}-${entityId}`}
      aria-label={`${voted ? "Remove upvote" : "Upvote"} (${count})`}
      className={cn(
        "flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors",
        voted
          ? "text-accent font-bold bg-accent/10"
          : "text-muted-foreground hover:text-primary hover:bg-primary/10"
      )}
    >
      <ArrowUp className="h-3.5 w-3.5" />
      {count}
    </button>
  );
}

export function AcceptAnswerButton({
  replyId,
  onAccept,
}: {
  replyId: number;
  onAccept: () => void;
}) {
  return (
    <button
      onClick={onAccept}
      data-testid={`button-accept-reply-${replyId}`}
      className="flex items-center gap-1 text-xs text-[#2A9D8F] font-medium px-2 py-1 rounded-full hover:bg-[#2A9D8F]/10 transition-colors"
    >
      <CheckCircle className="h-3.5 w-3.5" />
      Mark as Answer
    </button>
  );
}

function ReplyCard({
  reply,
  isThreadAuthor,
  isAdviceRequest,
  hasAcceptedAnswer,
  userVotedReplyIds,
  currentUserId,
  votePending,
  onVote,
  onAccept,
}: {
  reply: ReplyWithAuthor;
  threadId: number;
  isThreadAuthor: boolean;
  isAdviceRequest: boolean;
  hasAcceptedAnswer: boolean;
  userVotedReplyIds: number[];
  currentUserId?: string;
  votePending?: boolean;
  onVote: (replyId: number) => void;
  onAccept: (replyId: number) => void;
}) {
  const [reportOpen, setReportOpen] = useState(false);
  const voted = userVotedReplyIds.includes(reply.id);
  const authorName = `${reply.author.firstName || "Member"} ${reply.author.lastName || ""}`.trim();
  const canReport = !!currentUserId && !!reply.author.id;

  return (
    <article
      className={cn(
        "sm-post",
        reply.isAcceptedAnswer && "ring-2 ring-[#2A9D8F]/40 bg-[#2A9D8F]/3"
      )}
      data-testid={`card-reply-${reply.id}`}
    >
      {reply.isAcceptedAnswer && (
        <div className="flex items-center gap-1.5 px-4 py-2 bg-[#2A9D8F]/10 border-b border-[#2A9D8F]/20 rounded-t-2xl">
          <CheckCircle className="h-3.5 w-3.5 text-[#2A9D8F]" />
          <span className="text-xs font-semibold text-[#2A9D8F]">Accepted Answer</span>
        </div>
      )}
      <div className="px-4 pt-3 pb-3">
        <div className="flex gap-3">
          <AuthorAvatar author={reply.author} />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-sm font-semibold text-foreground">{authorName}</span>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(reply.createdAt || new Date()), { addSuffix: true })}
              </span>
            </div>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{reply.body}</p>
            {reply.mediaUrls && reply.mediaUrls.length > 0 && (
              <MediaGallery urls={reply.mediaUrls} />
            )}
            <div className="flex items-center gap-2 mt-3 -ml-1">
              <UpvoteButton
                entityType="reply"
                entityId={reply.id}
                count={reply.upvotesCount}
                voted={voted}
                disabled={votePending}
                onVote={() => onVote(reply.id)}
              />
              {isThreadAuthor && isAdviceRequest && !hasAcceptedAnswer && !reply.isAcceptedAnswer && (
                <AcceptAnswerButton replyId={reply.id} onAccept={() => onAccept(reply.id)} />
              )}
              {canReport && (
                <button
                  onClick={() => setReportOpen(true)}
                  data-testid={`button-report-reply-${reply.id}`}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded-full hover:bg-destructive/10 transition-colors ml-auto"
                  aria-label="Report reply"
                >
                  <Flag className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {canReport && reply.author.id && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          contentType="reply"
          contentId={reply.id}
          authorId={reply.author.id}
          authorName={authorName}
        />
      )}
    </article>
  );
}

function ReplyComposer({ threadId, onSuccess }: { threadId: string; onSuccess: () => void }) {
  const { toast } = useToast();
  const [showImageFields, setShowImageFields] = useState(false);

  const form = useForm<ReplyFormValues>({
    resolver: zodResolver(replySchema),
    defaultValues: {
      body: "",
      imageUrl0: "",
      imageUrl1: "",
      imageUrl2: "",
      imageUrl3: "",
    },
  });

  const replyMutation = useMutation({
    mutationFn: (values: ReplyFormValues) => {
      const mediaUrls = [values.imageUrl0, values.imageUrl1, values.imageUrl2, values.imageUrl3]
        .filter((u): u is string => !!u && u.trim() !== "");
      return apiRequest("POST", `/api/forums/threads/${threadId}/replies`, {
        body: values.body,
        mediaUrls,
      });
    },
    onSuccess: () => {
      form.reset();
      setShowImageFields(false);
      onSuccess();
      toast({ title: "Reply posted!" });
    },
    onError: () => toast({ title: "Failed to post reply", variant: "destructive" }),
  });

  return (
    <div className="sm-card">
      <div className="sm-card-title">
        <MessageSquare className="h-4 w-4 text-primary" />
        Leave a reply
      </div>
      <div className="sm-card-body pt-2">
        <Form {...form}>
          <form onSubmit={form.handleSubmit(v => replyMutation.mutate(v))} className="space-y-3">
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Share your thoughts, experience, or advice..."
                      rows={4}
                      className="text-sm resize-none"
                      data-testid="input-reply-body"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showImageFields && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Image className="h-3 w-3" />
                  Image URLs (up to 4)
                </p>
                {([0, 1, 2, 3] as const).map(i => (
                  <FormField
                    key={i}
                    control={form.control}
                    name={`imageUrl${i}` as "imageUrl0" | "imageUrl1" | "imageUrl2" | "imageUrl3"}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder={`Image URL ${i + 1} (optional)`}
                            className="text-xs h-8"
                            data-testid={`input-image-url-${i}`}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowImageFields(v => !v)}
                  data-testid="button-toggle-image-fields"
                  className={cn(
                    "flex items-center gap-1 text-xs px-2 py-1 rounded-full transition-colors",
                    showImageFields
                      ? "text-primary bg-primary/10 font-medium"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/10"
                  )}
                >
                  <Image className="h-3 w-3" />
                  {showImageFields ? "Hide image fields" : "Add images"}
                </button>
                <p className="text-xs text-muted-foreground hidden sm:block">
                  Thoughtful replies (100+ chars) earn bonus points.
                </p>
              </div>
              <Button
                type="submit"
                disabled={replyMutation.isPending || !form.watch("body").trim()}
                className="text-xs h-9 px-5 rounded-full bg-primary"
                data-testid="button-submit-reply"
              >
                {replyMutation.isPending ? "Posting…" : "Post Reply"}
              </Button>
            </div>
          </form>
        </Form>
      </div>
    </div>
  );
}

export default function ForumThreadPage() {
  const { slug, threadId } = useParams<{ slug: string; threadId: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: thread, isLoading } = useQuery<ThreadDetail>({
    queryKey: [`/api/forums/threads/${threadId}`],
    enabled: !!threadId,
  });

  const { data: category } = useQuery<ForumCategory>({
    queryKey: [`/api/forums/categories/${slug}`],
    enabled: !!slug,
  });

  const replyIds = thread?.replies.map(r => r.id) || [];
  const { data: votesData } = useQuery<VoteBulkData>({
    queryKey: [`/api/forums/votes/bulk-replies`, threadId],
    enabled: replyIds.length > 0,
    queryFn: async () => {
      const res = await fetch("/api/forums/votes/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entityType: "reply", entityIds: replyIds }),
      });
      return res.json();
    },
  });
  const userVotedReplyIds = votesData?.votedIds || [];

  const { data: threadVotesData } = useQuery<VoteBulkData>({
    queryKey: [`/api/forums/votes/bulk-thread-single`, threadId],
    enabled: !!threadId,
    queryFn: async () => {
      const res = await fetch("/api/forums/votes/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ entityType: "thread", entityIds: [parseInt(threadId!)] }),
      });
      return res.json();
    },
  });
  const userVotedThread = threadVotesData?.votedIds?.includes(parseInt(threadId!)) ?? false;

  const voteMutation = useMutation({
    mutationFn: ({ entityType, entityId }: { entityType: "thread" | "reply"; entityId: number }) =>
      apiRequest("POST", `/api/forums/${entityType === "thread" ? "threads" : "replies"}/${entityId}/vote`),

    onMutate: async ({ entityType, entityId }) => {
      if (entityType === "thread") {
        await queryClient.cancelQueries({ queryKey: [`/api/forums/votes/bulk-thread-single`, threadId] });
        const prevVotes = queryClient.getQueryData<VoteBulkData>([`/api/forums/votes/bulk-thread-single`, threadId]);
        const prevThread = queryClient.getQueryData<ThreadDetail>([`/api/forums/threads/${threadId}`]);

        queryClient.setQueryData<VoteBulkData>([`/api/forums/votes/bulk-thread-single`, threadId], old => {
          const ids = old?.votedIds || [];
          return { votedIds: ids.includes(entityId) ? ids.filter(i => i !== entityId) : [...ids, entityId] };
        });
        queryClient.setQueryData<ThreadDetail>([`/api/forums/threads/${threadId}`], old => {
          if (!old) return old;
          const wasVoted = prevVotes?.votedIds?.includes(entityId);
          return { ...old, upvotesCount: old.upvotesCount + (wasVoted ? -1 : 1) };
        });

        return { prevVotes, prevThread, entityType };
      } else {
        await queryClient.cancelQueries({ queryKey: [`/api/forums/votes/bulk-replies`, threadId] });
        const prevVotes = queryClient.getQueryData<VoteBulkData>([`/api/forums/votes/bulk-replies`, threadId]);
        const prevThread = queryClient.getQueryData<ThreadDetail>([`/api/forums/threads/${threadId}`]);

        queryClient.setQueryData<VoteBulkData>([`/api/forums/votes/bulk-replies`, threadId], old => {
          const ids = old?.votedIds || [];
          return { votedIds: ids.includes(entityId) ? ids.filter(i => i !== entityId) : [...ids, entityId] };
        });
        queryClient.setQueryData<ThreadDetail>([`/api/forums/threads/${threadId}`], old => {
          if (!old) return old;
          const wasVoted = prevVotes?.votedIds?.includes(entityId);
          return {
            ...old,
            replies: old.replies.map(r =>
              r.id === entityId ? { ...r, upvotesCount: r.upvotesCount + (wasVoted ? -1 : 1) } : r
            ),
          };
        });

        return { prevVotes, prevThread, entityType };
      }
    },

    onError: (_err, { entityType }, context) => {
      if (!context) return;
      if (entityType === "thread") {
        if (context.prevVotes) queryClient.setQueryData([`/api/forums/votes/bulk-thread-single`, threadId], context.prevVotes);
        if (context.prevThread) queryClient.setQueryData([`/api/forums/threads/${threadId}`], context.prevThread);
      } else {
        if (context.prevVotes) queryClient.setQueryData([`/api/forums/votes/bulk-replies`, threadId], context.prevVotes);
        if (context.prevThread) queryClient.setQueryData([`/api/forums/threads/${threadId}`], context.prevThread);
      }
    },

    onSettled: (_data, _err, { entityType }) => {
      queryClient.invalidateQueries({ queryKey: [`/api/forums/threads/${threadId}`] });
      if (entityType === "thread") {
        queryClient.invalidateQueries({ queryKey: [`/api/forums/votes/bulk-thread-single`, threadId] });
      } else {
        queryClient.invalidateQueries({ queryKey: [`/api/forums/votes/bulk-replies`, threadId] });
      }
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (replyId: number) =>
      apiRequest("POST", `/api/forums/replies/${replyId}/accept`, { threadId: parseInt(threadId!) }),

    onMutate: async (replyId: number) => {
      await queryClient.cancelQueries({ queryKey: [`/api/forums/threads/${threadId}`] });
      const prevThread = queryClient.getQueryData<ThreadDetail>([`/api/forums/threads/${threadId}`]);

      queryClient.setQueryData<ThreadDetail>([`/api/forums/threads/${threadId}`], old => {
        if (!old) return old;
        return {
          ...old,
          isSolved: true,
          replies: old.replies.map(r =>
            r.id === replyId ? { ...r, isAcceptedAnswer: true } : { ...r, isAcceptedAnswer: false }
          ),
        };
      });

      return { prevThread };
    },

    onError: (_err, _replyId, context) => {
      if (context?.prevThread) {
        queryClient.setQueryData([`/api/forums/threads/${threadId}`], context.prevThread);
      }
      toast({ title: "Failed to mark answer", variant: "destructive" });
    },

    onSuccess: () => {
      toast({ title: "Answer accepted!" });
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/forums/threads/${threadId}`] });
    },
  });

  const isThreadAuthor = !!user && thread?.authorId === user.id;
  const authorName = thread
    ? `${thread.author.firstName || "Member"} ${thread.author.lastName || ""}`.trim()
    : "";
  const [threadReportOpen, setThreadReportOpen] = useState(false);
  const canReportThread = !!user && thread && !!thread.author.id;

  const acceptedReplies = thread?.replies.filter(r => r.isAcceptedAnswer) || [];
  const otherReplies = thread?.replies.filter(r => !r.isAcceptedAnswer) || [];
  const hasAcceptedAnswer = acceptedReplies.length > 0;

  const categoryDisplayName = category?.name || slug;

  const handleReplySuccess = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/forums/threads/${threadId}`] });
  };

  const { data: bulletinState } = useBulletinThreadState(thread?.id);

  return (
    <Layout>
      <SEO
        title={`${thread?.title || "Thread"} — Forums — DisabilitySquare`}
        description={thread?.body?.slice(0, 160) || "Community forum discussion"}
      />

      <div className="max-w-2xl">
        <nav className="flex items-center gap-2 mb-4 text-xs" aria-label="Breadcrumb">
          <Link href={`/forums/${slug}`}>
            <span
              className="text-primary hover:text-primary/80 cursor-pointer flex items-center gap-1 font-medium"
              data-testid="link-back-to-category"
            >
              <ChevronLeft className="h-3.5 w-3.5" />Back to {categoryDisplayName}
            </span>
          </Link>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground truncate max-w-[160px]">{thread?.title || "Thread"}</span>
        </nav>

        {isLoading ? (
          <div className="space-y-3">
            <div className="sm-post animate-pulse p-4">
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-muted rounded-full w-1/4" />
                  <div className="h-5 bg-muted rounded-full w-3/4" />
                  <div className="h-16 bg-muted rounded-xl" />
                </div>
              </div>
            </div>
            {[1, 2].map(i => (
              <div key={i} className="sm-post animate-pulse p-4">
                <div className="flex gap-3">
                  <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded-full w-1/5" />
                    <div className="h-10 bg-muted rounded-xl" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : thread ? (
          <div className="space-y-3">
            {/* Original post */}
            <article className="sm-post" data-testid={`card-thread-detail-${thread.id}`}>
              <div className="px-4 pt-4 pb-3">
                <div className="flex gap-3">
                  <AuthorAvatar author={thread.author} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-foreground">{authorName}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(thread.createdAt || new Date()), { addSuffix: true })}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mb-2">
                      {thread.isAdviceRequest && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-accent/10 text-accent rounded-full border border-accent/20">
                          <Lightbulb className="h-2.5 w-2.5" />Advice Request
                        </span>
                      )}
                      {thread.isSolved && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold bg-[#2A9D8F]/10 text-[#2A9D8F] rounded-full border border-[#2A9D8F]/20">
                          <CheckCircle className="h-2.5 w-2.5" />Solved
                        </span>
                      )}
                    </div>

                    <h1 className="font-bold text-foreground text-base leading-snug mb-2">{thread.title}</h1>
                    <p className="text-sm text-foreground/80 whitespace-pre-wrap leading-relaxed">{thread.body}</p>

                    {thread.mediaUrls && thread.mediaUrls.length > 0 && (
                      <MediaGallery urls={thread.mediaUrls} />
                    )}

                    {thread.tags && Array.isArray(thread.tags) && (thread.tags as string[]).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(thread.tags as string[]).map(tag => (
                          <span key={tag} className="sm-badge">{tag}</span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-3 mt-3 -ml-1">
                      <UpvoteButton
                        entityType="thread"
                        entityId={thread.id}
                        count={thread.upvotesCount}
                        voted={userVotedThread}
                        disabled={voteMutation.isPending || !user}
                        onVote={() => voteMutation.mutate({ entityType: "thread", entityId: thread.id })}
                      />
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {thread.replyCount} repl{thread.replyCount !== 1 ? "ies" : "y"}
                      </span>
                      {canReportThread && (
                        <button
                          onClick={() => setThreadReportOpen(true)}
                          data-testid={`button-report-thread-${thread.id}`}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded-full hover:bg-destructive/10 transition-colors ml-auto"
                          aria-label="Report thread"
                        >
                          <Flag className="h-3.5 w-3.5" />
                          Report
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </article>

            {canReportThread && thread.author.id && (
              <ReportDialog
                open={threadReportOpen}
                onOpenChange={setThreadReportOpen}
                contentType="thread"
                contentId={thread.id}
                authorId={thread.author.id}
                authorName={authorName}
              />
            )}

            <ForumThreadTools threadId={thread.id} />

            {/* Accepted answers pinned first */}
            {acceptedReplies.map(reply => (
              <ReplyCard
                key={reply.id}
                reply={reply}
                threadId={thread.id}
                isThreadAuthor={isThreadAuthor}
                isAdviceRequest={thread.isAdviceRequest}
                hasAcceptedAnswer={hasAcceptedAnswer}
                userVotedReplyIds={userVotedReplyIds}
                currentUserId={user?.id}
                votePending={voteMutation.isPending || !user}
                onVote={id => voteMutation.mutate({ entityType: "reply", entityId: id })}
                onAccept={id => acceptMutation.mutate(id)}
              />
            ))}

            {acceptedReplies.length > 0 && otherReplies.length > 0 && (
              <div className="flex items-center gap-3 px-1 py-1">
                <div className="h-px flex-1 bg-border/40" />
                <span className="text-[11px] text-muted-foreground">Other replies</span>
                <div className="h-px flex-1 bg-border/40" />
              </div>
            )}

            {/* Regular replies */}
            {otherReplies.map(reply => (
              <ReplyCard
                key={reply.id}
                reply={reply}
                threadId={thread.id}
                isThreadAuthor={isThreadAuthor}
                isAdviceRequest={thread.isAdviceRequest}
                hasAcceptedAnswer={hasAcceptedAnswer}
                userVotedReplyIds={userVotedReplyIds}
                currentUserId={user?.id}
                votePending={voteMutation.isPending || !user}
                onVote={id => voteMutation.mutate({ entityType: "reply", entityId: id })}
                onAccept={id => acceptMutation.mutate(id)}
              />
            ))}

            {otherReplies.length === 0 && acceptedReplies.length === 0 && (
              <div className="sm-card">
                <div className="sm-card-body text-center py-6">
                  <p className="text-sm text-muted-foreground">No replies yet. Be the first to respond!</p>
                </div>
              </div>
            )}

            {/* Reply composer */}
            {bulletinState?.isLocked ? (
              <div className="sm-card p-4" role="status">This discussion is locked. New replies are closed.</div>
            ) : user ? (
              <ReplyComposer threadId={threadId!} onSuccess={handleReplySuccess} />
            ) : (
              <div className="sm-card">
                <div className="sm-card-body text-center py-6">
                  <p className="text-sm text-muted-foreground">Sign in to leave a reply.</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="sm-card">
            <div className="sm-card-body text-center py-12">
              <p className="text-muted-foreground text-sm">Thread not found.</p>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
