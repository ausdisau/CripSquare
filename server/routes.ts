import type { Express, Response, NextFunction } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { registerForumBulletin, guardForumThreadCreate, guardForumReplyCreate } from "./forum-bulletin";
import { setupAuth0, registerAuth0Routes, isAuthenticated, requiresAgeVerification } from "./auth0";
import { bulletinEnabled } from "@shared/forum-bulletin-policy";
import { safeForumAuthor } from "@shared/forum-bulletin-security-policy";
import { requireForumCookieOrigin } from "./forum-bulletin-security";
import { api } from "@shared/routes";
import { z } from "zod";
import { POINT_VALUES, EXTENSION_EVENTS, EXTENSION_PERMISSIONS, profiles } from "@shared/schema";
import { extensionManager } from "./extensions";
import { db } from "./db";
import { inArray, eq } from "drizzle-orm";

async function getMembersOnlyUserIds(userIds: string[]): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: profiles.userId, visibility: profiles.visibility })
    .from(profiles)
    .where(inArray(profiles.userId, userIds));
  return new Set(rows.filter(r => r.visibility === 'members_only').map(r => r.userId));
}

function anonymizeAuthor(author: any): any {
  return { ...author, firstName: "Protected", lastName: "Member", email: null, profileImageUrl: null };
}

