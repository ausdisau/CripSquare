import { db } from "./db";
import { forumThreadControls } from "@shared/forum-bulletin-schema";
import { bulletinEnabled } from "@shared/forum-bulletin-policy";
import { eq, desc, and, sql, sum, gte, lte, lt, inArray, ne } from "drizzle-orm";
import { 
  users, profiles, groups, posts, comments, gameScores, groupMembers,
  badges, userBadges, pointsLedger, userPoints, userReports,
  spoonStatus, journalEntries, serviceProviders, resources, savedResources, jobListings,
  transportProviders, transportVehicles, tripQuotes, trips,
  postReactions,
  forumCategories, forumThreads, forumReplies, forumVotes,
  venues, events, eventAttendees, userConnections, userServiceAffinities, participationJourneys,
  blogPosts, blogComments, blogPostReactions,
  type User, type InsertUser,
  type Profile, type InsertProfile,
  type Group, type InsertGroup,
  type Post, type InsertPost,
  type Comment, type InsertComment,
  type GameScore, type InsertGameScore,
  type Badge, type InsertBadge,
  type UserBadge, type InsertUserBadge,
  type PointsLedgerEntry, type InsertPointsLedgerEntry,
  type UserPoints, type InsertUserPoints,
  type UserReport, type InsertUserReport,
  type SpoonStatus, type InsertSpoonStatus,
  type JournalEntry, type InsertJournalEntry,
  type ServiceProvider, type InsertServiceProvider,
  type Resource, type InsertResource,
  type JobListing, type InsertJobListing,
  type TransportProvider, type InsertTransportProvider,
  type TransportVehicle, type InsertTransportVehicle,
  type TripQuote, type InsertTripQuote,
  type Trip, type InsertTrip,
  type PostReaction,
  type ForumCategory, type InsertForumCategory,
  type ForumThread, type InsertForumThread,
  type ForumReply, type InsertForumReply,
  type Venue, type InsertVenue,
  type Event, type InsertEvent,
  type EventAttendee, type InsertEventAttendee,
  type UserConnection, type InsertUserConnection,
  type UserServiceAffinity, type InsertUserServiceAffinity,
  type ParticipationJourney, type InsertParticipationJourney,
  type BlogPost, type InsertBlogPost,
  type BlogComment, type InsertBlogComment,
  type BlogPostReaction,
  POINT_VALUES
} from "@shared/schema";

export interface IStorage {
  // User management
  getUser(id: string): Promise<User | undefined>;
  makeUserAdmin(userId: string): Promise<void>;
  
  // Profile
  getProfile(userId: string): Promise<Profile | undefined>;
  createProfile(profile: InsertProfile): Promise<Profile>;
  updateProfile(userId: string, profile: Partial<InsertProfile>): Promise<Profile>;

  // Groups
  listGroups(category?: string, search?: string): Promise<Group[]>;
  getGroup(id: number): Promise<Group | undefined>;
  createGroup(group: InsertGroup): Promise<Group>;
  
  // Posts
  listPosts(groupId?: number, tag?: string): Promise<(Post & { author: User })[]>;
  getPost(id: number): Promise<(Post & { comments: (Comment & { author: User })[] }) | undefined>;
  createPost(post: InsertPost): Promise<Post>;

  // Comments
  createComment(comment: InsertComment): Promise<Comment>;

  // Games
  createGameScore(score: InsertGameScore): Promise<GameScore>;
  getLeaderboard(gameName: string): Promise<(GameScore & { user: User })[]>;

  // Valorization System
  awardPoints(entry: InsertPointsLedgerEntry): Promise<PointsLedgerEntry>;
  getUserPoints(userId: string): Promise<UserPoints | undefined>;
  getPointsLeaderboard(limit?: number): Promise<(UserPoints & { user: User })[]>;
  getUserBadges(userId: string): Promise<(UserBadge & { badge: Badge })[]>;
  awardBadge(userId: string, badgeId: number): Promise<UserBadge>;
  getAllBadges(): Promise<Badge[]>;
  getRecentAchievements(limit?: number): Promise<(PointsLedgerEntry & { user: User })[]>;
  initializeUserPoints(userId: string): Promise<UserPoints>;
  
  // User Reports (eSafety compliance)
  createUserReport(report: InsertUserReport): Promise<UserReport>;
  getUserReports(userId: string): Promise<UserReport[]>;
  hasReportedUser(reporterId: string, reportedUserId: string, reportType: string): Promise<boolean>;
  listAllReports(status?: string): Promise<UserReport[]>;
  getAdminReports(scheme?: string, status?: string): Promise<(UserReport & { reporter: User; reportedUser: User })[]>;
  getReportById(id: number): Promise<UserReport | undefined>;
  updateReportStatus(id: number, adminId: string, data: { status?: string; adminNotes?: string }): Promise<UserReport>;
  deactivateUser(userId: string, notice?: string): Promise<void>;

  // Public stats (for landing page)
  getPublicStats(): Promise<{ memberCount: number; threadCount: number; replyCount: number }>;
  getPublicRecentActivity(limit?: number): Promise<{ id: number; title: string; categorySlug: string; createdAt: Date | null }[]>;

  // Spoon Status
  setSpoonStatus(userId: string, data: InsertSpoonStatus): Promise<SpoonStatus>;
  getSpoonStatus(userId: string, date: string): Promise<SpoonStatus | undefined>;
  getSpoonHistory(userId: string, days?: number): Promise<SpoonStatus[]>;

  // Journal
  upsertJournalEntry(userId: string, data: InsertJournalEntry): Promise<JournalEntry>;
  getJournalEntry(userId: string, date: string): Promise<JournalEntry | undefined>;
  listJournalEntries(userId: string, limit?: number): Promise<JournalEntry[]>;

  // Service Providers
  listServiceProviders(filters?: { category?: string; state?: string; ndisRegistered?: boolean; search?: string }): Promise<ServiceProvider[]>;
  getServiceProvider(id: number): Promise<ServiceProvider | undefined>;
  createServiceProvider(data: InsertServiceProvider, submittedById: string): Promise<ServiceProvider>;
  approveServiceProvider(id: number): Promise<void>;

  // Resources
  listResources(filters?: { category?: string; search?: string }): Promise<Resource[]>;
  getResource(id: number): Promise<Resource | undefined>;
  createResource(data: InsertResource, addedById: string): Promise<Resource>;
  approveResource(id: number): Promise<void>;
  toggleSaveResource(userId: string, resourceId: number): Promise<{ saved: boolean }>;
  getSavedResourceIds(userId: string): Promise<number[]>;

  // Job Listings
  listJobListings(filters?: { category?: string; state?: string; type?: string; isRemote?: boolean; search?: string }): Promise<JobListing[]>;
  getJobListing(id: number): Promise<JobListing | undefined>;
  createJobListing(data: InsertJobListing, postedById: string): Promise<JobListing>;
  approveJobListing(id: number): Promise<void>;

  // Reactions (empathetic reactions: hug, me_too, helpful, inspiring)
  addReaction(postId: number, userId: string, reactionType: string): Promise<PostReaction>;
  removeReaction(postId: number, userId: string): Promise<void>;
  getReactionCounts(postId: number): Promise<Record<string, number>>;
  getUserReaction(postId: number, userId: string): Promise<PostReaction | undefined>;
  getReactionCountsBulk(postIds: number[]): Promise<Record<number, Record<string, number>>>;

  // Peer Connect — find users with matching diagnosis or interests
  getPeerMatches(userId: string, limit?: number): Promise<(User & { profile: Profile | null })[]>;
  listAllProfiles(): Promise<(User & { profile: Profile | null })[]>;

  // Public stats (no auth required)
  getPublicMemberCount(): Promise<number>;
  listRecentPublicThreads(limit: number): Promise<{ id: number; title: string; categoryName: string; categorySlug: string; createdAt: Date | null }[]>;

  // Community Forums
  seedForumCategories(): Promise<void>;
  listForumCategories(): Promise<ForumCategory[]>;
  getForumCategory(slug: string): Promise<ForumCategory | undefined>;
  listForumThreads(categoryId: number, limit?: number): Promise<(ForumThread & { author: User })[]>;
  getForumThread(id: number, repliesPage?: number, repliesLimit?: number): Promise<(ForumThread & { author: User; replies: (ForumReply & { author: User })[]; totalReplies: number }) | undefined>;
  createForumThread(data: InsertForumThread, authorId: string): Promise<ForumThread>;
  createForumReply(data: InsertForumReply, authorId: string): Promise<ForumReply>;
  toggleForumVote(userId: string, entityType: string, entityId: number): Promise<{ voted: boolean; count: number; recipientId?: string }>;
  getUserForumVotes(userId: string, entityType: string, entityIds: number[]): Promise<number[]>;
  markAcceptedAnswer(threadId: number, replyId: number, requestingUserId: string): Promise<{ replyAuthorId: string; wasAlreadyAccepted: boolean }>;

  // Venues
  listVenues(): Promise<Venue[]>;
  getVenue(id: number): Promise<Venue | undefined>;
  createVenue(data: InsertVenue): Promise<Venue>;
  updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined>;
  deleteVenue(id: number): Promise<void>;
  seedVenuesAndEvents(): Promise<void>;

  // Events
  listEvents(filters?: { groupId?: number; upcoming?: boolean }): Promise<(Event & { venue: Venue | null; attendeeCount: number })[]>;
  getEvent(id: number): Promise<(Event & { venue: Venue | null; attendees: EventAttendee[] }) | undefined>;
  createEvent(data: InsertEvent): Promise<Event>;
  updateEvent(id: number, data: Partial<InsertEvent>): Promise<Event | undefined>;
  deleteEvent(id: number): Promise<void>;
  rsvpEvent(eventId: number, userId: string, status: string): Promise<EventAttendee>;
  getUserEventRsvps(userId: string): Promise<EventAttendee[]>;

