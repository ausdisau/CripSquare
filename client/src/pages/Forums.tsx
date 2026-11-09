import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEO } from "@/components/SEO";
import { CreateThreadDialog } from "@/components/CreateThreadDialog";
import { ForumAnalyticsConsent } from "@/components/ForumAnalyticsConsent";
import { formatDistanceToNow } from "date-fns";
import { MessageSquare, MessageCircle, Heart, Zap, FileText, Home, Briefcase, Activity, Stethoscope, ChevronRight } from "lucide-react";
import type { ForumCategory } from "@shared/schema";

const ICON_MAP: Record<string, any> = {
  MessageSquare, MessageCircle, Heart, Zap, FileText, Home, Briefcase, Activity, Stethoscope,
};

const ICON_COLORS: Record<string, string> = {
  MessageSquare: "bg-blue-50 text-blue-600",
  MessageCircle: "bg-violet-50 text-violet-600",
  Heart: "bg-red-50 text-red-500",
  Zap: "bg-yellow-50 text-yellow-600",
  FileText: "bg-gray-50 text-gray-600",
  Home: "bg-green-50 text-green-600",
  Briefcase: "bg-indigo-50 text-indigo-600",
  Activity: "bg-teal-50 text-teal-600",
  Stethoscope: "bg-orange-50 text-orange-600",
};

function CategoryIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] || MessageSquare;
  const colors = ICON_COLORS[name] || "bg-primary/10 text-primary";
  return (
    <div className={`h-10 w-10 rounded-2xl flex items-center justify-center shrink-0 ${colors}`}>
      <Icon className="h-5 w-5" aria-hidden="true" />
    </div>
  );
}

export default function Forums() {
  const { data: categories, isLoading } = useQuery<ForumCategory[]>({
    queryKey: ["/api/forums/categories"],
  });

  const { data: bulletin } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/forums/bulletin/capabilities"],
    retry: false,
    queryFn: async () => {
      const res = await fetch("/api/forums/bulletin/capabilities", { credentials: "include", cache: "no-store" });
      if (!res.ok) return { enabled: false };
      return res.json() as Promise<{ enabled: boolean }>;
    },
  });

  return (
    <Layout>
      <SEO
        title="Community Forums — DisabilitySquare"
        description="Get peer advice, share experiences, and connect with others in our structured community forums."
      />

      <div className="max-w-2xl">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-foreground mb-1">Community Forums</h1>
          <p className="text-sm text-muted-foreground">
            Peer advice and discussion — newest activity first, no algorithm.
          </p>
          {bulletin?.enabled && (
            <Link href="/forums/search" className="inline-flex min-h-11 mt-3 items-center rounded-lg border px-4 py-2 text-sm font-semibold focus-visible:outline-2">
              Search community discussions
            </Link>
          )}
        </div>

        {bulletin?.enabled && <ForumAnalyticsConsent />}

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="sm-card animate-pulse">
                <div className="sm-card-body">
                  <div className="flex gap-3">
                    <div className="h-10 w-10 rounded-2xl bg-muted shrink-0" />
                    <div className="flex-1 space-y-2 py-1">
                      <div className="h-3.5 bg-muted rounded-full w-1/3" />
                      <div className="h-3 bg-muted rounded-full w-2/3" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {categories?.map(cat => (
              <Link key={cat.id} href={`/forums/${cat.slug}`}>
                <div
                  className="sm-card cursor-pointer hover:border-primary/30 hover:shadow-md transition-all"
                  data-testid={`card-forum-category-${cat.id}`}
                >
                  <div className="sm-card-body">
                    <div className="flex items-center gap-3">
                      <CategoryIcon name={cat.icon} />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground text-sm leading-tight">{cat.name}</h3>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{cat.description}</p>
                      </div>
                      <div className="text-right shrink-0 hidden sm:flex flex-col items-end gap-0.5">
                        <span className="sm-stat">{cat.threadCount}</span>
                        <span className="text-[10px] text-muted-foreground">threads</span>
                        {cat.lastActivityAt && (
                          <span className="text-[10px] text-muted-foreground">
                            {formatDistanceToNow(new Date(cat.lastActivityAt), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 sm:hidden" aria-hidden="true" />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="sm-card mt-4">
          <div className="sm-card-body flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Have something to share or a question to ask? Start a new thread in any category.
            </p>
            <CreateThreadDialog categories={categories || []} />
          </div>
        </div>
      </div>
    </Layout>
  );
}
