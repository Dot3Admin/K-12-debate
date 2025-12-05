import {
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
  type GroupChat,
  type InsertGroupChat,
  type GroupChatMember,
  type InsertGroupChatMember,
  type GroupChatAgent,
  type InsertGroupChatAgent,
  type GroupChatMessage,
  type InsertGroupChatMessage,
} from "@shared/schema";
import { IStorage } from "./storage";
import { cache } from "./cache";
import * as fs from "fs";
import * as path from "path";

// Temporary in-memory storage to handle database connection issues
export class MemoryStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private agents: Map<number, Agent> = new Map();
  private conversations: Map<number, Conversation> = new Map();
  private messages: Map<number, Message> = new Map();
  private documents: Map<number, Document> = new Map();
  private agentStats: Map<number, AgentStats> = new Map();
  private messageReactions: Map<number, MessageReaction> = new Map();
  private organizationCategories: Map<number, any> = new Map();
  private organizationFiles: Map<string, any> = new Map();
  private userFiles: Map<string, any> = new Map();
  private agentFiles: Map<string, any> = new Map();
  private qaImprovementComments: Map<number, QAImprovementComment> = new Map();
  
  // 그룹 채팅 관련 저장소
  private groupChats: Map<number, GroupChat> = new Map();
  private groupChatMembers: Map<number, GroupChatMember> = new Map();
  private groupChatAgents: Map<number, GroupChatAgent> = new Map();
  private groupChatMessages: Map<number, GroupChatMessage> = new Map();
  
  private nextId = 1;
  private nextUserId = 1;
  private nextAgentId = 1;
  private nextConversationId = 1;
  private nextMessageId = 1;
  private nextDocumentId = 1;
  private nextOrganizationId = 1;
  private nextQACommentId = 1;
  private nextGroupChatId = 1;
  private nextGroupChatMemberId = 1;
  private nextGroupChatAgentId = 1;
  private nextGroupChatMessageId = 1;
  
  private readonly persistenceDir = path.join(process.cwd(), 'data');
  private readonly documentsFile = path.join(this.persistenceDir, 'documents.json');
  private readonly organizationFilesFile = path.join(this.persistenceDir, 'organization-files.json');
  private readonly userFilesFile = path.join(this.persistenceDir, 'user-files.json');
  private readonly agentFilesFile = path.join(this.persistenceDir, 'agent-files.json');
  private readonly usersFile = path.join(this.persistenceDir, 'memory-storage.json');
  private readonly agentsFile = path.join(this.persistenceDir, 'memory-storage-agents.json');
  private readonly conversationsFile = path.join(this.persistenceDir, 'conversations.json');
  private readonly messagesFile = path.join(this.persistenceDir, 'messages.json');
  private readonly organizationCategoriesFile = path.join(this.persistenceDir, 'organization-categories.json');
  private readonly qaCommentsFile = path.join(this.persistenceDir, 'qa-comments.json');
  private readonly groupChatsFile = path.join(this.persistenceDir, 'group-chats.json');
  private readonly groupChatMembersFile = path.join(this.persistenceDir, 'group-chat-members.json');
  private readonly groupChatAgentsFile = path.join(this.persistenceDir, 'group-chat-agents.json');
  private readonly groupChatMessagesFile = path.join(this.persistenceDir, 'group-chat-messages.json');

  constructor() {
    // Initialize maps (already declared above)
    // Initialize IDs (already declared above)

    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.persistenceDir)) {
      fs.mkdirSync(this.persistenceDir, { recursive: true });
    }

    // Load persisted data from admin center managed files
    this.loadUsersFromAdminCenter();
    this.loadAgentsFromAdminCenter();
    this.loadOrganizationCategoriesFromAdminCenter();
    this.loadPersistedDocuments();
    this.loadPersistedConversations();
    this.loadPersistedMessages();
    this.loadPersistedOrganizationFiles();
    this.loadPersistedUserFiles();
    this.loadPersistedAgentFiles();
    this.loadPersistedQAComments();
    this.loadPersistedGroupChats();
    this.loadPersistedGroupChatMembers();
    this.loadPersistedGroupChatAgents();
    this.loadPersistedGroupChatMessages();

    console.log(`Memory storage initialized with ${this.users.size} users, ${this.agents.size} agents, and ${this.organizationCategories.size} organization categories`);
    // Skip default data initialization - use admin center data only

    // Optimize garbage collection
    this.setupPeriodicCleanup();
  }

  private setupPeriodicCleanup() {
    // Clean up old conversations and messages every 30 minutes
    setInterval(() => {
      this.cleanupOldData();
    }, 30 * 60 * 1000);
  }

  private cleanupOldData() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Remove old conversations without recent activity
    for (const [id, conversation] of this.conversations.entries()) {
      if (conversation.lastMessageAt && conversation.lastMessageAt < thirtyDaysAgo) {
        this.conversations.delete(id);
      }
    }

    // Remove orphaned messages
    const validConversationIds = new Set(this.conversations.keys());
    for (const [id, message] of this.messages.entries()) {
      if (!validConversationIds.has(message.conversationId)) {
        this.messages.delete(id);
      }
    }
  }

  private ensurePersistenceDir() {
    if (!fs.existsSync(this.persistenceDir)) {
      fs.mkdirSync(this.persistenceDir, { recursive: true });
    }
  }

  private loadPersistedDocuments() {
    try {
      if (fs.existsSync(this.documentsFile)) {
        const data = fs.readFileSync(this.documentsFile, 'utf-8');
        const persistedData = JSON.parse(data);

        // Restore documents
        if (persistedData.documents) {
          persistedData.documents.forEach((doc: Document) => {
            // Convert date strings back to Date objects
            if (doc.createdAt) {
              doc.createdAt = new Date(doc.createdAt);
            }
            this.documents.set(doc.id, doc);
          });
        }

        // Update nextId to avoid conflicts
        if (persistedData.nextId) {
          this.nextId = Math.max(this.nextId, persistedData.nextId);
        }

        console.log(`Loaded ${this.documents.size} persisted documents`);

        // Load organization categories separately
        this.loadOrganizationCategoriesFromFile();
      }
    } catch (error) {
      console.error('Error loading persisted documents:', error);
    }
  }

  private savePersistedDocuments() {
    try {
      const data = {
        documents: Array.from(this.documents.values()),
        organizationCategories: Array.from(this.organizationCategories.values()),
        nextId: this.nextId,
        nextOrganizationId: this.nextOrganizationId
      };
      fs.writeFileSync(this.documentsFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error saving persisted documents:', error);
    }
  }

  async loadNewAgentData() {
    try {
      const fs = await import('fs');
      const agentDataPath = './new_agents.json';

      if (fs.existsSync(agentDataPath)) {
        console.log('새 에이전트 데이터 로드 중...');

        const agentData = JSON.parse(fs.readFileSync(agentDataPath, 'utf8'));

        // 기존 에이전트 모두 삭제
        this.agents.clear();

        // 새 에이전트 추가
        let loadedCount = 0;
        for (const agent of agentData) {
          const newAgent: any = {
            id: agent.id,
            name: agent.name,
            description: agent.description,
            creatorId: 'master_admin',
            icon: agent.icon || 'Bot',
            backgroundColor: agent.backgroundColor || '#3B82F6',
            category: agent.category || '기능',
            isActive: true,
            status: 'active',
            managerId: agent.managerId || 'prof001',
            organizationId: agent.organizationId || 1,
            visibility: 'public',
            maxInputLength: 1000,
            llmModel: 'gpt-4o',
            chatbotType: 'general-llm',
            speakingStyle: '친근하고 도움이 되는 말투',
            personalityTraits: '친절하고 전문적인 성격으로 정확한 정보를 제공',
            documentManagerIds: [],
            agentEditorIds: [],
            isCustomIcon: false,
            maxResponseLength: null,
            additionalPrompt: '',
            upperCategory: null,
            lowerCategory: null,
            detailCategory: null,
            personaName: null,
            rolePrompt: null,
            uploadFormats: [],
            uploadMethod: null,
            maxFileCount: null,
            maxFileSizeMB: null,
            createdAt: new Date(),
            updatedAt: new Date()
          };

          this.agents.set(agent.id, newAgent);
          loadedCount++;
        }

        console.log(`✅ ${loadedCount}개의 새 에이전트가 로드되었습니다.`);
        this.nextId = Math.max(this.nextId, loadedCount + 1);
      }
    } catch (error) {
      console.error('새 에이전트 데이터 로드 오류:', error);
    }
  }

  private initializeDefaultData() {
    // Create users with pre-hashed passwords (using any type to avoid complex type mismatches)
    const masterAdmin: any = {
      id: "master_admin",
      username: "master_admin",
      firstName: "Master",
      lastName: "Admin",
      password: "$2b$10$e097KpT.lX7HTqlHodUO5.3gIU26TfoFaDbkINPo5egSeY/zf4sb6", // MasterAdmin2024!
      email: "admin@lobo.edu",
      userType: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      profileImageUrl: null,
      name: "Master Admin",
      upperCategory: null,
      lowerCategory: null,
      detailCategory: null,
      role: "admin",
      status: "active",
      passwordHash: null,
      lastLoginAt: null,
      groups: null,
      position: null,
      permissions: null,
      lockedReason: null,
      deactivatedAt: null,
      loginFailCount: 0,
      lastLoginIP: null,
      authProvider: "email",
      termsAcceptedAt: null
    };
    this.users.set("master_admin", masterAdmin);

    // Create demo student account
    const studentUser: any = {
      id: "2024001234",
      username: "2024001234",
      firstName: "김",
      lastName: "학생",
      password: "$2b$10$N8XSxPz/zitNI7exEyKVHuh/AS.CnxoperLS.zOa7UEBmNsUJ7EDO", // student123
      email: "student@lobo.edu",
      userType: "student",
      createdAt: new Date(),
      updatedAt: new Date(),
      profileImageUrl: null,
      name: "김학생",
      upperCategory: "로보대학교",
      lowerCategory: "공과대학",
      detailCategory: "컴퓨터공학과",
      role: "user",
      status: "active",
      passwordHash: null,
      lastLoginAt: null,
      groups: null,
      position: null,
      permissions: null,
      lockedReason: null,
      deactivatedAt: null,
      loginFailCount: 0,
      lastLoginIP: null,
      authProvider: "email",
      termsAcceptedAt: null
    };
    this.users.set("2024001234", studentUser);

    // Create demo faculty account
    const facultyUser: any = {
      id: "F2024001",
      username: "F2024001",
      firstName: "이",
      lastName: "교수",
      password: "$2b$10$eYu4kIdi2oqmILaVljmuNOELydq3vW920HbVQhTiiG8xPT5WyiLeO", // faculty123
      email: "faculty@lobo.edu",
      userType: "faculty",
      createdAt: new Date(),
      updatedAt: new Date(),
      profileImageUrl: null,
      name: "이교수",
      upperCategory: "로보대학교",
      lowerCategory: "공과대학",
      detailCategory: "컴퓨터공학과",
      role: "user",
      status: "active",
      passwordHash: null,
      lastLoginAt: null,
      groups: null,
      position: "교수",
      permissions: null,
      lockedReason: null,
      deactivatedAt: null,
      loginFailCount: 0,
      lastLoginIP: null,
      authProvider: "email",
      termsAcceptedAt: null
    };
    this.users.set("F2024001", facultyUser);

    // Create sample agents (simplified to avoid type mismatches)
    const sampleAgents: any[] = [
      {
        id: 1,
        name: "학교 안내",
        description: "학교 전반에 대한 정보를 제공합니다",
        category: "학교",
        icon: "School",
        backgroundColor: "blue",
        isActive: true,
        isCustomIcon: false,
        speechStyle: "친근하고 도움이 되는",
        personality: "친절하고 전문적인 성격으로 정확한 정보를 제공",
        additionalPrompt: "",
        llmModel: "gpt-4o",
        chatbotType: "general-llm",
        managerId: "master_admin",
        organizationId: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        creatorId: "master_admin",
        upperCategory: null,
        lowerCategory: null,
        detailCategory: null,
        status: "active",
        visibility: "public",
        maxInputLength: 2048,
        maxResponseLength: 1024,
        responseSpeed: "normal",
        useContext: true,
        contextWindow: 4096,
        topP: 1.0,
        frequencyPenalty: 0.0,
        presencePenalty: 0.0,
        modelVersion: "latest",
        customPrompt: null,
        welcomeMessage: null,
        fallbackResponse: null,
        enableFeedback: true,
        feedbackPrompt: null
      },
      {
        id: 2,
        name: "입학 상담",
        description: "입학 관련 정보와 상담을 제공합니다",
        category: "학교",
        icon: "GraduationCap",
        backgroundColor: "green",
        isActive: true,
        isCustomIcon: false,
        speechStyle: "정확하고 신뢰할 수 있는",
        personality: "신뢰할 수 있고 정확한 정보를 제공하는 전문적인 성격",
        additionalPrompt: "",
        llmModel: "gpt-4o",
        chatbotType: "doc-fallback-llm",
        managerId: "master_admin",
        organizationId: 1,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    sampleAgents.forEach(agent => this.agents.set(agent.id, agent));
  }

  // User operations
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(user => user.username === username);
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const user: User = {
      id: userData.id,
      username: userData.username,
      email: userData.email || null,
      firstName: userData.firstName || "",
      lastName: userData.lastName || "",
      name: userData.name || null,
      role: userData.role || "user",
      status: userData.status || "active",
      userType: userData.userType || "student",
      position: userData.position || null,
      upperCategory: userData.upperCategory || null,
      lowerCategory: userData.lowerCategory || null,
      detailCategory: userData.detailCategory || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastLoginAt: userData.lastLoginAt || null,
      profileImageUrl: userData.profileImageUrl || null,
      passwordHash: userData.passwordHash || "",
      password: userData.password || "",
      groups: userData.groups || [],
      usingAgents: userData.usingAgents || [],
      managedCategories: userData.managedCategories || [],
      managedAgents: userData.managedAgents || [],
      organizationAffiliations: userData.organizationAffiliations || [],
      agentPermissions: userData.agentPermissions || [],
      userMemo: userData.userMemo || null,
      permissions: userData.permissions || {},
      lockedReason: userData.lockedReason || null,
      deactivatedAt: userData.deactivatedAt || null,
      loginFailCount: 0,
      lastLoginIP: userData.lastLoginIP || null,
      authProvider: userData.authProvider || "email",
      termsAcceptedAt: userData.termsAcceptedAt || null
    };

    this.users.set(user.id, user);
    this.savePersistedUsers(); // Auto-save after creating user
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const existingUser = this.users.get(userData.id);

    const user: User = {
      ...existingUser,
      id: userData.id,
      username: userData.username,
      email: userData.email || existingUser?.email || null,
      firstName: userData.firstName || existingUser?.firstName || "",
      lastName: userData.lastName || existingUser?.lastName || "",
      name: userData.name || existingUser?.name || null,
      role: userData.role || existingUser?.role || "user",
      status: userData.status || existingUser?.status || "active",
      userType: userData.userType || existingUser?.userType || "student",
      position: userData.position || existingUser?.position || null,
      upperCategory: userData.upperCategory || existingUser?.upperCategory || null,
      lowerCategory: userData.lowerCategory || existingUser?.lowerCategory || null,
      detailCategory: userData.detailCategory || existingUser?.detailCategory || null,
      createdAt: existingUser?.createdAt || new Date(),
      updatedAt: new Date(),
      lastLoginAt: userData.lastLoginAt || existingUser?.lastLoginAt || null,
      profileImageUrl: userData.profileImageUrl || existingUser?.profileImageUrl || null,
      passwordHash: userData.passwordHash || existingUser?.passwordHash || "",
      password: userData.password || existingUser?.password || "",
      groups: userData.groups || existingUser?.groups || [],
      usingAgents: userData.usingAgents || existingUser?.usingAgents || [],
      managedCategories: userData.managedCategories || existingUser?.managedCategories || [],
      managedAgents: userData.managedAgents || existingUser?.managedAgents || [],
      organizationAffiliations: userData.organizationAffiliations || existingUser?.organizationAffiliations || [],
      agentPermissions: userData.agentPermissions || existingUser?.agentPermissions || [],
      userMemo: userData.userMemo || existingUser?.userMemo || null,
      permissions: userData.permissions || existingUser?.permissions || {},
      lockedReason: userData.lockedReason || existingUser?.lockedReason || null,
      deactivatedAt: userData.deactivatedAt || existingUser?.deactivatedAt || null,
      loginFailCount: userData.loginFailCount !== undefined ? userData.loginFailCount : (existingUser?.loginFailCount || 0),
      lastLoginIP: userData.lastLoginIP || existingUser?.lastLoginIP || null,
      authProvider: userData.authProvider || existingUser?.authProvider || "email",
      termsAcceptedAt: userData.termsAcceptedAt || existingUser?.termsAcceptedAt || null
    };

    this.users.set(user.id, user);
    this.savePersistedUsers(); // Auto-save after upserting user
    return user;
  }

  async updateUser(id: string, updates: any): Promise<User | undefined> {
    const existingUser = this.users.get(id);
    if (!existingUser) {
      return undefined;
    }

    const updatedUser: User = {
      ...existingUser,
      ...updates,
      id, // Ensure ID doesn't change
      updatedAt: new Date(),
    };

    this.users.set(id, updatedUser);
    this.savePersistedUsers(); // Auto-save after updating user
    return updatedUser;
  }

  async clearAllUsers(): Promise<{ deletedCount: number; deletedUsers: string[] }> {
    const deletedUsers: string[] = [];
    let deletedCount = 0;

    // 마스터 관리자 계정은 보존
    for (const [id, user] of this.users.entries()) {
      if (id !== 'master_admin') {
        deletedUsers.push(`${user.name || user.username} (ID: ${id})`);
        this.users.delete(id);
        deletedCount++;
      }
    }

    // 변경사항 저장
    this.savePersistedUsers();

    console.log(`🗑️ ${deletedCount}개의 사용자가 삭제되었습니다 (master_admin 제외):`);
    deletedUsers.forEach(userName => console.log(`   - ${userName}`));

    return { deletedCount, deletedUsers };
  }

  // Agent operations
  async getAllAgents(): Promise<Agent[]> {
    const cacheKey = 'all_agents';
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const agents = Array.from(this.agents.values());
    cache.set(cacheKey, agents, 2 * 60 * 1000); // Cache for 2 minutes
    return agents;
  }

  async getAgent(id: number): Promise<Agent | undefined> {
    return this.agents.get(id);
  }

  async clearAllAgents(): Promise<void> {
    this.agents.clear();
    cache.delete('all_agents');
  }

  async deleteRoboUniversityAgents(): Promise<{ deletedCount: number; deletedAgents: string[] }> {
    const deletedAgents: string[] = [];
    let deletedCount = 0;

    // 로보대학교 관련 에이전트 찾기 및 삭제 (이름 또는 설명에 포함된 경우)
    console.log(`현재 에이전트 수: ${this.agents.size}`);
    
    // Map을 배열로 변환하여 안전하게 순회
    const agentsToDelete: number[] = [];
    
    this.agents.forEach((agent, id) => {
      console.log(`검사 중: ${agent.name} (ID: ${id})`);
      if ((agent.name && agent.name.includes('로보대학교')) || 
          (agent.description && agent.description.includes('로보대학교'))) {
        console.log(`삭제 대상 발견: ${agent.name}`);
        agentsToDelete.push(id);
        deletedAgents.push(`${agent.name} (ID: ${id})`);
      }
    });
    
    // 실제 삭제 수행
    for (const agentId of agentsToDelete) {
      this.agents.delete(agentId);
      deletedCount++;
    }
    
    console.log(`🗑️ ${deletedCount}개의 로보대학교 에이전트가 삭제되었습니다:`);
    deletedAgents.forEach(agentName => console.log(`   - ${agentName}`));

    return { deletedCount, deletedAgents };
  }

  async createAgent(agent: InsertAgent): Promise<Agent> {
    const id = this.nextId++;
    const newAgent: Agent = {
      ...agent,
      id,
      isCustomIcon: agent.isCustomIcon || false,
      isActive: agent.isActive || true,
      managerId: agent.managerId || null,
      organizationId: agent.organizationId || null,
      status: agent.status || "active",
      maxInputLength: agent.maxInputLength || null,
      maxResponseLength: agent.maxResponseLength || null,
      llmModel: agent.llmModel || "gpt-4o",
      chatbotType: agent.chatbotType || "general-llm",
      speechStyle: agent.speechStyle || "친근하고 도움이 되는 말투",
      personality: agent.personality || "친절하고 전문적인 성격으로 정확한 정보를 제공",
      additionalPrompt: agent.additionalPrompt || "",
      upperCategory: agent.upperCategory || null,
      lowerCategory: agent.lowerCategory || null,
      detailCategory: agent.detailCategory || null,
      personaNickname: agent.personaNickname || null,
      expertiseArea: agent.expertiseArea || null,
      uploadFormats: agent.uploadFormats || [],
      uploadMethod: agent.uploadMethod || null,
      visibility: agent.visibility || null,
      maxFileCount: agent.maxFileCount || null,
      maxFileSizeMB: agent.maxFileSizeMB || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.agents.set(id, newAgent);

    // Invalidate cache
    cache.delete('all_agents');
    
    // Save to persistent storage immediately
    this.savePersistedAgents();

    return newAgent;
  }

  async updateAgent(id: number, updates: any): Promise<Agent> {
    const existingAgent = this.agents.get(id);
    if (!existingAgent) {
      throw new Error("Agent not found");
    }
    const updatedAgent = { ...existingAgent, ...updates, updatedAt: new Date() };
    this.agents.set(id, updatedAgent);
    
    // Invalidate all caches that might contain agent data
    cache.delete('all_agents');
    
    // Critical: Invalidate conversation caches that contain embedded agent data
    // Clear all conversation caches since they embed agent information
    cache.clear(); // Clear all caches to ensure embedded agent data is refreshed
    
    // Save to persistent storage immediately
    this.savePersistedAgents();
    
    return updatedAgent;
  }

  async deleteAgent(id: number): Promise<boolean> {
    try {
      console.log(`[MEMORY STORAGE] Deleting agent with ID: ${id}`);
      const existingAgent = this.agents.get(id);
      if (!existingAgent) {
        console.log(`[MEMORY STORAGE] Agent ${id} not found`);
        return false;
      }
      
      this.agents.delete(id);
      
      // Invalidate all caches that might contain agent data
      cache.delete('all_agents');
      cache.clear(); // Clear all caches to ensure removed agent is no longer cached
      
      // Save to persistent storage immediately
      this.savePersistedAgents();
      
      console.log(`[MEMORY STORAGE] Agent ${id} deleted successfully`);
      return true;
    } catch (error) {
      console.error(`[MEMORY STORAGE] Error deleting agent ${id}:`, error);
      return false;
    }
  }

  async getAgentsByManager(managerId: string): Promise<Agent[]> {
    return Array.from(this.agents.values()).filter(agent => agent.managerId === managerId);
  }

  // Conversation operations
  async getOrCreateConversation(userId: string, agentId: number, type: string = "general"): Promise<Conversation> {
    const existing = Array.from(this.conversations.values()).find(
      conv => conv.userId === userId && conv.agentId === agentId && conv.type === type
    );

    if (existing) {
      // If conversation exists but is hidden, unhide it
      if (existing.isHidden) {
        await this.unhideConversation(existing.id);
        return { ...existing, isHidden: false };
      }
      return existing;
    }

    const id = this.nextId++;
    const newConversation: Conversation = {
      id,
      userId,
      agentId,
      type,
      unreadCount: 0,
      lastReadAt: null,
      lastMessageAt: new Date(),
      isHidden: false,
      createdAt: new Date()
    };
    this.conversations.set(id, newConversation);
    
    // Save to persistent storage
    this.savePersistedConversations();
    
    return newConversation;
  }

  async getUserConversations(userId: string): Promise<(Conversation & { agent: Agent; lastMessage?: Message })[]> {
    const cacheKey = `user_conversations_${userId}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const userConversations = Array.from(this.conversations.values())
      .filter(conv => conv.userId === userId && conv.type === "general" && !conv.isHidden)
      .sort((a, b) => {
        const aTime = a.lastMessageAt?.getTime() || 0;
        const bTime = b.lastMessageAt?.getTime() || 0;
        return bTime - aTime;
      });

    const result = userConversations.map(conv => {
      const agent = this.agents.get(conv.agentId);
      const conversationMessages = Array.from(this.messages.values())
        .filter(msg => msg.conversationId === conv.id)
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

      return {
        ...conv,
        agent: agent!,
        lastMessage: conversationMessages[0]
      };
    });

    cache.set(cacheKey, result, 1 * 60 * 1000); // Cache for 1 minute
    return result;
  }

  // Admin API alias for getUserConversations 
  async getConversationsByUserId(userId: string): Promise<(Conversation & { agent: Agent; lastMessage?: Message })[]> {
    return this.getAllUserConversations(userId);
  }

  async getAllUserConversations(userId: string): Promise<(Conversation & { agent: Agent; lastMessage?: Message })[]> {
    const userConversations = Array.from(this.conversations.values())
      .filter(conv => conv.userId === userId)
      .sort((a, b) => {
        const aTime = a.lastMessageAt?.getTime() || 0;
        const bTime = b.lastMessageAt?.getTime() || 0;
        return bTime - aTime;
      });

    return userConversations.map(conv => {
      const agent = this.agents.get(conv.agentId);
      const conversationMessages = Array.from(this.messages.values())
        .filter(msg => msg.conversationId === conv.id)
        .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));

      return {
        ...conv,
        agent: agent!,
        lastMessage: conversationMessages[0]
      };
    });
  }

  async getAllConversations(): Promise<Conversation[]> {
    return Array.from(this.conversations.values())
      .sort((a, b) => {
        const aTime = a.lastMessageAt?.getTime() || 0;
        const bTime = b.lastMessageAt?.getTime() || 0;
        return bTime - aTime;
      });
  }

  async getConversation(id: number): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async updateConversation(conversationId: number, updates: Partial<Conversation>): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) {
      throw new Error(`Conversation with ID ${conversationId} not found`);
    }

    // Update the conversation with the provided updates
    const updatedConversation = {
      ...conversation,
      ...updates
    };

    this.conversations.set(conversationId, updatedConversation);
    
    // Clear cache
    cache.delete(`user_conversations_${conversation.userId}`);
    cache.delete(`conversation_${conversationId}`);
    
    // Save to persistent storage
    this.savePersistentData();
    this.savePersistedConversations();
    this.savePersistedMessages();
  }

  async deleteConversationWithMessages(userId: string, agentId: number): Promise<void> {
    console.log(`Deleting conversations for user ${userId} and agent ${agentId}`);
    
    // Find conversations for this user and agent
    const conversationsToDelete = Array.from(this.conversations.values())
      .filter(conv => conv.userId === userId && conv.agentId === agentId);

    for (const conversation of conversationsToDelete) {
      console.log(`Deleting conversation ${conversation.id}`);
      
      // Delete all messages in this conversation
      const messagesToDelete = Array.from(this.messages.values())
        .filter(msg => msg.conversationId === conversation.id);
      
      for (const message of messagesToDelete) {
        this.messages.delete(message.id);
        
        // Delete message reactions for this message
        const reactionsToDelete = Array.from(this.messageReactions.values())
          .filter(reaction => reaction.messageId === message.id);
        
        for (const reaction of reactionsToDelete) {
          this.messageReactions.delete(reaction.id);
        }
      }

      // Delete the conversation itself
      this.conversations.delete(conversation.id);
    }

    // Clear related caches
    cache.delete(`user_conversations_${userId}`);
    cache.delete(`all_user_conversations_${userId}`);
    
    // Save to persistent storage
    this.savePersistedConversations();
    this.savePersistedMessages();
    
    console.log(`Deleted ${conversationsToDelete.length} conversations for user ${userId} and agent ${agentId}`);
  }

  // Message operations
  async getConversationMessages(conversationId: number): Promise<Message[]> {
    // Always fetch fresh data for management conversations to ensure persistence
    const messages = Array.from(this.messages.values())
      .filter(msg => msg.conversationId === conversationId)
      .sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));

    console.log(`Loading messages for conversation ${conversationId}: found ${messages.length} messages`);
    return messages;
  }

  async getAllMessages(): Promise<Message[]> {
    const allMessages = Array.from(this.messages.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    
    console.log(`getAllMessages: returning ${allMessages.length} total messages`);
    return allMessages;
  }

  async createMessage(message: InsertMessage): Promise<Message> {
    const id = this.nextId++;
    const newMessage: Message = {
      ...message,
      id,
      createdAt: new Date()
    };
    this.messages.set(id, newMessage);

    // Update conversation's lastMessageAt  
    const conversation = this.conversations.get(message.conversationId);
    if (conversation) {
      conversation.lastMessageAt = newMessage.createdAt;

      // Invalidate related caches
      cache.delete(`user_conversations_${conversation.userId}`);
      cache.delete(`conversation_messages_${message.conversationId}`);
    }

    // Save to persistent storage
    this.savePersistedMessages();
    this.savePersistedConversations();

    return newMessage;
  }

  async markConversationAsRead(conversationId: number): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      const updatedConversation = {
        ...conversation,
        unreadCount: 0,
        lastReadAt: new Date()
      };
      this.conversations.set(conversationId, updatedConversation);
      
      // Clear cache and save to persistent storage
      cache.delete(`user_conversations_${conversation.userId}`);
      cache.delete(`conversation_${conversationId}`);
      this.savePersistedConversations();
      
      console.log(`Marked conversation ${conversationId} as read and persisted`);
    }
  }

  async deleteConversationMessages(conversationId: number): Promise<void> {
    // Delete all messages for this conversation
    const messagesToDelete: number[] = [];
    for (const [messageId, message] of this.messages.entries()) {
      if (message.conversationId === conversationId) {
        messagesToDelete.push(messageId);
      }
    }
    
    // Remove all messages from memory
    messagesToDelete.forEach(messageId => {
      this.messages.delete(messageId);
    });
    
    // Update conversation last message info
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      const updatedConversation = {
        ...conversation,
        lastMessageAt: null,
        unreadCount: 0
      };
      this.conversations.set(conversationId, updatedConversation);
    }
    
    // Clear cache and save to persistent storage
    cache.delete(`conversation_messages_${conversationId}`);
    this.savePersistedMessages();
    this.savePersistedConversations();
    
    console.log(`Deleted ${messagesToDelete.length} messages from conversation ${conversationId}`);
  }

  async hideConversation(conversationId: number): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      const updatedConversation = {
        ...conversation,
        isHidden: true
      };
      this.conversations.set(conversationId, updatedConversation);
      
      // Clear cache and save to persistent storage
      cache.delete(`user_conversations_${conversation.userId}`);
      cache.delete(`conversation_${conversationId}`);
      this.savePersistedConversations();
      
      console.log(`Conversation ${conversationId} hidden and persisted`);
    }
  }

  async unhideConversation(conversationId: number): Promise<void> {
    const conversation = this.conversations.get(conversationId);
    if (conversation) {
      const updatedConversation = {
        ...conversation,
        isHidden: false
      };
      this.conversations.set(conversationId, updatedConversation);
      
      // Clear cache and save to persistent storage
      cache.delete(`user_conversations_${conversation.userId}`);
      cache.delete(`conversation_${conversationId}`);
      this.savePersistedConversations();
      
      console.log(`Conversation ${conversationId} unhidden and persisted`);
    }
  }

  // Document operations
  async createDocument(document: InsertDocument): Promise<Document> {
    const id = this.nextId++;
    const newDocument: Document = {
      ...document,
      id,
      content: document.content || null,
      createdAt: new Date(),
      updatedAt: new Date(),
      status: document.status || "active",
      type: document.type || null,
      description: document.description || null,
      connectedAgents: document.connectedAgents || []
    };
    this.documents.set(id, newDocument);
    this.savePersistedDocuments(); // Persist immediately
    console.log(`Document ${id} created and persisted: ${document.originalName}`);
    return newDocument;
  }

  async getAgentDocuments(agentId: number): Promise<Document[]> {
    return Array.from(this.documents.values())
      .filter(doc => doc.agentId === agentId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getAgentDocumentsForUser(agentId: number, userId: string): Promise<Document[]> {
    const user = this.users.get(userId);
    const agent = this.agents.get(agentId);
    
    // 모든 문서를 가져옴
    const allDocuments = Array.from(this.documents.values())
      .filter(doc => doc.agentId === agentId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
    
    // 사용자가 에이전트 관리자인지 확인
    const isAgentManager = user && agent && (
      user.role === 'admin' || 
      user.role === 'master_admin' ||
      user.role === 'agent_admin' ||
      agent.managerId === userId
    );
    
    // 에이전트 관리자는 모든 문서를 볼 수 있고, 일반 사용자는 가시성이 true인 문서만 볼 수 있음
    if (isAgentManager) {
      return allDocuments;
    } else {
      return allDocuments.filter(doc => doc.isVisibleToUsers !== false);
    }
  }

  async getDocument(id: number): Promise<Document | undefined> {
    return this.documents.get(id);
  }

  async deleteDocument(id: number): Promise<void> {
    const document = this.documents.get(id);
    if (document) {
      this.documents.delete(id);
      this.savePersistedDocuments(); // Persist immediately
      console.log(`Document ${id} deleted and persisted: ${document.originalName}`);
    }
  }



  async getAllDocuments(): Promise<Document[]> {
    return Array.from(this.documents.values());
  }

  async updateDocument(id: number, updates: Partial<Document>): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (document) {
      Object.assign(document, { ...updates, updatedAt: new Date() });
      this.savePersistedDocuments(); // Persist immediately
      console.log(`Document ${id} updated and persisted: ${document.originalName}`);
      return document;
    }
    return undefined;
  }

  async updateDocumentContent(id: number, content: string): Promise<Document | null> {
    const document = this.documents.get(id);
    if (document) {
      document.content = content;
      this.savePersistedDocuments(); // Persist immediately
      console.log(`Document ${id} content updated and persisted: ${document.originalName}`);
      return document;
    }
    return null;
  }

  async updateDocumentVisibility(id: number, isVisible: boolean): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (document) {
      document.isVisibleToUsers = isVisible;
      document.updatedAt = new Date();
      this.savePersistedDocuments(); // Persist immediately
      console.log(`Document ${id} visibility updated to ${isVisible ? 'visible' : 'hidden'} and persisted: ${document.originalName}`);
      return document;
    }
    return undefined;
  }

  async updateDocumentTraining(id: number, isUsedForTraining: boolean): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (document) {
      document.isUsedForTraining = isUsedForTraining;
      document.updatedAt = new Date();
      this.savePersistedDocuments(); // Persist immediately
      console.log(`Document ${id} training setting updated to ${isUsedForTraining ? 'enabled' : 'disabled'} and persisted: ${document.originalName}`);
      return document;
    }
    return undefined;
  }

  async updateDocumentAgentConnections(id: number, connectedAgentIds: number[]): Promise<Document | undefined> {
    const document = this.documents.get(id);
    if (!document) {
      return undefined;
    }

    // Update document with connected agents
    (document as any).connectedAgents = connectedAgentIds;
    document.updatedAt = new Date();
    
    // Save to file immediately to persist changes
    this.savePersistedDocuments();
    console.log(`Document ${id} agent connections updated and persisted: ${document.originalName}, connected to ${connectedAgentIds.length} agents`);
    
    return document;
  }

  async getDocumentConnectedAgents(documentId: number): Promise<Agent[]> {
    const document = this.documents.get(documentId);
    if (!document || !(document as any).connectedAgents) {
      return [];
    }

    const connectedAgentIds = (document as any).connectedAgents as number[];
    const connectedAgents: Agent[] = [];

    for (const agentId of connectedAgentIds) {
      const agent = this.agents.get(agentId);
      if (agent) {
        connectedAgents.push(agent);
      }
    }

    return connectedAgents;
  }

  // Stats operations
  async getAgentStats(agentId: number): Promise<AgentStats | undefined> {
    return this.agentStats.get(agentId);
  }

  async updateAgentStats(agentId: number, stats: Partial<AgentStats>): Promise<void> {
    const existing = this.agentStats.get(agentId);
    const newStats: AgentStats = {
      id: existing?.id || this.nextId++,
      agentId,
      activeUsers: stats.activeUsers || 0,
      totalMessages: stats.totalMessages || 0,
      usagePercentage: stats.usagePercentage || 0,
      ranking: stats.ranking || 0,
      updatedAt: new Date()
    };
    this.agentStats.set(agentId, newStats);
  }

  // Message reaction operations
  async createMessageReaction(reaction: InsertMessageReaction): Promise<MessageReaction> {
    // Delete existing reaction first
    await this.deleteMessageReaction(reaction.messageId, reaction.userId);

    const id = this.nextId++;
    const newReaction: MessageReaction = {
      ...reaction,
      id,
      createdAt: new Date()
    };
    this.messageReactions.set(id, newReaction);
    return newReaction;
  }

  async deleteMessageReaction(messageId: number, userId: string): Promise<void> {
    const reactions = Array.from(this.messageReactions.entries());
    for (const [id, reaction] of reactions) {
      if (reaction.messageId === messageId && reaction.userId === userId) {
        this.messageReactions.delete(id);
        break;
      }
    }
  }

  async getMessageReactions(messageIds: number[]): Promise<{ [messageId: number]: MessageReaction | undefined }> {
    const result: { [messageId: number]: MessageReaction | undefined } = {};
    const reactions = Array.from(this.messageReactions.values());

    for (const messageId of messageIds) {
      result[messageId] = reactions.find(r => r.messageId === messageId);
    }

    return result;
  }

  async getAllUsers(): Promise<User[]> {
    const allUsers = Array.from(this.users.values());
    console.log(`Memory storage getAllUsers: ${allUsers.length} users total`);
    return allUsers;
  }

  async deleteUser(id: string): Promise<void> {
    this.users.delete(id);
  }

  private async savePersistentData(): Promise<void> {
    try {
      const data = {
        users: Array.from(this.users.entries()),
        agents: Array.from(this.agents.entries()),
        conversations: Array.from(this.conversations.entries()),
        messages: Array.from(this.messages.entries()),
        documents: Array.from(this.documents.entries()).map(([id, doc]) => [
          id,
          {
            ...doc,
            createdAt: doc.createdAt?.toISOString?.() || doc.createdAt,
            updatedAt: doc.updatedAt?.toISOString?.() || doc.updatedAt
          }
        ]),
        agentStats: Array.from(this.agentStats.entries()),
        messageReactions: Array.from(this.messageReactions.entries()),
        nextId: this.nextId
      };

      const dir = path.dirname('./data/memory-storage.json');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync('./data/memory-storage.json', JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save persistent data:', error);
    }
  }

  private loadPersistentData(): void {
    try {
      if (fs.existsSync('./data/memory-storage.json')) {
        const data = JSON.parse(fs.readFileSync('./data/memory-storage.json', 'utf8'));

        this.users = new Map(data.users || []);
        this.agents = new Map(data.agents || []);
        this.conversations = new Map(data.conversations || []);
        this.messages = new Map(data.messages || []);

        const documentsWithDates = (data.documents || []).map(([id, doc]: [number, any]) => [
          id,
          {
            ...doc,
            createdAt: new Date(doc.createdAt),
            updatedAt: doc.updatedAt ? new Date(doc.updatedAt) : new Date(),
            status: doc.status || "active",
            type: doc.type || null,
            description: doc.description || null,
            connectedAgents: doc.connectedAgents || []
          }
        ]);
        this.documents = new Map(documentsWithDates);

        this.agentStats = new Map(data.agentStats || []);
        this.messageReactions = new Map(data.messageReactions || []);
        this.nextId = data.nextId || 1;

        if (data.organizationCategories) {
          this.organizationCategories = new Map(data.organizationCategories.map((org: any) => [org.id, {
            ...org,
            createdAt: new Date(org.createdAt),
            updatedAt: new Date(org.updatedAt)
          }]));
          this.nextOrganizationId = Math.max(...data.organizationCategories.map((org: any) => org.id), 0) + 1;
        }

        if (data.nextOrganizationId) {
          this.nextOrganizationId = data.nextOrganizationId;
        }

        console.log(`Loaded ${this.documents.size} persisted documents and ${this.organizationCategories.size} organization categories`);
      }
    } catch (error) {
      console.error('Failed to load persistent data:', error);
    }
  }

  // Organization category management
  async getOrganizationCategories(): Promise<any[]> {
    return Array.from(this.organizationCategories.values());
  }

  async createOrganizationCategory(organization: any): Promise<any> {
    const id = this.nextOrganizationId++;
    const newOrganization = {
      id,
      ...organization,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    this.organizationCategories.set(id, newOrganization);
    await this.saveOrganizationCategoriesToFile();
    return newOrganization;
  }

  async updateOrganizationCategory(id: number, organization: any): Promise<any> {
    const existingOrganization = this.organizationCategories.get(id);
    if (!existingOrganization) {
      throw new Error(`Organization category with id ${id} not found`);
    }

    const updatedOrganization = {
      ...existingOrganization,
      ...organization,
      manager: organization.manager !== undefined ? organization.manager : existingOrganization.manager,
      updatedAt: new Date()
    };

    this.organizationCategories.set(id, updatedOrganization);
    console.log(`Updated organization category ${id}:`, updatedOrganization);

    await this.saveOrganizationCategoriesToFile();
    return updatedOrganization;
  }

  async deleteOrganizationCategory(id: number): Promise<void> {
    this.organizationCategories.delete(id);
    await this.saveOrganizationCategoriesToFile();
  }

  async bulkCreateOrganizationCategories(organizations: any[], shouldOverwrite: boolean = false): Promise<any[]> {
    const createdOrganizations: any[] = [];
    const updatedOrganizations: any[] = [];
    const uniqueOrgs = new Map<string, any>();

    console.log(`Starting bulk creation of ${organizations.length} organization categories`);
    console.log(`Current organization count before bulk creation: ${this.organizationCategories.size}`);
    console.log(`Overwrite mode: ${shouldOverwrite}`);

    // Only clear existing data if explicitly requested to overwrite
    if (shouldOverwrite) {
      console.log('Overwrite mode: Clearing existing organization categories');
      this.organizationCategories.clear();
      this.nextOrganizationId = 1;
    }

    // Deduplicate organizations based on name and hierarchy
    for (const org of organizations) {
      const key = `${org.name || ''}-${org.upperCategory || ''}-${org.lowerCategory || ''}-${org.detailCategory || ''}`;
      if (!uniqueOrgs.has(key)) {
        uniqueOrgs.set(key, org);
      }
    }

    console.log(`Deduplicated from ${organizations.length} to ${uniqueOrgs.size} unique organizations`);

    // Process organizations - merge or create
    for (const org of uniqueOrgs.values()) {
      // Check if organization already exists by matching name and hierarchy
      const existingOrg = this.findExistingOrganization(org.name, org.upperCategory, org.lowerCategory, org.detailCategory);

      if (existingOrg && !shouldOverwrite) {
        // Merge mode: Update existing organization while preserving critical data
        console.log(`Merging existing organization: ${existingOrg.name} (ID: ${existingOrg.id})`);

        const updatedOrganization = {
          ...existingOrg, // Preserve existing data including connections
          // Only update non-critical fields if they have new values
          description: org.description || existingOrg.description,
          status: org.status || existingOrg.status,
          isActive: org.isActive !== undefined ? org.isActive : existingOrg.isActive,
          updatedAt: new Date()
          // Preserve: id, name, hierarchy, manager, createdAt, and any other connected data
        };

        this.organizationCategories.set(existingOrg.id, updatedOrganization);
        updatedOrganizations.push(updatedOrganization);

      } else {
        // Create new organization
        const id = shouldOverwrite ? this.nextOrganizationId++ : Math.max(...Array.from(this.organizationCategories.keys()), this.nextOrganizationId - 1) + 1;
        this.nextOrganizationId = Math.max(this.nextOrganizationId, id + 1);

        const newOrganization = {
          id,
          name: org.name,
          upperCategory: org.upperCategory || null,
          lowerCategory: org.lowerCategory || null,
          detailCategory: org.detailCategory || null,
          description: org.description || null,
        isActive: org.isActive !== false,
          status: org.status || '활성',
          manager: org.manager || null,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        this.organizationCategories.set(id, newOrganization);
        createdOrganizations.push(newOrganization);
        console.log(`Created organization: ${newOrganization.name} (ID: ${id}) - ${newOrganization.upperCategory} > ${newOrganization.lowerCategory} > ${newOrganization.detailCategory}`);
      }
    }

    console.log(`Organization count after bulk operation: ${this.organizationCategories.size}`);
    console.log(`Created: ${createdOrganizations.length}, Updated: ${updatedOrganizations.length}`);
    await this.saveOrganizationCategoriesToFile();

    const totalProcessed = [...createdOrganizations, ...updatedOrganizations];
    console.log(`Bulk processed ${totalProcessed.length} organization categories and saved to persistence`);
    return totalProcessed;
  }



  async deleteAllOrganizationCategories(): Promise<void> {
    console.log('Clearing all organization categories from memory storage');
    this.organizationCategories.clear();
    this.nextOrganizationId = 1;
    await this.saveOrganizationCategoriesToFile();
    console.log('All organization categories have been cleared from memory storage');
  }

  // Get unique user status values from stored users
  getUniqueUserStatuses(): string[] {
    const statuses = new Set<string>();
    
    for (const user of this.users.values()) {
      if (user.status && user.status.trim() !== '') {
        statuses.add(user.status.trim());
      }
    }
    
    return Array.from(statuses).sort();
  }

  // Helper method to find existing organization by name and hierarchy
  private findExistingOrganization(name: string, upperCategory?: string, lowerCategory?: string, detailCategory?: string): any | null {
    for (const org of this.organizationCategories.values()) {
      // Match by name and full hierarchy
      if (org.name === name && 
          org.upperCategory === (upperCategory || null) &&
          org.lowerCategory === (lowerCategory || null) &&
          org.detailCategory === (detailCategory || null)) {
        return org;
      }
    }
    return null;
  }

  // Method to reload authentic organization data
  async reloadAuthenticOrganizationData(): Promise<void> {
    console.log('Reloading authentic organization data from Excel file');

    // Clear existing data
    this.organizationCategories.clear();
    this.nextOrganizationId = 1;

    // Load the authentic data from the processed file
    this.loadPersistedOrganizationCategories();

    console.log(`Reloaded ${this.organizationCategories.size} authentic organization categories`);
  }

  // Enhanced file persistence for organization categories
  private async saveOrganizationCategoriesToFile(): Promise<void> {
    try {
      const organizationCategoriesFile = path.join(this.persistenceDir, 'organization-categories.json');
      const categoriesArray = Array.from(this.organizationCategories.values()).map(cat => ({
        ...cat,
        createdAt: cat.createdAt?.toISOString(),
        updatedAt: cat.updatedAt?.toISOString()
      }));

      fs.writeFileSync(organizationCategoriesFile, JSON.stringify(categoriesArray, null, 2));
      console.log(`Saved ${categoriesArray.length} organization categories to file`);
    } catch (error) {
      console.error('Failed to save organization categories to file:', error);
    }
  }

  private loadPersistedOrganizationCategories(): void {
    try {
      const organizationCategoriesFile = path.join(this.persistenceDir, 'organization-categories.json');

      if (fs.existsSync(organizationCategoriesFile)) {
        const data = fs.readFileSync(organizationCategoriesFile, 'utf8');
        const categoriesArray = JSON.parse(data);

        for (const cat of categoriesArray) {
          // Fix the incorrect data mapping
          const organizationCategory = {
            ...cat,
            // Correct the data mapping: upperCategory should be actual upper category
            upperCategory: cat.upperCategory || null, // This is actually the upper category
            lowerCategory: cat.lowerCategory || null, // This is actually the lower category  
            detailCategory: cat.detailCategory === '활성' || cat.detailCategory === '비활성' || cat.detailCategory === '등록 승인 대기중' ? null : cat.detailCategory, // Remove status from detailCategory
            status: cat.detailCategory === '활성' || cat.detailCategory === '비활성' || cat.detailCategory === '등록 승인 대기중' ? cat.detailCategory : (cat.status || '활성'),
            name: cat.name && (cat.name === '활성' || cat.name === '비활성' || cat.name === '등록 승인 대기중') ? 
              `${cat.upperCategory || ''} ${cat.lowerCategory || ''}`.trim() : cat.name,
            createdAt: cat.createdAt ? new Date(cat.createdAt) : new Date(),
            updatedAt: cat.updatedAt ? new Date(cat.updatedAt) : new Date()
          };
          this.organizationCategories.set(cat.id, organizationCategory);
          this.nextOrganizationId = Math.max(this.nextOrganizationId, cat.id + 1);
        }

        console.log(`Loaded ${this.organizationCategories.size} organization categories from file`);
      } else {
        console.log('No organization categories file found, starting with empty data');
      }
    } catch (error) {
      console.error('Failed to load organization categories from file:', error);
    }
  }

  // Organization file management methods
  async saveOrganizationFileRecord(fileRecord: any): Promise<void> {
    this.organizationFiles.set(fileRecord.fileName, fileRecord);
    this.savePersistedOrganizationFiles();
  }

  async getOrganizationFiles(): Promise<any[]> {
    return Array.from(this.organizationFiles.values());
  }

  async deleteOrganizationFile(fileName: string): Promise<boolean> {
    const deleted = this.organizationFiles.delete(fileName);
    if (deleted) {
      this.savePersistedOrganizationFiles();
    }
    return deleted;
  }

  private savePersistedOrganizationFiles(): void {
    try {
      const organizationFilesFile = path.join(this.persistenceDir, 'organization-files.json');
      const filesArray = Array.from(this.organizationFiles.values()).map(file => ({
        ...file,
        uploadedAt: file.uploadedAt?.toISOString ? file.uploadedAt.toISOString() : file.uploadedAt
      }));

      fs.writeFileSync(organizationFilesFile, JSON.stringify(filesArray, null, 2));
      console.log(`Saved ${filesArray.length} organization files to persistence`);
    } catch (error) {
      console.error('Failed to save organization files to file:', error);
    }
  }

  private loadPersistedOrganizationFiles(): void {
    try {
      const organizationFilesFile = path.join(this.persistenceDir, 'organization-files.json');

      if (fs.existsSync(organizationFilesFile)) {
        const data = fs.readFileSync(organizationFilesFile, 'utf8');
        const filesArray = JSON.parse(data);

        for (const file of filesArray) {
          const fileRecord = {
            ...file,
            uploadedAt: file.uploadedAt ? new Date(file.uploadedAt) : new Date()
          };
          this.organizationFiles.set(file.fileName, fileRecord);
        }

        console.log(`Loaded ${this.organizationFiles.size} organization files from persistence`);
      } else {
        console.log('No organization files found, starting with empty data');
      }
    } catch (error) {
      console.error('Failed to load organization files from persistence:', error);
    }
  }

  // User file management methods
  async saveUserFile(fileInfo: any): Promise<void> {
    this.userFiles.set(fileInfo.id, {
      ...fileInfo,
      uploadedAt: new Date(fileInfo.uploadedAt)
    });
    this.savePersistedUserFiles();
  }

  async getUserFiles(): Promise<any[]> {
    return Array.from(this.userFiles.values());
  }

  async deleteUserFile(fileId: string): Promise<void> {
    this.userFiles.delete(fileId);
    this.savePersistedUserFiles();
  }

  private savePersistedUserFiles(): void {
    try {
      const userFilesArray = Array.from(this.userFiles.values()).map(file => ({
        ...file,
        uploadedAt: file.uploadedAt?.toISOString()
      }));

      fs.writeFileSync(this.userFilesFile, JSON.stringify(userFilesArray, null, 2));
      console.log(`Saved ${userFilesArray.length} user files to persistence`);
    } catch (error) {
      console.error('Failed to save user files to persistence:', error);
    }
  }

  private loadPersistedUserFiles(): void {
    try {
      if (fs.existsSync(this.userFilesFile)) {
        const data = fs.readFileSync(this.userFilesFile, 'utf8');
        const userFilesArray = JSON.parse(data);

        for (const file of userFilesArray) {
          this.userFiles.set(file.id, {
            ...file,
            uploadedAt: file.uploadedAt ? new Date(file.uploadedAt) : new Date()
          });
        }

        console.log(`Loaded ${this.userFiles.size} user files from persistence`);
      } else {
        console.log('No user files found, starting with empty data');
      }
    } catch (error) {
      console.error('Failed to load user files from persistence:', error);
    }
  }

  // Agent file management methods
  async saveAgentFile(fileInfo: any): Promise<void> {
    this.agentFiles.set(fileInfo.id, {
      ...fileInfo,
      uploadedAt: new Date(fileInfo.uploadedAt)
    });
    this.savePersistedAgentFiles();
  }

  async getAgentFiles(): Promise<any[]> {
    return Array.from(this.agentFiles.values());
  }

  async deleteAgentFile(fileId: string): Promise<void> {
    this.agentFiles.delete(fileId);
    this.savePersistedAgentFiles();
  }

  private savePersistedAgentFiles(): void {
    try {
      const agentFilesArray = Array.from(this.agentFiles.values()).map(file => ({
        ...file,
        uploadedAt: file.uploadedAt?.toISOString()
      }));

      fs.writeFileSync(this.agentFilesFile, JSON.stringify(agentFilesArray, null, 2));
      console.log(`Saved ${agentFilesArray.length} agent files to persistence`);
    } catch (error) {
      console.error('Failed to save agent files to file:', error);
    }
  }

  private loadPersistedAgentFiles(): void {
    try {
      if (fs.existsSync(this.agentFilesFile)) {
        const data = fs.readFileSync(this.agentFilesFile, 'utf8');
        const filesArray = JSON.parse(data);

        for (const file of filesArray) {
          const fileRecord = {
            ...file,
            uploadedAt: file.uploadedAt ? new Date(file.uploadedAt) : new Date()
          };
          this.agentFiles.set(file.id, fileRecord);
        }

        console.log(`Loaded ${this.agentFiles.size} agent files from persistence`);
      } else {
        console.log('No agent files found, starting with empty data');
      }
    } catch (error) {
      console.error('Failed to load agent files from persistence:', error);
    }
  }

  private loadUsersFromAdminCenter(): void {
    try {
      if (fs.existsSync(this.usersFile)) {
        const data = fs.readFileSync(this.usersFile, 'utf8');
        const parsedData = JSON.parse(data);

        // Check if data has 'users' property (new format) or is directly an array (old format)
        let usersData = parsedData;
        if (parsedData.users) {
          usersData = parsedData.users;
        }

        // Handle Map entries format [key, value] pairs
        if (Array.isArray(usersData) && usersData.length > 0 && Array.isArray(usersData[0])) {
          // Map entries format: [[id, userData], [id, userData], ...]
          for (const [userId, userData] of usersData) {
            this.users.set(userId, {
              ...userData,
              createdAt: userData.createdAt ? new Date(userData.createdAt) : new Date(),
              updatedAt: userData.updatedAt ? new Date(userData.updatedAt) : new Date()
            });
          }
        } else if (Array.isArray(usersData)) {
          // Regular array format: [{user1}, {user2}, ...]
          for (const user of usersData) {
            this.users.set(user.id, {
              ...user,
              createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
              updatedAt: user.updatedAt ? new Date(user.updatedAt) : new Date()
            });
          }
        }

        console.log(`Loaded ${this.users.size} users from admin center (memory-storage.json)`);
      } else {
        console.log('No admin center users file found, starting with empty data');
      }
    } catch (error) {
      console.error('Error loading users from admin center:', error);
    }
  }

  private loadAgentsFromAdminCenter(): void {
    try {
      if (fs.existsSync(this.agentsFile)) {
        const data = fs.readFileSync(this.agentsFile, 'utf8');
        const agentsData = JSON.parse(data);

        // Handle multiple data formats
        let agentsArray;
        
        if (Array.isArray(agentsData)) {
          agentsArray = agentsData;
        } else if (agentsData && agentsData.agents && Array.isArray(agentsData.agents)) {
          // Handle format: { "agents": [[id, agent_data], ...] }
          agentsArray = agentsData.agents.map((item: any) => {
            if (Array.isArray(item) && item.length === 2) {
              return item[1]; // Extract the agent data from [id, agent_data]
            }
            return item;
          });
        } else if (typeof agentsData === 'object' && agentsData !== null) {
          // Convert object format to array
          agentsArray = Object.values(agentsData);
        } else {
          console.log('Invalid agents data format, starting with empty data');
          return;
        }

        for (const agent of agentsArray) {
          if (agent && agent.id) {
            this.agents.set(agent.id, {
              ...agent,
              createdAt: agent.createdAt ? new Date(agent.createdAt) : new Date(),
              updatedAt: agent.updatedAt ? new Date(agent.updatedAt) : new Date()
            });
            this.nextAgentId = Math.max(this.nextAgentId, agent.id + 1);
          }
        }

        console.log(`Loaded ${this.agents.size} agents from admin center (memory-storage-agents.json)`);
      } else {
        console.log('No admin center agents file found, starting with empty data');
      }
    } catch (error) {
      console.error('Error loading agents from admin center:', error);
    }
  }

  private loadOrganizationCategoriesFromAdminCenter(): void {
    try {
      if (fs.existsSync(this.organizationCategoriesFile)) {
        const data = fs.readFileSync(this.organizationCategoriesFile, 'utf8');
        const categoriesArray = JSON.parse(data);

        for (const category of categoriesArray) {
          this.organizationCategories.set(category.id, {
            ...category,
            createdAt: category.createdAt ? new Date(category.createdAt) : new Date(),
            updatedAt: category.updatedAt ? new Date(category.updatedAt) : new Date()
          });
          this.nextOrganizationId = Math.max(this.nextOrganizationId, category.id + 1);
        }

        console.log(`Loaded ${this.organizationCategories.size} organization categories from admin center (organization-categories.json)`);
      } else {
        console.log('No admin center organization categories file found, starting with empty data');
      }
    } catch (error) {
      console.error('Error loading organization categories from admin center:', error);
    }
  }

   private async savePersistedUsers(): Promise<void> {
    try {
      const usersFile = path.join(this.persistenceDir, 'users.json');
      const usersArray = Array.from(this.users.values()).map(user => ({
        ...user,
        createdAt: user.createdAt?.toISOString(),
        updatedAt: user.updatedAt?.toISOString()
      }));

      fs.writeFileSync(usersFile, JSON.stringify(usersArray, null, 2));
      console.log(`Saved ${usersArray.length} users to persistence`);
    } catch (error) {
      console.error('Failed to save users to persistence:', error);
    }
  }
  // Add cache clearing method
  clearCache(): void {
    console.log("Clearing memory storage cache");
    // Clear any cached data if needed
  }

  private loadPersistedConversations(): void {
    try {
      if (fs.existsSync(this.conversationsFile)) {
        const data = JSON.parse(fs.readFileSync(this.conversationsFile, 'utf8'));
        const conversationsWithDates = (data.conversations || []).map(([id, conv]: [number, any]) => [
          id,
          {
            ...conv,
            createdAt: conv.createdAt ? new Date(conv.createdAt) : null,
            lastReadAt: conv.lastReadAt ? new Date(conv.lastReadAt) : null,
            lastMessageAt: conv.lastMessageAt ? new Date(conv.lastMessageAt) : null,
            isHidden: conv.isHidden ?? false // 기본값 false 설정
          }
        ]);
        this.conversations = new Map(conversationsWithDates);
        console.log(`Loaded ${this.conversations.size} conversations from persistence`);
      }
    } catch (error) {
      console.error('Failed to load persisted conversations:', error);
      this.conversations = new Map();
    }
  }

  private loadPersistedMessages(): void {
    try {
      if (fs.existsSync(this.messagesFile)) {
        const data = JSON.parse(fs.readFileSync(this.messagesFile, 'utf8'));
        const messagesWithDates = (data.messages || []).map(([id, msg]: [number, any]) => [
          id,
          {
            ...msg,
            createdAt: msg.createdAt ? new Date(msg.createdAt) : null
          }
        ]);
        this.messages = new Map(messagesWithDates);
        console.log(`Loaded ${this.messages.size} messages from persistence`);
      }
    } catch (error) {
      console.error('Failed to load persisted messages:', error);
      this.messages = new Map();
    }
  }

  private savePersistedConversations(): void {
    try {
      const conversationsData = {
        conversations: Array.from(this.conversations.entries()).map(([id, conv]) => [
          id,
          {
            ...conv,
            createdAt: conv.createdAt?.toISOString(),
            lastReadAt: conv.lastReadAt?.toISOString(),
            lastMessageAt: conv.lastMessageAt?.toISOString()
          }
        ])
      };

      fs.writeFileSync(this.conversationsFile, JSON.stringify(conversationsData, null, 2));
    } catch (error) {
      console.error('Failed to save conversations to persistence:', error);
    }
  }

  private savePersistedMessages(): void {
    try {
      const messagesData = {
        messages: Array.from(this.messages.entries()).map(([id, msg]) => [
          id,
          {
            ...msg,
            createdAt: msg.createdAt?.toISOString()
          }
        ])
      };

      fs.writeFileSync(this.messagesFile, JSON.stringify(messagesData, null, 2));
    } catch (error) {
      console.error('Failed to save messages to persistence:', error);
    }
  }

  private savePersistedAgents(): void {
    try {
      const agentsData = {
        agents: Array.from(this.agents.entries()).map(([id, agent]) => [
          id,
          {
            ...agent,
            createdAt: agent.createdAt?.toISOString(),
            updatedAt: agent.updatedAt?.toISOString()
          }
        ])
      };

      fs.writeFileSync(this.agentsFile, JSON.stringify(agentsData, null, 2));
      console.log('✓ Agent data saved to persistence');
    } catch (error) {
      console.error('Failed to save agents to persistence:', error);
    }
  }

  private async loadOrganizationCategoriesFromFile(): Promise<void> {
    try {
      const organizationCategoriesFile = path.join(this.persistenceDir, 'organization-categories.json');

      if (fs.existsSync(organizationCategoriesFile)) {
        const data = fs.readFileSync(organizationCategoriesFile, 'utf8');
        const categories = JSON.parse(data);

        categories.forEach((cat: any) => {
          this.organizationCategories.set(cat.id, {
            ...cat,
            createdAt: cat.createdAt ? new Date(cat.createdAt) : new Date(),
            updatedAt: cat.updatedAt ? new Date(cat.updatedAt) : new Date()
          });

          if (cat.id >= this.nextOrganizationId) {
            this.nextOrganizationId = cat.id + 1;
          }
        });

        console.log(`Loaded ${categories.length} persisted organization categories`);
      } else {
        console.log('No persisted organization categories found');
      }
    } catch (error) {
      console.error('Failed to load persisted organization categories:', error);
    }
  }

  async deleteAgentsByOrganization(organizationName: string): Promise<number> {
    const initialCount = this.agents.size;
    const agentsToDelete: number[] = [];

    for (const [agentId, agent] of this.agents.entries()) {
      const hasOrgAffiliation =
        agent.upperCategory === organizationName ||
        agent.lowerCategory === organizationName ||
        (agent as any).organizationName === organizationName;

      if (hasOrgAffiliation) {
        agentsToDelete.push(agentId);
      }
    }

    agentsToDelete.forEach(agentId => this.agents.delete(agentId));

    const deletedCount = agentsToDelete.length;

    if (deletedCount > 0) {
      console.log(`🗑️ Deleted ${deletedCount} agents with ${organizationName} affiliation`);
      cache.delete('all_agents'); // Invalidate agent cache
    }

    return deletedCount;
  }

  async deleteRoboUniversityOrganizations(): Promise<{ deletedCount: number }> {
    const organizationsToDelete: number[] = [];
    
    for (const [orgId, org] of this.organizationCategories.entries()) {
      const hasRoboAffiliation =
        org.upperCategory === "로보대학교" ||
        org.lowerCategory === "로보대학교" ||
        org.detailCategory === "로보대학교" ||
        org.name === "로보대학교" ||
        (org.name && org.name.includes("로보대학교")) ||
        (org.upperCategory && org.upperCategory.includes("로보대학교")) ||
        (org.lowerCategory && org.lowerCategory.includes("로보대학교")) ||
        (org.detailCategory && org.detailCategory.includes("로보대학교"));

      if (hasRoboAffiliation) {
        organizationsToDelete.push(orgId);
      }
    }

    organizationsToDelete.forEach(orgId => this.organizationCategories.delete(orgId));

    const deletedCount = organizationsToDelete.length;

    if (deletedCount > 0) {
      console.log(`🗑️ Deleted ${deletedCount} organization categories with 로보대학교 affiliation`);
      // Save to persistence file
      this.saveOrganizationCategoriesToFile();
      // Clear cache
      if (cache) {
        cache.delete('all_organizations');
        cache.delete('organization_categories');
      }
    }

    return { deletedCount };
  }

  async clearAllOrganizationCategories(): Promise<void> {
    this.organizationCategories.clear();
    this.nextOrganizationId = 1;
    console.log('All organization categories cleared from memory storage');
    
    // Save the cleared state to persistence
    this.saveOrganizationCategoriesToFile();
    
    // Clear cache
    if (cache) {
      cache.delete('all_organizations');
      cache.delete('organization_categories');
    }
  }

  // QA Improvement Comment operations
  async createQAImprovementComment(commentData: InsertQAImprovementComment): Promise<QAImprovementComment> {
    const comment: QAImprovementComment = {
      id: this.nextQACommentId++,
      conversationId: commentData.conversationId,
      comment: commentData.comment,
      createdBy: commentData.createdBy,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.qaImprovementComments.set(comment.conversationId, comment);
    this.savePersistedQAComments();
    return comment;
  }

  async getQAImprovementComment(conversationId: number): Promise<QAImprovementComment | undefined> {
    return this.qaImprovementComments.get(conversationId);
  }

  async updateQAImprovementComment(conversationId: number, commentText: string, updatedBy: string): Promise<QAImprovementComment | undefined> {
    const existingComment = this.qaImprovementComments.get(conversationId);
    
    if (existingComment) {
      const updatedComment: QAImprovementComment = {
        ...existingComment,
        comment: commentText,
        createdBy: updatedBy,
        updatedAt: new Date(),
      };
      
      this.qaImprovementComments.set(conversationId, updatedComment);
      this.savePersistedQAComments();
      return updatedComment;
    }
    
    // If comment doesn't exist, create new one
    return this.createQAImprovementComment({
      conversationId,
      comment: commentText,
      createdBy: updatedBy,
    });
  }

  private loadPersistedQAComments() {
    try {
      if (fs.existsSync(this.qaCommentsFile)) {
        const data = fs.readFileSync(this.qaCommentsFile, 'utf8');
        const comments = JSON.parse(data);
        
        // Convert date strings back to Date objects
        comments.forEach((comment: any) => {
          comment.createdAt = new Date(comment.createdAt);
          comment.updatedAt = new Date(comment.updatedAt);
          this.qaImprovementComments.set(comment.conversationId, comment);
          
          // Update next ID to avoid conflicts
          if (comment.id >= this.nextQACommentId) {
            this.nextQACommentId = comment.id + 1;
          }
        });
        
        console.log(`Loaded ${comments.length} QA improvement comments from persistence`);
      } else {
        console.log('No QA comments found, starting with empty data');
      }
    } catch (error) {
      console.error('Error loading persisted QA comments:', error);
    }
  }

  private savePersistedQAComments() {
    try {
      const comments = Array.from(this.qaImprovementComments.values());
      fs.writeFileSync(this.qaCommentsFile, JSON.stringify(comments, null, 2));
    } catch (error) {
      console.error('Error saving QA comments:', error);
    }
  }

  clearCache() {
    cache.clear();
  }

  // 그룹 채팅 관련 메서드들
  async createGroupChat(groupChatData: InsertGroupChat): Promise<GroupChat> {
    const id = this.nextGroupChatId++;
    const newGroupChat: GroupChat = {
      ...groupChatData,
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastMessageAt: new Date()
    };
    this.groupChats.set(id, newGroupChat);
    this.savePersistedGroupChats();
    return newGroupChat;
  }

  async getGroupChat(id: number): Promise<GroupChat | undefined> {
    return this.groupChats.get(id);
  }

  async getUserGroupChats(userId: string): Promise<any[]> {
    const userGroupChats: any[] = [];
    
    // 사용자가 멤버로 있는 그룹 채팅들 찾기
    for (const member of this.groupChatMembers.values()) {
      if (member.userId === userId) {
        const groupChat = this.groupChats.get(member.groupChatId);
        if (groupChat) {
          // 마지막 메시지 찾기
          const lastMessage = Array.from(this.groupChatMessages.values())
            .filter(msg => msg.groupChatId === groupChat.id)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

          userGroupChats.push({
            ...groupChat,
            lastMessage
          });
        }
      }
    }

    return userGroupChats.sort((a, b) => 
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  }

  async updateGroupChat(id: number, updates: Partial<GroupChat>): Promise<GroupChat | undefined> {
    const groupChat = this.groupChats.get(id);
    if (groupChat) {
      const updatedGroupChat = {
        ...groupChat,
        ...updates,
        updatedAt: new Date()
      };
      this.groupChats.set(id, updatedGroupChat);
      this.savePersistedGroupChats();
      return updatedGroupChat;
    }
    return undefined;
  }

  async deleteGroupChat(id: number): Promise<void> {
    this.groupChats.delete(id);
    
    // 관련된 멤버, 에이전트, 메시지도 모두 삭제
    Array.from(this.groupChatMembers.entries()).forEach(([memberId, member]) => {
      if (member.groupChatId === id) {
        this.groupChatMembers.delete(memberId);
      }
    });
    
    Array.from(this.groupChatAgents.entries()).forEach(([agentId, agent]) => {
      if (agent.groupChatId === id) {
        this.groupChatAgents.delete(agentId);
      }
    });
    
    Array.from(this.groupChatMessages.entries()).forEach(([messageId, message]) => {
      if (message.groupChatId === id) {
        this.groupChatMessages.delete(messageId);
      }
    });

    this.savePersistedGroupChats();
    this.savePersistedGroupChatMembers();
    this.savePersistedGroupChatAgents();
    this.savePersistedGroupChatMessages();
  }

  async addGroupChatMember(memberData: InsertGroupChatMember): Promise<GroupChatMember> {
    const id = this.nextGroupChatMemberId++;
    const newMember: GroupChatMember = {
      ...memberData,
      id,
      joinedAt: new Date(),
      lastReadAt: null
    };
    this.groupChatMembers.set(id, newMember);
    this.savePersistedGroupChatMembers();
    return newMember;
  }

  async removeGroupChatMember(groupChatId: number, userId: string): Promise<void> {
    Array.from(this.groupChatMembers.entries()).forEach(([id, member]) => {
      if (member.groupChatId === groupChatId && member.userId === userId) {
        this.groupChatMembers.delete(id);
      }
    });
    this.savePersistedGroupChatMembers();
  }

  async getGroupChatMembers(groupChatId: number): Promise<GroupChatMember[]> {
    return Array.from(this.groupChatMembers.values())
      .filter(member => member.groupChatId === groupChatId);
  }

  async addGroupChatAgent(agentData: InsertGroupChatAgent): Promise<GroupChatAgent> {
    const id = this.nextGroupChatAgentId++;
    const newAgent: GroupChatAgent = {
      ...agentData,
      id,
      addedAt: new Date()
    };
    this.groupChatAgents.set(id, newAgent);
    this.savePersistedGroupChatAgents();
    return newAgent;
  }

  async removeGroupChatAgent(groupChatId: number, agentId: number): Promise<void> {
    Array.from(this.groupChatAgents.entries()).forEach(([id, agent]) => {
      if (agent.groupChatId === groupChatId && agent.agentId === agentId) {
        this.groupChatAgents.delete(id);
      }
    });
    this.savePersistedGroupChatAgents();
  }

  async getGroupChatAgents(groupChatId: number): Promise<GroupChatAgent[]> {
    return Array.from(this.groupChatAgents.values())
      .filter(agent => agent.groupChatId === groupChatId);
  }

  async createGroupChatMessage(messageData: InsertGroupChatMessage): Promise<GroupChatMessage> {
    const id = this.nextGroupChatMessageId++;
    const newMessage: GroupChatMessage = {
      ...messageData,
      id,
      createdAt: new Date()
    };
    this.groupChatMessages.set(id, newMessage);

    // 그룹 채팅의 lastMessageAt 업데이트
    const groupChat = this.groupChats.get(messageData.groupChatId);
    if (groupChat) {
      groupChat.lastMessageAt = newMessage.createdAt;
      this.groupChats.set(messageData.groupChatId, groupChat);
      this.savePersistedGroupChats();
    }

    this.savePersistedGroupChatMessages();
    return newMessage;
  }

  async getGroupChatMessages(groupChatId: number): Promise<GroupChatMessage[]> {
    return Array.from(this.groupChatMessages.values())
      .filter(message => message.groupChatId === groupChatId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async markGroupChatAsRead(groupChatId: number, userId: string): Promise<void> {
    Array.from(this.groupChatMembers.entries()).forEach(([id, member]) => {
      if (member.groupChatId === groupChatId && member.userId === userId) {
        member.lastReadAt = new Date();
        this.groupChatMembers.set(id, member);
      }
    });
    this.savePersistedGroupChatMembers();
  }

  // 그룹 채팅 관련 데이터 저장 메서드들
  private savePersistedGroupChats(): void {
    this.ensurePersistenceDir();
    const data = Array.from(this.groupChats.values()).map(chat => ({
      ...chat,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      lastMessageAt: chat.lastMessageAt.toISOString()
    }));
    fs.writeFileSync(this.groupChatsFile, JSON.stringify(data, null, 2));
  }

  private savePersistedGroupChatMembers(): void {
    this.ensurePersistenceDir();
    const data = Array.from(this.groupChatMembers.values()).map(member => ({
      ...member,
      joinedAt: member.joinedAt.toISOString(),
      lastReadAt: member.lastReadAt?.toISOString() || null
    }));
    fs.writeFileSync(this.groupChatMembersFile, JSON.stringify(data, null, 2));
  }

  private savePersistedGroupChatAgents(): void {
    this.ensurePersistenceDir();
    const data = Array.from(this.groupChatAgents.values()).map(agent => ({
      ...agent,
      addedAt: agent.addedAt.toISOString()
    }));
    fs.writeFileSync(this.groupChatAgentsFile, JSON.stringify(data, null, 2));
  }

  private savePersistedGroupChatMessages(): void {
    this.ensurePersistenceDir();
    const data = Array.from(this.groupChatMessages.values()).map(message => ({
      ...message,
      createdAt: message.createdAt.toISOString()
    }));
    fs.writeFileSync(this.groupChatMessagesFile, JSON.stringify(data, null, 2));
  }

  // 그룹 채팅 관련 데이터 로드 메서드들
  private loadPersistedGroupChats(): void {
    try {
      if (fs.existsSync(this.groupChatsFile)) {
        const data = JSON.parse(fs.readFileSync(this.groupChatsFile, 'utf-8'));
        data.forEach((chat: any) => {
          this.groupChats.set(chat.id, {
            ...chat,
            createdAt: new Date(chat.createdAt),
            updatedAt: new Date(chat.updatedAt),
            lastMessageAt: new Date(chat.lastMessageAt)
          });
        });
        if (data.length > 0) {
          this.nextGroupChatId = Math.max(...data.map((c: any) => c.id)) + 1;
        }
        console.log(`Loaded ${data.length} group chats from persistence`);
      }
    } catch (error) {
      console.error('Failed to load group chats:', error);
    }
  }

  private loadPersistedGroupChatMembers(): void {
    try {
      if (fs.existsSync(this.groupChatMembersFile)) {
        const data = JSON.parse(fs.readFileSync(this.groupChatMembersFile, 'utf-8'));
        data.forEach((member: any) => {
          this.groupChatMembers.set(member.id, {
            ...member,
            joinedAt: new Date(member.joinedAt),
            lastReadAt: member.lastReadAt ? new Date(member.lastReadAt) : null
          });
        });
        if (data.length > 0) {
          this.nextGroupChatMemberId = Math.max(...data.map((m: any) => m.id)) + 1;
        }
        console.log(`Loaded ${data.length} group chat members from persistence`);
      }
    } catch (error) {
      console.error('Failed to load group chat members:', error);
    }
  }

  private loadPersistedGroupChatAgents(): void {
    try {
      if (fs.existsSync(this.groupChatAgentsFile)) {
        const data = JSON.parse(fs.readFileSync(this.groupChatAgentsFile, 'utf-8'));
        data.forEach((agent: any) => {
          this.groupChatAgents.set(agent.id, {
            ...agent,
            addedAt: new Date(agent.addedAt)
          });
        });
        if (data.length > 0) {
          this.nextGroupChatAgentId = Math.max(...data.map((a: any) => a.id)) + 1;
        }
        console.log(`Loaded ${data.length} group chat agents from persistence`);
      }
    } catch (error) {
      console.error('Failed to load group chat agents:', error);
    }
  }

  private loadPersistedGroupChatMessages(): void {
    try {
      if (fs.existsSync(this.groupChatMessagesFile)) {
        const data = JSON.parse(fs.readFileSync(this.groupChatMessagesFile, 'utf-8'));
        data.forEach((message: any) => {
          this.groupChatMessages.set(message.id, {
            ...message,
            createdAt: new Date(message.createdAt)
          });
        });
        if (data.length > 0) {
          this.nextGroupChatMessageId = Math.max(...data.map((m: any) => m.id)) + 1;
        }
        console.log(`Loaded ${data.length} group chat messages from persistence`);
      }
    } catch (error) {
      console.error('Failed to load group chat messages:', error);
    }
  }
  
  // 🎭 Character Speaking Pattern operations (stub - not used in memory storage)
  async getCharacterSpeakingPattern(agentId: number): Promise<any> {
    // Memory storage stub - patterns are only used with database storage
    return undefined;
  }
  
  async createCharacterSpeakingPattern(pattern: any): Promise<any> {
    // Memory storage stub - patterns are only used with database storage
    console.log('[MemoryStorage] Character pattern creation skipped (database-only feature)');
    return pattern;
  }
}