  // User Connections (follows)
  followUser(followerId: string, followingId: string): Promise<UserConnection>;
  unfollowUser(followerId: string, followingId: string): Promise<void>;
  isFollowing(followerId: string, followingId: string): Promise<boolean>;
  getFollowing(userId: string): Promise<UserConnection[]>;
  getFollowers(userId: string): Promise<UserConnection[]>;

  // User Service Affinities
  saveServiceAffinity(data: InsertUserServiceAffinity): Promise<UserServiceAffinity>;
  getUserServiceAffinities(userId: string): Promise<(UserServiceAffinity & { serviceProvider: ServiceProvider })[]>;
  removeServiceAffinity(userId: string, serviceProviderId: number): Promise<void>;

  // Participation Journeys
  createParticipationJourney(data: InsertParticipationJourney): Promise<ParticipationJourney>;
  getUserJourneys(userId: string): Promise<(ParticipationJourney & { event: Event; serviceProvider: ServiceProvider | null; transportProvider: TransportProvider | null })[]>;
  getJourney(id: number): Promise<ParticipationJourney | undefined>;
  updateJourneyStatus(id: number, status: string): Promise<ParticipationJourney>;

  // Graph Recommendations
  getSuggestedConnections(userId: string, limit?: number): Promise<(User & { profile: Profile | null; sharedGroupCount: number })[]>;
  getMatchedServices(userId: string, limit?: number): Promise<ServiceProvider[]>;
  getMatchedEvents(userId: string, limit?: number): Promise<(Event & { venue: Venue | null; attendeeCount: number })[]>;
  getJourneyOptions(userId: string, eventId: number): Promise<{
    event: Event | undefined;
    venue: Venue | undefined;
    serviceProviders: ServiceProvider[];
    transportProviders: (TransportProvider & { compatibleVehicleCount: number })[];
    accessibilityWarnings: string[];
  }>;

  // Blogs & Personal Stories
  listBlogPosts(filters?: { tag?: string; status?: string; authorId?: string }): Promise<(BlogPost & { author: User; reactionCounts: Record<string, number> })[]>;
  getBlogPost(slug: string): Promise<(BlogPost & { author: User; comments: (BlogComment & { author: User })[]; reactionCounts: Record<string, number> }) | undefined>;
  getBlogPostById(id: number): Promise<BlogPost | undefined>;
  createBlogPost(data: InsertBlogPost & { authorId: string }): Promise<BlogPost>;
  updateBlogPost(id: number, authorId: string, data: Partial<InsertBlogPost>): Promise<BlogPost | undefined>;
  deleteBlogPost(id: number, authorId: string): Promise<{ deleted: boolean; reason?: string }>;
  publishBlogPost(id: number, authorId: string): Promise<BlogPost | undefined>;
  unpublishBlogPost(id: number, authorId: string): Promise<BlogPost | undefined>;
  addBlogComment(data: { blogPostId: number; authorId: string; content: string }): Promise<BlogComment>;
  addBlogReaction(blogPostId: number, userId: string, reactionType: string): Promise<BlogPostReaction>;
  removeBlogReaction(blogPostId: number, userId: string): Promise<void>;
  getBlogReactionCounts(blogPostId: number): Promise<Record<string, number>>;
  getUserBlogReaction(blogPostId: number, userId: string): Promise<BlogPostReaction | undefined>;
  getUserDraftBlogPosts(authorId: string): Promise<BlogPost[]>;