// Middleware to check if user is admin (persisted in database)
const isAdmin = async (req: any, res: Response, next: NextFunction) => {
  const userId = req.userId || req.oidc?.user?.sub;
  
  if (!userId) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  
  const user = await storage.getUser(userId);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ message: 'Admin access required' });
  }
  
  next();
};

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth0 Setup
  setupAuth0(app);
  registerAuth0Routes(app);
  if (bulletinEnabled(process.env)) {
    // Enforce member-only visibility and cross-origin write protection for legacy and bulletin APIs.
    app.use("/api/forums", isAuthenticated, requiresAgeVerification, requireForumCookieOrigin);
  }
  registerForumBulletin(app);

  // === PROFILES ===
  app.get(api.profiles.get.path, async (req: any, res) => {
    const profile = await storage.getProfile(req.params.userId);
    if (!profile) return res.status(404).json({ message: "Profile not found" });
    // eSafety: members_only visibility — only authenticated users may view this profile
    if (profile.visibility === 'members_only') {
      const requesterId = req.userId || req.oidc?.user?.sub;
      if (!requesterId) {
        return res.status(403).json({ message: "This profile is only visible to members." });
      }
    }
    res.json(profile);
  });

  app.put(api.profiles.update.path, isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    try {
      const input = api.profiles.update.input.parse(req.body);
      let profile = await storage.getProfile(userId);
      if (!profile) {
        profile = await storage.createProfile({ userId, ...input } as any);
      } else {
        profile = await storage.updateProfile(userId, input);
      }
      res.json(profile);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === DIRECT MESSAGES ===

  // POST /api/direct-messages/start — initiate DM with a user (enforces dmRestricted for under-18 accounts)
  app.post("/api/direct-messages/start", isAuthenticated, async (req: any, res) => {
    const requesterId = req.userId || req.oidc?.user?.sub;
    try {
      const schema = z.object({ targetUserId: z.string().min(1) });
      const { targetUserId } = schema.parse(req.body);
      if (targetUserId === requesterId) {
        return res.status(400).json({ message: "You cannot message yourself" });
      }
      const targetProfile = await storage.getProfile(targetUserId);
      if (!targetProfile) return res.status(404).json({ message: "User not found" });
      // eSafety: dmRestricted accounts only accept messages from established connections
      // An established connection means the restricted user already follows the requester
      if (targetProfile.dmRestricted) {
        const connected = await storage.isFollowing(targetUserId, requesterId);
        if (!connected) {
          return res.status(403).json({ message: "This user has restricted direct messages. Only their accepted connections may message them." });
        }
      }
      res.json({ success: true, targetUserId });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === GROUPS ===
  app.get(api.groups.list.path, async (req, res) => {
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const groups = await storage.listGroups(category, search);
    res.json(groups);
  });

  app.get(api.groups.get.path, async (req, res) => {
    const group = await storage.getGroup(Number(req.params.id));
    if (!group) return res.status(404).json({ message: "Group not found" });
    res.json(group);
  });

  app.post(api.groups.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const input = api.groups.create.input.parse(req.body);
      const userId = req.userId || req.oidc?.user?.sub;
      const group = await storage.createGroup({
        ...input,
        createdById: userId,
      });
      
      // Award points for creating a group
      await storage.awardPoints({
        userId,
        points: POINT_VALUES.FIRST_POST_IN_GROUP,
        actionType: 'group_created',
        description: `Created group: "${group.name}"`,
      });
      
      // Emit extension event
      await extensionManager.emit(EXTENSION_EVENTS.GROUP_CREATED, { group }, userId);
      
      res.status(201).json(group);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === POSTS ===
  app.get(api.posts.list.path, async (req: any, res) => {
    const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;
    const tag = req.query.tag as string | undefined;
    const postsList = await storage.listPosts(groupId, tag);
    // eSafety: anonymize members_only (16–17 yo) authors for unauthenticated requests
    const requesterId = req.userId || req.oidc?.user?.sub;
    if (!requesterId) {
      const authorIds = [...new Set(postsList.map((p: any) => p.author?.id).filter(Boolean))];
      const protectedIds = await getMembersOnlyUserIds(authorIds);
      if (protectedIds.size > 0) {
        return res.json(postsList.map((p: any) =>
          protectedIds.has(p.author?.id) ? { ...p, author: anonymizeAuthor(p.author) } : p
        ));
      }
    }
    res.json(postsList);
  });

  app.post(api.posts.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const input = api.posts.create.input.parse(req.body);
      const userId = req.userId || req.oidc?.user?.sub;
      const post = await storage.createPost({
        ...input,
        authorId: userId,
      });
      
      // Award points for creating a post
      await storage.awardPoints({
        userId,
        points: POINT_VALUES.POST_CREATED,
        actionType: 'post_created',
        description: `Created post: "${post.title.substring(0, 50)}${post.title.length > 50 ? '...' : ''}"`,
      });
      
      // Emit extension event
      await extensionManager.emit(EXTENSION_EVENTS.POST_CREATED, { post }, userId);
      
      res.status(201).json(post);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.posts.get.path, async (req, res) => {
    const post = await storage.getPost(Number(req.params.id));
    if (!post) return res.status(404).json({ message: "Post not found" });
    res.json(post);
  });

  // === REACTIONS ===
  // POST /api/posts/:id/react — add or switch reaction (hug, me_too, helpful, inspiring)
  app.post('/api/posts/:id/react', isAuthenticated, async (req: any, res) => {
    const postId = Number(req.params.id);
    const userId = req.userId || req.oidc?.user?.sub;
    const { reactionType } = req.body;
    const validTypes = ['hug', 'me_too', 'helpful', 'inspiring'];
    if (!validTypes.includes(reactionType)) {
      return res.status(400).json({ message: 'Invalid reaction type' });
    }
    const reaction = await storage.addReaction(postId, userId, reactionType);
    res.json(reaction);
  });

  // DELETE /api/posts/:id/react — remove reaction
  app.delete('/api/posts/:id/react', isAuthenticated, async (req: any, res) => {
    const postId = Number(req.params.id);
    const userId = req.userId || req.oidc?.user?.sub;
    await storage.removeReaction(postId, userId);
    res.json({ success: true });
  });

  // GET /api/posts/:id/reactions — get reaction counts and current user's reaction
  app.get('/api/posts/:id/reactions', async (req: any, res) => {
    const postId = Number(req.params.id);
    const userId = req.userId || req.oidc?.user?.sub;
    const counts = await storage.getReactionCounts(postId);
    const userReaction = userId ? await storage.getUserReaction(postId, userId) : undefined;
    res.json({ counts, userReaction: userReaction?.reactionType || null });
  });

  // POST /api/reactions/bulk — get reaction counts for multiple posts
  app.post('/api/reactions/bulk', async (req: any, res) => {
    const { postIds, userId } = req.body;
    if (!Array.isArray(postIds)) return res.status(400).json({ message: 'postIds must be an array' });
    const counts = await storage.getReactionCountsBulk(postIds);
    const userReactions: Record<number, string | null> = {};
    if (userId) {
      for (const postId of postIds) {
        const r = await storage.getUserReaction(postId, userId);
        userReactions[postId] = r?.reactionType || null;
      }
    }
    res.json({ counts, userReactions });
  });

  // === PEER CONNECT ===
  // GET /api/connect/matches — find members with matching diagnosis or interests
  app.get('/api/connect/matches', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const matches = await storage.getPeerMatches(userId, limit);
    res.json(matches);
  });

  // GET /api/connect/members — list all members (for browse view)
  app.get('/api/connect/members', async (req: any, res) => {
    const members = await storage.listAllProfiles();
    // eSafety: exclude members_only profiles from public/unauthenticated requests
    const requesterId = req.userId || req.oidc?.user?.sub;
    if (!requesterId) {
      res.json(members.filter(m => m.profile?.visibility !== 'members_only'));
    } else {
      res.json(members);
    }
  });

  // === PUBLIC COMMUNITY STATS (no auth required) ===
  app.get('/api/public/stats', async (req, res) => {
    try {
      const categories = await storage.listForumCategories();
      const memberCount = await storage.getPublicMemberCount();
      const totalThreads = categories.reduce((sum, c) => sum + (c.threadCount || 0), 0);
      res.json({
        memberCount,
        threadCount: totalThreads,
        categoryCount: categories.length,
      });
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/public/categories — public forum categories (no auth required)
  app.get('/api/public/categories', async (req, res) => {
    try {
      const categories = await storage.listForumCategories();
      res.json(categories);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/public/recent-threads — 10 most recent thread titles + category, no author info
  app.get('/api/public/recent-threads', async (req, res) => {
    try {
      const threads = await storage.listRecentPublicThreads(10);
      res.json(threads);
    } catch {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === COMMENTS ===
  app.post(api.comments.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const input = api.comments.create.input.parse(req.body);
      const userId = req.userId || req.oidc?.user?.sub;
      const comment = await storage.createComment({
        ...input,
        authorId: userId,
      });
      
      // Get the post to check if this is a cross-user interaction
      const post = await storage.getPost(input.postId);
      const isThoughtful = input.content.length > 100;
      const isCrossUser = post && post.authorId !== userId;
      
      // Award base points for commenting
      let points = POINT_VALUES.COMMENT_CREATED;
      let actionType = 'comment_created';
      
      if (isThoughtful) {
        points = POINT_VALUES.THOUGHTFUL_COMMENT;
        actionType = 'thoughtful_comment';
      }
      
      await storage.awardPoints({
        userId,
        points,
        actionType,
        description: `Commented on a post`,
        relatedUserId: isCrossUser ? post.authorId : undefined,
      });
      
      // If cross-user interaction, also give points to post author
      if (isCrossUser) {
        await storage.awardPoints({
          userId: post.authorId,
          points: POINT_VALUES.REPLY_TO_OTHER,
          actionType: 'received_engagement',
          description: `Someone engaged with your post`,
          relatedUserId: userId,
        });
      }
      
      // Emit extension event
      await extensionManager.emit(EXTENSION_EVENTS.COMMENT_CREATED, { comment, post }, userId);
      
      res.status(201).json(comment);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === GAMES ===
  app.post(api.games.submitScore.path, isAuthenticated, async (req: any, res) => {
    try {
      const input = api.games.submitScore.input.parse(req.body);
      const score = await storage.createGameScore({
        ...input,
        userId: req.userId || req.oidc?.user?.sub,
      });
      res.status(201).json(score);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get(api.games.leaderboard.path, async (req, res) => {
    const leaderboard = await storage.getLeaderboard(req.params.gameName);
    res.json(leaderboard);
  });

  // === VALORIZATION SYSTEM ===
  
  // Get current user's points
  app.get(api.valorization.myPoints.path, isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    let points = await storage.getUserPoints(userId);
    if (!points) {
      points = await storage.initializeUserPoints(userId);
    }
    res.json(points);
  });

  // Get any user's points
  app.get(api.valorization.userPoints.path, async (req, res) => {
    const points = await storage.getUserPoints(req.params.userId);
    if (!points) {
      return res.status(404).json({ message: "User points not found" });
    }
    res.json(points);
  });

  // Get points leaderboard
  app.get(api.valorization.leaderboard.path, async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 10;
    const leaderboard = await storage.getPointsLeaderboard(limit);
    res.json(leaderboard);
  });

  // Get current user's badges
  app.get(api.valorization.myBadges.path, isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const userBadges = await storage.getUserBadges(userId);
    res.json(userBadges);
  });

  // Get any user's badges
  app.get(api.valorization.userBadges.path, async (req, res) => {
    const userBadges = await storage.getUserBadges(req.params.userId);
    res.json(userBadges);
  });

  // Get all available badges
  app.get(api.valorization.allBadges.path, async (req, res) => {
    const allBadges = await storage.getAllBadges();
    res.json(allBadges);
  });

  // Get recent achievements (activity feed)
  app.get(api.valorization.recentAchievements.path, async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const achievements = await storage.getRecentAchievements(limit);
    res.json(achievements);
  });

  // === USER REPORTS (eSafety compliance) ===
  
  // Submit a content or user report (eSafety multi-scheme)
  app.post("/api/reports", isAuthenticated, async (req: any, res) => {
    const reporterId = req.userId || req.oidc?.user?.sub;
    
    try {
      const schema = z.object({
        reportedUserId: z.string().min(1),
        reportType: z.string().min(1), // eSafety scheme key or legacy type
        esafetyScheme: z.string().optional(),
        contentType: z.enum(['post', 'thread', 'reply', 'user']).optional(),
        contentId: z.number().int().optional(),
        reason: z.string().optional(),
        contextData: z.record(z.string()).optional(),
      });
      
      const input = schema.parse(req.body);
      
      // Prevent self-reporting
      if (input.reportedUserId === reporterId) {
        return res.status(400).json({ message: "You cannot report yourself" });
      }

      // Prevent duplicate reports
      const alreadyReported = await storage.hasReportedUser(reporterId, input.reportedUserId, input.reportType);
      if (alreadyReported) {
        return res.status(409).json({ message: "You have already submitted a report of this type for this user" });
      }
      
      const report = await storage.createUserReport({
        reporterId,
        reportedUserId: input.reportedUserId,
        reportType: input.reportType,
        esafetyScheme: input.esafetyScheme || input.reportType,
        contentType: input.contentType || 'user',
        contentId: input.contentId,
        reason: input.reason,
        contextData: input.contextData || {},
        status: 'pending',
      });
      
      res.status(201).json({ success: true, reportId: report.id });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: error.errors[0].message });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });
  
  // Check if current user has reported another user (for UI feedback)
  app.get("/api/reports/check/:userId/:reportType", isAuthenticated, async (req: any, res) => {
    const reporterId = req.userId || req.oidc?.user?.sub;
    const { userId, reportType } = req.params;
    
    const hasReported = await storage.hasReportedUser(reporterId, userId, reportType);
    res.json({ hasReported });
  });

  // POST /api/reports/esafety — extended eSafety report endpoint with duplicate check
  app.post("/api/reports/esafety", isAuthenticated, async (req: any, res) => {
    const reporterId = req.userId || req.oidc?.user?.sub;
    try {
      const schema = z.object({
        reportedUserId: z.string().min(1),
        reportType: z.enum(['underage', 'harassment', 'inappropriate_content', 'spam', 'other', 'cyber_abuse', 'image_based_abuse', 'illegal_content']),
        reason: z.string().optional(),
        esafetyScheme: z.enum(['basic_online_safety', 'online_safety_code', 'online_safety_act']).optional(),
        urgencyLevel: z.enum(['low', 'medium', 'high', 'critical']).optional(),
        reportReference: z.string().optional(),
        targetContentType: z.enum(['post', 'comment', 'forum_thread', 'forum_reply', 'profile']).optional(),
        targetContentId: z.number().int().optional(),
      });
      const input = schema.parse(req.body);
      if (input.reportedUserId === reporterId) {
        return res.status(400).json({ message: "You cannot report yourself" });
      }
      const alreadyReported = await storage.hasReportedUser(reporterId, input.reportedUserId, input.reportType);
      if (alreadyReported) {
        return res.status(400).json({ message: "You have already submitted a report of this type against this user" });
      }
      const report = await storage.createUserReport({
        reporterId,
        reportedUserId: input.reportedUserId,
        reportType: input.reportType,
        reason: input.reason ?? null,
        status: 'pending',
        esafetyScheme: input.esafetyScheme ?? null,
        urgencyLevel: input.urgencyLevel ?? null,
        reportReference: input.reportReference ?? null,
        targetContentType: input.targetContentType ?? null,
        targetContentId: input.targetContentId ?? null,
      });
      res.status(201).json({ success: true, reportId: report.id });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      if ((error as any)?.code === '23505') {
        return res.status(400).json({ message: "You have already submitted a report of this type against this user" });
      }
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === ADMIN REPORTS (underage + eSafety reports) ===

  // GET /api/admin/reports — list all reports, optionally filtered by scheme and/or status
  app.get("/api/admin/reports", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const scheme = req.query.scheme as string | undefined;
      const validStatuses = ['pending', 'reviewed', 'dismissed', 'actioned'];
      const statusParam = req.query.status as string | undefined;
      const status = statusParam && validStatuses.includes(statusParam) ? statusParam : undefined;
      const reports = await storage.getAdminReports(scheme, status);
      res.json(reports);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // PATCH /api/admin/reports/:id — update report status or add admin notes
  app.patch("/api/admin/reports/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    const adminId = req.userId || req.oidc?.user?.sub;
    const reportId = Number(req.params.id);
    if (!Number.isInteger(reportId) || reportId <= 0) {
      return res.status(400).json({ message: "Invalid report ID" });
    }
    try {
      const schema = z.object({
        status: z.enum(['pending', 'reviewed', 'dismissed', 'actioned']).optional(),
        adminNotes: z.string().optional(),
      });
      const input = schema.parse(req.body);
      const report = await storage.updateReportStatus(reportId, adminId, input);
      res.json(report);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/admin/reports/:id/deactivate — deactivate the reported user's account
  app.post("/api/admin/reports/:id/deactivate", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const report = await storage.getReportById(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "Report not found" });
      const reportId = Number(req.params.id);
      const adminId = req.userId || req.oidc?.user?.sub;
      const templateNotice = `Your account has been deactivated following an eSafety compliance review (reference: #${reportId}). This action was taken in accordance with Australian eSafety Commissioner guidelines. If you believe this decision is incorrect, please contact our support team to appeal.`;
      await storage.deactivateUser(report.reportedUserId, templateNotice);
      await storage.updateReportStatus(reportId, adminId, {
        status: 'actioned',
        adminNotes: (req.body?.adminNotes) || `Account deactivated. User notice: ${templateNotice}`,
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/admin/reports/:id/reverify — mark report as requiring re-verification
  app.post("/api/admin/reports/:id/reverify", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const report = await storage.getReportById(Number(req.params.id));
      if (!report) return res.status(404).json({ message: "Report not found" });
      const adminId = req.userId || req.oidc?.user?.sub;
      await storage.updateReportStatus(Number(req.params.id), adminId, {
        status: 'reviewed',
        adminNotes: 'Re-verification requested.',
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // === EXTENSION ROUTES ===

  // Get all extensions
  app.get(api.extensions.list.path, async (req, res) => {
    const allExtensions = await extensionManager.getAllExtensions();
    res.json(allExtensions);
  });

  // Get available event types
  app.get(api.extensions.events.path, async (req, res) => {
    res.json(Object.values(EXTENSION_EVENTS));
  });

  // Get available permissions
  app.get(api.extensions.permissions.path, async (req, res) => {
    res.json(Object.values(EXTENSION_PERMISSIONS));
  });

  // Get single extension
  app.get(api.extensions.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const ext = await extensionManager.getExtension(id);
    if (!ext) {
      return res.status(404).json({ message: 'Extension not found' });
    }
    res.json(ext);
  });

  // Install extension (admin only)
  app.post(api.extensions.install.path, isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const parsed = api.extensions.install.input.parse(req.body);
      const ext = await extensionManager.installExtension(parsed, parsed.entryPoint);
      res.status(201).json(ext);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  // Enable extension (admin only)
  app.post(api.extensions.enable.path, isAuthenticated, isAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    const ext = await extensionManager.getExtension(id);
    if (!ext) {
      return res.status(404).json({ message: 'Extension not found' });
    }
    await extensionManager.enableExtension(id);
    res.json({ success: true });
  });

  // Disable extension (admin only)
  app.post(api.extensions.disable.path, isAuthenticated, isAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    const ext = await extensionManager.getExtension(id);
    if (!ext) {
      return res.status(404).json({ message: 'Extension not found' });
    }
    await extensionManager.disableExtension(id);
    res.json({ success: true });
  });

  // Uninstall extension (admin only)
  app.delete(api.extensions.uninstall.path, isAuthenticated, isAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    const ext = await extensionManager.getExtension(id);
    if (!ext) {
      return res.status(404).json({ message: 'Extension not found' });
    }
    await extensionManager.uninstallExtension(id);
    res.json({ success: true });
  });

  // Update extension config (admin only)
  app.put(api.extensions.updateConfig.path, isAuthenticated, isAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    const ext = await extensionManager.getExtension(id);
    if (!ext) {
      return res.status(404).json({ message: 'Extension not found' });
    }
    await extensionManager.updateExtensionConfig(id, req.body);
    res.json({ success: true });
  });

  // Get extension logs (admin only)
  app.get(api.extensions.logs.path, isAuthenticated, isAdmin, async (req: any, res) => {
    const id = Number(req.params.id);
    const ext = await extensionManager.getExtension(id);
    if (!ext) {
      return res.status(404).json({ message: 'Extension not found' });
    }
    const logs = await extensionManager.getExtensionLogs(id);
    res.json(logs);
  });

  // === HCAPTCHA & AGE VERIFICATION ===
  
  // Get hCaptcha site key (public, safe to expose)
  app.get('/api/config/hcaptcha', (req, res) => {
    res.json({ siteKey: process.env.HCAPTCHA_SITE_KEY || '' });
  });

  // Verify hCaptcha token
  app.post('/api/verify-captcha', async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, message: 'Captcha token required' });
      }

      const secretKey = process.env.HCAPTCHA_SECRET_KEY;
      if (!secretKey) {
        return res.status(500).json({ success: false, message: 'hCaptcha not configured' });
      }

      const response = await fetch('https://api.hcaptcha.com/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: secretKey,
          response: token,
        }),
      });

      const data = await response.json() as { success: boolean; 'error-codes'?: string[] };
      
      if (data.success) {
        res.json({ success: true });
      } else {
        res.status(400).json({ 
          success: false, 
          message: 'Captcha verification failed',
          errors: data['error-codes'] 
        });
      }
    } catch (error) {
      console.error('hCaptcha verification error:', error);
      res.status(500).json({ success: false, message: 'Verification failed' });
    }
  });

  // Update profile with age verification
  app.post('/api/verify-age', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const { dateOfBirth, ageDeclarationAccepted } = req.body;
      
      if (!dateOfBirth) {
        return res.status(400).json({ success: false, message: 'Date of birth required' });
      }
      if (!ageDeclarationAccepted) {
        return res.status(400).json({ success: false, message: 'You must confirm you are 16 or older to use DisabilitySquare' });
      }

      const dob = new Date(dateOfBirth);
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const monthDiff = today.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
        age--;
      }

      if (age < 16) {
        return res.status(403).json({ 
          success: false, 
          message: 'You must be at least 16 years old to use DisabilitySquare' 
        });
      }

      // Apply under-18 privacy protections for 16-17 year olds
      const isUnder18 = age < 18;
      const profileData: Record<string, any> = {
        dateOfBirth: dob,
        ageVerified: true,
        ageVerifiedAt: new Date(),
        ageDeclarationAt: new Date(), // always set — ageDeclarationAccepted is required above
        ...(isUnder18 ? { visibility: 'members_only', dmRestricted: true } : {}),
      };

      let profile = await storage.getProfile(userId);
      if (!profile) {
        profile = await storage.createProfile({ userId, ...profileData } as any);
      } else {
        profile = await storage.updateProfile(userId, profileData as any);
      }

      res.json({ success: true, profile, isUnder18 });
    } catch (error) {
      console.error('Age verification error:', error);
      res.status(500).json({ success: false, message: 'Verification failed' });
    }
  });

  // === SPOON STATUS ===
  app.get('/api/spoons/today', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const today = new Date().toISOString().split('T')[0];
    const status = await storage.getSpoonStatus(userId, today);
    res.json(status || null);
  });

  app.post('/api/spoons', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    try {
      const schema = z.object({ spoons: z.number().int().min(1).max(12), note: z.string().optional(), date: z.string() });
      const input = schema.parse(req.body);
      const status = await storage.setSpoonStatus(userId, input);
      res.json(status);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/spoons/history', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const days = req.query.days ? Number(req.query.days) : 30;
    const history = await storage.getSpoonHistory(userId, days);
    res.json(history);
  });

  // === JOURNAL ===
  app.get('/api/journal', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const entries = await storage.listJournalEntries(userId, limit);
    res.json(entries);
  });

  app.get('/api/journal/:date', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const entry = await storage.getJournalEntry(userId, req.params.date);
    res.json(entry || null);
  });

  app.post('/api/journal', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    try {
      const schema = z.object({
        date: z.string(),
        mood: z.number().int().min(1).max(5),
        symptoms: z.array(z.string()).optional().default([]),
        painLevel: z.number().int().min(0).max(10).optional(),
        energyLevel: z.number().int().min(1).max(10).optional(),
        notes: z.string().optional(),
        isPrivate: z.boolean().optional().default(true),
      });
      const input = schema.parse(req.body);
      const entry = await storage.upsertJournalEntry(userId, input as any);
      res.json(entry);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // === SERVICE PROVIDERS ===
  app.get('/api/providers', async (req, res) => {
    const filters = {
      category: req.query.category as string | undefined,
      state: req.query.state as string | undefined,
      ndisRegistered: req.query.ndisRegistered === 'true' ? true : req.query.ndisRegistered === 'false' ? false : undefined,
      search: req.query.search as string | undefined,
    };
    const providers = await storage.listServiceProviders(filters);
    res.json(providers);
  });

  app.get('/api/providers/:id', async (req, res) => {
    const provider = await storage.getServiceProvider(Number(req.params.id));
    if (!provider) return res.status(404).json({ message: 'Provider not found' });
    res.json(provider);
  });

  app.post('/api/providers', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    try {
      const schema = z.object({
        name: z.string().min(2),
        category: z.enum(['allied_health', 'support_worker', 'accommodation', 'employment', 'legal', 'mental_health', 'equipment', 'other']),
        description: z.string().min(10),
        location: z.string().min(2),
        state: z.string().min(2),
        phone: z.string().optional(),
        email: z.string().email().optional(),
        website: z.string().url().optional(),
        ndisRegistered: z.boolean().optional().default(false),
        acceptsNdis: z.boolean().optional().default(false),
        disabilityTypes: z.array(z.string()).optional().default([]),
      });
      const input = schema.parse(req.body);
      const provider = await storage.createServiceProvider(input as any, userId);
      res.status(201).json(provider);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/providers/:id/approve', isAuthenticated, isAdmin, async (req: any, res) => {
    await storage.approveServiceProvider(Number(req.params.id));
    res.json({ success: true });
  });

  // === RESOURCES ===
  app.get('/api/resources', async (req, res) => {
    const filters = {
      category: req.query.category as string | undefined,
      search: req.query.search as string | undefined,
    };
    const resourcesList = await storage.listResources(filters);
    res.json(resourcesList);
  });

  app.get('/api/resources/saved', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const savedIds = await storage.getSavedResourceIds(userId);
    res.json(savedIds);
  });

  app.post('/api/resources/:id/save', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    const result = await storage.toggleSaveResource(userId, Number(req.params.id));
    res.json(result);
  });

  app.post('/api/resources', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    try {
      const schema = z.object({
        title: z.string().min(2),
        description: z.string().min(10),
        url: z.string().url(),
        category: z.enum(['ndis', 'mental_health', 'employment', 'legal', 'housing', 'community', 'research', 'tools']),
        tags: z.array(z.string()).optional().default([]),
        source: z.string().min(2),
        isAustralian: z.boolean().optional().default(true),
      });
      const input = schema.parse(req.body);
      const resource = await storage.createResource(input as any, userId);
      res.status(201).json(resource);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/resources/:id/approve', isAuthenticated, isAdmin, async (req: any, res) => {
    await storage.approveResource(Number(req.params.id));
    res.json({ success: true });
  });

  // === JOB LISTINGS ===
  app.get('/api/jobs', async (req, res) => {
    const filters = {
      category: req.query.category as string | undefined,
      state: req.query.state as string | undefined,
      type: req.query.type as string | undefined,
      isRemote: req.query.isRemote === 'true' ? true : req.query.isRemote === 'false' ? false : undefined,
      search: req.query.search as string | undefined,
    };
    const jobs = await storage.listJobListings(filters);
    res.json(jobs);
  });

  app.get('/api/jobs/:id', async (req, res) => {
    const job = await storage.getJobListing(Number(req.params.id));
    if (!job) return res.status(404).json({ message: 'Job not found' });
    res.json(job);
  });

  app.post('/api/jobs', isAuthenticated, async (req: any, res) => {
    const userId = req.userId || req.oidc?.user?.sub;
    try {
      const schema = z.object({
        title: z.string().min(2),
        company: z.string().min(2),
        description: z.string().min(10),
        location: z.string().min(2),
        state: z.string().min(2),
        type: z.enum(['full_time', 'part_time', 'casual', 'volunteer', 'contract']),
        salary: z.string().optional(),
        category: z.enum(['admin', 'healthcare', 'tech', 'creative', 'education', 'retail', 'trades', 'other']),
        tags: z.array(z.string()).optional().default([]),
        isRemote: z.boolean().optional().default(false),
        isAccessible: z.boolean().optional().default(false),
        disabilityWelcome: z.boolean().optional().default(false),
        applyUrl: z.string().url().optional(),
        applyEmail: z.string().email().optional(),
        expiresAt: z.string().optional().transform(v => v ? new Date(v) : undefined),
      });
      const input = schema.parse(req.body);
      const job = await storage.createJobListing(input as any, userId);
      res.status(201).json(job);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.post('/api/jobs/:id/approve', isAuthenticated, isAdmin, async (req: any, res) => {
    await storage.approveJobListing(Number(req.params.id));
    res.json({ success: true });
  });

  // === TRANSPORT MODULE ===

  // Seed demo transport data (dev/public endpoint)
  app.post("/api/transport/seed-demo", async (req, res) => {
    try {
      await storage.seedTransportProviders();
      res.json({ success: true, message: "Transport demo data seeded" });
    } catch (error) {
      console.error("[transport] Seed error:", error);
      res.status(500).json({ message: "Failed to seed transport data" });
    }
  });

  // Get a quote for a trip
  app.post("/api/transport/quote", async (req: any, res) => {
    try {
      const schema = z.object({
        pickupAddress: z.string().min(3),
        pickupLat: z.string(),
        pickupLng: z.string(),
        dropoffAddress: z.string().min(3),
        dropoffLat: z.string(),
        dropoffLng: z.string(),
        accessNeeds: z.array(z.enum(["wheelchair", "ramp", "driver_assistance", "low_sensory", "no_stairs"])).default([]),
        companionCount: z.number().int().min(0).max(6).default(0),
        fundingType: z.enum(["ndis", "private", "transport_allowance"]).default("private"),
        sessionId: z.string().optional(),
      });
      const input = schema.parse(req.body);
      const userId = req.userId || req.oidc?.user?.sub || null;

      const { getDirections, calculatePrice } = await import("./transport/maps");
      const { distanceKm, durationMinutes } = await getDirections(
        input.pickupLat, input.pickupLng, input.dropoffLat, input.dropoffLng
      );

      const totalPassengers = 1 + input.companionCount;
      const originLat = parseFloat(input.pickupLat);
      const originLng = parseFloat(input.pickupLng);
      const vehicles = await storage.findNearbyVehicles({
        accessNeeds: input.accessNeeds,
        capacity: totalPassengers,
        originLat: isNaN(originLat) ? undefined : originLat,
        originLng: isNaN(originLng) ? undefined : originLng,
        radiusKm: 100,
      });

      if (vehicles.length === 0) {
        await storage.seedTransportProviders();
        const seededVehicles = await storage.findNearbyVehicles({
          accessNeeds: [],
          capacity: totalPassengers,
          originLat: isNaN(originLat) ? undefined : originLat,
          originLng: isNaN(originLng) ? undefined : originLng,
          radiusKm: 100,
        });
        if (seededVehicles.length === 0) {
          return res.status(404).json({ message: "No vehicles available for your requirements" });
        }
      }

      const availableVehicles = vehicles.length > 0 ? vehicles : await storage.findNearbyVehicles({
        accessNeeds: [],
        capacity: totalPassengers,
        originLat: isNaN(originLat) ? undefined : originLat,
        originLng: isNaN(originLng) ? undefined : originLng,
        radiusKm: 100,
      });

      const seenProviders = new Set<number>();
      const options = [];
      for (const vehicle of availableVehicles) {
        if (seenProviders.has(vehicle.providerId)) continue;
        seenProviders.add(vehicle.providerId);
        const provider = vehicle.provider;
        const rateCard = provider.rateCard as any;
        const price = calculatePrice(distanceKm, durationMinutes, rateCard, input.accessNeeds);
        const etaMinutes = 8 + Math.floor(Math.random() * 12);
        options.push({
          providerId: provider.id,
          providerName: provider.name,
          vehicleType: vehicle.vehicleType,
          etaMinutes,
          priceAud: price,
          ndisEligible: provider.ndisSupport,
          vehicleId: vehicle.id,
        });
      }

      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
      const quote = await storage.createTripQuote({
        sessionId: input.sessionId || null,
        userId,
        pickupAddress: input.pickupAddress,
        pickupLat: input.pickupLat,
        pickupLng: input.pickupLng,
        dropoffAddress: input.dropoffAddress,
        dropoffLat: input.dropoffLat,
        dropoffLng: input.dropoffLng,
        accessNeeds: input.accessNeeds,
        companionCount: input.companionCount,
        fundingType: input.fundingType,
        distanceKm: distanceKm.toFixed(2),
        durationMinutes,
        options,
        expiresAt,
      });

      res.json({
        quoteId: quote.id,
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        durationMinutes,
        options,
        expiresAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      console.error("[transport] Quote error:", error);
      res.status(500).json({ message: "Failed to generate quote" });
    }
  });

  // Book a trip from a quote
  app.post("/api/transport/trips", async (req: any, res) => {
    try {
      const schema = z.object({
        quoteId: z.number().int(),
        selectedOptionIndex: z.number().int().min(0),
        sessionId: z.string().optional(),
      });
      const input = schema.parse(req.body);
      const userId = req.userId || req.oidc?.user?.sub || null;

      const quote = await storage.getTripQuote(input.quoteId);
      if (!quote) return res.status(404).json({ message: "Quote not found" });

      if (new Date() > quote.expiresAt) {
        return res.status(400).json({ message: "Quote has expired. Please get a new quote." });
      }

      const options = quote.options as any[];
      if (!options || input.selectedOptionIndex >= options.length) {
        return res.status(400).json({ message: "Invalid option selected" });
      }

      const selectedOption = options[input.selectedOptionIndex];
      const provider = await storage.getTransportProvider(selectedOption.providerId);
      if (!provider) return res.status(404).json({ message: "Provider not found" });

      const trip = await storage.createTrip({
        quoteId: quote.id,
        providerId: selectedOption.providerId,
        vehicleId: selectedOption.vehicleId,
        sessionId: input.sessionId || quote.sessionId || null,
        userId,
        pickupAddress: quote.pickupAddress,
        dropoffAddress: quote.dropoffAddress,
        priceAud: selectedOption.priceAud.toFixed(2),
        status: "pending",
        accessNeeds: quote.accessNeeds as string[],
        fundingType: quote.fundingType,
        externalRef: null,
      });

      const { getAdapter } = await import("./transport/adapters/registry");
      const adapter = getAdapter(provider.adapterKey);
      const booking = await adapter.book({
        tripId: trip.id,
        pickupAddress: quote.pickupAddress,
        pickupLat: quote.pickupLat,
        pickupLng: quote.pickupLng,
        dropoffAddress: quote.dropoffAddress,
        dropoffLat: quote.dropoffLat,
        dropoffLng: quote.dropoffLng,
        vehicleId: selectedOption.vehicleId,
        vehicleType: selectedOption.vehicleType,
        accessNeeds: quote.accessNeeds as string[],
        priceAud: selectedOption.priceAud,
        sessionId: trip.sessionId || undefined,
        userId: userId || undefined,
      });

      const updatedTrip = await storage.updateTripStatus(trip.id, booking.status);
      const [finalTrip] = await Promise.all([
        storage.getTrip(trip.id),
      ]);

      await storage.updateTripStatus(trip.id, booking.status);

      const tripWithRef = await storage.getTrip(trip.id);
      if (tripWithRef) {
        await import("./db").then(async ({ db }) => {
          const { trips: tripsTable } = await import("@shared/schema");
          const { eq } = await import("drizzle-orm");
          await db.update(tripsTable).set({ externalRef: booking.externalRef }).where(eq(tripsTable.id, trip.id));
        });
      }

      res.status(201).json({
        tripId: trip.id,
        referenceNumber: booking.externalRef,
        status: booking.status,
        message: booking.message,
        pickupAddress: quote.pickupAddress,
        dropoffAddress: quote.dropoffAddress,
        priceAud: selectedOption.priceAud,
        providerName: selectedOption.providerName,
        vehicleType: selectedOption.vehicleType,
        etaMinutes: selectedOption.etaMinutes,
      });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ message: error.errors[0].message });
      console.error("[transport] Booking error:", error);
      res.status(500).json({ message: "Failed to create booking" });
    }
  });

  // Get a specific trip (ownership enforced)
  app.get("/api/transport/trips/:id", async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const userId = req.userId || req.oidc?.user?.sub || null;
      const sessionId = req.query.sessionId as string | undefined;
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });
      const ownerMatch = (userId && trip.userId === userId) || (sessionId && trip.sessionId === sessionId);
      if (!ownerMatch) return res.status(403).json({ message: "Access denied" });
      res.json(trip);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // List trips for current session/user
  app.get("/api/transport/trips", async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub || null;
      const sessionId = req.query.sessionId as string | undefined;
      if (!userId && !sessionId) return res.json([]);
      const tripsList = await storage.getUserTrips(sessionId, userId);
      res.json(tripsList);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Cancel a trip (ownership enforced)
  app.post("/api/transport/trips/:id/cancel", async (req: any, res) => {
    try {
      const id = Number(req.params.id);
      const userId = req.userId || req.oidc?.user?.sub || null;
      const sessionId = (req.body?.sessionId || req.query.sessionId) as string | undefined;
      const trip = await storage.getTrip(id);
      if (!trip) return res.status(404).json({ message: "Trip not found" });

      const ownerMatch = (userId && trip.userId === userId) || (sessionId && trip.sessionId === sessionId);
      if (!ownerMatch) return res.status(403).json({ message: "Access denied" });

      if (trip.status !== "pending" && trip.status !== "confirmed") {
        return res.status(400).json({ message: `Cannot cancel a trip with status: ${trip.status}` });
      }

      const provider = trip.provider;
      if (provider && trip.externalRef) {
        try {
          const { getAdapter } = await import("./transport/adapters/registry");
          const adapter = getAdapter(provider.adapterKey);
          await adapter.cancel(trip.externalRef);
        } catch (err) {
          console.warn("[transport] Adapter cancel failed, proceeding anyway:", err);
        }
      }

      const cancelled = await storage.cancelTrip(id);
      res.json(cancelled);
    } catch (error) {
      console.error("[transport] Cancel error:", error);
      res.status(500).json({ message: "Failed to cancel trip" });
    }
  });

  // === VOICE TRANSCRIPTION (Accessibility Feature) ===
  const MAX_AUDIO_SIZE = 10 * 1024 * 1024; // 10MB limit
  
  app.post('/api/transcribe', isAuthenticated, async (req: any, res) => {
    try {
      const { audio } = req.body;
      if (!audio) {
        return res.status(400).json({ message: 'Audio data required' });
      }
      
      if (typeof audio !== 'string' || audio.length > MAX_AUDIO_SIZE * 1.37) {
        return res.status(400).json({ message: 'Audio file too large (max 10MB)' });
      }
      
      const { speechToText, ensureCompatibleFormat } = await import('./replit_integrations/audio/client');
      
      const rawBuffer = Buffer.from(audio, 'base64');
      if (rawBuffer.length > MAX_AUDIO_SIZE) {
        return res.status(400).json({ message: 'Audio file too large (max 10MB)' });
      }
      
      const { buffer: audioBuffer, format } = await ensureCompatibleFormat(rawBuffer);
      const transcript = await speechToText(audioBuffer, format);
      
      if (!transcript || transcript.trim() === '') {
        return res.json({ transcript: '', message: 'No speech detected' });
      }
      
      res.json({ transcript });
    } catch (error) {
      console.error('Transcription error:', error);
      res.status(500).json({ message: 'Failed to transcribe audio. Please try again.' });
    }
  });

  // === PUBLIC ENDPOINTS (no auth) ===

  app.get("/api/public/stats", async (req, res) => {
    try {
      const stats = await storage.getPublicStats();
      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/public/categories", async (req, res) => {
    try {
      const categories = await storage.listForumCategories();
      res.json(categories);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/public/activity", async (req, res) => {
    try {
      const activity = await storage.getPublicRecentActivity(10);
      res.json(activity);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // === COMMUNITY FORUMS ===

  // List all categories (public, no auth)
  app.get("/api/forums/categories", async (req, res) => {
    try {
      const categories = await storage.listForumCategories();
      res.json(categories);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Get category by slug (public, no auth)
  app.get("/api/forums/categories/:slug", async (req, res) => {
    try {
      const cat = await storage.getForumCategory(req.params.slug);
      if (!cat) return res.status(404).json({ message: "Category not found" });
      res.json(cat);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // List threads in a category (public, no auth)
  app.get("/api/forums/categories/:slug/threads", async (req: any, res) => {
    try {
      const cat = await storage.getForumCategory(req.params.slug);
      if (!cat) return res.status(404).json({ message: "Category not found" });
      const threads = await storage.listForumThreads(cat.id);
      // eSafety: anonymize members_only (16–17 yo) authors for unauthenticated requests
      const requesterId = req.userId || req.oidc?.user?.sub;
      if (!requesterId) {
        const authorIds = [...new Set(threads.map((t: any) => t.author?.id).filter(Boolean))];
        const protectedIds = await getMembersOnlyUserIds(authorIds);
        if (protectedIds.size > 0) {
          const anonymized = threads.map((t: any) =>
            protectedIds.has(t.author?.id) ? { ...t, author: anonymizeAuthor(t.author) } : t
          );
          return res.json(anonymized);
        }
      }
      if (bulletinEnabled(process.env)) {
        return res.json(threads.map((item: any) => ({ ...item, author: safeForumAuthor(item.author) })));
      }
      res.json(threads);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Create a thread
  app.post("/api/forums/categories/:slug/threads", isAuthenticated, guardForumThreadCreate, async (req, res) => {
    try {
      const userId = (req as any).userId || (req as any).oidc?.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const cat = await storage.getForumCategory(req.params.slug);
      if (!cat) return res.status(404).json({ message: "Category not found" });
      const { title, body, isAdviceRequest, tags, mediaUrls } = req.body;
      if (!title?.trim() || !body?.trim()) return res.status(400).json({ message: "Title and body required" });
      const thread = await storage.createForumThread({
        categoryId: cat.id,
        title: title.trim(),
        body: body.trim(),
        isAdviceRequest: !!isAdviceRequest,
        tags: tags || [],
        mediaUrls: mediaUrls || [],
      }, userId);
      // Award points for starting a thread
      if (bulletinEnabled(process.env)) {
        try {
          await storage.awardPoints({ userId, points: 15, actionType: "forum_thread", description: "Started a forum thread" });
        } catch { console.error("Forum thread saved; points award failed."); }
      } else {
        await storage.awardPoints({ userId, points: 15, actionType: "forum_thread", description: "Started a forum thread" });
      }
      res.status(201).json(thread);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Get thread detail with paginated replies (public, no auth)
  app.get("/api/forums/threads/:id", async (req: any, res) => {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
      const thread = await storage.getForumThread(parseInt(req.params.id), page, limit);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      if (bulletinEnabled(process.env)) {
        return res.json({ ...thread,
          author: safeForumAuthor(thread.author),
          replies: (thread.replies || []).map((item: any) => ({ ...item, author: safeForumAuthor(item.author) })),
          repliesPage: page, repliesLimit: limit,
        });
      }
      // eSafety: anonymize members_only (16–17 yo) authors for unauthenticated requests
      const requesterId = req.userId || req.oidc?.user?.sub;
      if (!requesterId) {
        const authorIds = new Set<string>();
        if (thread.author?.id) authorIds.add(thread.author.id);
        (thread.replies || []).forEach((r: any) => { if (r.author?.id) authorIds.add(r.author.id); });
        const protectedIds = await getMembersOnlyUserIds([...authorIds]);
        if (protectedIds.size > 0) {
          const anonymizedThread = protectedIds.has(thread.author?.id)
            ? { ...thread, author: anonymizeAuthor(thread.author) }
            : thread;
          const anonymizedReplies = (thread.replies || []).map((r: any) =>
            protectedIds.has(r.author?.id) ? { ...r, author: anonymizeAuthor(r.author) } : r
          );
          return res.json({ ...anonymizedThread, replies: anonymizedReplies, repliesPage: page, repliesLimit: limit });
        }
      }
      res.json({ ...thread, repliesPage: page, repliesLimit: limit });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Create a reply
  app.post("/api/forums/threads/:id/replies", isAuthenticated, guardForumReplyCreate, async (req, res) => {
    try {
      const userId = (req as any).userId || (req as any).oidc?.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const threadId = parseInt(req.params.id);
      const { body, mediaUrls } = req.body;
      if (!body?.trim()) return res.status(400).json({ message: "Reply body required" });
      const reply = await storage.createForumReply({ threadId, body: body.trim(), mediaUrls: mediaUrls || [] }, userId);
      // Award points for replying
      const points = body.length >= 100 ? 10 : 5;
      if (bulletinEnabled(process.env)) {
        try {
          await storage.awardPoints({ userId, points, actionType: "forum_reply", description: "Replied to a forum thread" });
        } catch { console.error("Forum reply saved; points award failed."); }
      } else {
        await storage.awardPoints({ userId, points, actionType: "forum_reply", description: "Replied to a forum thread" });
      }
      res.status(201).json(reply);
    } catch (e: any) {
      if (bulletinEnabled(process.env) && e?.message === "THREAD_LOCKED") {
        return res.status(423).json({ code: "THREAD_LOCKED", message: "This discussion is locked. Your draft has not been posted." });
      }
      if (bulletinEnabled(process.env) && e?.message === "THREAD_NOT_FOUND") {
        return res.status(404).json({ message: "Discussion not found." });
      }
      res.status(500).json({ message: bulletinEnabled(process.env) ? "Forum reply could not be saved." : e.message });
    }
  });

  // Toggle vote on a thread
  app.post("/api/forums/threads/:id/vote", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).userId || (req as any).oidc?.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const result = await storage.toggleForumVote(userId, "thread", parseInt(req.params.id));
      // Award points to the thread author when they receive a net new upvote (not to the voter)
      if (result.voted && result.recipientId && result.recipientId !== userId) {
        await storage.awardPoints({ userId: result.recipientId, points: 2, actionType: "forum_upvote_received", description: "Received an upvote on a forum thread" });
      }
      res.json({ voted: result.voted, count: result.count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Toggle vote on a reply
  app.post("/api/forums/replies/:id/vote", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).userId || (req as any).oidc?.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const result = await storage.toggleForumVote(userId, "reply", parseInt(req.params.id));
      // Award points to the reply author when they receive a net new upvote (not to the voter)
      if (result.voted && result.recipientId && result.recipientId !== userId) {
        await storage.awardPoints({ userId: result.recipientId, points: 2, actionType: "forum_upvote_received", description: "Received an upvote on a forum reply" });
      }
      res.json({ voted: result.voted, count: result.count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Get user votes for threads or replies
  app.post("/api/forums/votes/bulk", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).userId || (req as any).oidc?.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { entityType, entityIds } = req.body;
      const votedIds = await storage.getUserForumVotes(userId, entityType, entityIds || []);
      res.json({ votedIds });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Mark accepted answer (only thread author)
  app.post("/api/forums/replies/:id/accept", isAuthenticated, async (req, res) => {
    try {
      const userId = (req as any).userId || (req as any).oidc?.user?.sub;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { threadId } = req.body;
      if (!threadId) return res.status(400).json({ message: "threadId required" });
      const { replyAuthorId, wasAlreadyAccepted } = await storage.markAcceptedAnswer(parseInt(threadId), parseInt(req.params.id), userId);
      // Only award points when transitioning from not-accepted to accepted (idempotent)
      if (!wasAlreadyAccepted && replyAuthorId && replyAuthorId !== userId) {
        await storage.awardPoints({ userId: replyAuthorId, points: 20, actionType: "accepted_answer", description: "Reply marked as accepted answer" });
      }
      res.json({ success: true });
    } catch (e: any) {
      const status = e.message === "Not authorized" ? 403 : e.message === "Reply not found in this thread" ? 404 : 500;
      res.status(status).json({ message: e.message });
    }
  });

  // === GRAPH / DISCOVER ROUTES ===

  // Venues
  app.get("/api/venues", async (req, res) => {
    try {
      const venueList = await storage.listVenues();
      res.json(venueList);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/venues/:id", async (req, res) => {
    try {
      const venue = await storage.getVenue(Number(req.params.id));
      if (!venue) return res.status(404).json({ message: "Venue not found" });
      res.json(venue);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/venues", isAuthenticated, async (req: any, res) => {
    try {
      const venueSchema = z.object({
        name: z.string().min(1),
        address: z.string().min(1),
        suburb: z.string().min(1),
        state: z.string().min(1),
        postcode: z.string().optional().nullable(),
        isOnline: z.boolean().default(false),
        lat: z.string().optional().nullable(),
        lng: z.string().optional().nullable(),
        phone: z.string().optional().nullable(),
        website: z.string().url().optional().nullable(),
        accessibilityFeatures: z.array(z.string()).default([]),
        imageUrl: z.string().url().optional().nullable(),
      });
      const input = venueSchema.parse(req.body);
      const venue = await storage.createVenue(input);
      res.status(201).json(venue);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/venues/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const updated = await storage.updateVenue(Number(req.params.id), req.body);
      if (!updated) return res.status(404).json({ message: "Venue not found" });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/venues/:id", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      await storage.deleteVenue(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Events
  app.get("/api/events", async (req, res) => {
    try {
      const filters = {
        groupId: req.query.groupId ? Number(req.query.groupId) : undefined,
        upcoming: req.query.upcoming === "true" ? true : undefined,
      };
      const eventList = await storage.listEvents(filters);
      res.json(eventList);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/events/rsvps/mine", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const rsvps = await storage.getUserEventRsvps(userId);
      res.json(rsvps);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/events/:id", async (req, res) => {
    try {
      const event = await storage.getEvent(Number(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });
      res.json(event);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/events", isAuthenticated, isAdmin, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const event = await storage.createEvent({ ...req.body, organiserUserId: userId });
      res.status(201).json(event);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch("/api/events/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const event = await storage.getEvent(Number(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.organiserUserId !== userId) {
        const user = await storage.getUser(userId);
        if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
      }
      const updated = await storage.updateEvent(Number(req.params.id), req.body);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/events/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const event = await storage.getEvent(Number(req.params.id));
      if (!event) return res.status(404).json({ message: "Event not found" });
      if (event.organiserUserId !== userId) {
        const user = await storage.getUser(userId);
        if (!user?.isAdmin) return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteEvent(Number(req.params.id));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/events/:id/rsvp", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const { status } = req.body;
      const validStatuses = ["going", "interested", "not_going"];
      if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });
      const attendee = await storage.rsvpEvent(Number(req.params.id), userId, status);
      res.json(attendee);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // User Connections
  app.post("/api/connections/follow/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const followerId = req.userId || req.oidc?.user?.sub;
      const followingId = req.params.userId;
      if (followerId === followingId) return res.status(400).json({ message: "Cannot follow yourself" });
      const conn = await storage.followUser(followerId, followingId);
      res.json(conn);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete("/api/connections/follow/:userId", isAuthenticated, async (req: any, res) => {
    try {
      const followerId = req.userId || req.oidc?.user?.sub;
      await storage.unfollowUser(followerId, req.params.userId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/connections/following", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const following = await storage.getFollowing(userId);
      res.json(following);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/connections/followers", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const followers = await storage.getFollowers(userId);
      res.json(followers);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // User Service Affinities
  app.get("/api/affinities", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const affinities = await storage.getUserServiceAffinities(userId);
      res.json(affinities);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/affinities", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const affinitySchema = z.object({
        serviceProviderId: z.number().int().positive(),
        rating: z.number().int().min(1).max(5).optional().nullable(),
        notes: z.string().max(500).optional().nullable(),
      });
      const input = affinitySchema.parse(req.body);
      const affinity = await storage.saveServiceAffinity({ ...input, userId });
      res.json(affinity);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/affinities/:providerId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      await storage.removeServiceAffinity(userId, Number(req.params.providerId));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Participation Journeys
  app.get("/api/journeys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const journeys = await storage.getUserJourneys(userId);
      res.json(journeys);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post("/api/journeys", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const journeySchema = z.object({
        eventId: z.number().int().positive(),
        serviceProviderId: z.number().int().positive().optional().nullable(),
        transportProviderId: z.number().int().positive().optional().nullable(),
        supportNeeds: z.array(z.string()).default([]),
        notes: z.string().optional().nullable(),
      });
      const input = journeySchema.parse(req.body);
      const journey = await storage.createParticipationJourney({ ...input, userId, status: "planning" });
      res.status(201).json(journey);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/journeys/:id/status", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const journeyId = Number(req.params.id);
      const journey = await storage.getJourney(journeyId);
      if (!journey) return res.status(404).json({ message: "Journey not found" });
      if (journey.userId !== userId) return res.status(403).json({ message: "Forbidden" });
      const validStatuses = ["planning", "confirmed", "completed", "cancelled"];
      const { status } = req.body;
      if (!validStatuses.includes(status)) return res.status(400).json({ message: "Invalid status" });
      const updated = await storage.updateJourneyStatus(journeyId, status);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Graph Recommendation Endpoints
  app.get("/api/graph/connections", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const limit = Math.min(Number(req.query.limit) || 10, 30);
      const suggestions = await storage.getSuggestedConnections(userId, limit);
      res.json(suggestions);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/graph/services", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const services = await storage.getMatchedServices(userId);
      res.json(services);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/graph/events", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const matchedEvents = await storage.getMatchedEvents(userId);
      res.json(matchedEvents);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get("/api/graph/journey-options/:eventId", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const options = await storage.getJourneyOptions(userId, Number(req.params.eventId));
      res.json(options);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // === BLOGS & PERSONAL STORIES ===

  // GET /api/blogs — list published blog posts (optional ?tag= filter)
  app.get("/api/blogs", async (req: any, res) => {
    try {
      const tag = req.query.tag as string | undefined;
      const posts = await storage.listBlogPosts({ tag });
      res.json(posts);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/blogs/my — current user's posts (all statuses)
  app.get("/api/blogs/my", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const posts = await storage.listBlogPosts({ authorId: userId });
      res.json(posts);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // GET /api/blogs/:slug — get single post by slug
  app.get("/api/blogs/:slug", async (req: any, res) => {
    try {
      const requesterId = req.userId || req.oidc?.user?.sub;
      const post = await storage.getBlogPost(req.params.slug);
      if (!post) return res.status(404).json({ message: "Blog post not found" });
      // Only author can see draft
      if (post.status === "draft") {
        if (!requesterId || requesterId !== post.authorId) {
          return res.status(404).json({ message: "Blog post not found" });
        }
      }
      const userReaction = requesterId ? await storage.getUserBlogReaction(post.id, requesterId) : undefined;
      res.json({ ...post, userReaction: userReaction?.reactionType || null });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/blogs — create a new blog post
  app.post("/api/blogs", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const schema = z.object({
        title: z.string().min(1).max(200),
        slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
        content: z.string().min(1),
        excerpt: z.string().optional(),
        tags: z.array(z.string()).default([]),
        status: z.enum(["draft", "published"]).default("draft"),
      });
      const input = schema.parse(req.body);
      const post = await storage.createBlogPost({ ...input, authorId: userId });
      if (input.status === "published") {
        await storage.publishBlogPost(post.id, userId);
      }
      res.status(201).json(post);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      if ((e as any)?.code === '23505') return res.status(409).json({ message: "A post with this slug already exists. Please choose a different title/slug." });
      res.status(500).json({ message: e.message || "Internal server error" });
    }
  });

  // PATCH /api/blogs/:id — update a blog post (author only)
  app.patch("/api/blogs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const id = Number(req.params.id);
      const schema = z.object({
        title: z.string().min(1).max(200).optional(),
        content: z.string().min(1).optional(),
        excerpt: z.string().optional(),
        tags: z.array(z.string()).optional(),
        slug: z.string().min(1).max(200).regex(/^[a-z0-9-]+$/).optional(),
      });
      const input = schema.parse(req.body);
      const post = await storage.updateBlogPost(id, userId, input);
      if (!post) return res.status(404).json({ message: "Blog post not found or access denied" });
      res.json(post);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: e.message || "Internal server error" });
    }
  });

  // DELETE /api/blogs/:id — delete a blog post (author only)
  app.delete("/api/blogs/:id", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const id = Number(req.params.id);
      const result = await storage.deleteBlogPost(id, userId);
      if (!result.deleted) {
        if (result.reason === "not_found") return res.status(404).json({ message: "Blog post not found" });
        if (result.reason === "forbidden") return res.status(403).json({ message: "You do not have permission to delete this post" });
      }
      res.json({ success: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "An error occurred";
      res.status(500).json({ message: msg });
    }
  });

  // POST /api/blogs/:id/publish — publish a draft post
  app.post("/api/blogs/:id/publish", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const post = await storage.publishBlogPost(Number(req.params.id), userId);
      if (!post) return res.status(404).json({ message: "Blog post not found or access denied" });
      res.json(post);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/blogs/:id/unpublish — unpublish a post back to draft
  app.post("/api/blogs/:id/unpublish", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const post = await storage.unpublishBlogPost(Number(req.params.id), userId);
      if (!post) return res.status(404).json({ message: "Blog post not found or access denied" });
      res.json(post);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // POST /api/blogs/:id/comments — add a comment (post must be published)
  app.post("/api/blogs/:id/comments", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const blogPostId = Number(req.params.id);
      const post = await storage.getBlogPostById(blogPostId);
      if (!post) return res.status(404).json({ message: "Blog post not found" });
      if (post.status !== "published") return res.status(403).json({ message: "Cannot comment on a draft post" });
      const schema = z.object({ content: z.string().min(1).max(2000) });
      const { content } = schema.parse(req.body);
      const comment = await storage.addBlogComment({ blogPostId, authorId: userId, content });
      res.status(201).json(comment);
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ message: e.errors[0].message });
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/blogs/:id/react — add/update reaction (post must be published)
  app.post("/api/blogs/:id/react", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const blogPostId = Number(req.params.id);
      const post = await storage.getBlogPostById(blogPostId);
      if (!post) return res.status(404).json({ message: "Blog post not found" });
      if (post.status !== "published") return res.status(403).json({ message: "Cannot react to a draft post" });
      const { reactionType } = req.body;
      const validTypes = ['hug', 'me_too', 'helpful', 'inspiring'];
      if (!validTypes.includes(reactionType)) return res.status(400).json({ message: "Invalid reaction type" });
      const reaction = await storage.addBlogReaction(blogPostId, userId, reactionType);
      res.json(reaction);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // DELETE /api/blogs/:id/react — remove reaction (post must be published)
  app.delete("/api/blogs/:id/react", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.userId || req.oidc?.user?.sub;
      const blogPostId = Number(req.params.id);
      const post = await storage.getBlogPostById(blogPostId);
      if (!post) return res.status(404).json({ message: "Blog post not found" });
      if (post.status !== "published") return res.status(403).json({ message: "Cannot react to a draft post" });
      await storage.removeBlogReaction(blogPostId, userId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  return httpServer;
}
