import {
  users,
  agents,
  conversations,
  messages,
  documents,
  agentStats,
  messageReactions,
  qaImprovementComments,
  groupChats,
  groupChatMembers,
  groupChatAgents,
  groupChatUserAgentSettings,
  groupChatMessages,
  relationshipTones,
  scenarioSummaries,
  characterSpeakingPatterns,
  phraseUsageHistory,
  unifiedChats,
  chatParticipants,
  chatMessages,
  recommendedCharacters,
  conversationAnalytics,
  cardFolders,
  cardItems,
  userCardViews,
  boards,
  boardPosts,
  tokenUsage,
  agentCanon,
  agentHumor,
  ragEntities,
  ragEdges,
  ragMemories,
  canonProfiles,
  toneProfiles,
  trendingTopics,
  messageReferences,
  followUpQuestions,
  characterAvatars,
  type User,
  type UpsertUser,
  type Agent,
  type InsertAgent,
  type Conversation,
  type InsertConversation,
  type Message,
  type InsertMessage,
  type Document,
  type InsertDocument,
  type AgentStats,
  type MessageReaction,
  type InsertMessageReaction,
  type OrganizationCategory,
  type InsertOrganizationCategory,
  type QAImprovementComment,
  type InsertQAImprovementComment,
  type UnifiedChat,
  type InsertUnifiedChat,
  type ChatParticipant,
  type InsertChatParticipant,
  type ChatMessage,
  type InsertChatMessage,
  type RecommendedCharacter,
  type InsertRecommendedCharacter,
  type GroupChatUserAgentSettings,
  type InsertGroupChatUserAgentSettings,
  type RelationshipTone,
  type InsertRelationshipTone,
  type CharacterSpeakingPattern,
  type InsertCharacterSpeakingPattern,
  type PhraseUsageHistory,
  type InsertPhraseUsageHistory,
  type ConversationAnalytics,
  type InsertConversationAnalytics,
  type CardFolder,
  type InsertCardFolder,
  type CardItem,
  type InsertCardItem,
  type UserCardView,
  type InsertUserCardView,
  type Board,
  type InsertBoard,
  type BoardPost,
  type InsertBoardPost,
  type TokenUsage,
  type InsertTokenUsage,
  type AgentCanon,
  type InsertAgentCanon,
  type AgentHumor,
  type InsertAgentHumor,
  type RagEntity,
  type InsertRagEntity,
  type RagEdge,
  type InsertRagEdge,
  type RagMemory,
  type InsertRagMemory,
  type CanonProfile,
  type InsertCanonProfile,
  type ToneProfile,
  type InsertToneProfile,
  type TrendingTopic,
  type InsertTrendingTopic,
  type MessageReference,
  type InsertMessageReference,
  type FollowUpQuestion,
  type InsertFollowUpQuestion,
  type CharacterAvatar,
  type InsertCharacterAvatar,
  insertGroupChatSchema,
  insertCharacterAvatarSchema,
  insertGroupChatMemberSchema,
  insertGroupChatAgentSchema,
  insertGroupChatUserAgentSettingsSchema,
  insertGroupChatMessageSchema,
  insertUnifiedChatSchema,
  insertChatParticipantSchema,
  insertChatMessageSchema,
  insertRecommendedCharacterSchema,
  insertConversationAnalyticsSchema,
  insertCardFolderSchema,
  insertCardItemSchema,
  insertTokenUsageSchema,
} from "@shared/schema";
import { db } from "./db";
import { organizationCategories } from "@shared/schema";
import { eq, desc, and, sql, inArray, isNotNull, ilike } from "drizzle-orm";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { MemoryStorage } from "./memory-storage";
// import { relationshipMatrixCache } from "./cache"; // DB 저장으로 대체