  // Transport Module
  seedTransportProviders(): Promise<void>;
  listTransportProviders(): Promise<TransportProvider[]>;
  getTransportProvider(id: number): Promise<TransportProvider | undefined>;
  findNearbyVehicles(filters: { accessNeeds: string[]; capacity: number; originLat?: number; originLng?: number; radiusKm?: number }): Promise<(TransportVehicle & { provider: TransportProvider })[]>;
  createTripQuote(data: InsertTripQuote): Promise<TripQuote>;
  getTripQuote(id: number): Promise<TripQuote | undefined>;
  createTrip(data: InsertTrip): Promise<Trip>;
  getTrip(id: number): Promise<(Trip & { provider: TransportProvider }) | undefined>;
  getUserTrips(sessionId?: string, userId?: string): Promise<(Trip & { provider: TransportProvider })[]>;
  updateTripStatus(id: number, status: string): Promise<Trip>;
  cancelTrip(id: number): Promise<Trip>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }
  
  async makeUserAdmin(userId: string): Promise<void> {
    await db.update(users).set({ isAdmin: true }).where(eq(users.id, userId));
  }

  async getProfile(userId: string): Promise<Profile | undefined> {
    const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId));
    return profile;
  }

  async createProfile(profile: InsertProfile): Promise<Profile> {
    const [newProfile] = await db.insert(profiles).values(profile).returning();
    return newProfile;
  }

  async updateProfile(userId: string, profileUpdate: Partial<InsertProfile>): Promise<Profile> {
    const [updated] = await db.update(profiles)
      .set(profileUpdate)
      .where(eq(profiles.userId, userId))
      .returning();
    return updated;
  }

  async listGroups(category?: string, search?: string): Promise<Group[]> {
    let query = db.select().from(groups);
    const conditions = [];
    if (category) conditions.push(eq(groups.category, category));
    if (search) conditions.push(sql`${groups.name} ILIKE ${`%${search}%`}`); // Simple search
    
    if (conditions.length > 0) {
      // @ts-ignore - drizzle type inference can be tricky with dynamic where
      return await query.where(and(...conditions));
    }
    return await query;
  }

  async getGroup(id: number): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group;
  }

  async createGroup(group: InsertGroup): Promise<Group> {
    const [newGroup] = await db.insert(groups).values(group).returning();
    return newGroup;
  }

  async listPosts(groupId?: number, tag?: string): Promise<(Post & { author: User })[]> {
    const conditions = [];
    if (groupId) conditions.push(eq(posts.groupId, groupId));
    // Tag filtering would require JSONB containment check, simpler to skip or do basic if needed. 
    // Drizzle has limited JSONB operator support in some versions, but we'll try basic approach or skip tag for now if complex.
    
    const result = await db.query.posts.findMany({
      where: groupId ? eq(posts.groupId, groupId) : undefined,
      orderBy: [desc(posts.createdAt)],
      with: {
        author: true,
      }
    });
    
    // Manual filter for tags if needed (since it's jsonb)
    if (tag) {
      return result.filter(p => (p.tags as string[])?.includes(tag)) as any;
    }
    return result as any;
  }

  async getPost(id: number): Promise<(Post & { comments: (Comment & { author: User })[] }) | undefined> {
    const post = await db.query.posts.findFirst({
      where: eq(posts.id, id),
      with: {
        comments: {
          with: { author: true },
          orderBy: [desc(comments.createdAt)]
        }
      }
    });
    return post as any;
  }

  async createPost(post: InsertPost): Promise<Post> {
    const [newPost] = await db.insert(posts).values(post).returning();
    return newPost;
  }

  async createComment(comment: InsertComment): Promise<Comment> {
    const [newComment] = await db.insert(comments).values(comment).returning();
    return newComment;
  }

  async createGameScore(score: InsertGameScore): Promise<GameScore> {
    const [newScore] = await db.insert(gameScores).values(score).returning();
    return newScore;
  }

  async getLeaderboard(gameName: string): Promise<(GameScore & { user: User })[]> {
    const scores = await db.query.gameScores.findMany({
      where: eq(gameScores.gameName, gameName),
      orderBy: [desc(gameScores.score)],
      limit: 10,
      with: {
        user: true
      }
    });
    return scores as any;
  }

  // === VALORIZATION SYSTEM ===

  async initializeUserPoints(userId: string): Promise<UserPoints> {
    const existing = await this.getUserPoints(userId);
    if (existing) return existing;
    
    const [newRecord] = await db.insert(userPoints).values({
      userId,
      totalPoints: 0,
      level: 1,
    }).returning();
    return newRecord;
  }

  async awardPoints(entry: InsertPointsLedgerEntry): Promise<PointsLedgerEntry> {
    // Create ledger entry
    const [ledgerEntry] = await db.insert(pointsLedger).values(entry).returning();
    
    // Update or create user points record
    const existing = await this.getUserPoints(entry.userId);
    let newTotal = entry.points;
    if (existing) {
      newTotal = existing.totalPoints + entry.points;
      const newLevel = Math.floor(newTotal / 100) + 1; // Level up every 100 points
      await db.update(userPoints)
        .set({ 
          totalPoints: newTotal, 
          level: newLevel,
          updatedAt: new Date() 
        })
        .where(eq(userPoints.userId, entry.userId));
    } else {
      await db.insert(userPoints).values({
        userId: entry.userId,
        totalPoints: entry.points,
        level: 1,
      });
    }
    
    // Check and award badges based on new total points
    await this.checkAndAwardBadges(entry.userId, newTotal);
    
    return ledgerEntry;
  }

  private async checkAndAwardBadges(userId: string, totalPoints: number): Promise<void> {
    // Get all badges the user doesn't have yet
    const allBadgesList = await this.getAllBadges();
    const userBadgesList = await this.getUserBadges(userId);
    const earnedBadgeIds = new Set(userBadgesList.map(ub => ub.badgeId));
    
    // Award badges where user meets the points threshold
    for (const badge of allBadgesList) {
      if (!earnedBadgeIds.has(badge.id) && totalPoints >= badge.pointsRequired) {
        await this.awardBadge(userId, badge.id);
      }
    }
  }

  async getUserPoints(userId: string): Promise<UserPoints | undefined> {
    const [record] = await db.select().from(userPoints).where(eq(userPoints.userId, userId));
    return record;
  }

  async getPointsLeaderboard(limit: number = 10): Promise<(UserPoints & { user: User })[]> {
    const leaders = await db.query.userPoints.findMany({
      orderBy: [desc(userPoints.totalPoints)],
      limit,
      with: {
        user: true
      }
    });
    return leaders as any;
  }

  async getUserBadges(userId: string): Promise<(UserBadge & { badge: Badge })[]> {
    const userBadgesList = await db.query.userBadges.findMany({
      where: eq(userBadges.userId, userId),
      with: {
        badge: true
      }
    });
    return userBadgesList as any;
  }

  async awardBadge(userId: string, badgeId: number): Promise<UserBadge> {
    // Check if already has badge
    const existing = await db.select().from(userBadges)
      .where(and(eq(userBadges.userId, userId), eq(userBadges.badgeId, badgeId)));
    if (existing.length > 0) return existing[0];
    
    const [newBadge] = await db.insert(userBadges).values({
      userId,
      badgeId,
    }).returning();
    return newBadge;
  }

  async getAllBadges(): Promise<Badge[]> {
    return await db.select().from(badges);
  }

  async getRecentAchievements(limit: number = 20): Promise<(PointsLedgerEntry & { user: User })[]> {
    const recent = await db.query.pointsLedger.findMany({
      orderBy: [desc(pointsLedger.createdAt)],
      limit,
      with: {
        user: true
      }
    });
    return recent as any;
  }
  
  // User Reports (eSafety compliance)
  async createUserReport(report: InsertUserReport): Promise<UserReport> {
    const [newReport] = await db.insert(userReports).values(report).returning();
    return newReport;
  }
  
  async getUserReports(userId: string): Promise<UserReport[]> {
    return await db.select().from(userReports)
      .where(eq(userReports.reportedUserId, userId))
      .orderBy(desc(userReports.createdAt));
  }
  
  async hasReportedUser(reporterId: string, reportedUserId: string, reportType: string): Promise<boolean> {
    const existing = await db.select().from(userReports).where(
      and(
        eq(userReports.reporterId, reporterId),
        eq(userReports.reportedUserId, reportedUserId),
        eq(userReports.reportType, reportType)
      )
    );
    return existing.length > 0;
  }

  async getAdminReports(scheme?: string, status?: string): Promise<(UserReport & { reporter: User; reportedUser: User })[]> {
    const conditions = [];
    if (scheme) conditions.push(eq(userReports.esafetyScheme, scheme));
    if (status) conditions.push(eq(userReports.status, status));
    const reports = await db.query.userReports.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(userReports.createdAt)],
      with: {
        reporter: true,
        reportedUser: true,
      },
    });
    return reports as any;
  }

  async listAllReports(status?: string): Promise<UserReport[]> {
    if (status) {
      return await db.select().from(userReports).where(eq(userReports.status, status)).orderBy(desc(userReports.createdAt));
    }
    return await db.select().from(userReports).orderBy(desc(userReports.createdAt));
  }

  async getReportById(id: number): Promise<UserReport | undefined> {
    const [report] = await db.select().from(userReports).where(eq(userReports.id, id));
    return report;
  }

  async updateReportStatus(id: number, adminId: string, data: { status?: string; adminNotes?: string }): Promise<UserReport> {
    const [updated] = await db.update(userReports)
      .set({
        ...(data.status ? { status: data.status } : {}),
        ...(data.adminNotes !== undefined ? { adminNotes: data.adminNotes } : {}),
        reviewedAt: new Date(),
        reviewedBy: adminId,
      })
      .where(eq(userReports.id, id))
      .returning();
    return updated;
  }

  async deactivateUser(userId: string, notice?: string): Promise<void> {
    await db.update(users).set({
      isActive: false,
      deactivationNotice: notice ?? 'Your account has been deactivated following an eSafety compliance review. If you believe this is an error, please contact our support team to appeal this decision.',
    }).where(eq(users.id, userId));
  }

  // === SPOON STATUS ===
  async setSpoonStatus(userId: string, data: InsertSpoonStatus): Promise<SpoonStatus> {
    const existing = await this.getSpoonStatus(userId, data.date);
    if (existing) {
      const [updated] = await db.update(spoonStatus)
        .set({ spoons: data.spoons, note: data.note })
        .where(and(eq(spoonStatus.userId, userId), eq(spoonStatus.date, data.date)))
        .returning();
      return updated;
    }
    const [newEntry] = await db.insert(spoonStatus).values({ ...data, userId }).returning();
    return newEntry;
  }

  async getSpoonStatus(userId: string, date: string): Promise<SpoonStatus | undefined> {
    const [entry] = await db.select().from(spoonStatus)
      .where(and(eq(spoonStatus.userId, userId), eq(spoonStatus.date, date)));
    return entry;
  }

  async getSpoonHistory(userId: string, days: number = 30): Promise<SpoonStatus[]> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    return await db.select().from(spoonStatus)
      .where(and(eq(spoonStatus.userId, userId), gte(spoonStatus.date, cutoffStr)))
      .orderBy(desc(spoonStatus.date));
  }

  // === JOURNAL ===
  async upsertJournalEntry(userId: string, data: InsertJournalEntry): Promise<JournalEntry> {
    const existing = await this.getJournalEntry(userId, data.date);
    if (existing) {
      const [updated] = await db.update(journalEntries)
        .set({ ...data, updatedAt: new Date() })
        .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, data.date)))
        .returning();
      return updated;
    }
    const [newEntry] = await db.insert(journalEntries).values({ ...data, userId }).returning();
    return newEntry;
  }

  async getJournalEntry(userId: string, date: string): Promise<JournalEntry | undefined> {
    const [entry] = await db.select().from(journalEntries)
      .where(and(eq(journalEntries.userId, userId), eq(journalEntries.date, date)));
    return entry;
  }

  async listJournalEntries(userId: string, limit: number = 30): Promise<JournalEntry[]> {
    return await db.select().from(journalEntries)
      .where(eq(journalEntries.userId, userId))
      .orderBy(desc(journalEntries.date))
      .limit(limit);
  }

  // === SERVICE PROVIDERS ===
  async listServiceProviders(filters?: { category?: string; state?: string; ndisRegistered?: boolean; search?: string }): Promise<ServiceProvider[]> {
    const conditions = [eq(serviceProviders.approved, true)];
    if (filters?.category) conditions.push(eq(serviceProviders.category, filters.category));
    if (filters?.state) conditions.push(eq(serviceProviders.state, filters.state));
    if (filters?.ndisRegistered !== undefined) conditions.push(eq(serviceProviders.ndisRegistered, filters.ndisRegistered));
    if (filters?.search) conditions.push(sql`${serviceProviders.name} ILIKE ${`%${filters.search}%`}`);
    return await db.select().from(serviceProviders).where(and(...conditions)).orderBy(serviceProviders.name);
  }

  async getServiceProvider(id: number): Promise<ServiceProvider | undefined> {
    const [provider] = await db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    return provider;
  }

  async createServiceProvider(data: InsertServiceProvider, submittedById: string): Promise<ServiceProvider> {
    const [newProvider] = await db.insert(serviceProviders).values({ ...data, submittedById, approved: false }).returning();
    return newProvider;
  }

  async approveServiceProvider(id: number): Promise<void> {
    await db.update(serviceProviders).set({ approved: true }).where(eq(serviceProviders.id, id));
  }

  // === RESOURCES ===
  async listResources(filters?: { category?: string; search?: string }): Promise<Resource[]> {
    const conditions = [eq(resources.approved, true)];
    if (filters?.category) conditions.push(eq(resources.category, filters.category));
    if (filters?.search) conditions.push(sql`(${resources.title} ILIKE ${`%${filters.search}%`} OR ${resources.description} ILIKE ${`%${filters.search}%`})`);
    return await db.select().from(resources).where(and(...conditions)).orderBy(desc(resources.saves));
  }

  async getResource(id: number): Promise<Resource | undefined> {
    const [resource] = await db.select().from(resources).where(eq(resources.id, id));
    return resource;
  }

  async createResource(data: InsertResource, addedById: string): Promise<Resource> {
    const [newResource] = await db.insert(resources).values({ ...data, addedById, approved: false }).returning();
    return newResource;
  }

  async approveResource(id: number): Promise<void> {
    await db.update(resources).set({ approved: true }).where(eq(resources.id, id));
  }

  async toggleSaveResource(userId: string, resourceId: number): Promise<{ saved: boolean }> {
    const existing = await db.select().from(savedResources)
      .where(and(eq(savedResources.userId, userId), eq(savedResources.resourceId, resourceId)));
    if (existing.length > 0) {
      await db.delete(savedResources).where(and(eq(savedResources.userId, userId), eq(savedResources.resourceId, resourceId)));
      await db.update(resources).set({ saves: sql`saves - 1` }).where(eq(resources.id, resourceId));
      return { saved: false };
    }
    await db.insert(savedResources).values({ userId, resourceId });
    await db.update(resources).set({ saves: sql`saves + 1` }).where(eq(resources.id, resourceId));
    return { saved: true };
  }

  async getSavedResourceIds(userId: string): Promise<number[]> {
    const saved = await db.select({ resourceId: savedResources.resourceId }).from(savedResources).where(eq(savedResources.userId, userId));
    return saved.map(s => s.resourceId);
  }

  // === JOB LISTINGS ===
  async listJobListings(filters?: { category?: string; state?: string; type?: string; isRemote?: boolean; search?: string }): Promise<JobListing[]> {
    const conditions = [eq(jobListings.approved, true)];
    if (filters?.category) conditions.push(eq(jobListings.category, filters.category));
    if (filters?.state) conditions.push(eq(jobListings.state, filters.state));
    if (filters?.type) conditions.push(eq(jobListings.type, filters.type));
    if (filters?.isRemote !== undefined) conditions.push(eq(jobListings.isRemote, filters.isRemote));
    if (filters?.search) conditions.push(sql`(${jobListings.title} ILIKE ${`%${filters.search}%`} OR ${jobListings.company} ILIKE ${`%${filters.search}%`})`);
    return await db.select().from(jobListings).where(and(...conditions)).orderBy(desc(jobListings.createdAt));
  }

  async getJobListing(id: number): Promise<JobListing | undefined> {
    const [job] = await db.select().from(jobListings).where(eq(jobListings.id, id));
    return job;
  }

  async createJobListing(data: InsertJobListing, postedById: string): Promise<JobListing> {
    const [newJob] = await db.insert(jobListings).values({ ...data, postedById, approved: false }).returning();
    return newJob;
  }

  async approveJobListing(id: number): Promise<void> {
    await db.update(jobListings).set({ approved: true }).where(eq(jobListings.id, id));
  }

  // === TRANSPORT MODULE ===

  async seedTransportProviders(): Promise<void> {
    const existing = await db.select().from(transportProviders).limit(1);
    if (existing.length > 0) return;

    const [wat] = await db.insert(transportProviders).values({
      name: "Sydney Accessible Transport Co.",
      kind: "wat",
      ndisSupport: true,
      rateCard: {
        baseFare: 8.0,
        perKm: 2.8,
        perMinute: 0.45,
        wheelchairSurcharge: 12.0,
        rampSurcharge: 5.0,
        driverAssistanceSurcharge: 8.0,
      },
      adapterKey: "zoomly_manual",
      active: true,
    }).returning();

    const [rideshare] = await db.insert(transportProviders).values({
      name: "CityRide Partner Network",
      kind: "rideshare",
      ndisSupport: false,
      rateCard: {
        baseFare: 5.0,
        perKm: 1.9,
        perMinute: 0.3,
        wheelchairSurcharge: 0,
        rampSurcharge: 0,
        driverAssistanceSurcharge: 4.0,
      },
      adapterKey: "zoomly_manual",
      active: true,
    }).returning();

    await db.insert(transportVehicles).values([
      {
        providerId: wat.id,
        vehicleType: "wheelchair_van",
        capacity: 4,
        accessibilityFeatures: ["wheelchair", "ramp", "driver_assistance", "low_sensory", "no_stairs"],
        lat: "-33.8688",
        lng: "151.2093",
        available: true,
      },
      {
        providerId: wat.id,
        vehicleType: "minibus",
        capacity: 8,
        accessibilityFeatures: ["wheelchair", "ramp", "no_stairs"],
        lat: "-33.8750",
        lng: "151.2050",
        available: true,
      },
      {
        providerId: rideshare.id,
        vehicleType: "sedan",
        capacity: 4,
        accessibilityFeatures: ["driver_assistance"],
        lat: "-33.8700",
        lng: "151.2100",
        available: true,
      },
      {
        providerId: rideshare.id,
        vehicleType: "suv",
        capacity: 5,
        accessibilityFeatures: ["driver_assistance", "low_sensory"],
        lat: "-33.8650",
        lng: "151.2150",
        available: true,
      },
    ]);
  }

  async listTransportProviders(): Promise<TransportProvider[]> {
    return await db.select().from(transportProviders).where(eq(transportProviders.active, true));
  }

  async getTransportProvider(id: number): Promise<TransportProvider | undefined> {
    const [provider] = await db.select().from(transportProviders).where(eq(transportProviders.id, id));
    return provider;
  }

  async findNearbyVehicles(filters: { accessNeeds: string[]; capacity: number; originLat?: number; originLng?: number; radiusKm?: number }): Promise<(TransportVehicle & { provider: TransportProvider })[]> {
    const allVehicles = await db.query.transportVehicles.findMany({
      where: eq(transportVehicles.available, true),
      with: {
        provider: true,
      },
    });

    const radiusKm = filters.radiusKm ?? 50;

    function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
      const R = 6371;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLng = (lng2 - lng1) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    return (allVehicles as any[]).filter((v: any) => {
      if (v.capacity < filters.capacity) return false;
      if (!v.provider?.active) return false;
      if (filters.originLat !== undefined && filters.originLng !== undefined && v.lat && v.lng) {
        const dist = haversineKm(filters.originLat, filters.originLng, parseFloat(v.lat), parseFloat(v.lng));
        if (dist > radiusKm) return false;
      }
      if (filters.accessNeeds.length === 0) return true;
      const features = v.accessibilityFeatures as string[];
      return filters.accessNeeds.every(need => features.includes(need));
    });
  }

  async createTripQuote(data: InsertTripQuote): Promise<TripQuote> {
    const [quote] = await db.insert(tripQuotes).values(data).returning();
    return quote;
  }

  async getTripQuote(id: number): Promise<TripQuote | undefined> {
    const [quote] = await db.select().from(tripQuotes).where(eq(tripQuotes.id, id));
    return quote;
  }

  async createTrip(data: InsertTrip): Promise<Trip> {
    const [trip] = await db.insert(trips).values(data).returning();
    return trip;
  }

  async getTrip(id: number): Promise<(Trip & { provider: TransportProvider }) | undefined> {
    const trip = await db.query.trips.findFirst({
      where: eq(trips.id, id),
      with: { provider: true },
    });
    return trip as any;
  }

  async getUserTrips(sessionId?: string, userId?: string): Promise<(Trip & { provider: TransportProvider })[]> {
    const userTrips = await db.query.trips.findMany({
      where: userId
        ? eq(trips.userId, userId)
        : sessionId
          ? eq(trips.sessionId, sessionId)
          : undefined,
      with: { provider: true },
      orderBy: [desc(trips.createdAt)],
    });
    return userTrips as any;
  }

  async updateTripStatus(id: number, status: string): Promise<Trip> {
    const [updated] = await db.update(trips)
      .set({ status, updatedAt: new Date() })
      .where(eq(trips.id, id))
      .returning();
    return updated;
  }

  async cancelTrip(id: number): Promise<Trip> {
    const [updated] = await db.update(trips)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(trips.id, id))
      .returning();
    return updated;
  }

  // === REACTIONS ===
  async addReaction(postId: number, userId: string, reactionType: string): Promise<PostReaction> {
    const [reaction] = await db
      .insert(postReactions)
      .values({ postId, userId, reactionType })
      .onConflictDoUpdate({
        target: [postReactions.postId, postReactions.userId],
        set: { reactionType },
      })
      .returning();
    return reaction;
  }

  async removeReaction(postId: number, userId: string): Promise<void> {
    await db.delete(postReactions)
      .where(and(eq(postReactions.postId, postId), eq(postReactions.userId, userId)));
  }

  async getReactionCounts(postId: number): Promise<Record<string, number>> {
    const rows = await db
      .select({ reactionType: postReactions.reactionType, count: sql<number>`count(*)::int` })
      .from(postReactions)
      .where(eq(postReactions.postId, postId))
      .groupBy(postReactions.reactionType);
    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.reactionType] = row.count;
    return counts;
  }

  async getUserReaction(postId: number, userId: string): Promise<PostReaction | undefined> {
    const [reaction] = await db
      .select()
      .from(postReactions)
      .where(and(eq(postReactions.postId, postId), eq(postReactions.userId, userId)));
    return reaction;
  }

  async getReactionCountsBulk(postIds: number[]): Promise<Record<number, Record<string, number>>> {
    if (postIds.length === 0) return {};
    const rows = await db
      .select({ postId: postReactions.postId, reactionType: postReactions.reactionType, count: sql<number>`count(*)::int` })
      .from(postReactions)
      .where(inArray(postReactions.postId, postIds))
      .groupBy(postReactions.postId, postReactions.reactionType);
    const result: Record<number, Record<string, number>> = {};
    for (const row of rows) {
      if (!result[row.postId]) result[row.postId] = {};
      result[row.postId][row.reactionType] = row.count;
    }
    return result;
  }

  // === PEER CONNECT ===
  async getPeerMatches(userId: string, limit = 20): Promise<(User & { profile: Profile | null })[]> {
    const myProfile = await this.getProfile(userId);
    const myDiagnosis = myProfile?.diagnosis?.toLowerCase() || "";
    const myInterests: string[] = (myProfile?.interests as string[]) || [];

    const allUsers = await db.query.users.findMany({
      where: ne(users.id, userId),
      with: { profile: true },
      limit: 200,
    });

    const scored = (allUsers as any[]).map((u: any) => {
      const profile = u.profile;
      let score = 0;
      if (profile?.diagnosis && myDiagnosis && profile.diagnosis.toLowerCase().includes(myDiagnosis)) score += 3;
      if (profile?.diagnosis && myDiagnosis && myDiagnosis.includes(profile.diagnosis.toLowerCase())) score += 3;
      const theirInterests: string[] = (profile?.interests as string[]) || [];
      const shared = theirInterests.filter((i: string) => myInterests.includes(i));
      score += shared.length;
      if (profile?.location && myProfile?.location && profile.location === myProfile.location) score += 1;
      return { ...u, _score: score };
    });

    return scored
      .sort((a: any, b: any) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...u }: any) => u);
  }

  async listAllProfiles(): Promise<(User & { profile: Profile | null })[]> {
    return await db.query.users.findMany({
      with: { profile: true },
      limit: 100,
    }) as any;
  }

  async getPublicMemberCount(): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(users);
    return Number(result?.count ?? 0);
  }

  async listRecentPublicThreads(limit: number): Promise<{ id: number; title: string; categoryName: string; categorySlug: string; createdAt: Date | null }[]> {
    const rows = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        categoryName: forumCategories.name,
        categorySlug: forumCategories.slug,
        createdAt: forumThreads.createdAt,
      })
      .from(forumThreads)
      .innerJoin(forumCategories, eq(forumThreads.categoryId, forumCategories.id))
      .orderBy(desc(forumThreads.lastActivityAt))
      .limit(limit);
    return rows;
  }

  // === COMMUNITY FORUMS ===

  async seedForumCategories(): Promise<void> {
    const existing = await db.select().from(forumCategories).limit(1);
    if (existing.length > 0) return;

    const defaultCategories = [
      { name: "Mental Health", slug: "mental-health", description: "Share experiences, coping strategies, and support for mental health challenges.", icon: "Brain", sortOrder: 0 },
      { name: "Mobility", slug: "mobility", description: "Discussions about mobility aids, accessibility, and getting around with physical disabilities.", icon: "Accessibility", sortOrder: 1 },
      { name: "Chronic Pain", slug: "chronic-pain", description: "A space for those living with chronic pain conditions to connect and share strategies.", icon: "Activity", sortOrder: 2 },
      { name: "NDIS & Funding", slug: "ndis-funding", description: "Navigate the NDIS, funding plans, and financial support for people with disability.", icon: "FileText", sortOrder: 3 },
      { name: "Daily Living", slug: "daily-living", description: "Tips, tools, and conversations about managing everyday tasks with a disability.", icon: "Home", sortOrder: 4 },
      { name: "General", slug: "general", description: "A place for everything else — introduce yourself, share news, or just chat.", icon: "MessageSquare", sortOrder: 5 },
    ];

    await db.insert(forumCategories).values(defaultCategories);
  }

  async listForumCategories(): Promise<ForumCategory[]> {
    return db.select().from(forumCategories).orderBy(forumCategories.sortOrder);
  }

  async getForumCategory(slug: string): Promise<ForumCategory | undefined> {
    const [cat] = await db.select().from(forumCategories).where(eq(forumCategories.slug, slug));
    return cat;
  }

  async listForumThreads(categoryId: number, limit = 30): Promise<(ForumThread & { author: User })[]> {
    if (bulletinEnabled(process.env)) {
      // Sticky discussions first; do not query new tables while feature is OFF.
      const rows = await db.select({
        thread: forumThreads,
        author: users,
        pinned: forumThreadControls.isPinned,
        locked: forumThreadControls.isLocked,
      }).from(forumThreads)
        .innerJoin(users, eq(users.id, forumThreads.authorId))
        .leftJoin(forumThreadControls, eq(forumThreadControls.threadId, forumThreads.id))
        .where(eq(forumThreads.categoryId, categoryId))
        .orderBy(
          desc(sql`COALESCE(${forumThreadControls.isPinned}, false)`),
          desc(forumThreads.lastActivityAt),
          desc(forumThreads.id),
        ).limit(limit);
      return rows.map(row => ({
        ...row.thread, author: row.author,
        isPinned: row.pinned === true,
        isLocked: row.locked === true,
      }));
    }
    return db.query.forumThreads.findMany({
      where: eq(forumThreads.categoryId, categoryId),
      orderBy: [desc(forumThreads.lastActivityAt)],
      with: { author: true },
      limit,
    }) as any;
  }

  async getForumThread(id: number, repliesPage = 1, repliesLimit = 20): Promise<(ForumThread & { author: User; replies: (ForumReply & { author: User })[]; totalReplies: number }) | undefined> {
    const thread = await db.query.forumThreads.findFirst({
      where: eq(forumThreads.id, id),
      with: { author: true },
    });
    if (!thread) return undefined;

    const offset = (repliesPage - 1) * repliesLimit;
    const [{ count: totalReplies }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(forumReplies)
      .where(eq(forumReplies.threadId, id));

    const replies = await db.query.forumReplies.findMany({
      where: eq(forumReplies.threadId, id),
      orderBy: [forumReplies.createdAt],
      with: { author: true },
      limit: repliesLimit,
      offset,
    });

    return { ...(thread as any), replies, totalReplies };
  }

  async createForumThread(data: InsertForumThread, authorId: string): Promise<ForumThread> {
    if (bulletinEnabled(process.env)) {
      // Persist the thread and category count together to avoid false failures and orphaned counters.
      return db.transaction(async tx => {
        const [category] = await tx.select({ id: forumCategories.id })
          .from(forumCategories).where(eq(forumCategories.id, data.categoryId)).for("update");
        if (!category) throw new Error("FORUM_CATEGORY_NOT_FOUND");
        const [thread] = await tx.insert(forumThreads).values({ ...data, authorId }).returning();
        await tx.update(forumCategories)
          .set({ threadCount: sql`${forumCategories.threadCount} + 1`, lastActivityAt: new Date() })
          .where(eq(forumCategories.id, data.categoryId));
        return thread;
      });
    }
    const [thread] = await db.insert(forumThreads).values({ ...data, authorId }).returning();
    await db.update(forumCategories)
      .set({ threadCount: sql`${forumCategories.threadCount} + 1`, lastActivityAt: new Date() })
      .where(eq(forumCategories.id, data.categoryId));
    return thread;
  }

  async createForumReply(data: InsertForumReply, authorId: string): Promise<ForumReply> {
    if (bulletinEnabled(process.env)) {
      // Both reply insertion and moderator locking take the same row lock.
      // This avoids a moderation/reply race after the route guard runs.
      return db.transaction(async tx => {
        const [thread] = await tx.select({
          id: forumThreads.id, categoryId: forumThreads.categoryId,
        }).from(forumThreads)
          .where(eq(forumThreads.id, data.threadId)).for("update");
        if (!thread) throw new Error("THREAD_NOT_FOUND");
        const [control] = await tx.select({ locked: forumThreadControls.isLocked })
          .from(forumThreadControls)
          .where(eq(forumThreadControls.threadId, data.threadId)).limit(1);
        if (control?.locked === true) throw new Error("THREAD_LOCKED");
        const [reply] = await tx.insert(forumReplies)
          .values({ ...data, authorId }).returning();
        await tx.update(forumThreads).set({
          replyCount: sql`${forumThreads.replyCount} + 1`,
          lastActivityAt: new Date(),
        }).where(eq(forumThreads.id, data.threadId));
        await tx.update(forumCategories).set({
          lastActivityAt: new Date(),
        }).where(eq(forumCategories.id, thread.categoryId));
        return reply;
      });
    }
    // Existing storage path remains unchanged when bulletin is disabled.
    const [reply] = await db.insert(forumReplies).values({ ...data, authorId }).returning();
    await db.update(forumThreads).set({
      replyCount: sql`${forumThreads.replyCount} + 1`, lastActivityAt: new Date(),
    }).where(eq(forumThreads.id, data.threadId));
    const [thread] = await db.select({ categoryId: forumThreads.categoryId }).from(forumThreads).where(eq(forumThreads.id, data.threadId));
    if (thread) {
      await db.update(forumCategories).set({ lastActivityAt: new Date() }).where(eq(forumCategories.id, thread.categoryId));
    }
    return reply;
  }

    async toggleForumVote(userId: string, entityType: string, entityId: number): Promise<{ voted: boolean; count: number; recipientId?: string }> {
    const [existing] = await db.select().from(forumVotes).where(
      and(eq(forumVotes.userId, userId), eq(forumVotes.entityType, entityType), eq(forumVotes.entityId, entityId))
    );
    if (existing) {
      await db.delete(forumVotes).where(eq(forumVotes.id, existing.id));
      if (entityType === 'thread') {
        await db.update(forumThreads).set({ upvotesCount: sql`${forumThreads.upvotesCount} - 1` }).where(eq(forumThreads.id, entityId));
        const [t] = await db.select({ upvotesCount: forumThreads.upvotesCount, authorId: forumThreads.authorId }).from(forumThreads).where(eq(forumThreads.id, entityId));
        return { voted: false, count: t?.upvotesCount ?? 0, recipientId: t?.authorId };
      } else {
        await db.update(forumReplies).set({ upvotesCount: sql`${forumReplies.upvotesCount} - 1` }).where(eq(forumReplies.id, entityId));
        const [r] = await db.select({ upvotesCount: forumReplies.upvotesCount, authorId: forumReplies.authorId }).from(forumReplies).where(eq(forumReplies.id, entityId));
        return { voted: false, count: r?.upvotesCount ?? 0, recipientId: r?.authorId };
      }
    } else {
      await db.insert(forumVotes).values({ userId, entityType, entityId });
      if (entityType === 'thread') {
        await db.update(forumThreads).set({ upvotesCount: sql`${forumThreads.upvotesCount} + 1` }).where(eq(forumThreads.id, entityId));
        const [t] = await db.select({ upvotesCount: forumThreads.upvotesCount, authorId: forumThreads.authorId }).from(forumThreads).where(eq(forumThreads.id, entityId));
        return { voted: true, count: t?.upvotesCount ?? 1, recipientId: t?.authorId };
      } else {
        await db.update(forumReplies).set({ upvotesCount: sql`${forumReplies.upvotesCount} + 1` }).where(eq(forumReplies.id, entityId));
        const [r] = await db.select({ upvotesCount: forumReplies.upvotesCount, authorId: forumReplies.authorId }).from(forumReplies).where(eq(forumReplies.id, entityId));
        return { voted: true, count: r?.upvotesCount ?? 1, recipientId: r?.authorId };
      }
    }
  }

  async getUserForumVotes(userId: string, entityType: string, entityIds: number[]): Promise<number[]> {
    if (!entityIds.length) return [];
    const votes = await db.select({ entityId: forumVotes.entityId }).from(forumVotes).where(
      and(eq(forumVotes.userId, userId), eq(forumVotes.entityType, entityType), inArray(forumVotes.entityId, entityIds))
    );
    return votes.map(v => v.entityId);
  }

  async markAcceptedAnswer(threadId: number, replyId: number, requestingUserId: string): Promise<{ replyAuthorId: string; wasAlreadyAccepted: boolean }> {
    const [thread] = await db.select().from(forumThreads).where(eq(forumThreads.id, threadId));
    if (!thread || thread.authorId !== requestingUserId) throw new Error("Not authorized");
    // Verify the reply belongs to this thread
    const [reply] = await db.select().from(forumReplies).where(
      and(eq(forumReplies.id, replyId), eq(forumReplies.threadId, threadId))
    );
    if (!reply) throw new Error("Reply not found in this thread");
    const wasAlreadyAccepted = reply.isAcceptedAnswer;
    // Clear existing accepted answer on this thread
    await db.update(forumReplies).set({ isAcceptedAnswer: false }).where(eq(forumReplies.threadId, threadId));
    // Set new accepted answer
    await db.update(forumReplies).set({ isAcceptedAnswer: true }).where(eq(forumReplies.id, replyId));
    // Mark thread as solved
    await db.update(forumThreads).set({ isSolved: true }).where(eq(forumThreads.id, threadId));
    return { replyAuthorId: reply.authorId, wasAlreadyAccepted };
  }

  // === PUBLIC STATS ===

  async getPublicStats(): Promise<{ memberCount: number; threadCount: number; replyCount: number }> {
    const [memberRow] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const [threadRow] = await db.select({ count: sql<number>`count(*)::int` }).from(forumThreads);
    const [replyRow] = await db.select({ count: sql<number>`count(*)::int` }).from(forumReplies);
    return {
      memberCount: memberRow?.count ?? 0,
      threadCount: threadRow?.count ?? 0,
      replyCount: replyRow?.count ?? 0,
    };
  }

  async getPublicRecentActivity(limit = 10): Promise<{ id: number; title: string; categorySlug: string; createdAt: Date | null }[]> {
    const threads = await db
      .select({
        id: forumThreads.id,
        title: forumThreads.title,
        categorySlug: forumCategories.slug,
        createdAt: forumThreads.createdAt,
      })
      .from(forumThreads)
      .innerJoin(forumCategories, eq(forumThreads.categoryId, forumCategories.id))
      .orderBy(desc(forumThreads.createdAt))
      .limit(limit);
    return threads;
  }

  // === VENUES ===

  async listVenues(): Promise<Venue[]> {
    return db.select().from(venues).orderBy(venues.name);
  }

  async getVenue(id: number): Promise<Venue | undefined> {
    const [venue] = await db.select().from(venues).where(eq(venues.id, id));
    return venue;
  }

  async createVenue(data: InsertVenue): Promise<Venue> {
    const [venue] = await db.insert(venues).values(data).returning();
    return venue;
  }

  async updateVenue(id: number, data: Partial<InsertVenue>): Promise<Venue | undefined> {
    const [updated] = await db.update(venues).set(data).where(eq(venues.id, id)).returning();
    return updated;
  }

  async deleteVenue(id: number): Promise<void> {
    await db.delete(venues).where(eq(venues.id, id));
  }

  async seedVenuesAndEvents(): Promise<void> {
    const existingVenues = await db.select().from(venues).limit(1);
    if (existingVenues.length > 0) return;

    const venueData = [
      {
        name: "Accessible Arts NSW",
        address: "93 Norton St",
        suburb: "Leichhardt",
        state: "NSW",
        postcode: "2040",
        isOnline: false,
        lat: "-33.8826",
        lng: "151.1577",
        phone: "(02) 9550 2900",
        website: "https://aarts.net.au",
        accessibilityFeatures: ["ramp", "accessible_bathroom", "lift", "hearing_loop", "auslan"],
      },
      {
        name: "Disability Resource Centre Melbourne",
        address: "141 Capel St",
        suburb: "North Melbourne",
        state: "VIC",
        postcode: "3051",
        isOnline: false,
        lat: "-37.7979",
        lng: "144.9530",
        phone: "(03) 9326 1006",
        website: "https://drc.org.au",
        accessibilityFeatures: ["ramp", "accessible_bathroom", "quiet_room", "hearing_loop"],
      },
      {
        name: "Brisbane Disability Support Hub",
        address: "66 Ann St",
        suburb: "Brisbane City",
        state: "QLD",
        postcode: "4000",
        isOnline: false,
        lat: "-27.4698",
        lng: "153.0251",
        phone: "(07) 3831 8811",
        website: "https://disability.qld.gov.au",
        accessibilityFeatures: ["ramp", "lift", "accessible_bathroom", "braille"],
      },
      {
        name: "Online Community Hub",
        address: "Virtual",
        suburb: "Online",
        state: "National",
        postcode: "0000",
        isOnline: true,
        accessibilityFeatures: ["auslan", "hearing_loop"],
      },
      {
        name: "Perth Inclusion Centre",
        address: "190 St Georges Tce",
        suburb: "Perth",
        state: "WA",
        postcode: "6000",
        isOnline: false,
        lat: "-31.9534",
        lng: "115.8585",
        accessibilityFeatures: ["ramp", "accessible_bathroom", "quiet_room"],
      },
    ];

    const insertedVenues = await db.insert(venues).values(venueData).returning();

    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const threeWeeks = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000);

    const eventData = [
      {
        title: "Inclusive Art Workshop — Painting for All",
        description: "A relaxed, accessible art session welcoming people of all abilities. No experience needed. Materials provided. Quiet room available.",
        venueId: insertedVenues[0].id,
        startTime: nextWeek,
        endTime: new Date(nextWeek.getTime() + 2 * 60 * 60 * 1000),
        category: "art",
        tags: ["art", "inclusive", "creative", "beginner"],
        accessibilityNotes: "Fully wheelchair accessible. Auslan interpreter available on request.",
        maxAttendees: 20,
        isOnline: false,
      },
      {
        title: "NDIS Navigation Workshop",
        description: "Learn how to get the most from your NDIS plan. Guest speaker from the NDIA. Light refreshments provided. Carer/support worker welcome.",
        venueId: insertedVenues[1].id,
        startTime: twoWeeks,
        endTime: new Date(twoWeeks.getTime() + 3 * 60 * 60 * 1000),
        category: "education",
        tags: ["ndis", "funding", "planning"],
        accessibilityNotes: "Hearing loop installed. Auslan available. Parking nearby with accessible bays.",
        maxAttendees: 40,
        isOnline: false,
      },
      {
        title: "Online Peer Support Circle — Chronic Illness",
        description: "A safe, moderated peer support group for people living with chronic illness. Share, listen, and connect from the comfort of your home.",
        venueId: insertedVenues[3].id,
        startTime: nextWeek,
        endTime: new Date(nextWeek.getTime() + 90 * 60 * 1000),
        category: "support_group",
        tags: ["chronic_illness", "peer_support", "online", "mental_health"],
        accessibilityNotes: "Zoom captions available. Low-bandwidth friendly.",
        maxAttendees: 15,
        isOnline: true,
        meetingLink: "https://zoom.us/j/example",
      },
      {
        title: "Adaptive Sport Day — Bocce & Wheelchair Basketball",
        description: "Come try bocce and modified wheelchair basketball in a fun, non-competitive environment. Equipment and coaching provided.",
        venueId: insertedVenues[2].id,
        startTime: threeWeeks,
        endTime: new Date(threeWeeks.getTime() + 4 * 60 * 60 * 1000),
        category: "sport",
        tags: ["sport", "adaptive", "wheelchair", "social"],
        accessibilityNotes: "Full accessible facilities. Transport assistance available — contact organiser.",
        maxAttendees: 30,
        isOnline: false,
      },
      {
        title: "Social Morning Tea — Connect & Chat",
        description: "A relaxed morning tea for people with disability and their carers to meet neighbours and make connections. Hosted by Perth Inclusion Centre.",
        venueId: insertedVenues[4].id,
        startTime: nextWeek,
        endTime: new Date(nextWeek.getTime() + 2 * 60 * 60 * 1000),
        category: "social",
        tags: ["social", "community", "connection"],
        accessibilityNotes: "Quiet room available. Sensory-friendly environment.",
        maxAttendees: 25,
        isOnline: false,
      },
    ];

    await db.insert(events).values(eventData);
  }

  // === EVENTS ===

  async listEvents(filters?: { groupId?: number; upcoming?: boolean }): Promise<(Event & { venue: Venue | null; attendeeCount: number })[]> {
    const conditions: any[] = [];
    if (filters?.groupId) conditions.push(eq(events.groupId, filters.groupId));
    if (filters?.upcoming) conditions.push(gte(events.startTime, new Date()));

    const eventsData = await db.select().from(events)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(events.startTime);

    const result = await Promise.all(eventsData.map(async (event) => {
      const venue = event.venueId ? await this.getVenue(event.venueId) : null;
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(eventAttendees)
        .where(and(eq(eventAttendees.eventId, event.id), eq(eventAttendees.status, "going")));
      return { ...event, venue: venue ?? null, attendeeCount: count };
    }));

    return result;
  }

  async getEvent(id: number): Promise<(Event & { venue: Venue | null; attendees: EventAttendee[] }) | undefined> {
    const [event] = await db.select().from(events).where(eq(events.id, id));
    if (!event) return undefined;
    const venue = event.venueId ? await this.getVenue(event.venueId) : null;
    const attendeesList = await db.select().from(eventAttendees).where(eq(eventAttendees.eventId, id));
    return { ...event, venue: venue ?? null, attendees: attendeesList };
  }

  async createEvent(data: InsertEvent): Promise<Event> {
    const [event] = await db.insert(events).values(data).returning();
    return event;
  }

  async updateEvent(id: number, data: Partial<InsertEvent>): Promise<Event | undefined> {
    const [updated] = await db.update(events).set(data).where(eq(events.id, id)).returning();
    return updated;
  }

  async deleteEvent(id: number): Promise<void> {
    await db.delete(eventAttendees).where(eq(eventAttendees.eventId, id));
    await db.delete(events).where(eq(events.id, id));
  }

  async rsvpEvent(eventId: number, userId: string, status: string): Promise<EventAttendee> {
    const [attendee] = await db
      .insert(eventAttendees)
      .values({ eventId, userId, status })
      .onConflictDoUpdate({
        target: [eventAttendees.eventId, eventAttendees.userId],
        set: { status },
      })
      .returning();
    return attendee;
  }

  async getUserEventRsvps(userId: string): Promise<EventAttendee[]> {
    return db.select().from(eventAttendees).where(eq(eventAttendees.userId, userId));
  }

  // === USER CONNECTIONS ===

  async followUser(followerId: string, followingId: string): Promise<UserConnection> {
    const [conn] = await db
      .insert(userConnections)
      .values({ followerId, followingId })
      .onConflictDoNothing()
      .returning();
    if (!conn) {
      const [existing] = await db.select().from(userConnections)
        .where(and(eq(userConnections.followerId, followerId), eq(userConnections.followingId, followingId)));
      return existing;
    }
    return conn;
  }

  async unfollowUser(followerId: string, followingId: string): Promise<void> {
    await db.delete(userConnections)
      .where(and(eq(userConnections.followerId, followerId), eq(userConnections.followingId, followingId)));
  }

  async isFollowing(followerId: string, followingId: string): Promise<boolean> {
    const [conn] = await db.select().from(userConnections)
      .where(and(eq(userConnections.followerId, followerId), eq(userConnections.followingId, followingId)));
    return !!conn;
  }

  async getFollowing(userId: string): Promise<UserConnection[]> {
    return db.select().from(userConnections).where(eq(userConnections.followerId, userId));
  }

  async getFollowers(userId: string): Promise<UserConnection[]> {
    return db.select().from(userConnections).where(eq(userConnections.followingId, userId));
  }

  // === USER SERVICE AFFINITIES ===

  async saveServiceAffinity(data: InsertUserServiceAffinity): Promise<UserServiceAffinity> {
    const [affinity] = await db
      .insert(userServiceAffinities)
      .values(data)
      .onConflictDoUpdate({
        target: [userServiceAffinities.userId, userServiceAffinities.serviceProviderId],
        set: { rating: data.rating, notes: data.notes },
      })
      .returning();
    return affinity;
  }

  async getUserServiceAffinities(userId: string): Promise<(UserServiceAffinity & { serviceProvider: ServiceProvider })[]> {
    const affinities = await db.query.userServiceAffinities.findMany({
      where: eq(userServiceAffinities.userId, userId),
      with: { serviceProvider: true },
    });
    return affinities as unknown as (UserServiceAffinity & { serviceProvider: ServiceProvider })[];
  }

  async removeServiceAffinity(userId: string, serviceProviderId: number): Promise<void> {
    await db.delete(userServiceAffinities)
      .where(and(eq(userServiceAffinities.userId, userId), eq(userServiceAffinities.serviceProviderId, serviceProviderId)));
  }

  // === PARTICIPATION JOURNEYS ===

  async createParticipationJourney(data: InsertParticipationJourney): Promise<ParticipationJourney> {
    const [journey] = await db.insert(participationJourneys).values(data).returning();
    return journey;
  }

  async getUserJourneys(userId: string): Promise<(ParticipationJourney & { event: Event; serviceProvider: ServiceProvider | null; transportProvider: TransportProvider | null })[]> {
    type JourneyWithRelations = ParticipationJourney & {
      event: Event;
      serviceProvider: ServiceProvider | null;
      transportProvider: TransportProvider | null;
    };
    const journeys = await db.query.participationJourneys.findMany({
      where: eq(participationJourneys.userId, userId),
      with: {
        event: true,
        serviceProvider: true,
        transportProvider: true,
      },
      orderBy: [desc(participationJourneys.createdAt)],
    });
    return journeys as unknown as JourneyWithRelations[];
  }

  async getJourney(id: number): Promise<ParticipationJourney | undefined> {
    const [journey] = await db.select().from(participationJourneys).where(eq(participationJourneys.id, id));
    return journey;
  }

  async updateJourneyStatus(id: number, status: string): Promise<ParticipationJourney> {
    const [updated] = await db.update(participationJourneys)
      .set({ status, updatedAt: new Date() })
      .where(eq(participationJourneys.id, id))
      .returning();
    return updated;
  }

  // === GRAPH RECOMMENDATIONS ===

  async getSuggestedConnections(userId: string, limit = 10): Promise<(User & { profile: Profile | null; sharedGroupCount: number })[]> {
    // Get user's groups
    const myMemberships = await db.select({ groupId: groupMembers.groupId })
      .from(groupMembers).where(eq(groupMembers.userId, userId));
    const myGroupIds = myMemberships.map(m => m.groupId);

    // Get users I already follow
    const following = await this.getFollowing(userId);
    const followingIds = new Set(following.map(f => f.followingId));
    followingIds.add(userId); // exclude self

    // Find other members in same groups
    let candidateUserIds: string[] = [];
    if (myGroupIds.length > 0) {
      const membersInMyGroups = await db.select({ userId: groupMembers.userId })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, myGroupIds), ne(groupMembers.userId, userId)));
      candidateUserIds = membersInMyGroups.map(m => m.userId);
    }

    if (candidateUserIds.length === 0) {
      // Fall back to peer matching
      const peers = await this.getPeerMatches(userId, limit);
      return peers.map(u => ({ ...u, sharedGroupCount: 0 }));
    }

    // Count shared groups per candidate
    const sharedGroupCounts: Record<string, number> = {};
    for (const uid of candidateUserIds) {
      if (followingIds.has(uid)) continue;
      sharedGroupCounts[uid] = (sharedGroupCounts[uid] || 0) + 1;
    }

    const uniqueCandidateIds = Object.keys(sharedGroupCounts).slice(0, 50);
    if (uniqueCandidateIds.length === 0) return [];

    const candidateUsers = await db.query.users.findMany({
      where: inArray(users.id, uniqueCandidateIds),
      with: { profile: true },
    });

    const myProfile = await this.getProfile(userId);
    const myInterests: string[] = (myProfile?.interests as string[]) || [];
    const myDiagnosis = myProfile?.diagnosis?.toLowerCase() || "";

    type CandidateUser = User & { profile: Profile | null };
    const scored = (candidateUsers as CandidateUser[]).map((u) => {
      const profile = u.profile;
      let score = (sharedGroupCounts[u.id] || 0) * 2;
      if (profile?.diagnosis && myDiagnosis && profile.diagnosis.toLowerCase().includes(myDiagnosis)) score += 3;
      const theirInterests: string[] = (profile?.interests as string[]) || [];
      score += theirInterests.filter((i) => myInterests.includes(i)).length;
      return { ...u, _score: score, sharedGroupCount: sharedGroupCounts[u.id] || 0 };
    });

    type ScoredCandidate = CandidateUser & { _score: number; sharedGroupCount: number };
    return (scored as ScoredCandidate[])
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...u }) => u as User & { profile: Profile | null; sharedGroupCount: number });
  }

  async getMatchedServices(userId: string, limit = 8): Promise<ServiceProvider[]> {
    const myProfile = await this.getProfile(userId);
    const myDiagnosis = myProfile?.diagnosis?.toLowerCase() || "";
    const myLocation = myProfile?.location || "";
    const myInterests: string[] = (myProfile?.interests as string[]) || [];

    const allProviders = await db.select().from(serviceProviders)
      .where(eq(serviceProviders.approved, true))
      .orderBy(serviceProviders.name);

    type ScoredProvider = typeof allProviders[0] & { _score: number };
    const scored: ScoredProvider[] = allProviders.map((p) => {
      let score = 0;
      const disabilityTypes = (p.disabilityTypes as string[]) || [];
      const categories = (p.category || "").toLowerCase();

      // Diagnosis match against provider disability types
      if (myDiagnosis && disabilityTypes.some((d) =>
        d.toLowerCase().includes(myDiagnosis) || myDiagnosis.includes(d.toLowerCase())
      )) {
        score += 5;
      }

      // Location match (state or suburb)
      if (myLocation && (
        p.state === myLocation ||
        p.location.toLowerCase().includes(myLocation.toLowerCase())
      )) {
        score += 3;
      }

      // Interest overlap with provider category or disability types
      if (myInterests.length > 0) {
        const interestMatch = myInterests.some((interest) =>
          categories.includes(interest.toLowerCase()) ||
          disabilityTypes.some((d) => d.toLowerCase().includes(interest.toLowerCase()))
        );
        if (interestMatch) score += 2;
      }

      if (p.ndisRegistered) score += 1;
      return { ...p, _score: score };
    });

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...p }) => p);
  }

  async getMatchedEvents(userId: string, limit = 8): Promise<(Event & { venue: Venue | null; attendeeCount: number })[]> {
    const myProfile = await this.getProfile(userId);
    const myInterests: string[] = (myProfile?.interests as string[]) || [];

    const myMemberships = await db.select({ groupId: groupMembers.groupId })
      .from(groupMembers).where(eq(groupMembers.userId, userId));
    const myGroupIds = myMemberships.map(m => m.groupId);

    const upcomingEvents = await this.listEvents({ upcoming: true });

    const scored = upcomingEvents.map((e) => {
      let score = 0;
      const tags = (e.tags as string[]) || [];
      score += tags.filter(t => myInterests.some(i => i.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(i.toLowerCase()))).length * 2;
      if (e.groupId && myGroupIds.includes(e.groupId)) score += 4;
      return { ...e, _score: score };
    });

    return scored
      .sort((a, b) => b._score - a._score)
      .slice(0, limit)
      .map(({ _score, ...e }) => e);
  }

  async getJourneyOptions(userId: string, eventId: number): Promise<{
    event: Event | undefined;
    venue: Venue | undefined;
    serviceProviders: ServiceProvider[];
    transportProviders: (TransportProvider & { compatibleVehicleCount: number })[];
    accessibilityWarnings: string[];
  }> {
    const event = await this.getEvent(eventId);
    const venue = event?.venueId ? await this.getVenue(event.venueId) : undefined;

    // Use profile.accessNeeds (not user table — access needs are on the profile)
    const profile = await this.getProfile(userId);
    const userNeeds: string[] = (profile?.accessNeeds as string[]) || [];

    // Map user access needs to venue accessibility feature keys
    const needToVenueFeatureMap: Record<string, string> = {
      wheelchair: "ramp",
      hearing: "hearing_loop",
      vision: "braille",
      auslan: "auslan",
      quiet: "quiet_room",
      lift: "lift",
      accessible_bathroom: "accessible_bathroom",
    };

    const accessibilityWarnings: string[] = [];
    if (venue && !venue.isOnline && userNeeds.length > 0) {
      const venueFeatures = (venue.accessibilityFeatures as string[]) || [];
      for (const need of userNeeds) {
        const requiredFeature = needToVenueFeatureMap[need];
        if (requiredFeature && !venueFeatures.includes(requiredFeature)) {
          accessibilityWarnings.push(
            `Venue may not fully support your '${need}' access need — '${requiredFeature}' not listed in venue features.`
          );
        }
      }
    }

    const matchedServices = await this.getMatchedServices(userId, 5);

    // Get all transport providers with vehicle accessibility data
    // Filter vehicles that match user's access needs, return provider + compatible vehicle count
    const allProviders = await this.listTransportProviders();
    const transportProviders: (TransportProvider & { compatibleVehicleCount: number })[] = [];

    for (const provider of allProviders) {
      // Load vehicles for this provider and check accessibility features
      const vehicles = await db
        .select()
        .from(transportVehicles)
        .where(eq(transportVehicles.providerId, provider.id));

      let compatibleVehicleCount = 0;
      if (userNeeds.length === 0) {
        // No specific needs — all vehicles are compatible
        compatibleVehicleCount = vehicles.filter((v) => v.available).length;
      } else {
        // Need to vehicle feature map (wheelchair = 'wheelchair_van', hearing_loop = vehicle accessibility_features entry)
        const vehicleNeedToFeatureMap: Record<string, string[]> = {
          wheelchair: ["wheelchair_ramp", "wheelchair_lift"],
          hearing: ["hearing_loop"],
          vision: ["audio_announcements"],
          auslan: [],
          quiet: [],
          lift: ["wheelchair_lift"],
          accessible_bathroom: [],
        };
        for (const vehicle of vehicles) {
          if (!vehicle.available) continue;
          const vFeatures = (vehicle.accessibilityFeatures as string[]) || [];
          const vehicleType = vehicle.vehicleType || "";
          const meetsNeeds = userNeeds.every((need) => {
            // wheelchair users need wheelchair_van OR a vehicle with ramp/lift features
            if (need === "wheelchair") {
              return vehicleType === "wheelchair_van" ||
                vFeatures.some((f) => ["wheelchair_ramp", "wheelchair_lift"].includes(f));
            }
            const requiredFeatures = vehicleNeedToFeatureMap[need] || [];
            return requiredFeatures.length === 0 || requiredFeatures.some((f) => vFeatures.includes(f));
          });
          if (meetsNeeds) compatibleVehicleCount++;
        }
      }

      transportProviders.push({ ...provider, compatibleVehicleCount });
    }

    // Sort providers: those with compatible vehicles first
    transportProviders.sort((a, b) => b.compatibleVehicleCount - a.compatibleVehicleCount);

    return { event, venue, serviceProviders: matchedServices, transportProviders, accessibilityWarnings };
  }

  // === BLOGS & PERSONAL STORIES ===

  async listBlogPosts(filters?: { tag?: string; status?: string; authorId?: string }): Promise<(BlogPost & { author: User; reactionCounts: Record<string, number> })[]> {
    const conditions = [];
    if (filters?.authorId) {
      conditions.push(eq(blogPosts.authorId, filters.authorId));
    } else {
      conditions.push(eq(blogPosts.status, filters?.status || "published"));
    }
    const result = await db.query.blogPosts.findMany({
      where: conditions.length === 1 ? conditions[0] : and(...conditions),
      orderBy: [desc(blogPosts.publishedAt), desc(blogPosts.createdAt)],
      with: { author: true },
    });
    let filtered = result;
    if (filters?.tag) {
      filtered = result.filter(p => (p.tags as string[])?.includes(filters.tag!));
    }
    // Fetch reaction counts for all posts in a single query
    const postIds = filtered.map(p => p.id);
    let reactionMap: Record<number, Record<string, number>> = {};
    if (postIds.length > 0) {
      const allReactions = await db.select().from(blogPostReactions).where(inArray(blogPostReactions.blogPostId, postIds));
      for (const r of allReactions) {
        if (!reactionMap[r.blogPostId]) reactionMap[r.blogPostId] = {};
        reactionMap[r.blogPostId][r.reactionType] = (reactionMap[r.blogPostId][r.reactionType] || 0) + 1;
      }
    }
    return filtered.map(p => ({ ...p, reactionCounts: reactionMap[p.id] || {} }));
  }

  async getBlogPost(slug: string): Promise<(BlogPost & { author: User; comments: (BlogComment & { author: User })[]; reactionCounts: Record<string, number> }) | undefined> {
    const post = await db.query.blogPosts.findFirst({
      where: eq(blogPosts.slug, slug),
      with: {
        author: true,
        comments: {
          with: { author: true },
          orderBy: [desc(blogComments.createdAt)],
        },
      },
    });
    if (!post) return undefined;
    const reactionCounts = await this.getBlogReactionCounts(post.id);
    return { ...post, reactionCounts };
  }

  async getBlogPostById(id: number): Promise<BlogPost | undefined> {
    const [post] = await db.select().from(blogPosts).where(eq(blogPosts.id, id));
    return post;
  }

  async createBlogPost(data: InsertBlogPost & { authorId: string }): Promise<BlogPost> {
    const [post] = await db.insert(blogPosts).values({
      ...data,
      updatedAt: new Date(),
    }).returning();
    return post;
  }

  async updateBlogPost(id: number, authorId: string, data: Partial<InsertBlogPost>): Promise<BlogPost | undefined> {
    const existing = await this.getBlogPostById(id);
    if (!existing || existing.authorId !== authorId) return undefined;
    const [updated] = await db.update(blogPosts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(blogPosts.id, id))
      .returning();
    return updated;
  }

  async deleteBlogPost(id: number, authorId: string): Promise<{ deleted: boolean; reason?: string }> {
    const existing = await this.getBlogPostById(id);
    if (!existing) return { deleted: false, reason: "not_found" };
    if (existing.authorId !== authorId) return { deleted: false, reason: "forbidden" };
    await db.delete(blogPosts).where(eq(blogPosts.id, id));
    return { deleted: true };
  }

  async publishBlogPost(id: number, authorId: string): Promise<BlogPost | undefined> {
    const existing = await this.getBlogPostById(id);
    if (!existing || existing.authorId !== authorId) return undefined;
    const [updated] = await db.update(blogPosts)
      .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
      .where(eq(blogPosts.id, id))
      .returning();
    return updated;
  }

  async unpublishBlogPost(id: number, authorId: string): Promise<BlogPost | undefined> {
    const existing = await this.getBlogPostById(id);
    if (!existing || existing.authorId !== authorId) return undefined;
    const [updated] = await db.update(blogPosts)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(blogPosts.id, id))
      .returning();
    return updated;
  }

  async addBlogComment(data: { blogPostId: number; authorId: string; content: string }): Promise<BlogComment> {
    const [comment] = await db.insert(blogComments).values(data).returning();
    return comment;
  }

  async addBlogReaction(blogPostId: number, userId: string, reactionType: string): Promise<BlogPostReaction> {
    const existing = await this.getUserBlogReaction(blogPostId, userId);
    if (existing) {
      const [updated] = await db.update(blogPostReactions)
        .set({ reactionType })
        .where(and(eq(blogPostReactions.blogPostId, blogPostId), eq(blogPostReactions.userId, userId)))
        .returning();
      return updated;
    }
    const [reaction] = await db.insert(blogPostReactions).values({ blogPostId, userId, reactionType }).returning();
    return reaction;
  }

  async removeBlogReaction(blogPostId: number, userId: string): Promise<void> {
    await db.delete(blogPostReactions).where(
      and(eq(blogPostReactions.blogPostId, blogPostId), eq(blogPostReactions.userId, userId))
    );
  }

  async getBlogReactionCounts(blogPostId: number): Promise<Record<string, number>> {
    const reactions = await db.select().from(blogPostReactions).where(eq(blogPostReactions.blogPostId, blogPostId));
    const counts: Record<string, number> = {};
    for (const r of reactions) {
      counts[r.reactionType] = (counts[r.reactionType] || 0) + 1;
    }
    return counts;
  }

  async getUserBlogReaction(blogPostId: number, userId: string): Promise<BlogPostReaction | undefined> {
    const [reaction] = await db.select().from(blogPostReactions).where(
      and(eq(blogPostReactions.blogPostId, blogPostId), eq(blogPostReactions.userId, userId))
    );
    return reaction;
  }

  async getUserDraftBlogPosts(authorId: string): Promise<BlogPost[]> {
    return await db.select().from(blogPosts)
      .where(and(eq(blogPosts.authorId, authorId), eq(blogPosts.status, "draft")))
      .orderBy(desc(blogPosts.updatedAt));
  }

}

export const storage = new DatabaseStorage();