// Interface for storage operations
export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: UpsertUser): Promise<User>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: any): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: string): Promise<void>;

  // Agent operations
  getAllAgents(): Promise<Agent[]>;
  getAgent(id: number): Promise<Agent | undefined>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  updateAgent(id: number, updates: any): Promise<Agent>;
  deleteAgent(id: number): Promise<boolean>;
  getAgentsByManager(managerId: string): Promise<Agent[]>;
  getUserCreatedAndManagedAgents(userId: string): Promise<Agent[]>; // creatorId 또는 managerId가 userId인 에이전트
  getAgentGroupChats(agentId: number, userId: string): Promise<{ id: number; title: string | null; lastMessageAt: Date | null }[]>; // 에이전트가 참여 중인 그룹 채팅 목록

  // Conversation operations
  getOrCreateConversation(userId: string, agentId: number, type?: string): Promise<Conversation>;
  getUserConversations(userId: string): Promise<(Conversation & { agent: Agent; lastMessage?: Message })[]>;
  getAllUserConversations(userId: string): Promise<(Conversation & { agent: Agent; lastMessage?: Message })[]>;
  getAllConversations(): Promise<Conversation[]>;
  getConversation(id: number): Promise<Conversation | undefined>;
  updateConversation(conversationId: number, updates: Partial<Conversation>): Promise<void>;
  deleteConversationWithMessages(userId: string, agentId: number): Promise<void>;

  // Message operations
  getConversationMessages(conversationId: number): Promise<Message[]>;
  getAllMessages(): Promise<Message[]>;
  createMessage(message: InsertMessage): Promise<Message>;
  markConversationAsRead(conversationId: number): Promise<void>;
  deleteConversationMessages(conversationId: number): Promise<void>;
  hideConversation(conversationId: number): Promise<void>;
  unhideConversation(conversationId: number): Promise<void>;

  // Document operations
  createDocument(document: InsertDocument): Promise<Document>;
  getAgentDocuments(agentId: number): Promise<Document[]>;
  getAgentDocumentsForUser(agentId: number, userId: string): Promise<Document[]>;
  getAllDocuments(): Promise<Document[]>;
  getDocument(id: number): Promise<Document | undefined>;
  updateDocument(id: number, updates: any): Promise<Document | undefined>;
  //delete document operations
  deleteDocument(id: number): Promise<void>;
  updateDocumentContent(id: number, content: string): Promise<Document | null>;
  updateDocumentVisibility(id: number, isVisible: boolean): Promise<Document | undefined>;
  updateDocumentTraining(id: number, isUsedForTraining: boolean): Promise<Document | undefined>;

  // Stats operations
  getAgentStats(agentId: number): Promise<AgentStats | undefined>;
  updateAgentStats(agentId: number, stats: Partial<AgentStats>): Promise<void>;

  // Message reaction operations
  createMessageReaction(reaction: InsertMessageReaction): Promise<MessageReaction>;
  deleteMessageReaction(messageId: number, userId: string): Promise<void>;
  getMessageReactions(messageIds: number[]): Promise<{ [messageId: number]: MessageReaction | undefined }>;

  // Organization category operations
  getOrganizationCategories(): Promise<any[]>;
  createOrganizationCategory(organization: any): Promise<any>;
  updateOrganizationCategory(id: number, organization: any): Promise<any>;
  deleteOrganizationCategory(id: number): Promise<void>;
  bulkCreateOrganizationCategories(organizations: any[]): Promise<any[]>;
  clearAllOrganizationCategories(): Promise<void>;
  deleteRoboUniversityOrganizations(): Promise<{ deletedCount: number }>;
  clearCache?(): void;

  // User status operations
  getUniqueUserStatuses(): string[];

  // Agent file operations
  getAgentFiles(): Promise<any[]>;
  saveAgentFile(fileInfo: any): Promise<void>;
  deleteAgentFile(fileId: string): Promise<void>;

  // User file operations
  getUserFiles(): Promise<any[]>;
  deleteUserFile(fileId: string): Promise<void>;

  // Organization file operations
  getOrganizationFiles(): Promise<any[]>;

  // QA Improvement Comment operations
  createQAImprovementComment(comment: InsertQAImprovementComment): Promise<QAImprovementComment>;
  getQAImprovementComment(conversationId: number): Promise<QAImprovementComment | undefined>;
  updateQAImprovementComment(conversationId: number, comment: string, updatedBy: string): Promise<QAImprovementComment | undefined>;

  // Group Chat operations
  createGroupChat(groupChat: any): Promise<any>;
  getGroupChat(id: number): Promise<any>;
  getUserGroupChats(userId: string): Promise<any[]>;
  getUserGroupChatViews(userId: string): Promise<Array<{ groupChatId: number; firstViewedAt: string }>>;
  getPublicGroupChats(): Promise<any[]>;
  getAllGroupChats(): Promise<any[]>;
  updateGroupChat(id: number, updates: any): Promise<any>;
  deleteGroupChat(id: number): Promise<void>;
  addGroupChatMember(memberData: any): Promise<any>;
  removeGroupChatMember(groupChatId: number, userId: string): Promise<void>;
  getGroupChatMembers(groupChatId: number): Promise<any[]>;
  addGroupChatAgent(agentData: any): Promise<any>;
  removeGroupChatAgent(groupChatId: number, agentId: number): Promise<void>;
  getGroupChatAgents(groupChatId: number): Promise<any[]>;
  
  // Group chat user agent settings operations
  createOrUpdateUserAgentSettings(settingsData: InsertGroupChatUserAgentSettings): Promise<GroupChatUserAgentSettings>;
  getUserAgentSettings(groupChatId: number, userId: string): Promise<GroupChatUserAgentSettings[]>;
  getUserAgentSetting(groupChatId: number, userId: string, agentId: number): Promise<GroupChatUserAgentSettings | undefined>;
  
  // Relationship tones operations
  getRelationshipTone(relationshipType: string, toneName: string): Promise<RelationshipTone | undefined>;
  getRelationshipTonesByType(relationshipType: string): Promise<RelationshipTone[]>;
  createRelationshipTone(toneData: InsertRelationshipTone): Promise<RelationshipTone>;
  
  createGroupChatMessage(messageData: any): Promise<any>;
  getGroupChatMessages(groupChatId: number): Promise<any[]>;
  updateGroupChatMessageSources(messageId: number, sources: any): Promise<void>;
  deleteGroupChatMessages(messageIds: number[]): Promise<void>;
  deleteAllGroupChatMessages(groupChatId: number): Promise<void>;
  markGroupChatAsRead(groupChatId: number, userId: string): Promise<void>;
  
  // Group Chat management operations
  getGroupChatById(id: number): Promise<any>;
  addAgentToGroupChat(groupChatId: number, agentId: number): Promise<void>;
  removeAgentFromGroupChat(groupChatId: number, agentId: number): Promise<void>;
  addMemberToGroupChat(groupChatId: number, userId: string): Promise<void>;

  // Unified Chat System operations
  createUnifiedChat(chatData: InsertUnifiedChat): Promise<UnifiedChat>;
  getUnifiedChat(id: number): Promise<UnifiedChat | undefined>;
  getUserUnifiedChats(userId: string): Promise<(UnifiedChat & { lastMessage?: ChatMessage | null; lastReadAt?: Date | null })[]>;
  updateUnifiedChat(id: number, updates: Partial<UnifiedChat>): Promise<UnifiedChat>;
  deleteUnifiedChat(id: number): Promise<void>;
  setChatResponseStatus(chatId: number, isBlocked: boolean, respondingAgentId?: number): Promise<void>;
  getChatResponseStatus(chatId: number): Promise<{ isResponseBlocked: boolean; currentRespondingAgent?: number }>;
  
  // Recommended Characters operations
  saveRecommendedCharacters(userId: string, topic: string, characters: any[]): Promise<void>;
  getUserRecommendedCharacters(userId: string): Promise<RecommendedCharacter[]>;
  updateRecommendedCharacterAgentId(characterId: number, agentId: number): Promise<void>;
  getRecommendedCharactersWithAgent(): Promise<Array<RecommendedCharacter & { agent: Agent }>>;
  
  // Chat Participants operations
  addChatParticipant(participantData: InsertChatParticipant): Promise<ChatParticipant>;
  removeChatParticipant(chatId: number, participantType: string, participantId: string | number): Promise<void>;
  getChatParticipants(chatId: number): Promise<(ChatParticipant & { user?: User | null; agent?: Agent | null })[]>;
  updateChatParticipant(chatId: number, participantId: string | number, updates: Partial<ChatParticipant>): Promise<void>;
  
  // Unified Chat Messages operations
  createChatMessage(messageData: InsertChatMessage): Promise<ChatMessage>;
  getChatMessages(chatId: number): Promise<(ChatMessage & { sender?: User | null; agent?: Agent | null })[]>;
  markChatAsRead(chatId: number, userId: string): Promise<void>;
  
  // Group Chat Response Status operations
  setGroupChatResponseStatus(groupChatId: number, isBlocked: boolean, respondingAgentId?: number): Promise<void>;
  getGroupChatResponseStatus(groupChatId: number): Promise<{ isResponseBlocked: boolean; currentRespondingAgent?: number }>;
  
  // Atomic locking operations to prevent race conditions
  lockGroupChatForResponse(groupChatId: number, respondingAgentId?: number): Promise<{ success: boolean; currentRespondingAgent?: number }>;
  unlockGroupChatResponse(groupChatId: number): Promise<void>;
  
  // Relationship Matrix operations (영구 저장)
  saveRelationshipMatrix(groupChatId: number, matrix: any[]): Promise<void>;
  getRelationshipMatrix(groupChatId: number): Promise<any[] | null>;
  deleteRelationshipMatrix(groupChatId: number): Promise<void>;
  hasRelationshipMatrix(groupChatId: number): Promise<boolean>;
  
  // Scenario Summary operations
  saveScenarioSummary(summaryData: { groupChatId: number; storySummary: string; characterStates: any; turnCount: number }): Promise<void>;
  getLatestScenarioSummary(groupChatId: number): Promise<{ storySummary: string; characterStates: any; turnCount: number } | null>;
  deleteOldScenarioSummaries(groupChatId: number, keepLatest?: number): Promise<void>;
  
  // Character Speaking Pattern operations (자동 생성된 말하는 방식)
  getCharacterSpeakingPattern(agentId: number): Promise<CharacterSpeakingPattern | undefined>;
  createCharacterSpeakingPattern(pattern: InsertCharacterSpeakingPattern): Promise<CharacterSpeakingPattern>;
  updateCharacterSpeakingPattern(agentId: number, updates: Partial<CharacterSpeakingPattern>): Promise<void>;
  
  // Phrase Usage History operations (순환 선택용)
  getPhraseUsageHistory(agentId: number, conversationId?: number | null, groupChatId?: number | null): Promise<PhraseUsageHistory | undefined>;
  savePhraseUsageHistory(data: InsertPhraseUsageHistory): Promise<void>;
  
  // Agent Intensity Sync operations (에이전트 기본값 동기화)
  syncAgentIntensityToUsers(agentId: number, newIntensity: number): Promise<void>;
  
  // ========================================
  // 🎯 토큰 절감을 위한 프롬프트 압축 엔진 Operations
  // ========================================
  
  // Canon Lock operations - RAG 검색 범위 제한 도구
  getAgentCanon(agentId: number): Promise<AgentCanon | undefined>;
  createOrUpdateAgentCanon(agentId: number, data: Omit<InsertAgentCanon, 'agentId'>): Promise<AgentCanon>;
  
  // Humor settings operations - LLM 응답 길이/형식 제어 도구
  getAgentHumor(agentId: number): Promise<AgentHumor | undefined>;
  createOrUpdateAgentHumor(agentId: number, data: Omit<InsertAgentHumor, 'agentId'>): Promise<AgentHumor>;
  
  // Graph-RAG Entity operations - External Memory 시스템
  createRagEntity(entity: InsertRagEntity): Promise<RagEntity>;
  getRagEntity(id: number): Promise<RagEntity | undefined>;
  getRagEntitiesByType(type: string): Promise<RagEntity[]>;
  getRagEntityByExternalId(type: string, externalId: string): Promise<RagEntity | undefined>;
  updateRagEntity(id: number, updates: Partial<RagEntity>): Promise<RagEntity>;
  deleteRagEntity(id: number): Promise<void>;
  
  // Graph-RAG Edge operations - 관계 저장
  createRagEdge(edge: InsertRagEdge): Promise<RagEdge>;
  getRagEdge(id: number): Promise<RagEdge | undefined>;
  getRagEdgesByEntity(entityId: number, direction?: 'from' | 'to' | 'both'): Promise<RagEdge[]>;
  getRagEdgesByType(type: string): Promise<RagEdge[]>;
  updateRagEdge(id: number, updates: Partial<RagEdge>): Promise<RagEdge>;
  deleteRagEdge(id: number): Promise<void>;
  
  // Graph-RAG Memory operations - 압축된 기억 저장
  createRagMemory(memory: InsertRagMemory): Promise<RagMemory>;
  getRagMemory(id: number): Promise<RagMemory | undefined>;
  getRagMemoriesByEntity(entityId: number, limit?: number): Promise<RagMemory[]>;
  getRagMemoriesByConversation(conversationId: number): Promise<RagMemory[]>;
  getImportantRagMemories(entityId: number, minImportance: number, limit?: number): Promise<RagMemory[]>;
  updateRagMemory(id: number, updates: Partial<RagMemory>): Promise<RagMemory>;
  deleteRagMemory(id: number): Promise<void>;
  deleteExpiredRagMemories(): Promise<number>;
  
  // ========================================
  // 🎯 Canon-Style 분리 아키텍처 Operations
  // ========================================
  
  // Canon Profile operations - "무엇을 말할지" (지식/사실/교리)
  getCanonProfile(id: number): Promise<CanonProfile | undefined>;
  getCanonProfileByName(name: string): Promise<CanonProfile | undefined>;
  getAllCanonProfiles(): Promise<CanonProfile[]>;
  createCanonProfile(data: InsertCanonProfile): Promise<CanonProfile>;
  updateCanonProfile(id: number, updates: Partial<CanonProfile>): Promise<CanonProfile>;
  deleteCanonProfile(id: number): Promise<void>;
  
  // Tone Profile operations - "어떻게 말할지" (말투/유머/감정표현)
  getToneProfile(id: number): Promise<ToneProfile | undefined>;
  getToneProfileByName(name: string): Promise<ToneProfile | undefined>;
  getAllToneProfiles(): Promise<ToneProfile[]>;
  createToneProfile(data: InsertToneProfile): Promise<ToneProfile>;
  updateToneProfile(id: number, updates: Partial<ToneProfile>): Promise<ToneProfile>;
  deleteToneProfile(id: number): Promise<void>;
  
  // ========================================
  // 🔍 CallNAsk Trending & Discovery Operations
  // ========================================
  
  // Trending Topics operations
  getTrendingTopics(category?: string, limit?: number): Promise<TrendingTopic[]>;
  getTrendingTopic(id: number): Promise<TrendingTopic | undefined>;
  createTrendingTopic(data: InsertTrendingTopic): Promise<TrendingTopic>;
  updateTrendingTopic(id: number, updates: Partial<TrendingTopic>): Promise<TrendingTopic>;
  incrementTrendingTopicClick(id: number): Promise<void>;
  deleteTrendingTopic(id: number): Promise<void>;
  
  // Message References operations
  getMessageReferences(messageId: number): Promise<MessageReference[]>;
  createMessageReference(data: InsertMessageReference): Promise<MessageReference>;
  deleteMessageReferences(messageId: number): Promise<void>;
  
  // Follow-up Questions operations
  getFollowUpQuestions(messageId: number): Promise<FollowUpQuestion[]>;
  createFollowUpQuestion(data: InsertFollowUpQuestion): Promise<FollowUpQuestion>;
  deleteFollowUpQuestions(messageId: number): Promise<void>;
  
  // ========================================
  // 🎭 Character Avatar Operations (멀티모달 감정 표현 아바타)
  // ========================================
  
  getCharacterAvatars(agentId: number): Promise<CharacterAvatar[]>;
  getCharacterAvatarsByGroupChat(groupChatId: number): Promise<CharacterAvatar[]>;
  getCharacterAvatar(agentId: number, characterId: string): Promise<CharacterAvatar | undefined>;
  getCharacterAvatarByGroupChat(groupChatId: number, characterId: string): Promise<CharacterAvatar | undefined>;
  findAvatarByNormalizedName(normalizedName: string): Promise<CharacterAvatar | undefined>;
  createCharacterAvatar(data: InsertCharacterAvatar): Promise<CharacterAvatar>;
  updateCharacterAvatar(id: number, updates: Partial<CharacterAvatar>): Promise<CharacterAvatar>;
  deleteCharacterAvatar(id: number): Promise<void>;
  deleteCharacterAvatarsByAgent(agentId: number): Promise<void>;
  deleteCharacterAvatarsByGroupChat(groupChatId: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async updateUser(id: string, updates: any): Promise<User | undefined> {
    const result = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return result[0] as User;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user as User;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user as User;
  }

  async getAllUsers(): Promise<User[]> {
    const userList = await db.select().from(users);
    return userList as User[];
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    return user as User;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    return user as User;
  }

  // Agent operations
  async getAllAgents(): Promise<Agent[]> {
    return await db.select().from(agents).where(eq(agents.isActive, true));
  }

  async getAgent(id: number): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  }

  async createAgent(agent: InsertAgent): Promise<Agent> {
    const [newAgent] = await db.insert(agents).values(agent as any).returning();
    
    // 🎭 관계 매트릭스 캐시 무효화 - DB 저장 방식으로 대체됨 (비활성화)
    
    return newAgent;
  }

  async updateAgent(id: number, updates: any): Promise<Agent> {
    // 기존 에이전트 정보 조회 (이름 변경 감지용)
    const oldAgent = await this.getAgent(id);
    
    const [updatedAgent] = await db
      .update(agents)
      .set(updates)
      .where(eq(agents.id, id))
      .returning();
    
    // 🎭 관계 매트릭스 캐시 무효화 - DB 저장 방식으로 대체됨 (비활성화)
    
    return updatedAgent;
  }

  async deleteAgent(id: number): Promise<boolean> {
    try {
      console.log(`[STORAGE] Deleting agent with ID: ${id}`);
      
      // 0단계: 삭제 전 에이전트 정보 조회 (캐시 무효화용)
      const agentToDelete = await this.getAgent(id);
      
      // 1단계: group_chat_agents에서 해당 에이전트 참조 삭제 (외래 키 제약 조건 해결)
      console.log(`[STORAGE] Deleting group chat agent references for agent ${id}`);
      const deletedGroupChatAgents = await db.delete(groupChatAgents).where(eq(groupChatAgents.agentId, id));
      console.log(`[STORAGE] Deleted group chat agent references, affected rows: ${deletedGroupChatAgents.rowCount}`);
      
      // 2단계: 해당 에이전트와 연결된 documents 삭제 (외래 키 제약 조건 해결)
      console.log(`[STORAGE] Deleting documents for agent ${id}`);
      const deletedDocuments = await db.delete(documents).where(eq(documents.agentId, id));
      console.log(`[STORAGE] Deleted documents, affected rows: ${deletedDocuments.rowCount}`);
      
      // 3단계: 관련된 conversations 조회
      console.log(`[STORAGE] Finding related conversations for agent ${id}`);
      const relatedConversations = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.agentId, id));
      console.log(`[STORAGE] Found ${relatedConversations.length} related conversations`);
      
      // 4단계: conversations에 연결된 messages 먼저 삭제
      if (relatedConversations.length > 0) {
        const conversationIds = relatedConversations.map(c => c.id);
        console.log(`[STORAGE] Deleting messages for conversation IDs: ${conversationIds.join(', ')}`);
        const deletedMessages = await db.delete(messages).where(inArray(messages.conversationId, conversationIds));
        console.log(`[STORAGE] Deleted messages, affected rows: ${deletedMessages.rowCount}`);
      }
      
      // 5단계: conversations 삭제
      console.log(`[STORAGE] Deleting conversations for agent ${id}`);
      const deletedConversations = await db.delete(conversations).where(eq(conversations.agentId, id));
      console.log(`[STORAGE] Deleted conversations, affected rows: ${deletedConversations.rowCount}`);
      
      // 6단계: 마지막으로 agent 삭제
      console.log(`[STORAGE] Deleting agent ${id}`);
      const result = await db.delete(agents).where(eq(agents.id, id));
      const success = (result.rowCount ?? 0) > 0;
      console.log(`[STORAGE] Agent deletion ${success ? 'successful' : 'failed'}, affected rows: ${result.rowCount}`);
      
      // 🎭 관계 매트릭스 캐시 무효화 - DB 저장 방식으로 대체됨 (비활성화)
      
      return success;
    } catch (error) {
      console.error(`[STORAGE] Error deleting agent ${id}:`, error);
      return false;
    }
  }

  async getAgentsByManager(managerId: string): Promise<Agent[]> {
    return await db.select().from(agents).where(eq(agents.managerId, managerId));
  }

  async getUserCreatedAndManagedAgents(userId: string): Promise<Agent[]> {
    // creatorId 또는 managerId가 userId인 에이전트 조회
    const createdAgents = await db.select().from(agents).where(eq(agents.creatorId, userId));
    const managedAgents = await db.select().from(agents).where(eq(agents.managerId, userId));
    
    // 중복 제거 (같은 에이전트가 creatorId와 managerId 모두에 있을 수 있음)
    const agentMap = new Map<number, Agent>();
    [...createdAgents, ...managedAgents].forEach(agent => {
      agentMap.set(agent.id, agent);
    });
    
    return Array.from(agentMap.values());
  }

  async getAgentGroupChats(agentId: number, userId: string): Promise<{ id: number; title: string | null; lastMessageAt: Date | null }[]> {
    // 에이전트가 참여 중인 모든 그룹 채팅 조회 (사용자 참여 여부 무관)
    const chats = await db
      .select({
        id: groupChats.id,
        title: groupChats.title,
        createdAt: groupChats.createdAt,
        lastMessageAt: groupChats.lastMessageAt,
      })
      .from(groupChats)
      .innerJoin(groupChatAgents, eq(groupChats.id, groupChatAgents.groupChatId))
      .where(eq(groupChatAgents.agentId, agentId));

    // lastMessageAt으로 정렬하여 반환
    return chats
      .map(chat => ({
        id: chat.id,
        title: chat.title,
        lastMessageAt: chat.lastMessageAt || chat.createdAt,
      }))
      .sort((a, b) => {
        const timeA = a.lastMessageAt?.getTime() || 0;
        const timeB = b.lastMessageAt?.getTime() || 0;
        return timeB - timeA;
      });
  }

  // Conversation operations
  async getOrCreateConversation(userId: string, agentId: number, type: string = "general"): Promise<Conversation> {
    const [existing] = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.userId, userId), 
        eq(conversations.agentId, agentId),
        eq(conversations.type, type),
        eq(conversations.isHidden, false) // Only find non-hidden conversations
      ));

    if (existing) {
      return existing;
    }

    const [newConversation] = await db
      .insert(conversations)
      .values({ userId, agentId, type })
      .returning();
    return newConversation;
  }

  async getUserConversations(userId: string): Promise<(Conversation & { agent: Agent; lastMessage?: Message })[]> {
    const result = await db
      .select({
        conversation: conversations,
        agent: agents,
      })
      .from(conversations)
      .innerJoin(agents, eq(conversations.agentId, agents.id))
      .where(and(
        eq(conversations.userId, userId),
        eq(conversations.type, "general"), // Only show general conversations in the main list
        eq(conversations.isHidden, false) // Only show non-hidden conversations
      ))
      .orderBy(desc(conversations.lastMessageAt));

    // Get last message for each conversation
    const conversationsWithMessages = await Promise.all(
      result.map(async ({ conversation, agent }) => {
        const [lastMessage] = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversation.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        return {
          ...conversation,
          agent,
          lastMessage,
        };
      })
    );

    return conversationsWithMessages;
  }

  async getAllUserConversations(userId: string): Promise<(Conversation & { agent: Agent; lastMessage?: Message })[]> {
    const result = await db
      .select({
        conversation: conversations,
        agent: agents,
      })
      .from(conversations)
      .innerJoin(agents, eq(conversations.agentId, agents.id))
      .where(eq(conversations.userId, userId))
      .orderBy(desc(conversations.lastMessageAt));

    // Get last message for each conversation
    const conversationsWithMessages = await Promise.all(
      result.map(async ({ conversation, agent }) => {
        const lastMessages = await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, conversation.id))
          .orderBy(desc(messages.createdAt))
          .limit(1);

        const lastMessage = lastMessages[0] || undefined;

        return {
          ...conversation,
          agent,
          lastMessage,
        };
      })
    );

    return conversationsWithMessages;
  }

  async getAllConversations(): Promise<Conversation[]> {
    return await db
      .select()
      .from(conversations)
      .orderBy(desc(conversations.lastMessageAt));
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, id));
    return conversation;
  }

  async updateConversation(conversationId: number, updates: Partial<Conversation>): Promise<void> {
    await db
      .update(conversations)
      .set(updates)
      .where(eq(conversations.id, conversationId));
  }

  async deleteConversationWithMessages(userId: string, agentId: number): Promise<void> {
    // Find conversations for this user and agent
    const conversationsToDelete = await db
      .select()
      .from(conversations)
      .where(and(
        eq(conversations.userId, userId),
        eq(conversations.agentId, agentId)
      ));

    for (const conversation of conversationsToDelete) {
      // Delete all messages in this conversation
      await db
        .delete(messages)
        .where(eq(messages.conversationId, conversation.id));

      // Delete message reactions for this conversation
      const conversationMessages = await db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.conversationId, conversation.id));
      
      if (conversationMessages.length > 0) {
        const messageIds = conversationMessages.map(m => m.id);
        await db
          .delete(messageReactions)
          .where(inArray(messageReactions.messageId, messageIds));
      }

      // Delete the conversation itself
      await db
        .delete(conversations)
        .where(eq(conversations.id, conversation.id));
    }
  }

  // Message operations
  async getConversationMessages(conversationId: number): Promise<Message[]> {
    return await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversationId))
      .orderBy(messages.createdAt);
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const [newMessage] = await db.insert(messages).values(message).returning();

    // Update conversation last message time and increment unread count for AI messages
    const updateData: any = { lastMessageAt: new Date() };
    
    // If it's an AI message (not from user), increment unread count
    if (!message.isFromUser) {
      await db
        .update(conversations)
        .set({ 
          lastMessageAt: new Date(),
          unreadCount: sql`unread_count + 1`
        })
        .where(eq(conversations.id, message.conversationId));
    } else {
      await db
        .update(conversations)
        .set({ lastMessageAt: new Date() })
        .where(eq(conversations.id, message.conversationId));
    }

    return newMessage;
  }

  async markConversationAsRead(conversationId: number): Promise<void> {
    await db
      .update(conversations)
      .set({ 
        unreadCount: 0,
        lastReadAt: new Date()
      })
      .where(eq(conversations.id, conversationId));
  }

  async deleteConversationMessages(conversationId: number): Promise<void> {
    // Delete all messages for this conversation
    await db.delete(messages).where(eq(messages.conversationId, conversationId));
    
    // Update conversation to clear last message info
    await db
      .update(conversations)
      .set({ 
        lastMessageAt: null,
        unreadCount: 0
      })
      .where(eq(conversations.id, conversationId));
  }

  async deleteMessage(messageId: number, conversationId?: number): Promise<{ 
    success: boolean; 
    conversationId?: number; 
    groupChatId?: number;
    messageType: '1:1' | 'group' | 'not_found';
  }> {
    // If conversationId is provided, we know it's a 1:1 message
    if (conversationId) {
      const [oneOnOneMessage] = await db.select().from(messages)
        .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
      
      if (!oneOnOneMessage) {
        console.log(`[DELETE MESSAGE] Message ${messageId} not found in conversation ${conversationId}`);
        return { success: false, messageType: 'not_found' };
      }

      // Delete the message from 1:1 conversations
      await db.delete(messages).where(eq(messages.id, messageId));

      // Get remaining messages ordered by createdAt DESC
      const remainingMessages = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(desc(messages.createdAt))
        .limit(1);

      // Update conversation's lastMessageAt to the latest remaining message
      if (remainingMessages.length > 0) {
        await db
          .update(conversations)
          .set({ lastMessageAt: remainingMessages[0].createdAt })
          .where(eq(conversations.id, conversationId));
      } else {
        // No messages left, clear lastMessageAt
        await db
          .update(conversations)
          .set({ 
            lastMessageAt: null,
            unreadCount: 0
          })
          .where(eq(conversations.id, conversationId));
      }

      return { success: true, conversationId, messageType: '1:1' };
    }

    // If no conversationId provided, it's likely a group chat message
    // Try to find message in group chat messages table
    const [groupMessage] = await db.select().from(groupChatMessages).where(eq(groupChatMessages.id, messageId));
    
    if (groupMessage) {
      const groupChatId = groupMessage.groupChatId;

      // Delete the message from group chat
      await db.delete(groupChatMessages).where(eq(groupChatMessages.id, messageId));

      // Get remaining messages ordered by createdAt DESC
      const remainingMessages = await db
        .select()
        .from(groupChatMessages)
        .where(eq(groupChatMessages.groupChatId, groupChatId))
        .orderBy(desc(groupChatMessages.createdAt))
        .limit(1);

      // Update group chat's lastMessageAt to the latest remaining message
      if (remainingMessages.length > 0) {
        await db
          .update(groupChats)
          .set({ lastMessageAt: remainingMessages[0].createdAt })
          .where(eq(groupChats.id, groupChatId));
      } else {
        // No messages left, clear lastMessageAt
        await db
          .update(groupChats)
          .set({ lastMessageAt: null })
          .where(eq(groupChats.id, groupChatId));
      }

      return { success: true, groupChatId, messageType: 'group' };
    }

    // Message not found in either table
    return { success: false, messageType: 'not_found' };
  }

  async hideConversation(conversationId: number): Promise<void> {
    await db
      .update(conversations)
      .set({ isHidden: true })
      .where(eq(conversations.id, conversationId));
  }

  async unhideConversation(conversationId: number): Promise<void> {
    await db
      .update(conversations)
      .set({ isHidden: false })
      .where(eq(conversations.id, conversationId));
  }

  // Document operations
  async createDocument(document: InsertDocument): Promise<Document> {
    const [newDocument] = await db.insert(documents).values(document).returning();
    return newDocument;
  }

  async getAgentDocuments(agentId: number): Promise<Document[]> {
    return await db
      .select()
      .from(documents)
      .where(eq(documents.agentId, agentId))
      .orderBy(desc(documents.createdAt));
  }

  async getAllDocuments(): Promise<Document[]> {
    return await db
      .select()
      .from(documents)
      .orderBy(desc(documents.createdAt));
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.id, id));
    return document;
  }

  async updateDocument(id: number, updates: any): Promise<Document | undefined> {
    try {
      const result = await db
        .update(documents)
        .set(updates)
        .where(eq(documents.id, id))
        .returning();
      return result[0];
    } catch (error) {
      console.error("Error updating document:", error);
      throw error;
    }
  }

  async deleteDocument(id: number): Promise<void> {
    try {
      await db
        .delete(documents)
        .where(eq(documents.id, id));
    } catch (error) {
      console.error("Error deleting document:", error);
      throw error;
    }
  }

  async updateDocumentContent(id: number, content: string): Promise<Document | null> {
    try {
      const result = await db
        .update(documents)
        .set({ content })
        .where(eq(documents.id, id))
        .returning();
      return result[0] || null;
    } catch (error) {
      console.error("Error updating document content:", error);
      throw error;
    }
  }

  // Stats operations
  async getAgentStats(agentId: number): Promise<AgentStats | undefined> {
    const [stats] = await db.select().from(agentStats).where(eq(agentStats.agentId, agentId));
    return stats;
  }

  async updateAgentStats(agentId: number, stats: Partial<AgentStats>): Promise<void> {
    await db
      .insert(agentStats)
      .values({ agentId, ...stats })
      .onConflictDoUpdate({
        target: agentStats.agentId,
        set: { ...stats, updatedAt: new Date() },
      });
  }

  async createMessageReaction(reaction: InsertMessageReaction): Promise<MessageReaction> {
    // First delete any existing reaction from this user for this message
    await db.delete(messageReactions)
      .where(and(
        eq(messageReactions.messageId, reaction.messageId),
        eq(messageReactions.userId, reaction.userId)
      ));

    // Insert the new reaction
    const [result] = await db.insert(messageReactions)
      .values(reaction)
      .returning();
    return result;
  }

  async deleteMessageReaction(messageId: number, userId: string): Promise<void> {
    await db.delete(messageReactions)
      .where(and(
        eq(messageReactions.messageId, messageId),
        eq(messageReactions.userId, userId)
      ));
  }

  async getMessageReactions(messageIds: number[]): Promise<{ [messageId: number]: MessageReaction | undefined }> {
    if (messageIds.length === 0) return {};
    
    const reactions = await db.select()
      .from(messageReactions)
      .where(inArray(messageReactions.messageId, messageIds));

    const result: { [messageId: number]: MessageReaction | undefined } = {};
    reactions.forEach(reaction => {
      result[reaction.messageId] = reaction;
    });
    
    return result;
  }

  // Group Chat operations
  async getUserGroupChats(userId: string): Promise<any[]> {
    try {
      // Get groups where user is a member
      const memberGroups = await db
        .select({
          id: groupChats.id,
          title: groupChats.title,
          createdBy: groupChats.createdBy,
          visibility: groupChats.visibility,
          embedEnabled: groupChats.embedEnabled,
          sharingMode: groupChats.sharingMode,
          provider: groupChats.provider,
          model: groupChats.model,
          temperature: groupChats.temperature,
          createdAt: groupChats.createdAt,
          updatedAt: groupChats.updatedAt,
          lastMessageAt: groupChats.lastMessageAt
        })
        .from(groupChats)
        .innerJoin(groupChatMembers, eq(groupChats.id, groupChatMembers.groupChatId))
        .where(eq(groupChatMembers.userId, userId));
      
      // Get public groups (visibility='public')
      const publicGroups = await db
        .select({
          id: groupChats.id,
          title: groupChats.title,
          createdBy: groupChats.createdBy,
          visibility: groupChats.visibility,
          embedEnabled: groupChats.embedEnabled,
          sharingMode: groupChats.sharingMode,
          provider: groupChats.provider,
          model: groupChats.model,
          temperature: groupChats.temperature,
          createdAt: groupChats.createdAt,
          updatedAt: groupChats.updatedAt,
          lastMessageAt: groupChats.lastMessageAt
        })
        .from(groupChats)
        .where(eq(groupChats.visibility, 'public'));
      
      // Merge and deduplicate by ID
      const allGroupsMap = new Map();
      [...memberGroups, ...publicGroups].forEach(group => {
        allGroupsMap.set(group.id, group);
      });
      const results = Array.from(allGroupsMap.values());
      
      // For each group chat, fetch the last message content
      const enrichedResults = await Promise.all(results.map(async (groupChat) => {
        try {
          // Get the most recent message for this group chat
          const lastMessage = await db
            .select({
              content: groupChatMessages.content
            })
            .from(groupChatMessages)
            .where(eq(groupChatMessages.groupChatId, groupChat.id))
            .orderBy(desc(groupChatMessages.createdAt))
            .limit(1);
          
          return {
            ...groupChat,
            lastMessage: lastMessage.length > 0 ? lastMessage[0].content : null
          };
        } catch (error) {
          console.error(`Error fetching last message for group chat ${groupChat.id}:`, error);
          return {
            ...groupChat,
            lastMessage: null
          };
        }
      }));
      
      // Sort by lastMessageAt in descending order (most recent first)
      const sortedResults = enrichedResults.sort((a, b) => {
        if (!a.lastMessageAt && !b.lastMessageAt) return 0;
        if (!a.lastMessageAt) return 1; // No messages go to bottom
        if (!b.lastMessageAt) return -1; // No messages go to bottom
        return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
      });
      
      return sortedResults;
    } catch (error) {
      console.error('Error getting user group chats:', error);
      return [];
    }
  }

  async getUserGroupChatViews(userId: string): Promise<Array<{ groupChatId: number; firstViewedAt: string }>> {
    try {
      const views = await db
        .select({
          groupChatId: groupChatMembers.groupChatId,
          firstViewedAt: groupChatMembers.firstViewedAt
        })
        .from(groupChatMembers)
        .where(eq(groupChatMembers.userId, userId));
      
      return views
        .filter(v => v.firstViewedAt !== null)
        .map(v => ({
          groupChatId: v.groupChatId,
          firstViewedAt: v.firstViewedAt!.toISOString()
        }));
    } catch (error) {
      console.error('Error getting user group chat views:', error);
      return [];
    }
  }

  async createGroupChat(data: any): Promise<any> {
    try {
      // Drizzle handles JSONB automatically - no need for JSON.stringify()
      // For embed visibility: store empty array [] if no domains (= allow all sites)
      // For other visibilities: store null if no domains
      let allowedDomains = null;
      if (data.visibility === 'embed') {
        allowedDomains = data.allowedDomains && Array.isArray(data.allowedDomains) 
          ? data.allowedDomains 
          : [];
      }
      
      const [result] = await db.insert(groupChats).values({
        title: data.title,
        createdBy: data.createdBy,
        visibility: data.visibility || 'private',
        sharingMode: data.sharingMode || 'shared',
        embedCode: data.embedCode || null,
        embedEnabled: data.embedEnabled || false,
        callnaskEnabled: data.callnaskEnabled || false,
        callnaskConfig: data.callnaskConfig || null,
        allowedDomains,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastMessageAt: new Date()
      }).returning();
      return result;
    } catch (error) {
      console.error('Error creating group chat:', error);
      throw error;
    }
  }

  async getAllGroupChats(): Promise<any[]> {
    try {
      const results = await db
        .select()
        .from(groupChats)
        .orderBy(desc(groupChats.lastMessageAt));
      return results;
    } catch (error) {
      console.error('Error getting all group chats:', error);
      throw error;
    }
  }

  async getPublicGroupChats(): Promise<any[]> {
    try {
      const results = await db
        .select({
          id: groupChats.id,
          title: groupChats.title,
          createdBy: groupChats.createdBy,
          visibility: groupChats.visibility,
          sharingMode: groupChats.sharingMode,
          provider: groupChats.provider,
          model: groupChats.model,
          temperature: groupChats.temperature,
          createdAt: groupChats.createdAt,
          updatedAt: groupChats.updatedAt,
          lastMessageAt: groupChats.lastMessageAt
        })
        .from(groupChats)
        .where(eq(groupChats.visibility, 'public'))
        .orderBy(desc(groupChats.lastMessageAt));

      // For each group chat, fetch the last message content and member count
      const enrichedResults = await Promise.all(results.map(async (groupChat) => {
        try {
          // Get the most recent message
          const lastMessage = await db
            .select({
              content: groupChatMessages.content
            })
            .from(groupChatMessages)
            .where(eq(groupChatMessages.groupChatId, groupChat.id))
            .orderBy(desc(groupChatMessages.createdAt))
            .limit(1);

          // Get member count
          const memberCount = await db
            .select({ count: sql<number>`count(*)` })
            .from(groupChatMembers)
            .where(eq(groupChatMembers.groupChatId, groupChat.id));

          return {
            ...groupChat,
            lastMessage: lastMessage.length > 0 ? lastMessage[0].content : null,
            memberCount: memberCount[0]?.count || 0
          };
        } catch (error) {
          console.error(`Error enriching public group chat ${groupChat.id}:`, error);
          return {
            ...groupChat,
            lastMessage: null,
            memberCount: 0
          };
        }
      }));

      return enrichedResults;
    } catch (error) {
      console.error('Error getting public group chats:', error);
      return [];
    }
  }

  async getGroupChatByEmbedCode(embedCode: string): Promise<any> {
    try {
      const results = await db
        .select()
        .from(groupChats)
        .where(eq(groupChats.embedCode, embedCode))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      return results[0];
    } catch (error) {
      console.error('Error getting group chat by embed code:', error);
      throw error;
    }
  }

  async addGroupChatMember(data: any): Promise<any> {
    try {
      // Check if member already exists to prevent duplicates
      const existing = await db.select().from(groupChatMembers)
        .where(and(
          eq(groupChatMembers.groupChatId, data.groupChatId),
          eq(groupChatMembers.userId, data.userId)
        ));
      
      if (existing.length > 0) {
        console.log(`User ${data.userId} already member of group ${data.groupChatId}`);
        return existing[0];
      }

      const [result] = await db.insert(groupChatMembers).values({
        groupChatId: data.groupChatId,
        userId: data.userId,
        joinedAt: new Date()
      }).returning();
      return result;
    } catch (error) {
      console.error('Error adding group chat member:', error);
      throw error;
    }
  }

  async addGroupChatAgent(data: any): Promise<any> {
    try {
      const [result] = await db.insert(groupChatAgents).values({
        groupChatId: data.groupChatId,
        agentId: data.agentId,
        addedAt: new Date()
      }).returning();
      return result;
    } catch (error) {
      console.error('Error adding group chat agent:', error);
      throw error;
    }
  }

  async getGroupChat(id: number): Promise<any> {
    try {
      // 모든 필수 컬럼 조회
      const [result] = await db.select({
        id: groupChats.id,
        title: groupChats.title,
        createdBy: groupChats.createdBy,
        isResponseBlocked: groupChats.isResponseBlocked,
        currentRespondingAgent: groupChats.currentRespondingAgent,
        responseStartedAt: groupChats.responseStartedAt,
        createdAt: groupChats.createdAt,
        updatedAt: groupChats.updatedAt,
        lastMessageAt: groupChats.lastMessageAt,
        languageLevel: groupChats.languageLevel,
        provider: groupChats.provider,
        assistantId: groupChats.assistantId,
        threadId: groupChats.threadId,
        visibility: groupChats.visibility,
        embedEnabled: groupChats.embedEnabled,
        sharingMode: groupChats.sharingMode,
        embedCode: groupChats.embedCode,
        allowedDomains: groupChats.allowedDomains,
        callnaskEnabled: groupChats.callnaskEnabled,
        callnaskConfig: groupChats.callnaskConfig,
        isCallnaskTemplate: groupChats.isCallnaskTemplate,
        model: groupChats.model,
        temperature: groupChats.temperature,
        metaPrompt: groupChats.metaPrompt
      }).from(groupChats).where(eq(groupChats.id, id));
      
      return result || null;
    } catch (error) {
      console.error('Error getting group chat:', error);
      return null;
    }
  }

  async getGroupChatMembers(groupChatId: number): Promise<any[]> {
    try {
      const results = await db.select().from(groupChatMembers).where(eq(groupChatMembers.groupChatId, groupChatId));
      return results;
    } catch (error) {
      console.error('Error getting group chat members:', error);
      return [];
    }
  }

  async getGroupChatAgents(groupChatId: number): Promise<any[]> {
    try {
      const results = await db.select().from(groupChatAgents).where(eq(groupChatAgents.groupChatId, groupChatId));
      return results;
    } catch (error) {
      console.error('Error getting group chat agents:', error);
      return [];
    }
  }

  // Group chat user agent settings implementations
  async createOrUpdateUserAgentSettings(settingsData: InsertGroupChatUserAgentSettings): Promise<GroupChatUserAgentSettings> {
    try {
      // Check if settings already exist
      const existing = await this.getUserAgentSetting(
        settingsData.groupChatId!, 
        settingsData.userId!, 
        settingsData.agentId!
      );

      if (existing) {
        // Update existing settings
        const [updated] = await db.update(groupChatUserAgentSettings)
          .set({
            relationshipType: settingsData.relationshipType,
            languagePreference: settingsData.languagePreference,
            updatedAt: new Date()
          })
          .where(
            and(
              eq(groupChatUserAgentSettings.groupChatId, settingsData.groupChatId!),
              eq(groupChatUserAgentSettings.userId, settingsData.userId!),
              eq(groupChatUserAgentSettings.agentId, settingsData.agentId!)
            )
          )
          .returning();
        return updated;
      } else {
        // Create new settings
        const [created] = await db.insert(groupChatUserAgentSettings)
          .values(settingsData)
          .returning();
        return created;
      }
    } catch (error) {
      console.error('Error creating/updating user agent settings:', error);
      throw error;
    }
  }

  async getUserAgentSettings(groupChatId: number, userId: string): Promise<GroupChatUserAgentSettings[]> {
    try {
      const results = await db.select()
        .from(groupChatUserAgentSettings)
        .where(
          and(
            eq(groupChatUserAgentSettings.groupChatId, groupChatId),
            eq(groupChatUserAgentSettings.userId, userId)
          )
        );
      return results;
    } catch (error) {
      console.error('Error getting user agent settings:', error);
      return [];
    }
  }

  async getUserAgentSetting(groupChatId: number, userId: string, agentId: number): Promise<GroupChatUserAgentSettings | undefined> {
    try {
      const result = await db.select()
        .from(groupChatUserAgentSettings)
        .where(
          and(
            eq(groupChatUserAgentSettings.groupChatId, groupChatId),
            eq(groupChatUserAgentSettings.userId, userId),
            eq(groupChatUserAgentSettings.agentId, agentId)
          )
        )
        .limit(1);
      
      return result[0];
    } catch (error) {
      console.error('Error getting user agent setting:', error);
      return undefined;
    }
  }

  async getRelationshipTone(relationshipType: string, toneName: string): Promise<RelationshipTone | undefined> {
    try {
      const [result] = await db.select()
        .from(relationshipTones)
        .where(
          and(
            eq(relationshipTones.relationshipType, relationshipType),
            eq(relationshipTones.toneName, toneName)
          )
        )
        .limit(1);
      
      return result;
    } catch (error) {
      console.error('Error getting relationship tone:', error);
      return undefined;
    }
  }

  async getRelationshipTonesByType(relationshipType: string): Promise<RelationshipTone[]> {
    try {
      return await db.select()
        .from(relationshipTones)
        .where(eq(relationshipTones.relationshipType, relationshipType));
    } catch (error) {
      console.error('Error getting relationship tones by type:', error);
      return [];
    }
  }

  async createRelationshipTone(toneData: InsertRelationshipTone): Promise<RelationshipTone> {
    const [newTone] = await db.insert(relationshipTones).values(toneData).returning();
    return newTone;
  }

  async getGroupChatMessages(groupChatId: number, limit?: number, offset?: number): Promise<any[]> {
    try {
      // ✅ 단일 정렬 규칙 고정: createdAt, replyOrder, id ASC
      // sender 정보 포함 (다른 사용자 이름 표시를 위해)
      const query = db.select({
          message: groupChatMessages,
          sender: users,
          agent: agents
        })
        .from(groupChatMessages)
        .leftJoin(users, eq(groupChatMessages.senderId, users.id))
        .leftJoin(agents, eq(groupChatMessages.agentId, agents.id))
        .where(eq(groupChatMessages.groupChatId, groupChatId))
        .orderBy(
          groupChatMessages.createdAt,
          groupChatMessages.replyOrder,
          groupChatMessages.id
        )
        .limit(limit || 10000) // 기본값: 충분히 큰 수
        .offset(offset || 0);   // 기본값: 0
      
      const results = await query;
      // 메시지 객체 평탄화: message 필드를 최상위로, sender와 agent는 별도 필드로
      const flattenedResults = results.map(r => ({
        ...r.message,
        sender: r.sender,
        agent: r.agent
      }));
      console.log(`📊 [DB] 메시지 조회 완료: groupChatId=${groupChatId}, 반환=${flattenedResults.length}개 (limit=${limit}, offset=${offset}) [정렬: createdAt→replyOrder→id ASC]`);
      
      // 🔍 sources 필드 디버깅
      const sourcesCount = flattenedResults.filter(m => m.sources).length;
      if (sourcesCount > 0) {
        const lastWithSources = flattenedResults.reverse().find(m => m.sources);
        console.log(`🔍 [DB] ${sourcesCount}개 메시지에 sources 있음. 마지막 sources:`, typeof lastWithSources?.sources, lastWithSources?.sources ? JSON.stringify(lastWithSources.sources).substring(0, 200) : 'null');
        flattenedResults.reverse();
      }
      
      return flattenedResults;
    } catch (error) {
      console.error('Error getting group chat messages:', error);
      return [];
    }
  }

  async deleteGroupChatMessages(messageIds: number[]): Promise<void> {
    try {
      if (messageIds.length === 0) return;
      
      await db.delete(groupChatMessages)
        .where(inArray(groupChatMessages.id, messageIds));
      
      console.log(`🗑️ [DB] Deleted ${messageIds.length} messages`);
    } catch (error) {
      console.error('Error deleting group chat messages:', error);
      throw error;
    }
  }

  async deleteAllGroupChatMessages(groupChatId: number): Promise<void> {
    try {
      await db.delete(groupChatMessages)
        .where(eq(groupChatMessages.groupChatId, groupChatId));
      
      console.log(`🗑️ [DB] Deleted all messages from group chat ${groupChatId}`);
    } catch (error) {
      console.error('Error deleting all group chat messages:', error);
      throw error;
    }
  }

  async createGroupChatMessage(data: any): Promise<any> {
    try {
      const messageCreatedAt = new Date();
      
      // 🔒 강화된 Unicode 정규화 (한국어 조합형/분해형, 다국어 invisible chars)
      const senderKey = data.senderId || `agent_${data.agentId}` || 'unknown';
      const rawContent = data.content?.trim() || '';
      
      // Unicode NFC 정규화 + zero-width/invisible 문자 제거 + 내부 공백 정규화
      const normalizedContent = rawContent
        .normalize('NFC')  // 한국어 조합형 통일
        .replace(/[\u200B-\u200D\uFEFF]/g, '')  // zero-width chars 제거
        .replace(/[^\S\n]+/g, ' ')  // 줄바꿈 제외한 내부 공백 정규화 (표 형식 보존)
        .trim();
      
      // 🔑 userTurnId 기반 강력한 idempotency (재시작/다중인스턴스 안전)
      const userTurnId = data.userTurnId;
      if (!userTurnId) {
        console.warn('[⚠️ IDEMPOTENCY] userTurnId가 없습니다 - 약한 중복 방지 사용');
      }
      
      // 🔐 Advisory Lock을 사용한 동시성 안전 upsert (TOCTOU 완전 방지)
      const result = await db.transaction(async (tx) => {
        // 1. 메시지 내용 기반 고유 lock key 생성 (동일한 메시지는 동일한 lock)
        const senderKey = data.senderId || `agent_${data.agentId}` || 'unknown';
        const lockKey = createHash('sha1')
          .update(`${data.groupChatId}|${senderKey}|${normalizedContent}`)
          .digest('hex');
        
        // PostgreSQL advisory lock으로 동시 요청 직렬화 (동일 내용만)
        const lockId = parseInt(lockKey.substring(0, 8), 16); // 32-bit integer for pg_advisory_xact_lock
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockId})`);
        
        console.log(`[🔐 LOCK] Advisory lock 획득: ${lockId} (key=${lockKey.slice(0, 8)})`);
        
        // 2. Lock 보호 하에 중복 체크
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
        
        let existingMessage;
        if (userTurnId && data.senderId && data.senderId.startsWith('user')) {
          // 사용자 메시지: userTurnId로만 검색 (클라이언트 중복 클릭 방지)
          existingMessage = await tx.select().from(groupChatMessages)
            .where(eq(groupChatMessages.userTurnId, userTurnId))
            .limit(1);
        } else if (userTurnId && data.agentId && !data.isContinuation) {
          // 에이전트 응답: userTurnId + agentId 조합으로 검색 (각 에이전트별 고유 응답)
          // 📝 isContinuation=true일 때는 중복 체크 우회 (메시지 분할 허용)
          existingMessage = await tx.select().from(groupChatMessages)
            .where(
              and(
                eq(groupChatMessages.userTurnId, userTurnId),
                eq(groupChatMessages.agentId, data.agentId)
              )
            )
            .limit(1);
        } else {
          // userTurnId가 없거나 isContinuation=true일 때는 content+sender+시간윈도우로 매칭
          existingMessage = await tx.select().from(groupChatMessages)
            .where(
              and(
                eq(groupChatMessages.groupChatId, data.groupChatId),
                eq(groupChatMessages.content, normalizedContent),
                sql`${groupChatMessages.createdAt} > ${fiveMinutesAgo}`,
                data.senderId ? eq(groupChatMessages.senderId, data.senderId) : 
                data.agentId ? eq(groupChatMessages.agentId, data.agentId) : sql`1=0`
              )
            ).limit(1);
        }
        
        if (existingMessage.length > 0) {
          console.log(`[🔒 IDEMPOTENCY] 중복 메시지 감지 - 기존 반환: lockId=${lockId}, turnId=${userTurnId?.slice(0, 8)}, ID=${existingMessage[0].id}, content="${normalizedContent.slice(0, 50)}..."`);
          return existingMessage[0];
        }
        
        // 3. 중복이 없으면 새 메시지 생성 (lock으로 보호됨)
        // 📊 진단 로그: DB 저장 직전
        console.log('=== 📊 DB 저장 직전 ===');
        console.log(`내용 길이: ${normalizedContent.length}자`);
        console.log(`줄바꿈 개수: ${(normalizedContent.match(/\n/g) || []).length}`);
        console.log(`표 포함: ${normalizedContent.includes('|')}`);
        if (normalizedContent.length > 0) {
          console.log('=== 처음 300자 (이스케이프) ===');
          console.log(JSON.stringify(normalizedContent.substring(0, 300)));
        }
        
        const [result] = await tx.insert(groupChatMessages).values({
          groupChatId: data.groupChatId,
          content: normalizedContent,
          senderId: data.senderId || null,
          senderName: data.senderName || null, // Step 48: 사용자 이름
          senderType: data.agentId ? 'agent' : 'user', // agentId가 있으면 agent, 없으면 user
          agentId: data.agentId || null,
          agentName: data.agentName || null, // Step 48: 에이전트 이름 (앵커 등 가상 화자)
          targetAgentIds: data.targetAgentIds || null,
          replyOrder: data.replyOrder || null,
          userTurnId: userTurnId || null,
          isContinuation: data.isContinuation || false, // 연속 메시지 플래그
          splitType: data.splitType || 'paragraph', // 분할 타입 (기본값: paragraph)
          sources: data.sources || null, // Google Search 출처
          suggestionChips: data.suggestionChips || null, // 🎭 Step 46: 추천 화자 칩
          createdAt: messageCreatedAt
        }).returning();

        console.log(`[✅ CREATE] 새 메시지 생성: lockId=${lockId}, turnId=${userTurnId?.slice(0, 8)}, ID=${result.id}, content="${normalizedContent.slice(0, 50)}..."`);
        
        // 4. 그룹 채팅의 lastMessageAt 업데이트
        await tx
          .update(groupChats)
          .set({ lastMessageAt: messageCreatedAt })
          .where(eq(groupChats.id, data.groupChatId));
        
        // Lock은 트랜잭션 종료 시 자동 해제됨
        return result;
      });
      
      // 5. 🚀 트랜잭션 완료 후 SSE 브로드캐스트 - 새 메시지 실시간 업데이트
      console.log(`[📡 BROADCAST START] 메시지 브로드캐스트 시작 - ID: ${result.id}, groupChatId: ${data.groupChatId}`);
      const { broadcastWithEventId } = await import('./broadcast');
      broadcastWithEventId('group_chat_message', {
        groupChatId: data.groupChatId,
        message: result
      }, `group_msg_${result.id}`);
      console.log(`[📡 BROADCAST END] 메시지 브로드캐스트 완료 - ID: ${result.id}`);
      
      return result;
      
    } catch (error) {
      console.error('Error creating group chat message:', error);
      throw error;
    }
  }

  async updateGroupChatMessage(messageId: number, content: string): Promise<any> {
    try {
      const [result] = await db.update(groupChatMessages)
        .set({ content })
        .where(eq(groupChatMessages.id, messageId))
        .returning();
      return result;
    } catch (error) {
      console.error('Error updating group chat message:', error);
      throw error;
    }
  }

  async updateGroupChatMessageSources(messageId: number, sources: any): Promise<void> {
    try {
      await db.update(groupChatMessages)
        .set({ sources })
        .where(eq(groupChatMessages.id, messageId));
      console.log(`[💾 DB UPDATE] Message ${messageId} sources updated`);
    } catch (error) {
      console.error('Error updating group chat message sources:', error);
      throw error;
    }
  }

  async getGroupChatMessage(messageId: number): Promise<any | null> {
    try {
      const result = await db.select({
        message: groupChatMessages,
        sender: users,
        agent: agents
      })
        .from(groupChatMessages)
        .leftJoin(users, eq(groupChatMessages.senderId, users.id))
        .leftJoin(agents, eq(groupChatMessages.agentId, agents.id))
        .where(eq(groupChatMessages.id, messageId))
        .limit(1);
      
      if (result.length === 0) return null;
      
      return {
        ...result[0].message,
        sender: result[0].sender,
        agent: result[0].agent
      };
    } catch (error) {
      console.error(`Error getting group chat message ${messageId}:`, error);
      throw error;
    }
  }

  // Missing Group Chat methods implementation
  async updateGroupChat(id: number, updates: any): Promise<any> {
    try {
      // 모든 필드 업데이트 (DB 컬럼 추가됨)
      const [result] = await db.update(groupChats)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(groupChats.id, id))
        .returning();
      
      return result;
    } catch (error) {
      console.error('Error updating group chat:', error);
      throw error;
    }
  }

  async deleteGroupChat(id: number): Promise<void> {
    try {
      // Delete in order to avoid foreign key constraint issues
      // 1. Delete all group chat messages
      await db.delete(groupChatMessages).where(eq(groupChatMessages.groupChatId, id));
      
      // 2. Delete all group chat members
      await db.delete(groupChatMembers).where(eq(groupChatMembers.groupChatId, id));
      
      // 3. Delete all group chat agents
      await db.delete(groupChatAgents).where(eq(groupChatAgents.groupChatId, id));
      
      // 4. Delete all group chat user agent settings
      await db.delete(groupChatUserAgentSettings).where(eq(groupChatUserAgentSettings.groupChatId, id));
      
      // 5. Delete all scenario summaries
      await db.delete(scenarioSummaries).where(eq(scenarioSummaries.groupChatId, id));
      
      // 6. Finally delete the group chat itself
      await db.delete(groupChats).where(eq(groupChats.id, id));
    } catch (error) {
      console.error('Error deleting group chat:', error);
      throw error;
    }
  }

  async removeGroupChatMember(groupChatId: number, userId: string): Promise<void> {
    try {
      await db.delete(groupChatMembers)
        .where(and(eq(groupChatMembers.groupChatId, groupChatId), eq(groupChatMembers.userId, userId)));
    } catch (error) {
      console.error('Error removing group chat member:', error);
      throw error;
    }
  }

  async removeGroupChatAgent(groupChatId: number, agentId: number): Promise<void> {
    try {
      await db.delete(groupChatAgents)
        .where(and(eq(groupChatAgents.groupChatId, groupChatId), eq(groupChatAgents.agentId, agentId)));
    } catch (error) {
      console.error('Error removing group chat agent:', error);
      throw error;
    }
  }

  async markGroupChatAsRead(groupChatId: number, userId: string): Promise<void> {
    try {
      // This would typically update a read status table, for now just log
      console.log(`Marking group chat ${groupChatId} as read for user ${userId}`);
    } catch (error) {
      console.error('Error marking group chat as read:', error);
      throw error;
    }
  }

  // Group Chat management operations
  async getGroupChatById(id: number): Promise<any> {
    try {
      // 모든 컬럼 조회 (모든 필드 포함)
      const [groupChat] = await db.select({
        id: groupChats.id,
        title: groupChats.title,
        createdBy: groupChats.createdBy,
        isResponseBlocked: groupChats.isResponseBlocked,
        currentRespondingAgent: groupChats.currentRespondingAgent,
        responseStartedAt: groupChats.responseStartedAt,
        createdAt: groupChats.createdAt,
        updatedAt: groupChats.updatedAt,
        lastMessageAt: groupChats.lastMessageAt,
        languageLevel: groupChats.languageLevel,
        provider: groupChats.provider,
        model: groupChats.model,
        temperature: groupChats.temperature,
        metaPrompt: groupChats.metaPrompt,
        customUnifiedPrompt: groupChats.customUnifiedPrompt,
        customScenarioPrompt: groupChats.customScenarioPrompt,
        customMatrixPrompt: groupChats.customMatrixPrompt,
        threadId: groupChats.threadId,
        visibility: groupChats.visibility,
        embedEnabled: groupChats.embedEnabled,
        sharingMode: groupChats.sharingMode,
        embedCode: groupChats.embedCode,
        allowedDomains: groupChats.allowedDomains,
      }).from(groupChats).where(eq(groupChats.id, id));
      
      if (!groupChat) return null;

      // 🔍 DEBUG: provider 필드 확인
      console.log(`[🔍 STORAGE DEBUG] getGroupChatById(${id}): provider=${groupChat.provider}, model=${groupChat.model}`);

      // Get members and agents with their details
      const [members, groupAgents] = await Promise.all([
        db.select({
          userId: groupChatMembers.userId,
          joinedAt: groupChatMembers.joinedAt
        }).from(groupChatMembers).where(eq(groupChatMembers.groupChatId, id)),
        
        db.select({
          agentId: groupChatAgents.agentId,
          addedAt: groupChatAgents.addedAt,
          agent: agents
        })
        .from(groupChatAgents)
        .leftJoin(agents, eq(groupChatAgents.agentId, agents.id))
        .where(eq(groupChatAgents.groupChatId, id))
      ]);

      // Normalize temperature to number (Drizzle returns numeric as string)
      const result = {
        ...groupChat,
        temperature: groupChat.temperature != null ? Number(groupChat.temperature) : null,
        members,
        agents: groupAgents
      };
      
      // 🔍 DEBUG: 최종 반환값 확인
      console.log(`[🔍 STORAGE RETURN] getGroupChatById(${id}): provider=${result.provider}, model=${result.model}`);
      
      return result;
    } catch (error) {
      console.error('Error getting group chat by ID:', error);
      throw error;
    }
  }

  async addAgentToGroupChat(groupChatId: number, agentId: number): Promise<void> {
    try {
      await db.insert(groupChatAgents).values({
        groupChatId,
        agentId,
        addedAt: new Date()
      });
      
      // 🔄 관계 매트릭스 무효화: 참가자 변경 시 기존 매트릭스 제거
      await db.update(groupChats)
        .set({ 
          relationshipMatrix: null,
          matrixGeneratedAt: null 
        })
        .where(eq(groupChats.id, groupChatId));
      
      console.log(`[🔄 매트릭스 무효화] 그룹 ${groupChatId}에 에이전트 ${agentId} 추가 - 관계 매트릭스 재생성 필요`);
    } catch (error) {
      console.error('Error adding agent to group chat:', error);
      throw error;
    }
  }

  async removeAgentFromGroupChat(groupChatId: number, agentId: number): Promise<void> {
    try {
      await db.delete(groupChatAgents)
        .where(and(eq(groupChatAgents.groupChatId, groupChatId), eq(groupChatAgents.agentId, agentId)));
      
      // 🔄 관계 매트릭스 무효화: 참가자 변경 시 기존 매트릭스 제거
      await db.update(groupChats)
        .set({ 
          relationshipMatrix: null,
          matrixGeneratedAt: null 
        })
        .where(eq(groupChats.id, groupChatId));
      
      console.log(`[🔄 매트릭스 무효화] 그룹 ${groupChatId}에서 에이전트 ${agentId} 제거 - 관계 매트릭스 재생성 필요`);
    } catch (error) {
      console.error('Error removing agent from group chat:', error);
      throw error;
    }
  }

  async addMemberToGroupChat(groupChatId: number, userId: string): Promise<void> {
    try {
      await db.insert(groupChatMembers).values({
        groupChatId,
        userId,
        joinedAt: new Date()
      });
    } catch (error) {
      console.error('Error adding member to group chat:', error);
      throw error;
    }
  }

  // Missing document methods for DatabaseStorage
  async getAgentDocumentsForUser(agentId: number, userId: string): Promise<Document[]> {
    try {
      const results = await db.select().from(documents).where(eq(documents.agentId, agentId));
      return results;
    } catch (error) {
      console.error('Error getting agent documents for user:', error);
      return [];
    }
  }

  async updateDocumentVisibility(id: number, isVisible: boolean): Promise<Document | undefined> {
    try {
      const [result] = await db.update(documents)
        .set({ isVisibleToUsers: isVisible })
        .where(eq(documents.id, id))
        .returning();
      return result;
    } catch (error) {
      console.error('Error updating document visibility:', error);
      return undefined;
    }
  }

  async updateDocumentTraining(id: number, isUsedForTraining: boolean): Promise<Document | undefined> {
    try {
      const [result] = await db.update(documents)
        .set({ isUsedForTraining })
        .where(eq(documents.id, id))
        .returning();
      return result;
    } catch (error) {
      console.error('Error updating document training:', error);
      return undefined;
    }
  }

  async updateDocumentAgentConnections(id: number, connectedAgentIds: number[]): Promise<Document | undefined> {
    try {
      const [result] = await db.update(documents)
        .set({ connectedAgents: connectedAgentIds })
        .where(eq(documents.id, id))
        .returning();
      return result;
    } catch (error) {
      console.error('Error updating document agent connections:', error);
      return undefined;
    }
  }

  async getDocumentConnectedAgents(documentId: number): Promise<Agent[]> {
    try {
      const document = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
      if (!document[0] || !document[0].connectedAgents) {
        return [];
      }
      const agentIds = document[0].connectedAgents as number[];
      const results = await db.select().from(agents).where(inArray(agents.id, agentIds));
      return results;
    } catch (error) {
      console.error('Error getting document connected agents:', error);
      return [];
    }
  }

  // Organization category operations - placeholder implementations for DatabaseStorage
  async getOrganizationCategories(): Promise<any[]> {
    try {
      const results = await db.select().from(organizationCategories);
      console.log(`Retrieved ${results.length} organization categories from storage:`, results.slice(0, 3));
      return results;
    } catch (error) {
      console.error('Error getting organization categories:', error);
      // Return sample data if database is empty
      const { organizationCategories: sampleData } = await import('./organization-categories');
      return sampleData;
    }
  }

  async createOrganizationCategory(organization: any): Promise<any> {
    // Placeholder - would normally insert into organizationCategories table
    return organization;
  }

  async updateOrganizationCategory(id: number, organization: any): Promise<any> {
    // Placeholder - would normally update organizationCategories table
    return organization;
  }

  async deleteOrganizationCategory(id: number): Promise<void> {
    // Placeholder - would normally delete from organizationCategories table
  }

  async bulkCreateOrganizationCategories(organizations: any[]): Promise<any[]> {
    // Placeholder - would normally bulk insert into organizationCategories table
    return organizations;
  }

  async clearAllOrganizationCategories(): Promise<void> {
    // Placeholder - would normally truncate organizationCategories table
  }

  async deleteRoboUniversityOrganizations(): Promise<{ deletedCount: number }> {
    // Placeholder - would normally delete Robo University organizations from database
    return { deletedCount: 0 };
  }

  getUniqueUserStatuses(): string[] {
    // For database implementation, this would need actual SQL query
    // For now, return default statuses
    return ['활성', '비활성', '등록 승인 대기중', '휴면'];
  }

  // Agent file operations
  async getAgentFiles(): Promise<any[]> {
    const filePath = path.join(process.cwd(), 'data', 'agent-files.json');
    
    if (!fs.existsSync(filePath)) {
      return [];
    }
    
    try {
      const fileData = fs.readFileSync(filePath, 'utf8');
      const agentFiles = JSON.parse(fileData);
      return Object.values(agentFiles);
    } catch (error) {
      console.error('Error reading agent files:', error);
      return [];
    }
  }

  async saveAgentFile(fileInfo: any): Promise<void> {
    const filePath = path.join(process.cwd(), 'data', 'agent-files.json');
    
    // Ensure data directory exists
    const dataDir = path.dirname(filePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    let agentFiles: any = {};
    
    if (fs.existsSync(filePath)) {
      try {
        agentFiles = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch (error) {
        console.error('Error reading existing agent files:', error);
      }
    }
    
    agentFiles[fileInfo.id] = fileInfo;
    fs.writeFileSync(filePath, JSON.stringify(agentFiles, null, 2));
  }

  async deleteAgentFile(fileId: string): Promise<void> {
    const filePath = path.join(process.cwd(), 'data', 'agent-files.json');
    
    if (fs.existsSync(filePath)) {
      const agentFiles = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      delete agentFiles[fileId];
      fs.writeFileSync(filePath, JSON.stringify(agentFiles, null, 2));
    }
  }

  // User file operations
  async getUserFiles(): Promise<any[]> {
    // For now return empty array as user files are not implemented in database yet
    return [];
  }

  async deleteUserFile(fileId: string): Promise<void> {
    // For now do nothing as user files are not implemented in database yet
  }

  async getOrganizationFiles(): Promise<any[]> {
    // For now return empty array as organization files are not implemented in database yet
    return [];
  }

  // Missing interface methods
  async getAllMessages(): Promise<Message[]> {
    return await db.select().from(messages).orderBy(desc(messages.createdAt));
  }

  async createQAImprovementComment(comment: InsertQAImprovementComment): Promise<QAImprovementComment> {
    const [newComment] = await db.insert(qaImprovementComments).values(comment).returning();
    return newComment;
  }

  async getQAImprovementComment(conversationId: number): Promise<QAImprovementComment | undefined> {
    const [comment] = await db.select().from(qaImprovementComments).where(eq(qaImprovementComments.conversationId, conversationId));
    return comment;
  }

  async updateQAImprovementComment(conversationId: number, comment: string, updatedBy: string): Promise<QAImprovementComment | undefined> {
    const [updated] = await db.update(qaImprovementComments)
      .set({ comment, updatedAt: new Date() })
      .where(eq(qaImprovementComments.conversationId, conversationId))
      .returning();
    return updated;
  }

  // ============================================================================
  // Unified Chat System Implementation
  // ============================================================================

  // Unified Chat operations
  async createUnifiedChat(chatData: InsertUnifiedChat): Promise<UnifiedChat> {
    const [newChat] = await db.insert(unifiedChats).values(chatData).returning();
    return newChat;
  }

  async getUnifiedChat(id: number): Promise<UnifiedChat | undefined> {
    const [chat] = await db.select().from(unifiedChats).where(eq(unifiedChats.id, id));
    return chat;
  }

  async getUserUnifiedChats(userId: string): Promise<(UnifiedChat & { lastMessage?: ChatMessage | null; lastReadAt?: Date | null })[]> {
    // 사용자가 참가한 모든 채팅방 조회
    const result = await db
      .select({
        chat: unifiedChats,
        participant: chatParticipants,
      })
      .from(chatParticipants)
      .innerJoin(unifiedChats, eq(chatParticipants.chatId, unifiedChats.id))
      .where(and(
        eq(chatParticipants.userId, userId),
        eq(chatParticipants.participantType, "user"),
        eq(chatParticipants.isActive, true)
      ))
      .orderBy(desc(unifiedChats.lastMessageAt));

    // 각 채팅방의 마지막 메시지 가져오기
    const chatsWithMessages = await Promise.all(
      result.map(async ({ chat, participant }) => {
        const [lastMessage] = await db
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.chatId, chat.id))
          .orderBy(desc(chatMessages.createdAt))
          .limit(1);

        return {
          ...chat,
          lastMessage,
          lastReadAt: participant.lastReadAt,
        };
      })
    );

    return chatsWithMessages;
  }

  async updateUnifiedChat(id: number, updates: Partial<UnifiedChat>): Promise<UnifiedChat> {
    const [updatedChat] = await db
      .update(unifiedChats)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(unifiedChats.id, id))
      .returning();
    return updatedChat;
  }

  async deleteUnifiedChat(id: number): Promise<void> {
    // 관련된 메시지들 먼저 삭제
    await db.delete(chatMessages).where(eq(chatMessages.chatId, id));
    // 참가자들 삭제
    await db.delete(chatParticipants).where(eq(chatParticipants.chatId, id));
    // 채팅방 삭제
    await db.delete(unifiedChats).where(eq(unifiedChats.id, id));
  }

  async setChatResponseStatus(chatId: number, isBlocked: boolean, respondingAgentId?: number): Promise<void> {
    await db
      .update(unifiedChats)
      .set({
        isResponseBlocked: isBlocked,
        currentRespondingAgent: respondingAgentId || null,
        responseStartedAt: isBlocked ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(unifiedChats.id, chatId));
  }

  async getChatResponseStatus(chatId: number): Promise<{ isResponseBlocked: boolean; currentRespondingAgent?: number }> {
    const [chat] = await db
      .select({
        isResponseBlocked: unifiedChats.isResponseBlocked,
        currentRespondingAgent: unifiedChats.currentRespondingAgent,
      })
      .from(unifiedChats)
      .where(eq(unifiedChats.id, chatId));

    return {
      isResponseBlocked: chat?.isResponseBlocked || false,
      currentRespondingAgent: chat?.currentRespondingAgent || undefined,
    };
  }

  // Chat Participants operations
  async addChatParticipant(participantData: InsertChatParticipant): Promise<ChatParticipant> {
    const [newParticipant] = await db.insert(chatParticipants).values(participantData).returning();
    return newParticipant;
  }

  async removeChatParticipant(chatId: number, participantType: string, participantId: string | number): Promise<void> {
    if (participantType === "user") {
      await db
        .update(chatParticipants)
        .set({ isActive: false })
        .where(and(
          eq(chatParticipants.chatId, chatId),
          eq(chatParticipants.participantType, "user"),
          eq(chatParticipants.userId, participantId as string)
        ));
    } else if (participantType === "agent") {
      await db
        .update(chatParticipants)
        .set({ isActive: false })
        .where(and(
          eq(chatParticipants.chatId, chatId),
          eq(chatParticipants.participantType, "agent"),
          eq(chatParticipants.agentId, participantId as number)
        ));
    }
  }

  async getChatParticipants(chatId: number): Promise<(ChatParticipant & { user?: User | null; agent?: Agent | null })[]> {
    const result = await db
      .select({
        participant: chatParticipants,
        user: users,
        agent: agents,
      })
      .from(chatParticipants)
      .leftJoin(users, eq(chatParticipants.userId, users.id))
      .leftJoin(agents, eq(chatParticipants.agentId, agents.id))
      .where(and(
        eq(chatParticipants.chatId, chatId),
        eq(chatParticipants.isActive, true)
      ))
      .orderBy(chatParticipants.joinedAt);

    return result.map(({ participant, user, agent }) => ({
      ...participant,
      user: user as User | null,
      agent,
    }));
  }

  async updateChatParticipant(chatId: number, participantId: string | number, updates: Partial<ChatParticipant>): Promise<void> {
    // participantId가 userId인지 agentId인지에 따라 다르게 처리
    if (typeof participantId === "string") {
      await db
        .update(chatParticipants)
        .set(updates)
        .where(and(
          eq(chatParticipants.chatId, chatId),
          eq(chatParticipants.userId, participantId)
        ));
    } else {
      await db
        .update(chatParticipants)
        .set(updates)
        .where(and(
          eq(chatParticipants.chatId, chatId),
          eq(chatParticipants.agentId, participantId)
        ));
    }
  }

  // Unified Chat Messages operations
  async createChatMessage(messageData: InsertChatMessage): Promise<ChatMessage> {
    const [newMessage] = await db.insert(chatMessages).values(messageData).returning();
    
    // 채팅방의 lastMessageAt 업데이트
    await db
      .update(unifiedChats)
      .set({
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(unifiedChats.id, messageData.chatId));

    return newMessage;
  }

  async getChatMessages(chatId: number): Promise<(ChatMessage & { sender?: User | null; agent?: Agent | null })[]> {
    const result = await db
      .select({
        message: chatMessages,
        sender: users,
        agent: agents,
      })
      .from(chatMessages)
      .leftJoin(users, eq(chatMessages.senderId, users.id))
      .leftJoin(agents, eq(chatMessages.agentId, agents.id))
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(chatMessages.createdAt);

    return result.map(({ message, sender, agent }) => ({
      ...message,
      sender: sender as User | null,
      agent,
    }));
  }

  async markChatAsRead(chatId: number, userId: string): Promise<void> {
    await db
      .update(chatParticipants)
      .set({ lastReadAt: new Date() })
      .where(and(
        eq(chatParticipants.chatId, chatId),
        eq(chatParticipants.userId, userId),
        eq(chatParticipants.participantType, "user")
      ));
  }

  // Group Chat Response Status operations
  async setGroupChatResponseStatus(groupChatId: number, isBlocked: boolean, respondingAgentId?: number): Promise<void> {
    await db
      .update(groupChats)
      .set({
        isResponseBlocked: isBlocked,
        currentRespondingAgent: respondingAgentId || null,
        responseStartedAt: isBlocked ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(groupChats.id, groupChatId));
  }

  async getGroupChatResponseStatus(groupChatId: number): Promise<{ isResponseBlocked: boolean; currentRespondingAgent?: number }> {
    const [groupChat] = await db
      .select({
        isResponseBlocked: groupChats.isResponseBlocked,
        currentRespondingAgent: groupChats.currentRespondingAgent,
      })
      .from(groupChats)
      .where(eq(groupChats.id, groupChatId));

    return {
      isResponseBlocked: groupChat?.isResponseBlocked || false,
      currentRespondingAgent: groupChat?.currentRespondingAgent || undefined,
    };
  }

  // Atomic locking operation to prevent race conditions
  async lockGroupChatForResponse(groupChatId: number, respondingAgentId?: number): Promise<{ success: boolean; currentRespondingAgent?: number }> {
    try {
      // Atomic conditional update: only lock if not already locked
      const result = await db
        .update(groupChats)
        .set({
          isResponseBlocked: true,
          currentRespondingAgent: respondingAgentId || null,
          responseStartedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(
          eq(groupChats.id, groupChatId),
          eq(groupChats.isResponseBlocked, false) // Only update if not already blocked
        ))
        .returning({ 
          id: groupChats.id,
          currentRespondingAgent: groupChats.currentRespondingAgent 
        });

      if (result.length > 0) {
        // Successfully locked
        return { success: true, currentRespondingAgent: respondingAgentId };
      } else {
        // Failed to lock - already locked by another process
        // Get the current responding agent info
        const [currentStatus] = await db
          .select({
            currentRespondingAgent: groupChats.currentRespondingAgent,
          })
          .from(groupChats)
          .where(eq(groupChats.id, groupChatId));
        
        return { 
          success: false, 
          currentRespondingAgent: currentStatus?.currentRespondingAgent || undefined 
        };
      }
    } catch (error) {
      console.error('Error locking group chat for response:', error);
      return { success: false };
    }
  }

  // Centralized unlock operation with error handling
  async unlockGroupChatResponse(groupChatId: number): Promise<void> {
    try {
      await db
        .update(groupChats)
        .set({
          isResponseBlocked: false,
          currentRespondingAgent: null,
          responseStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(groupChats.id, groupChatId));
    } catch (error) {
      console.error('Error unlocking group chat response:', error);
      // Don't throw - this is cleanup code that shouldn't break the main flow
    }
  }

  // Recommended Characters operations
  async saveRecommendedCharacters(userId: string, topic: string, characters: any[]): Promise<void> {
    // 트랜잭션을 사용하여 원자성 보장
    await db.transaction(async (tx) => {
      let newCharactersSaved = 0;
      
      for (const character of characters) {
        try {
          // 캐릭터 해시 생성 (중복 방지용)
          const characterKey = `${character.name || ''}_${character.description || ''}_${character.personality || ''}_${topic}`;
          const characterHash = createHash('sha256').update(characterKey).digest('hex');
          
          // 중복 검사 및 삽입 (ON CONFLICT DO NOTHING)
          const insertResult = await tx
            .insert(recommendedCharacters)
            .values({
              userId,
              topic,
              characterData: character,
              characterHash
            })
            .onConflictDoNothing({ target: [recommendedCharacters.userId, recommendedCharacters.characterHash] });
          
          // 실제로 삽입된 경우에만 카운트
          if (insertResult.rowCount && insertResult.rowCount > 0) {
            newCharactersSaved++;
          }
        } catch (error) {
          console.error(`캐릭터 저장 실패 (${character.name}):`, error);
          // 개별 캐릭터 저장 실패는 전체 작업을 중단하지 않음
        }
      }
      
      if (newCharactersSaved > 0) {
        // 100개 제한 FIFO 관리
        const currentCountResult = await tx
          .select({ count: sql<number>`cast(count(*) as int)` })
          .from(recommendedCharacters)
          .where(eq(recommendedCharacters.userId, userId));
        
        const currentCount = Number(currentCountResult[0]?.count || 0);
        
        if (currentCount > 100) {
          // 가장 오래된 캐릭터들을 삭제하여 100개 제한 유지
          const deleteCount = currentCount - 100;
          const oldestCharacters = await tx
            .select({ id: recommendedCharacters.id })
            .from(recommendedCharacters)
            .where(eq(recommendedCharacters.userId, userId))
            .orderBy(recommendedCharacters.createdAt)
            .limit(deleteCount);
          
          if (oldestCharacters.length > 0) {
            const idsToDelete = oldestCharacters.map(char => char.id);
            await tx
              .delete(recommendedCharacters)
              .where(inArray(recommendedCharacters.id, idsToDelete));
          }
        }
        
        console.log(`[추천 캐릭터 저장] 사용자 ${userId}에 대해 주제 "${topic}"으로 ${newCharactersSaved}개 캐릭터 저장 완료 (중복 제거됨: ${characters.length - newCharactersSaved}개)`);
      } else {
        console.log(`[추천 캐릭터 저장] 사용자 ${userId}에 대해 주제 "${topic}" - 모든 캐릭터가 중복으로 저장되지 않음`);
      }
    });
  }

  async getUserRecommendedCharacters(userId: string): Promise<RecommendedCharacter[]> {
    try {
      const characters = await db
        .select()
        .from(recommendedCharacters)
        .where(eq(recommendedCharacters.userId, userId))
        .orderBy(desc(recommendedCharacters.createdAt));
      
      console.log(`[추천 캐릭터 조회] 사용자 ${userId}에 대해 ${characters.length}개 추천 캐릭터 조회`);
      return characters;
    } catch (error) {
      console.error('추천 캐릭터 조회 오류:', error);
      throw error;
    }
  }

  async updateRecommendedCharacterAgentId(characterId: number, agentId: number): Promise<void> {
    try {
      await db
        .update(recommendedCharacters)
        .set({ agentId })
        .where(eq(recommendedCharacters.id, characterId));
      
      console.log(`[추천 캐릭터 업데이트] 캐릭터 ${characterId}에 에이전트 ID ${agentId} 연결 완료`);
    } catch (error) {
      console.error(`[추천 캐릭터 업데이트] 에이전트 ID 업데이트 오류 (캐릭터 ${characterId}, 에이전트 ${agentId}):`, error);
      throw error;
    }
  }

  async getRecommendedCharactersWithAgent(): Promise<Array<RecommendedCharacter & { agent: Agent }>> {
    try {
      const results = await db
        .select({
          recommendedCharacter: recommendedCharacters,
          agent: agents
        })
        .from(recommendedCharacters)
        .innerJoin(agents, eq(recommendedCharacters.agentId, agents.id))
        .where(isNotNull(recommendedCharacters.agentId))
        .orderBy(desc(recommendedCharacters.createdAt));
      
      // 결과를 적절한 형태로 변환
      const formatted = results.map(row => ({
        ...row.recommendedCharacter,
        agent: row.agent
      }));
      
      console.log(`[추천 캐릭터 조회] 에이전트가 연결된 ${formatted.length}개 추천 캐릭터 조회`);
      return formatted;
    } catch (error) {
      console.error('[추천 캐릭터 조회 실패]:', error);
      throw error;
    }
  }

  async deleteRecommendedCharacter(characterId: number, userId: string): Promise<{ removedFromChats: number; agentName?: string }> {
    try {
      // 1. 추천 캐릭터 조회
      const [character] = await db
        .select()
        .from(recommendedCharacters)
        .where(and(
          eq(recommendedCharacters.id, characterId),
          eq(recommendedCharacters.userId, userId)
        ));

      if (!character) {
        throw new Error('추천 캐릭터를 찾을 수 없습니다.');
      }

      const characterData = typeof character.characterData === 'string'
        ? JSON.parse(character.characterData)
        : character.characterData;
      const characterName = characterData.name || '캐릭터';

      let removedFromChats = 0;
      let agentName: string | undefined;

      // 2. 연결된 에이전트가 있으면 그룹 채팅에서 제거
      if (character.agentId) {
        const agent = await this.getAgent(character.agentId);
        if (agent) {
          agentName = agent.name;

          // 해당 에이전트가 참여 중인 모든 그룹 채팅 조회
          const groupChatAssociations = await db
            .select({ groupChatId: groupChatAgents.groupChatId })
            .from(groupChatAgents)
            .where(eq(groupChatAgents.agentId, character.agentId));

          // 각 그룹 채팅에서 에이전트 제거 및 시스템 메시지 추가
          for (const association of groupChatAssociations) {
            try {
              // 에이전트 제거
              await this.removeGroupChatAgent(association.groupChatId, character.agentId);

              // 시스템 메시지 추가
              await this.createGroupChatMessage({
                groupChatId: association.groupChatId,
                content: `${agentName}이(가) 퇴장했습니다.`,
                senderId: null,
                agentId: null,
                replyOrder: undefined
              });

              removedFromChats++;
              console.log(`[추천 캐릭터 삭제] 에이전트 ${agentName} (ID: ${character.agentId})를 그룹 채팅 ${association.groupChatId}에서 제거`);
            } catch (error) {
              console.error(`[추천 캐릭터 삭제] 그룹 채팅 ${association.groupChatId}에서 에이전트 제거 실패:`, error);
            }
          }
        }
      }

      // 3. 추천 캐릭터 삭제
      await db
        .delete(recommendedCharacters)
        .where(eq(recommendedCharacters.id, characterId));

      console.log(`[추천 캐릭터 삭제] 캐릭터 ${characterName} (ID: ${characterId}) 삭제 완료 (${removedFromChats}개 채팅방에서 제거됨)`);

      return { removedFromChats, agentName };
    } catch (error) {
      console.error(`[추천 캐릭터 삭제] 오류 (캐릭터 ID ${characterId}):`, error);
      throw error;
    }
  }

  // Relationship Matrix operations (영구 저장)
  async saveRelationshipMatrix(groupChatId: number, matrix: any[]): Promise<void> {
    try {
      await db
        .update(groupChats)
        .set({
          relationshipMatrix: JSON.stringify(matrix),
          matrixGeneratedAt: new Date()
        })
        .where(eq(groupChats.id, groupChatId));
      
      console.log(`[🎭 관계 매트릭스] 그룹 채팅 ${groupChatId}에 관계 매트릭스 저장 완료 (${matrix.length}개 관계)`);
    } catch (error) {
      console.error(`[🎭 관계 매트릭스] 저장 오류 (그룹 채팅 ${groupChatId}):`, error);
      throw error;
    }
  }

  async getRelationshipMatrix(groupChatId: number): Promise<any[] | null> {
    try {
      const [groupChat] = await db
        .select({ relationshipMatrix: groupChats.relationshipMatrix })
        .from(groupChats)
        .where(eq(groupChats.id, groupChatId));
      
      if (!groupChat?.relationshipMatrix) {
        console.log(`[🎭 관계 매트릭스] 그룹 채팅 ${groupChatId}에 관계 매트릭스 없음`);
        return null;
      }
      
      const matrix = typeof groupChat.relationshipMatrix === 'string' 
        ? JSON.parse(groupChat.relationshipMatrix)
        : groupChat.relationshipMatrix;
      
      console.log(`[🎭 관계 매트릭스] 그룹 채팅 ${groupChatId}에서 관계 매트릭스 조회 완료 (${matrix.length}개 관계)`);
      return matrix;
    } catch (error) {
      console.error(`[🎭 관계 매트릭스] 조회 오류 (그룹 채팅 ${groupChatId}):`, error);
      return null;
    }
  }

  async deleteRelationshipMatrix(groupChatId: number): Promise<void> {
    try {
      await db
        .update(groupChats)
        .set({
          relationshipMatrix: null,
          matrixGeneratedAt: null
        })
        .where(eq(groupChats.id, groupChatId));
      
      console.log(`[🎭 관계 매트릭스] 그룹 채팅 ${groupChatId}의 관계 매트릭스 삭제 완료`);
    } catch (error) {
      console.error(`[🎭 관계 매트릭스] 삭제 오류 (그룹 채팅 ${groupChatId}):`, error);
      throw error;
    }
  }

  async hasRelationshipMatrix(groupChatId: number): Promise<boolean> {
    try {
      const [groupChat] = await db
        .select({ relationshipMatrix: groupChats.relationshipMatrix })
        .from(groupChats)
        .where(eq(groupChats.id, groupChatId));
      
      const hasMatrix = groupChat?.relationshipMatrix !== null && groupChat?.relationshipMatrix !== undefined;
      console.log(`[🎭 관계 매트릭스] 그룹 채팅 ${groupChatId} 관계 매트릭스 존재 여부: ${hasMatrix}`);
      return hasMatrix;
    } catch (error) {
      console.error(`[🎭 관계 매트릭스] 존재 여부 확인 오류 (그룹 채팅 ${groupChatId}):`, error);
      return false;
    }
  }
  
  // 🎯 시나리오 요약 저장
  async saveScenarioSummary(summaryData: { groupChatId: number; storySummary: string; characterStates: any; turnCount: number }): Promise<void> {
    try {
      await db.insert(scenarioSummaries).values({
        groupChatId: summaryData.groupChatId,
        storySummary: summaryData.storySummary,
        characterStates: summaryData.characterStates,
        turnCount: summaryData.turnCount,
      });
      console.log(`[🎯 시나리오 요약] 그룹 채팅 ${summaryData.groupChatId}에 요약 저장 완료 (턴: ${summaryData.turnCount})`);
    } catch (error) {
      console.error(`[🎯 시나리오 요약] 저장 오류 (그룹 채팅 ${summaryData.groupChatId}):`, error);
      throw error;
    }
  }
  
  // 🎯 최신 시나리오 요약 조회
  async getLatestScenarioSummary(groupChatId: number): Promise<{ storySummary: string; characterStates: any; turnCount: number } | null> {
    try {
      const [summary] = await db
        .select()
        .from(scenarioSummaries)
        .where(eq(scenarioSummaries.groupChatId, groupChatId))
        .orderBy(desc(scenarioSummaries.createdAt))
        .limit(1);
      
      if (!summary) {
        console.log(`[🎯 시나리오 요약] 그룹 채팅 ${groupChatId}에 요약 없음`);
        return null;
      }
      
      console.log(`[🎯 시나리오 요약] 그룹 채팅 ${groupChatId}에서 요약 조회 완료 (턴: ${summary.turnCount})`);
      return {
        storySummary: summary.storySummary,
        characterStates: summary.characterStates,
        turnCount: summary.turnCount || 0
      };
    } catch (error) {
      console.error(`[🎯 시나리오 요약] 조회 오류 (그룹 채팅 ${groupChatId}):`, error);
      return null;
    }
  }
  
  // 🎯 오래된 시나리오 요약 삭제 (최신 N개만 유지)
  async deleteOldScenarioSummaries(groupChatId: number, keepLatest: number = 3): Promise<void> {
    try {
      // 모든 요약 조회
      const allSummaries = await db
        .select({ id: scenarioSummaries.id })
        .from(scenarioSummaries)
        .where(eq(scenarioSummaries.groupChatId, groupChatId))
        .orderBy(desc(scenarioSummaries.createdAt));
      
      // 삭제할 요약 ID 계산 (최신 N개를 건너뛴 나머지)
      const summariesToDelete = allSummaries.slice(keepLatest);
      
      if (summariesToDelete.length === 0) {
        return;
      }
      
      const idsToDelete = summariesToDelete.map(s => s.id);
      
      // 삭제 실행
      await db
        .delete(scenarioSummaries)
        .where(inArray(scenarioSummaries.id, idsToDelete));
      
      console.log(`[🎯 시나리오 요약] 그룹 채팅 ${groupChatId}의 오래된 요약 ${idsToDelete.length}개 삭제 완료 (최신 ${keepLatest}개 유지)`);
    } catch (error) {
      console.error(`[🎯 시나리오 요약] 오래된 요약 삭제 오류 (그룹 채팅 ${groupChatId}):`, error);
      throw error;
    }
  }
  
  // 🎭 캐릭터 말하는 방식 패턴 조회
  async getCharacterSpeakingPattern(agentId: number): Promise<CharacterSpeakingPattern | undefined> {
    try {
      const [pattern] = await db
        .select()
        .from(characterSpeakingPatterns)
        .where(eq(characterSpeakingPatterns.agentId, agentId))
        .limit(1);
      
      return pattern as CharacterSpeakingPattern | undefined;
    } catch (error) {
      console.error(`[🎭 캐릭터 패턴] 조회 오류 (에이전트 ${agentId}):`, error);
      return undefined;
    }
  }
  
  // 🎭 캐릭터 말하는 방식 패턴 생성
  async createCharacterSpeakingPattern(pattern: InsertCharacterSpeakingPattern): Promise<CharacterSpeakingPattern> {
    try {
      const [created] = await db
        .insert(characterSpeakingPatterns)
        .values(pattern)
        .returning();
      
      console.log(`[🎭 캐릭터 패턴] 생성 완료 (에이전트 ${pattern.agentId})`);
      return created as CharacterSpeakingPattern;
    } catch (error) {
      console.error(`[🎭 캐릭터 패턴] 생성 오류:`, error);
      throw error;
    }
  }

  // 🎭 캐릭터 말하는 방식 패턴 업데이트
  async updateCharacterSpeakingPattern(agentId: number, updates: Partial<CharacterSpeakingPattern>): Promise<void> {
    try {
      await db
        .update(characterSpeakingPatterns)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(characterSpeakingPatterns.agentId, agentId));
      
      console.log(`[🎭 캐릭터 패턴] 업데이트 완료 (에이전트 ${agentId})`);
    } catch (error) {
      console.error(`[🎭 캐릭터 패턴] 업데이트 오류:`, error);
      throw error;
    }
  }

  // 🔄 표현 사용 이력 조회
  async getPhraseUsageHistory(
    agentId: number,
    conversationId?: number | null,
    groupChatId?: number | null
  ): Promise<PhraseUsageHistory | undefined> {
    try {
      const conditions = [eq(phraseUsageHistory.agentId, agentId)];
      
      if (conversationId !== undefined && conversationId !== null) {
        conditions.push(eq(phraseUsageHistory.conversationId, conversationId));
      } else if (groupChatId !== undefined && groupChatId !== null) {
        conditions.push(eq(phraseUsageHistory.groupChatId, groupChatId));
      }
      
      const [history] = await db
        .select()
        .from(phraseUsageHistory)
        .where(and(...conditions))
        .limit(1);
      
      return history as PhraseUsageHistory | undefined;
    } catch (error) {
      console.error(`[🔄 표현 이력] 조회 오류 (에이전트 ${agentId}):`, error);
      return undefined;
    }
  }

  // 🔄 표현 사용 이력 저장
  async savePhraseUsageHistory(data: InsertPhraseUsageHistory): Promise<void> {
    try {
      // Upsert 로직: 기존 이력이 있으면 업데이트, 없으면 생성
      const existing = await this.getPhraseUsageHistory(
        data.agentId,
        data.conversationId,
        data.groupChatId
      );

      if (existing) {
        await db
          .update(phraseUsageHistory)
          .set({
            usedPhrases: data.usedPhrases,
            lastUpdatedAt: new Date(),
          })
          .where(eq(phraseUsageHistory.id, existing.id));
        
        console.log(`[🔄 표현 이력] 업데이트 완료 (에이전트 ${data.agentId})`);
      } else {
        await db
          .insert(phraseUsageHistory)
          .values(data);
        
        console.log(`[🔄 표현 이력] 생성 완료 (에이전트 ${data.agentId})`);
      }
    } catch (error) {
      console.error(`[🔄 표현 이력] 저장 오류:`, error);
      throw error;
    }
  }
  
  // 🔄 에이전트 기본 강도를 사용자 설정에 동기화 (customIntensity=false인 항목만)
  async syncAgentIntensityToUsers(agentId: number, newIntensity: number): Promise<void> {
    try {
      const result = await db
        .update(groupChatUserAgentSettings)
        .set({ 
          debateIntensity: newIntensity.toString(),
          updatedAt: new Date()
        })
        .where(
          and(
            eq(groupChatUserAgentSettings.agentId, agentId),
            eq(groupChatUserAgentSettings.customIntensity, false)
          )
        );
      
      console.log(`[🔄 동기화 완료] 에이전트 ${agentId}의 기본 강도 ${newIntensity}를 ${result.rowCount || 0}개 사용자 설정에 반영`);
    } catch (error) {
      console.error(`[🔄 동기화 실패] 에이전트 ${agentId}:`, error);
      throw error;
    }
  }

  // 📊 대화 분석 결과 저장
  async saveConversationAnalytics(data: InsertConversationAnalytics): Promise<ConversationAnalytics> {
    try {
      const [created] = await db
        .insert(conversationAnalytics)
        .values(data)
        .returning();
      
      console.log(`[📊 분석 저장] 사용자 ${data.userId}, 기간: ${data.periodType} (${data.periodStart} ~ ${data.periodEnd})`);
      return created as ConversationAnalytics;
    } catch (error) {
      console.error(`[📊 분석 저장 실패]:`, error);
      throw error;
    }
  }

  // 📊 대화 분석 결과 조회
  async getConversationAnalytics(
    userId: string, 
    periodType: string,
    periodStart?: Date,
    periodEnd?: Date,
    conversationId?: number
  ): Promise<ConversationAnalytics[]> {
    try {
      const conditions = [eq(conversationAnalytics.userId, userId)];
      
      if (periodType) {
        conditions.push(eq(conversationAnalytics.periodType, periodType));
      }
      
      if (periodStart) {
        conditions.push(sql`${conversationAnalytics.periodStart} >= ${periodStart}`);
      }
      
      if (periodEnd) {
        conditions.push(sql`${conversationAnalytics.periodEnd} <= ${periodEnd}`);
      }
      
      if (conversationId !== undefined) {
        conditions.push(eq(conversationAnalytics.conversationId, conversationId));
      }
      
      const results = await db
        .select()
        .from(conversationAnalytics)
        .where(and(...conditions))
        .orderBy(desc(conversationAnalytics.periodStart));
      
      console.log(`[📊 분석 조회] 사용자 ${userId}, 기간: ${periodType}, 대화방: ${conversationId ?? '전체'}, ${results.length}개 결과`);
      return results as ConversationAnalytics[];
    } catch (error) {
      console.error(`[📊 분석 조회 실패]:`, error);
      throw error;
    }
  }

  // 📊 대화방별 마지막 분석 메시지 ID 조회 (기간 범위로 검색, ±1일 오차 허용)
  async getLastAnalyzedMessageId(conversationId: number, periodType: string, periodStart: Date, periodEnd: Date): Promise<number | null> {
    try {
      // ±1일의 오차를 허용하여 기존 분석 레코드 찾기
      const startLower = new Date(periodStart);
      startLower.setDate(startLower.getDate() - 1);
      
      const startUpper = new Date(periodStart);
      startUpper.setDate(startUpper.getDate() + 1);
      
      const endLower = new Date(periodEnd);
      endLower.setDate(endLower.getDate() - 1);
      
      const endUpper = new Date(periodEnd);
      endUpper.setDate(endUpper.getDate() + 1);
      
      const [result] = await db
        .select({ 
          lastAnalyzedMessageId: conversationAnalytics.lastAnalyzedMessageId,
          periodStart: conversationAnalytics.periodStart,
          periodEnd: conversationAnalytics.periodEnd
        })
        .from(conversationAnalytics)
        .where(
          and(
            eq(conversationAnalytics.conversationId, conversationId),
            eq(conversationAnalytics.periodType, periodType),
            sql`${conversationAnalytics.periodStart} BETWEEN ${startLower} AND ${startUpper}`,
            sql`${conversationAnalytics.periodEnd} BETWEEN ${endLower} AND ${endUpper}`
          )
        )
        .limit(1);
      
      if (result) {
        console.log(`[📊 기존 분석 발견] 대화방 ${conversationId}, 기간: ${result.periodStart} ~ ${result.periodEnd}, 마지막 메시지 ID: ${result.lastAnalyzedMessageId}`);
      }
      
      return result?.lastAnalyzedMessageId || null;
    } catch (error) {
      console.error(`[📊 마지막 분석 메시지 ID 조회 실패]:`, error);
      return null;
    }
  }

  // 📊 대화방의 미분석 메시지 조회 (그룹 채팅용)
  async getUnanalyzedMessages(conversationId: number, lastAnalyzedMessageId: number | null, periodStart: Date, periodEnd: Date): Promise<any[]> {
    try {
      const conditions = [
        eq(groupChatMessages.groupChatId, conversationId),
        sql`${groupChatMessages.createdAt} >= ${periodStart}`,
        sql`${groupChatMessages.createdAt} <= ${periodEnd}`
      ];
      
      // 마지막 분석 메시지 ID 이후의 메시지만 가져오기
      if (lastAnalyzedMessageId) {
        conditions.push(sql`${groupChatMessages.id} > ${lastAnalyzedMessageId}`);
      }
      
      const unanalyzedMessages = await db
        .select()
        .from(groupChatMessages)
        .where(and(...conditions))
        .orderBy(groupChatMessages.createdAt);
      
      console.log(`[📊 미분석 메시지] 대화방 ${conversationId}, ${unanalyzedMessages.length}개 메시지 (마지막 분석 ID: ${lastAnalyzedMessageId || '없음'})`);
      return unanalyzedMessages;
    } catch (error) {
      console.error(`[📊 미분석 메시지 조회 실패]:`, error);
      throw error;
    }
  }

  // 📊 대화 분석 결과 업데이트 (증분 분석용, ±1일 오차 허용)
  async updateConversationAnalytics(
    conversationId: number,
    periodType: string,
    periodStart: Date,
    periodEnd: Date,
    categoryData: Record<string, number>,
    totalMessages: number,
    lastAnalyzedMessageId: number
  ): Promise<ConversationAnalytics> {
    try {
      // ±1일의 오차를 허용하여 기존 레코드 찾기
      const startLower = new Date(periodStart);
      startLower.setDate(startLower.getDate() - 1);
      
      const startUpper = new Date(periodStart);
      startUpper.setDate(startUpper.getDate() + 1);
      
      const endLower = new Date(periodEnd);
      endLower.setDate(endLower.getDate() - 1);
      
      const endUpper = new Date(periodEnd);
      endUpper.setDate(endUpper.getDate() + 1);
      
      const [updated] = await db
        .update(conversationAnalytics)
        .set({
          categoryData,
          totalMessages,
          lastAnalyzedMessageId,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(conversationAnalytics.conversationId, conversationId),
            eq(conversationAnalytics.periodType, periodType),
            sql`${conversationAnalytics.periodStart} BETWEEN ${startLower} AND ${startUpper}`,
            sql`${conversationAnalytics.periodEnd} BETWEEN ${endLower} AND ${endUpper}`
          )
        )
        .returning();
      
      console.log(`[📊 분석 업데이트] 대화방 ${conversationId}, 기간: ${periodType}, 총 ${totalMessages}개 메시지, 마지막 메시지 ID: ${lastAnalyzedMessageId}`);
      return updated as ConversationAnalytics;
    } catch (error) {
      console.error(`[📊 분석 업데이트 실패]:`, error);
      throw error;
    }
  }

  // 📊 사용자의 모든 메시지 조회 (1:1 + 그룹)
  async getUserMessages(userId: string, startDate?: Date, endDate?: Date): Promise<{
    oneOnOneMessages: Message[];
    groupChatMessages: any[];
  }> {
    try {
      // 1:1 대화 메시지
      const conversationConditions: any[] = [];
      
      const userConvs = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.userId, userId));
      
      const convIds = userConvs.map(c => c.id);
      
      const messageConditions = convIds.length > 0 ? [inArray(messages.conversationId, convIds)] : [];
      if (startDate) {
        messageConditions.push(sql`${messages.createdAt} >= ${startDate}`);
      }
      if (endDate) {
        messageConditions.push(sql`${messages.createdAt} <= ${endDate}`);
      }
      
      const oneOnOneMessages = convIds.length > 0
        ? await db
            .select()
            .from(messages)
            .where(and(...messageConditions))
            .orderBy(messages.createdAt)
        : [];
      
      // 그룹 채팅 메시지
      const userGroupChats = await db
        .select({ groupChatId: groupChatMembers.groupChatId })
        .from(groupChatMembers)
        .where(eq(groupChatMembers.userId, userId));
      
      const groupChatIds = userGroupChats.map(g => g.groupChatId);
      
      const groupMessageConditions = groupChatIds.length > 0 ? [inArray(groupChatMessages.groupChatId, groupChatIds)] : [];
      if (startDate) {
        groupMessageConditions.push(sql`${groupChatMessages.createdAt} >= ${startDate}`);
      }
      if (endDate) {
        groupMessageConditions.push(sql`${groupChatMessages.createdAt} <= ${endDate}`);
      }
      
      const groupMessages = groupChatIds.length > 0
        ? await db
            .select()
            .from(groupChatMessages)
            .where(and(...groupMessageConditions))
            .orderBy(groupChatMessages.createdAt)
        : [];
      
      console.log(`[📊 메시지 조회] 사용자 ${userId}: 1:1 ${oneOnOneMessages.length}개, 그룹 ${groupMessages.length}개`);
      
      return {
        oneOnOneMessages: oneOnOneMessages as Message[],
        groupChatMessages: groupMessages
      };
    } catch (error) {
      console.error(`[📊 메시지 조회 실패]:`, error);
      throw error;
    }
  }

  // ==================== 카드 레이아웃 시스템 ====================
  
  // 폴더 생성
  async createCardFolder(data: InsertCardFolder): Promise<CardFolder> {
    try {
      const [folder] = await db.insert(cardFolders).values(data).returning();
      console.log(`[📁 폴더 생성] ID: ${folder.id}, 제목: ${folder.title}`);
      return folder as CardFolder;
    } catch (error) {
      console.error('[📁 폴더 생성 실패]:', error);
      throw error;
    }
  }

  // 모든 폴더 조회
  async getAllCardFolders(): Promise<CardFolder[]> {
    try {
      const folders = await db.select().from(cardFolders).orderBy(desc(cardFolders.createdAt));
      return folders as CardFolder[];
    } catch (error) {
      console.error('[📁 폴더 조회 실패]:', error);
      throw error;
    }
  }

  // 특정 폴더 조회
  async getCardFolderById(id: number): Promise<CardFolder | undefined> {
    try {
      const [folder] = await db.select().from(cardFolders).where(eq(cardFolders.id, id));
      return folder as CardFolder | undefined;
    } catch (error) {
      console.error(`[📁 폴더 조회 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 폴더 업데이트
  async updateCardFolder(id: number, data: Partial<InsertCardFolder>): Promise<CardFolder> {
    try {
      const [updated] = await db
        .update(cardFolders)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(cardFolders.id, id))
        .returning();
      console.log(`[📁 폴더 업데이트] ID: ${id}`);
      return updated as CardFolder;
    } catch (error) {
      console.error(`[📁 폴더 업데이트 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 폴더 삭제
  async deleteCardFolder(id: number): Promise<void> {
    try {
      await db.delete(cardFolders).where(eq(cardFolders.id, id));
      console.log(`[📁 폴더 삭제] ID: ${id}`);
    } catch (error) {
      console.error(`[📁 폴더 삭제 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 카드 생성
  async createCardItem(data: InsertCardItem): Promise<CardItem> {
    try {
      const [card] = await db.insert(cardItems).values(data).returning();
      console.log(`[🎴 카드 생성] ID: ${card.id}, 타입: ${card.type}, 제목: ${card.title}`);
      return card as CardItem;
    } catch (error) {
      console.error('[🎴 카드 생성 실패]:', error);
      throw error;
    }
  }

  // 홈 화면 카드 조회 (parentFolderId가 null인 것들)
  async getHomeCardItems(userId?: string): Promise<(CardItem & { unreadCount?: number; recentMessages?: any[] })[]> {
    try {
      const cards = await db
        .select()
        .from(cardItems)
        .where(sql`${cardItems.parentFolderId} IS NULL`)
        .orderBy(cardItems.position, cardItems.createdAt);
      
      // userId가 있으면 각 채팅방 카드의 unreadCount와 최근 메시지를 가져옴
      if (userId) {
        const cardsWithData = await Promise.all(
          cards.map(async (card) => {
            if (card.type === 'chat' && card.chatRoomId) {
              // unreadCount 조회
              const [member] = await db
                .select({ unreadCount: groupChatMembers.unreadCount })
                .from(groupChatMembers)
                .where(
                  and(
                    eq(groupChatMembers.groupChatId, card.chatRoomId),
                    eq(groupChatMembers.userId, userId)
                  )
                );
              
              // 최근 메시지 3개 조회 (DESC 정렬로 최신 메시지 먼저)
              const allMessages = await this.getGroupChatMessages(card.chatRoomId, 10000);
              const recentMessages = allMessages
                .filter((msg: any) => msg.senderType !== 'system') // 시스템 메시지 제외
                .slice(-3) // 마지막 3개 메시지
                .reverse(); // 최신 메시지가 위로 오도록 역순
              
              return { 
                ...card, 
                unreadCount: member?.unreadCount || 0,
                recentMessages
              };
            }
            return card;
          })
        );
        return cardsWithData;
      }
      
      return cards as CardItem[];
    } catch (error) {
      console.error('[🎴 홈 카드 조회 실패]:', error);
      throw error;
    }
  }

  // 특정 폴더 내 카드 조회
  async getFolderCardItems(folderId: number, userId?: string): Promise<(CardItem & { unreadCount?: number; recentMessages?: any[] })[]> {
    try {
      const cards = await db
        .select()
        .from(cardItems)
        .where(eq(cardItems.parentFolderId, folderId))
        .orderBy(cardItems.position, cardItems.createdAt);
      
      // userId가 있으면 각 채팅방 카드의 unreadCount와 최근 메시지를 가져옴
      if (userId) {
        const cardsWithData = await Promise.all(
          cards.map(async (card) => {
            if (card.type === 'chat' && card.chatRoomId) {
              // unreadCount 조회
              const [member] = await db
                .select({ unreadCount: groupChatMembers.unreadCount })
                .from(groupChatMembers)
                .where(
                  and(
                    eq(groupChatMembers.groupChatId, card.chatRoomId),
                    eq(groupChatMembers.userId, userId)
                  )
                );
              
              // 최근 메시지 3개 조회 (DESC 정렬로 최신 메시지 먼저)
              const allMessages = await this.getGroupChatMessages(card.chatRoomId, 10000);
              const recentMessages = allMessages
                .filter((msg: any) => msg.senderType !== 'system') // 시스템 메시지 제외
                .slice(-3) // 마지막 3개 메시지
                .reverse(); // 최신 메시지가 위로 오도록 역순
              
              return { 
                ...card, 
                unreadCount: member?.unreadCount || 0,
                recentMessages
              };
            }
            return card;
          })
        );
        return cardsWithData;
      }
      
      return cards as CardItem[];
    } catch (error) {
      console.error(`[🎴 폴더 카드 조회 실패] 폴더 ID: ${folderId}:`, error);
      throw error;
    }
  }

  // 특정 카드 조회
  async getCardItemById(id: number): Promise<CardItem | undefined> {
    try {
      const [card] = await db.select().from(cardItems).where(eq(cardItems.id, id));
      return card as CardItem | undefined;
    } catch (error) {
      console.error(`[🎴 카드 조회 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 카드 업데이트
  async updateCardItem(id: number, data: Partial<InsertCardItem>): Promise<CardItem> {
    try {
      const [updated] = await db
        .update(cardItems)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(cardItems.id, id))
        .returning();
      console.log(`[🎴 카드 업데이트] ID: ${id}`);
      return updated as CardItem;
    } catch (error) {
      console.error(`[🎴 카드 업데이트 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 여러 카드의 순서 일괄 업데이트 (드래그 앤 드롭용)
  async updateCardPositions(updates: Array<{ id: number; position: number }>): Promise<void> {
    try {
      for (const update of updates) {
        const { id, position } = update;
        await db.update(cardItems).set({ position, updatedAt: new Date() }).where(eq(cardItems.id, id));
      }
      console.log(`[🎴 카드 순서 일괄 업데이트] ${updates.length}개 카드 업데이트 완료`);
    } catch (error) {
      console.error('[🎴 카드 순서 업데이트 실패]:', error);
      throw error;
    }
  }

  // 카드 삭제
  async deleteCardItem(id: number): Promise<void> {
    try {
      // 외래 키 제약을 피하기 위해 먼저 user_card_views 삭제
      await db.delete(userCardViews).where(eq(userCardViews.cardItemId, id));
      
      // 카드 아이템 삭제
      await db.delete(cardItems).where(eq(cardItems.id, id));
      console.log(`[🎴 카드 삭제] ID: ${id}`);
    } catch (error) {
      console.error(`[🎴 카드 삭제 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // ==================== NEW 뱃지 관련 ====================

  // 카드를 "읽음" 상태로 표시 (처음 클릭 시)
  async markCardAsViewed(userId: string, cardItemId: number): Promise<UserCardView> {
    try {
      // 이미 조회한 적이 있는지 확인
      const [existing] = await db
        .select()
        .from(userCardViews)
        .where(and(eq(userCardViews.userId, userId), eq(userCardViews.cardItemId, cardItemId)));

      if (existing) {
        return existing as UserCardView;
      }

      // 없으면 새로 생성
      const [view] = await db
        .insert(userCardViews)
        .values({ userId, cardItemId })
        .returning();
      
      console.log(`[🎴 카드 조회 기록] userId: ${userId}, cardItemId: ${cardItemId}`);
      return view as UserCardView;
    } catch (error) {
      console.error('[🎴 카드 조회 기록 실패]:', error);
      throw error;
    }
  }

  // 사용자의 모든 카드 조회 기록 가져오기
  async getUserCardViews(userId: string): Promise<UserCardView[]> {
    try {
      const views = await db
        .select()
        .from(userCardViews)
        .where(eq(userCardViews.userId, userId));
      return views as UserCardView[];
    } catch (error) {
      console.error('[🎴 카드 조회 기록 조회 실패]:', error);
      throw error;
    }
  }

  // 그룹 채팅을 "읽음" 상태로 표시 (처음 열 때)
  async markGroupChatAsViewed(userId: string, groupChatId: number): Promise<void> {
    try {
      // 이미 firstViewedAt이 설정되어 있는지 확인
      const [member] = await db
        .select()
        .from(groupChatMembers)
        .where(and(eq(groupChatMembers.userId, userId), eq(groupChatMembers.groupChatId, groupChatId)));

      if (!member) {
        console.warn(`[⚠️ 그룹 채팅 멤버 없음] userId: ${userId}, groupChatId: ${groupChatId}`);
        return;
      }

      // firstViewedAt이 null인 경우에만 업데이트
      if (!member.firstViewedAt) {
        await db
          .update(groupChatMembers)
          .set({ firstViewedAt: new Date() })
          .where(and(eq(groupChatMembers.userId, userId), eq(groupChatMembers.groupChatId, groupChatId)));
        
        console.log(`[💬 그룹 채팅 조회 기록] userId: ${userId}, groupChatId: ${groupChatId}`);
      }
    } catch (error) {
      console.error('[💬 그룹 채팅 조회 기록 실패]:', error);
      throw error;
    }
  }

  // ==================== 게시판 관련 ====================

  // 모든 활성화된 게시판 목록 조회 (order 순으로 정렬)
  async getBoards(): Promise<Board[]> {
    try {
      const result = await db
        .select()
        .from(boards)
        .where(eq(boards.isActive, true))
        .orderBy(boards.order);
      return result as Board[];
    } catch (error) {
      console.error('[📋 게시판 목록 조회 실패]:', error);
      throw error;
    }
  }

  // 특정 게시판 조회
  async getBoardById(id: number): Promise<Board | null> {
    try {
      const [result] = await db
        .select()
        .from(boards)
        .where(eq(boards.id, id));
      return result ? (result as Board) : null;
    } catch (error) {
      console.error(`[📋 게시판 조회 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 게시판 생성 (운영자 전용)
  async createBoard(data: InsertBoard): Promise<Board> {
    try {
      const [result] = await db
        .insert(boards)
        .values(data)
        .returning();
      console.log(`[📋 게시판 생성] 제목: ${data.title}`);
      return result as Board;
    } catch (error) {
      console.error('[📋 게시판 생성 실패]:', error);
      throw error;
    }
  }

  // 게시판 업데이트
  async updateBoard(id: number, data: Partial<InsertBoard>): Promise<Board> {
    try {
      const [result] = await db
        .update(boards)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(boards.id, id))
        .returning();
      console.log(`[📋 게시판 업데이트] ID: ${id}`);
      return result as Board;
    } catch (error) {
      console.error(`[📋 게시판 업데이트 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 게시판의 게시물 목록 조회 (고정 게시물 우선, 최신순)
  async getBoardPosts(boardId: number): Promise<BoardPost[]> {
    try {
      const result = await db
        .select()
        .from(boardPosts)
        .where(eq(boardPosts.boardId, boardId))
        .orderBy(desc(boardPosts.isPinned), desc(boardPosts.createdAt));
      return result as BoardPost[];
    } catch (error) {
      console.error(`[📝 게시물 목록 조회 실패] boardId: ${boardId}:`, error);
      throw error;
    }
  }

  // 특정 게시물 조회
  async getBoardPostById(id: number): Promise<BoardPost | null> {
    try {
      const [result] = await db
        .select()
        .from(boardPosts)
        .where(eq(boardPosts.id, id));
      return result ? (result as BoardPost) : null;
    } catch (error) {
      console.error(`[📝 게시물 조회 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 게시물 작성 (운영자 전용)
  async createBoardPost(data: InsertBoardPost): Promise<BoardPost> {
    try {
      const [result] = await db
        .insert(boardPosts)
        .values(data)
        .returning();
      console.log(`[📝 게시물 작성] 제목: ${data.title}`);
      return result as BoardPost;
    } catch (error) {
      console.error('[📝 게시물 작성 실패]:', error);
      throw error;
    }
  }

  // 게시물 수정
  async updateBoardPost(id: number, data: Partial<InsertBoardPost>): Promise<BoardPost> {
    try {
      const [result] = await db
        .update(boardPosts)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(boardPosts.id, id))
        .returning();
      console.log(`[📝 게시물 업데이트] ID: ${id}`);
      return result as BoardPost;
    } catch (error) {
      console.error(`[📝 게시물 업데이트 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 게시물 삭제
  async deleteBoardPost(id: number): Promise<void> {
    try {
      await db
        .delete(boardPosts)
        .where(eq(boardPosts.id, id));
      console.log(`[📝 게시물 삭제] ID: ${id}`);
    } catch (error) {
      console.error(`[📝 게시물 삭제 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 게시물 조회수 증가
  async incrementPostViewCount(id: number): Promise<void> {
    try {
      await db
        .update(boardPosts)
        .set({ viewCount: sql`${boardPosts.viewCount} + 1` })
        .where(eq(boardPosts.id, id));
    } catch (error) {
      console.error(`[📝 조회수 증가 실패] ID: ${id}:`, error);
      throw error;
    }
  }

  // 토큰 사용량 로깅
  async logTokenUsage(data: InsertTokenUsage): Promise<TokenUsage> {
    try {
      const [result] = await db
        .insert(tokenUsage)
        .values(data)
        .returning();
      return result as TokenUsage;
    } catch (error) {
      console.error('[🔥 토큰 사용량 로깅 실패]:', error);
      throw error;
    }
  }

  // 토큰 사용량 통계 조회 (실시간 게이지용)
  async getTokenUsageStats(periodHours?: number): Promise<{
    totalTokens: number;
    totalCost: number;
    promptTokens: number;
    completionTokens: number;
    requestCount: number;
  }> {
    try {
      const query = db
        .select({
          totalTokens: sql<number>`COALESCE(SUM(${tokenUsage.totalTokens}), 0)`,
          totalCost: sql<number>`COALESCE(SUM(${tokenUsage.estimatedCost}), 0)`,
          promptTokens: sql<number>`COALESCE(SUM(${tokenUsage.promptTokens}), 0)`,
          completionTokens: sql<number>`COALESCE(SUM(${tokenUsage.completionTokens}), 0)`,
          requestCount: sql<number>`COUNT(*)`,
        })
        .from(tokenUsage);

      if (periodHours) {
        const cutoffTime = new Date(Date.now() - periodHours * 60 * 60 * 1000);
        query.where(sql`${tokenUsage.timestamp} >= ${cutoffTime}`);
      }

      const [result] = await query;
      return result as {
        totalTokens: number;
        totalCost: number;
        promptTokens: number;
        completionTokens: number;
        requestCount: number;
      };
    } catch (error) {
      console.error('[🔥 토큰 통계 조회 실패]:', error);
      throw error;
    }
  }

  // 기간별 토큰 사용량 그래프 데이터
  async getTokenUsageByPeriod(periodHours: number, intervalMinutes: number = 60): Promise<Array<{
    timestamp: Date;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }>> {
    try {
      const cutoffTime = new Date(Date.now() - periodHours * 60 * 60 * 1000);
      
      const result = await db
        .select({
          timestamp: sql<Date>`date_trunc('hour', ${tokenUsage.timestamp})`,
          totalTokens: sql<number>`COALESCE(SUM(${tokenUsage.totalTokens}), 0)`,
          totalCost: sql<number>`COALESCE(SUM(${tokenUsage.estimatedCost}), 0)`,
          requestCount: sql<number>`COUNT(*)`,
        })
        .from(tokenUsage)
        .where(sql`${tokenUsage.timestamp} >= ${cutoffTime}`)
        .groupBy(sql`date_trunc('hour', ${tokenUsage.timestamp})`)
        .orderBy(sql`date_trunc('hour', ${tokenUsage.timestamp})`);

      return result as Array<{
        timestamp: Date;
        totalTokens: number;
        totalCost: number;
        requestCount: number;
      }>;
    } catch (error) {
      console.error('[🔥 기간별 토큰 조회 실패]:', error);
      throw error;
    }
  }

  // 최근 토큰 사용 로그 (실시간 스크롤용)
  async getRecentTokenUsage(limit: number = 50): Promise<TokenUsage[]> {
    try {
      const result = await db
        .select()
        .from(tokenUsage)
        .orderBy(desc(tokenUsage.timestamp))
        .limit(limit);
      return result as TokenUsage[];
    } catch (error) {
      console.error('[🔥 최근 토큰 로그 조회 실패]:', error);
      throw error;
    }
  }

  // 기능별 토큰 사용량 분석
  async getTokenUsageByFeature(periodHours?: number): Promise<Array<{
    feature: string;
    totalTokens: number;
    totalCost: number;
    requestCount: number;
  }>> {
    try {
      const query = db
        .select({
          feature: tokenUsage.feature,
          totalTokens: sql<number>`COALESCE(SUM(${tokenUsage.totalTokens}), 0)`,
          totalCost: sql<number>`COALESCE(SUM(${tokenUsage.estimatedCost}), 0)`,
          requestCount: sql<number>`COUNT(*)`,
        })
        .from(tokenUsage)
        .groupBy(tokenUsage.feature);

      if (periodHours) {
        const cutoffTime = new Date(Date.now() - periodHours * 60 * 60 * 1000);
        query.where(sql`${tokenUsage.timestamp} >= ${cutoffTime}`);
      }

      const result = await query;
      return result as Array<{
        feature: string;
        totalTokens: number;
        totalCost: number;
        requestCount: number;
      }>;
    } catch (error) {
      console.error('[🔥 기능별 토큰 조회 실패]:', error);
      throw error;
    }
  }

  // ========================================
  // 🎯 토큰 절감을 위한 프롬프트 압축 엔진 구현
  // ========================================

  // Canon Lock operations
  async getAgentCanon(agentId: number): Promise<AgentCanon | undefined> {
    const [result] = await db
      .select()
      .from(agentCanon)
      .where(eq(agentCanon.agentId, agentId));
    return result;
  }

  async createOrUpdateAgentCanon(agentId: number, data: Omit<InsertAgentCanon, 'agentId'>): Promise<AgentCanon> {
    const [result] = await db
      .insert(agentCanon)
      .values({ agentId, ...data })
      .onConflictDoUpdate({
        target: agentCanon.agentId,
        set: { ...data, updatedAt: sql`NOW()` }
      })
      .returning();
    return result;
  }

  // Humor settings operations
  async getAgentHumor(agentId: number): Promise<AgentHumor | undefined> {
    const [result] = await db
      .select()
      .from(agentHumor)
      .where(eq(agentHumor.agentId, agentId));
    return result;
  }

  async createOrUpdateAgentHumor(agentId: number, data: Omit<InsertAgentHumor, 'agentId'>): Promise<AgentHumor> {
    const [result] = await db
      .insert(agentHumor)
      .values({ agentId, ...data })
      .onConflictDoUpdate({
        target: agentHumor.agentId,
        set: { ...data, updatedAt: sql`NOW()` }
      })
      .returning();
    return result;
  }

  // Graph-RAG Entity operations
  async createRagEntity(entity: InsertRagEntity): Promise<RagEntity> {
    const [result] = await db
      .insert(ragEntities)
      .values(entity)
      .returning();
    return result;
  }

  async getRagEntity(id: number): Promise<RagEntity | undefined> {
    const [result] = await db
      .select()
      .from(ragEntities)
      .where(eq(ragEntities.id, id));
    return result;
  }

  async getRagEntitiesByType(type: string): Promise<RagEntity[]> {
    return await db
      .select()
      .from(ragEntities)
      .where(eq(ragEntities.type, type));
  }

  async getRagEntityByExternalId(type: string, externalId: string): Promise<RagEntity | undefined> {
    const [result] = await db
      .select()
      .from(ragEntities)
      .where(and(
        eq(ragEntities.type, type),
        eq(ragEntities.externalId, externalId)
      ));
    return result;
  }

  async updateRagEntity(id: number, updates: Partial<RagEntity>): Promise<RagEntity> {
    const [result] = await db
      .update(ragEntities)
      .set({ ...updates, updatedAt: sql`NOW()` })
      .where(eq(ragEntities.id, id))
      .returning();
    return result;
  }

  async deleteRagEntity(id: number): Promise<void> {
    await db
      .delete(ragEntities)
      .where(eq(ragEntities.id, id));
  }

  // Graph-RAG Edge operations
  async createRagEdge(edge: InsertRagEdge): Promise<RagEdge> {
    const [result] = await db
      .insert(ragEdges)
      .values(edge)
      .returning();
    return result;
  }

  async getRagEdge(id: number): Promise<RagEdge | undefined> {
    const [result] = await db
      .select()
      .from(ragEdges)
      .where(eq(ragEdges.id, id));
    return result;
  }

  async getRagEdgesByEntity(entityId: number, direction: 'from' | 'to' | 'both' = 'both'): Promise<RagEdge[]> {
    if (direction === 'from') {
      return await db
        .select()
        .from(ragEdges)
        .where(eq(ragEdges.fromEntityId, entityId));
    } else if (direction === 'to') {
      return await db
        .select()
        .from(ragEdges)
        .where(eq(ragEdges.toEntityId, entityId));
    } else {
      return await db
        .select()
        .from(ragEdges)
        .where(sql`${ragEdges.fromEntityId} = ${entityId} OR ${ragEdges.toEntityId} = ${entityId}`);
    }
  }

  async getRagEdgesByType(type: string): Promise<RagEdge[]> {
    return await db
      .select()
      .from(ragEdges)
      .where(eq(ragEdges.type, type));
  }

  async updateRagEdge(id: number, updates: Partial<RagEdge>): Promise<RagEdge> {
    const [result] = await db
      .update(ragEdges)
      .set({ ...updates, updatedAt: sql`NOW()` })
      .where(eq(ragEdges.id, id))
      .returning();
    return result;
  }

  async deleteRagEdge(id: number): Promise<void> {
    await db
      .delete(ragEdges)
      .where(eq(ragEdges.id, id));
  }

  // Graph-RAG Memory operations
  async createRagMemory(memory: InsertRagMemory): Promise<RagMemory> {
    const [result] = await db
      .insert(ragMemories)
      .values(memory)
      .returning();
    return result;
  }

  async getRagMemory(id: number): Promise<RagMemory | undefined> {
    const [result] = await db
      .select()
      .from(ragMemories)
      .where(eq(ragMemories.id, id));
    return result;
  }

  async getRagMemoriesByEntity(entityId: number, limit: number = 50): Promise<RagMemory[]> {
    return await db
      .select()
      .from(ragMemories)
      .where(eq(ragMemories.entityId, entityId))
      .orderBy(desc(ragMemories.createdAt))
      .limit(limit);
  }

  async getRagMemoriesByConversation(conversationId: number): Promise<RagMemory[]> {
    return await db
      .select()
      .from(ragMemories)
      .where(eq(ragMemories.conversationId, conversationId))
      .orderBy(desc(ragMemories.createdAt));
  }

  async getImportantRagMemories(entityId: number, minImportance: number, limit: number = 20): Promise<RagMemory[]> {
    return await db
      .select()
      .from(ragMemories)
      .where(and(
        eq(ragMemories.entityId, entityId),
        sql`${ragMemories.importance} >= ${minImportance}`
      ))
      .orderBy(desc(ragMemories.importance), desc(ragMemories.createdAt))
      .limit(limit);
  }

  async updateRagMemory(id: number, updates: Partial<RagMemory>): Promise<RagMemory> {
    const [result] = await db
      .update(ragMemories)
      .set(updates)
      .where(eq(ragMemories.id, id))
      .returning();
    return result;
  }

  async deleteRagMemory(id: number): Promise<void> {
    await db
      .delete(ragMemories)
      .where(eq(ragMemories.id, id));
  }

  async deleteExpiredRagMemories(): Promise<number> {
    const result = await db
      .delete(ragMemories)
      .where(and(
        sql`${ragMemories.expiresAt} IS NOT NULL`,
        sql`${ragMemories.expiresAt} < NOW()`
      ));
    return result.rowCount || 0;
  }
  
  // ========================================
  // 🎯 Canon-Style 분리 아키텍처 Operations
  // ========================================
  
  // Canon Profile operations - "무엇을 말할지" (지식/사실/교리)
  async getCanonProfile(id: number): Promise<CanonProfile | undefined> {
    const [result] = await db
      .select()
      .from(canonProfiles)
      .where(eq(canonProfiles.id, id));
    return result;
  }
  
  async getCanonProfileByName(name: string): Promise<CanonProfile | undefined> {
    const [result] = await db
      .select()
      .from(canonProfiles)
      .where(eq(canonProfiles.name, name));
    return result;
  }
  
  async createCanonProfile(data: InsertCanonProfile): Promise<CanonProfile> {
    const [result] = await db
      .insert(canonProfiles)
      .values(data)
      .returning();
    console.log(`[🎯 Canon Profile] 생성 완료: ${data.name}`);
    return result;
  }
  
  async updateCanonProfile(id: number, updates: Partial<CanonProfile>): Promise<CanonProfile> {
    const [result] = await db
      .update(canonProfiles)
      .set({ ...updates, updatedAt: sql`NOW()` })
      .where(eq(canonProfiles.id, id))
      .returning();
    console.log(`[🎯 Canon Profile] 업데이트 완료: ID ${id}`);
    return result;
  }
  
  async getAllCanonProfiles(): Promise<CanonProfile[]> {
    const results = await db
      .select()
      .from(canonProfiles)
      .orderBy(canonProfiles.id);
    return results;
  }
  
  async deleteCanonProfile(id: number): Promise<void> {
    await db
      .delete(canonProfiles)
      .where(eq(canonProfiles.id, id));
    console.log(`[🎯 Canon Profile] 삭제 완료: ID ${id}`);
  }
  
  // Tone Profile operations - "어떻게 말할지" (말투/유머/감정표현)
  async getToneProfile(id: number): Promise<ToneProfile | undefined> {
    const [result] = await db
      .select()
      .from(toneProfiles)
      .where(eq(toneProfiles.id, id));
    return result;
  }
  
  async getToneProfileByName(name: string): Promise<ToneProfile | undefined> {
    const [result] = await db
      .select()
      .from(toneProfiles)
      .where(eq(toneProfiles.name, name));
    return result;
  }
  
  async createToneProfile(data: InsertToneProfile): Promise<ToneProfile> {
    const [result] = await db
      .insert(toneProfiles)
      .values(data)
      .returning();
    console.log(`[🎨 Tone Profile] 생성 완료: ${data.name}`);
    return result;
  }
  
  async updateToneProfile(id: number, updates: Partial<ToneProfile>): Promise<ToneProfile> {
    const [result] = await db
      .update(toneProfiles)
      .set({ ...updates, updatedAt: sql`NOW()` })
      .where(eq(toneProfiles.id, id))
      .returning();
    console.log(`[🎨 Tone Profile] 업데이트 완료: ID ${id}`);
    return result;
  }
  
  async getAllToneProfiles(): Promise<ToneProfile[]> {
    const results = await db
      .select()
      .from(toneProfiles)
      .orderBy(toneProfiles.id);
    return results;
  }
  
  async deleteToneProfile(id: number): Promise<void> {
    await db
      .delete(toneProfiles)
      .where(eq(toneProfiles.id, id));
    console.log(`[🎨 Tone Profile] 삭제 완료: ID ${id}`);
  }
  
  // ========================================
  // 🔍 CallNAsk Trending & Discovery Operations
  // ========================================
  
  async getTrendingTopics(category?: string, limit: number = 20): Promise<TrendingTopic[]> {
    let query = db
      .select()
      .from(trendingTopics)
      .where(eq(trendingTopics.isActive, true))
      .orderBy(desc(trendingTopics.displayOrder), desc(trendingTopics.clickCount))
      .limit(limit);
    
    if (category && category !== 'all') {
      query = db
        .select()
        .from(trendingTopics)
        .where(and(eq(trendingTopics.isActive, true), eq(trendingTopics.category, category)))
        .orderBy(desc(trendingTopics.displayOrder), desc(trendingTopics.clickCount))
        .limit(limit);
    }
    
    return await query;
  }
  
  async getTrendingTopic(id: number): Promise<TrendingTopic | undefined> {
    const [result] = await db
      .select()
      .from(trendingTopics)
      .where(eq(trendingTopics.id, id));
    return result;
  }
  
  async createTrendingTopic(data: InsertTrendingTopic): Promise<TrendingTopic> {
    const [result] = await db
      .insert(trendingTopics)
      .values(data)
      .returning();
    return result;
  }
  
  async updateTrendingTopic(id: number, updates: Partial<TrendingTopic>): Promise<TrendingTopic> {
    const [result] = await db
      .update(trendingTopics)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(trendingTopics.id, id))
      .returning();
    return result;
  }
  
  async incrementTrendingTopicClick(id: number): Promise<void> {
    await db
      .update(trendingTopics)
      .set({ clickCount: sql`${trendingTopics.clickCount} + 1` })
      .where(eq(trendingTopics.id, id));
  }
  
  async deleteTrendingTopic(id: number): Promise<void> {
    await db
      .delete(trendingTopics)
      .where(eq(trendingTopics.id, id));
  }
  
  async getMessageReferences(messageId: number): Promise<MessageReference[]> {
    return await db
      .select()
      .from(messageReferences)
      .where(eq(messageReferences.messageId, messageId))
      .orderBy(messageReferences.displayOrder);
  }
  
  async createMessageReference(data: InsertMessageReference): Promise<MessageReference> {
    const [result] = await db
      .insert(messageReferences)
      .values(data)
      .returning();
    return result;
  }
  
  async deleteMessageReferences(messageId: number): Promise<void> {
    await db
      .delete(messageReferences)
      .where(eq(messageReferences.messageId, messageId));
  }
  
  async getFollowUpQuestions(messageId: number): Promise<FollowUpQuestion[]> {
    return await db
      .select()
      .from(followUpQuestions)
      .where(eq(followUpQuestions.messageId, messageId))
      .orderBy(followUpQuestions.displayOrder);
  }
  
  async createFollowUpQuestion(data: InsertFollowUpQuestion): Promise<FollowUpQuestion> {
    const [result] = await db
      .insert(followUpQuestions)
      .values(data)
      .returning();
    return result;
  }
  
  async deleteFollowUpQuestions(messageId: number): Promise<void> {
    await db
      .delete(followUpQuestions)
      .where(eq(followUpQuestions.messageId, messageId));
  }
  
  // ========================================
  // 🎭 Character Avatar Operations (멀티모달 감정 표현 아바타)
  // ========================================
  
  async getCharacterAvatars(agentId: number): Promise<CharacterAvatar[]> {
    return await db
      .select()
      .from(characterAvatars)
      .where(eq(characterAvatars.agentId, agentId))
      .orderBy(characterAvatars.rowIndex);
  }
  
  async getCharacterAvatar(agentId: number, characterId: string): Promise<CharacterAvatar | undefined> {
    const [result] = await db
      .select()
      .from(characterAvatars)
      .where(
        and(
          eq(characterAvatars.agentId, agentId),
          eq(characterAvatars.characterId, characterId)
        )
      );
    return result;
  }
  
  async createCharacterAvatar(data: InsertCharacterAvatar): Promise<CharacterAvatar> {
    const [result] = await db
      .insert(characterAvatars)
      .values(data)
      .returning();
    return result;
  }
  
  async updateCharacterAvatar(id: number, updates: Partial<CharacterAvatar>): Promise<CharacterAvatar> {
    const [result] = await db
      .update(characterAvatars)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(characterAvatars.id, id))
      .returning();
    return result;
  }
  
  async deleteCharacterAvatar(id: number): Promise<void> {
    await db
      .delete(characterAvatars)
      .where(eq(characterAvatars.id, id));
  }
  
  async deleteCharacterAvatarsByAgent(agentId: number): Promise<void> {
    await db
      .delete(characterAvatars)
      .where(eq(characterAvatars.agentId, agentId));
  }
  
  async getCharacterAvatarsByGroupChat(groupChatId: number): Promise<CharacterAvatar[]> {
    return await db
      .select()
      .from(characterAvatars)
      .where(eq(characterAvatars.groupChatId, groupChatId))
      .orderBy(characterAvatars.rowIndex);
  }
  
  async getCharacterAvatarByGroupChat(groupChatId: number, characterId: string): Promise<CharacterAvatar | undefined> {
    const [result] = await db
      .select()
      .from(characterAvatars)
      .where(
        and(
          eq(characterAvatars.groupChatId, groupChatId),
          eq(characterAvatars.characterId, characterId)
        )
      );
    return result;
  }
  
  async findAvatarByNormalizedName(normalizedName: string): Promise<CharacterAvatar | undefined> {
    if (!normalizedName) return undefined;
    
    console.log(`[🔍 아바타 검색] 정규화된 이름: "${normalizedName}"`);
    
    // 모든 아바타 가져오기 (수동 업로드 우선)
    const allAvatars = await db
      .select()
      .from(characterAvatars)
      .where(isNotNull(characterAvatars.neutralImageUrl))
      .orderBy(characterAvatars.promptUsed); // NULL (수동 업로드)이 먼저 오도록
    
    // 1단계: 수동 업로드된 아바타 중에서 이름 매칭 (가장 우선)
    for (const avatar of allAvatars) {
      if (!avatar.promptUsed || avatar.promptUsed === '') {
        // 수동 업로드된 아바타
        const avatarName = avatar.characterName || '';
        // 괄호 제거 후 핵심 이름 추출
        const avatarCoreName = avatarName.replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, '').trim().split(/\s+/)[0];
        
        if (avatarCoreName && (
          normalizedName.includes(avatarCoreName) || 
          avatarCoreName.includes(normalizedName) ||
          avatarName.includes(normalizedName)
        )) {
          console.log(`[🔍 아바타 검색] ✅ 수동 업로드 아바타 발견: "${avatar.characterName}" (ID: ${avatar.id})`);
          return avatar;
        }
      }
    }
    
    // 2단계: 모든 아바타 중에서 정확한 이름 매칭
    for (const avatar of allAvatars) {
      if (avatar.characterName === normalizedName) {
        console.log(`[🔍 아바타 검색] ✅ 정확히 일치: "${avatar.characterName}" (ID: ${avatar.id})`);
        return avatar;
      }
    }
    
    // 3단계: 부분 매칭 (정규화된 이름이 캐릭터 이름에 포함)
    for (const avatar of allAvatars) {
      const avatarName = avatar.characterName || '';
      if (avatarName.includes(normalizedName) || normalizedName.includes(avatarName.split(/[\s\(\[]/)[0])) {
        console.log(`[🔍 아바타 검색] ✅ 부분 매칭: "${avatar.characterName}" (ID: ${avatar.id})`);
        return avatar;
      }
    }
    
    console.log(`[🔍 아바타 검색] ❌ 매칭되는 아바타 없음`);
    return undefined;
  }
  
  async deleteCharacterAvatarsByGroupChat(groupChatId: number): Promise<void> {
    await db
      .delete(characterAvatars)
      .where(eq(characterAvatars.groupChatId, groupChatId));
  }
}

// Use database storage now that PostgreSQL is set up
console.log('Using PostgreSQL database storage');
export const storage = new DatabaseStorage();