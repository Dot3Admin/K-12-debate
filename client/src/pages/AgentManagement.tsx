import { useState, useMemo, useEffect } from "react";
import * as React from "react";
import { useParams, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ArrowLeft, X, User, GraduationCap, Code, Bot, FlaskRound, Edit, Upload, Search, Plus, Sparkles, Map as MapIcon, Languages, Dumbbell, Database, Lightbulb, Heart, Calendar, Pen, FileText } from "lucide-react";
import type { GroupChatWithDetails, Agent } from "@/types/agent";
import { RelationshipType, RELATIONSHIP_TYPES, LanguageOption, LANGUAGE_OPTIONS, HUMOR_STYLES, STRICT_MODE_DOMAINS, StrictModeDomain } from "@shared/schema";

// Language labels
const LANGUAGE_LABELS: Record<LanguageOption, string> = {
  question_language: "Question language",
  native_language: "Native language",
  korean: "한국어",
  english: "English",
  chinese: "中文",
  spanish: "Español",
  hindi: "हिन्दी",
  arabic: "العربية",
  portuguese: "Português",
  bengali: "বাংলা",
  russian: "Русский",
  japanese: "日本語",
  french: "Français",
  german: "Deutsch",
};

// Icon mapping for agent icons
const iconMap: Record<string, any> = {
  "fas fa-graduation-cap": GraduationCap,
  "fas fa-code": Code,
  "fas fa-robot": Bot,
  "fas fa-user": User,
  "fas fa-flask": FlaskRound,
  "fas fa-map": MapIcon,
  "fas fa-language": Languages,
  "fas fa-dumbbell": Dumbbell,
  "fas fa-database": Database,
  "fas fa-lightbulb": Lightbulb,
  "fas fa-heart": Heart,
  "fas fa-calendar": Calendar,
  "fas fa-pen": Pen,
  "fas fa-file-alt": FileText,
};

interface AgentManagementProps {
  isOperationsMode?: boolean;
}

export default function AgentManagement({ isOperationsMode = false }: AgentManagementProps = {}) {
  const { t } = useTranslation();
  const { groupChatId: groupChatIdFromParams } = useParams();
  const [location, setLocation] = useLocation();
  
  // Extract groupChatId from URL if useParams doesn't work (TabletLayout case)
  // In operations mode, groupChatId is not required
  const groupChatId = isOperationsMode ? null : (groupChatIdFromParams || (() => {
    const match = location.match(/\/group-chat\/(\d+)/);
    return match ? match[1] : null;
  })());
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  
  // 탭 상태 (Group chat mode용)
  const [activeTab, setActiveTab] = useState("participating");
  
  // 통합 검색 상태 (Operations mode용)
  const [unifiedSearch, setUnifiedSearch] = useState("");
  
  // 참여 중인 에이전트 관련 상태
  const [selectedAgentToAdd, setSelectedAgentToAdd] = useState("");
  const [agentRelationships, setAgentRelationships] = useState<Record<number, RelationshipType>>({});
  const [pendingRelationshipUpdates, setPendingRelationshipUpdates] = useState<Record<number, boolean>>({});
  
  // 언어 설정 관련 상태
  const [agentLanguages, setAgentLanguages] = useState<Record<number, LanguageOption>>({});
  const [pendingLanguageUpdates, setPendingLanguageUpdates] = useState<Record<number, boolean>>({});
  
  // Canon Lock 설정 관련 상태
  const [agentCanonMode, setAgentCanonMode] = useState<Record<number, string | null>>({});
  const [agentCanonCustomRule, setAgentCanonCustomRule] = useState<Record<number, string>>({});
  const [pendingCanonUpdates, setPendingCanonUpdates] = useState<Record<number, boolean>>({});
  const [generatingEssence, setGeneratingEssence] = useState<Record<number, boolean>>({});
  
  // 에이전트 참여 대화방 상태
  const [agentGroupChats, setAgentGroupChats] = useState<Record<number, { id: number; title: string | null; lastMessageAt: Date | null }[]>>({});
  
  // 추천된 에이전트 관련 상태  
  const [recommendationTopic, setRecommendationTopic] = useState("");
  const [recommendedCharacters, setRecommendedCharacters] = useState<any[]>([]);
  const [isLoadingRecommendations, setIsLoadingRecommendations] = useState(false);
  
  // 저장된 캐릭터 확장 상태
  const [expandedCharacterIds, setExpandedCharacterIds] = useState<Set<number>>(new Set());
  const [characterRelationships, setCharacterRelationships] = useState<Record<number, RelationshipType>>({});
  const [characterLanguages, setCharacterLanguages] = useState<Record<number, LanguageOption>>({});
  const [characterDebateIntensities, setCharacterDebateIntensities] = useState<Record<number, number>>({});
  
  // 추천 캐릭터 검색 상태
  const [recommendedCharacterSearch, setRecommendedCharacterSearch] = useState("");
  
  // 캐릭터 삭제 확인 다이얼로그 상태
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [characterToDelete, setCharacterToDelete] = useState<{ id: number; name: string } | null>(null);
  
  // 저장된 추천 캐릭터 조회 (operations mode에서는 항상 로드, group chat mode에서는 recommended 탭 선택 시 로드)
  const { data: savedCharactersData, isLoading: isLoadingSavedCharacters } = useQuery<any>({
    queryKey: ['/api/recommended-characters'],
    enabled: isOperationsMode || activeTab === 'recommended'
  });
  
  // 에이전트 검색 관련 상태
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgentsForSearch, setSelectedAgentsForSearch] = useState<Agent[]>([]);
  
  // 편집 모달 상태
  const [editingAgent, setEditingAgent] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isProcessingDocuments, setIsProcessingDocuments] = useState(false);
  
  // 파일별 처리 상태
  interface FileProcessingStatus {
    file: File;
    status: 'pending' | 'processing' | 'success' | 'error';
    stage?: string; // 현재 단계 (텍스트 추출, OpenAI 분석, RAG 생성)
    result?: {
      textLength?: number;
      ragChunks?: number;
      error?: string;
    };
  }
  const [fileProcessingStatuses, setFileProcessingStatuses] = useState<FileProcessingStatus[]>([]);
  
  // 문서 삭제 다이얼로그 상태
  const [deleteDocumentDialogOpen, setDeleteDocumentDialogOpen] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<{ id: number; originalName: string } | null>(null);
  
  const [editForm, setEditForm] = useState({
    name: "",
    persona: "",
    model: "",
    speakingStyleIntensity: "0.50",
    strictMode: null as string | null,
    canonSources: [] as string[],
    files: [] as File[]
  });

  // 유머 설정 상태
  const [humorSettings, setHumorSettings] = useState<{
    enabled: boolean;
    styles: string[];
  }>({
    enabled: false,
    styles: []
  });

  // 그룹 채팅 정보 조회 (operations mode에서는 필요 없음)
  const { data: groupChat } = useQuery<GroupChatWithDetails>({
    queryKey: [`/api/group-chats/${groupChatId}`],
    enabled: !isOperationsMode && !!groupChatId,
  });

  // 사용 가능한 에이전트 목록 조회
  const { data: availableAgents = [] } = useQuery<Agent[]>({
    queryKey: ['/api/agents/public'],
  });

  // 본인이 만든 에이전트 조회 (Operations mode + 채팅방 모드 모두 사용)
  const { data: managedAgents = [] } = useQuery<Agent[]>({
    queryKey: ['/api/agents/managed'],
  });
  
  // Operations mode: 각 에이전트의 참여 대화방 정보 가져오기
  React.useEffect(() => {
    if (!isOperationsMode || managedAgents.length === 0) return;

    console.log(`[DEBUG] Fetching group chats for ${managedAgents.length} agents`);

    const fetchGroupChats = async () => {
      const chatsMap: Record<number, { id: number; title: string | null; lastMessageAt: Date | null }[]> = {};
      
      for (const agent of managedAgents) {
        try {
          console.log(`[DEBUG] Fetching group chats for agent ${agent.id} (${agent.name})`);
          const response = await fetch(`/api/agents/${agent.id}/group-chats`);
          if (response.ok) {
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
              const chats = await response.json();
              console.log(`[DEBUG] Agent ${agent.id} has ${chats.length} group chats:`, chats);
              chatsMap[agent.id] = chats;
            } else {
              console.warn(`[DEBUG] Agent ${agent.id} returned non-JSON response`);
              chatsMap[agent.id] = [];
            }
          } else {
            console.warn(`[DEBUG] Agent ${agent.id} request failed with status ${response.status}`);
            chatsMap[agent.id] = [];
          }
        } catch (error) {
          console.error(`Failed to fetch group chats for agent ${agent.id}:`, error);
          chatsMap[agent.id] = [];
        }
      }
      
      console.log(`[DEBUG] Final agentGroupChats map:`, chatsMap);
      setAgentGroupChats(chatsMap);
    };

    fetchGroupChats();
  }, [isOperationsMode, managedAgents]);
  
  // 에이전트 검색용 필터링된 목록
  const filteredAgents = useMemo(() => {
    return availableAgents.filter(agent => 
      !selectedAgentsForSearch.some(selected => selected.id === agent.id) &&
      agent.name.toLowerCase().includes(agentSearch.toLowerCase())
    );
  }, [availableAgents, selectedAgentsForSearch, agentSearch]);
  
  // 통합 검색: 모든 에이전트를 하나의 목록으로 필터링
  const allAgentsUnified = useMemo(() => {
    if (!isOperationsMode) return [];
    
    const searchLower = unifiedSearch.toLowerCase();
    
    // 본인이 관리하는 에이전트
    const managed = managedAgents.filter(agent =>
      !searchLower ||
      agent.name.toLowerCase().includes(searchLower) ||
      agent.description?.toLowerCase().includes(searchLower)
    ).map(agent => ({
      ...agent,
      agentType: 'managed' as const,
      groupChats: agentGroupChats[agent.id] || []
    }));
    
    // 추천 캐릭터로 생성한 에이전트
    const recommended = (savedCharactersData?.characters || [])
      .map((char: any) => {
        const agent = managedAgents.find(a => a.id === char.agentId);
        if (!agent) return null;
        const charData = char.characterData;
        return {
          ...agent,
          agentType: 'recommended' as const,
          characterData: charData,
          groupChats: agentGroupChats[agent.id] || []
        };
      })
      .filter((agent: any) => {
        if (!agent) return false;
        if (!searchLower) return true;
        return agent.name.toLowerCase().includes(searchLower) ||
               agent.description?.toLowerCase().includes(searchLower) ||
               agent.characterData?.description?.toLowerCase().includes(searchLower);
      });
    
    // 중복 제거 (추천 캐릭터가 이미 managed에 있으면 추천으로 표시)
    const recommendedIds = new Set(recommended.map((a: any) => a.id));
    const uniqueManaged = managed.filter(a => !recommendedIds.has(a.id));
    
    return [...recommended, ...uniqueManaged];
  }, [isOperationsMode, unifiedSearch, managedAgents, savedCharactersData, agentGroupChats]);

  // 그룹 채팅의 각 에이전트와의 현재 관계, 언어, Canon Lock 설정 조회
  React.useEffect(() => {
    if (!groupChat?.agents || !user) return;

    const loadSettings = async () => {
      const relationships: Record<number, RelationshipType> = {};
      const languages: Record<number, LanguageOption> = {};
      const canonModes: Record<number, string | null> = {};
      const canonCustomRules: Record<number, string> = {};
      
      for (const groupAgent of groupChat.agents) {
        try {
          // 각 에이전트와의 사용자별 설정 조회
          const response = await fetch(`/api/group-chats/${groupChatId}/agents/${groupAgent.agentId}/user-settings`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
          });
          
          if (response.ok) {
            const settings = await response.json();
            relationships[groupAgent.agentId] = (settings.relationshipType as RelationshipType) || RELATIONSHIP_TYPES[0];
            languages[groupAgent.agentId] = (settings.languagePreference as LanguageOption) || "question_language";
          } else {
            // 설정이 없으면 기본값 사용
            relationships[groupAgent.agentId] = RELATIONSHIP_TYPES[0];
            languages[groupAgent.agentId] = "question_language";
          }

          // Canon Lock 설정 조회 (agent-level, relationship와 독립적)
          try {
            const canonResponse = await fetch(`/api/agents/${groupAgent.agentId}/canon`);
            if (canonResponse.ok) {
              const canonData = await canonResponse.json();
              canonModes[groupAgent.agentId] = canonData?.strictMode || null;
              canonCustomRules[groupAgent.agentId] = canonData?.customRule || "";
            } else {
              canonModes[groupAgent.agentId] = null;
              canonCustomRules[groupAgent.agentId] = "";
            }
          } catch (canonError) {
            console.error(`Failed to load canon settings for agent ${groupAgent.agentId}:`, canonError);
            canonModes[groupAgent.agentId] = null;
            canonCustomRules[groupAgent.agentId] = "";
          }
        } catch (error) {
          console.error(`Failed to load settings for agent ${groupAgent.agentId}:`, error);
          relationships[groupAgent.agentId] = RELATIONSHIP_TYPES[0]; // 기본값
          languages[groupAgent.agentId] = "question_language"; // 기본값
          canonModes[groupAgent.agentId] = null; // 기본값
          canonCustomRules[groupAgent.agentId] = ""; // 기본값
        }
      }
      
      setAgentRelationships(relationships);
      setAgentLanguages(languages);
      setAgentCanonMode(canonModes);
      setAgentCanonCustomRule(canonCustomRules);
    };

    loadSettings();
  }, [groupChat?.agents, user, groupChatId]);

  // 에이전트 제거 뮤테이션
  const removeAgentMutation = useMutation({
    mutationFn: async (agentId: number) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/agents/${agentId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to remove agent');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t('chat:agentManagement.removeSuccess'),
        description: t('chat:agentManagement.removeSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
    },
    onError: () => {
      toast({
        title: t('chat:agentManagement.removeFailed'),
        description: t('chat:agentManagement.removeFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // 에이전트 추가 뮤테이션
  const addAgentMutation = useMutation({
    mutationFn: async (agentId: number) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      });
      if (!response.ok) throw new Error('Failed to add agent');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t('chat:agentManagement.addSuccess'),
        description: t('chat:agentManagement.addSuccessDesc'),
      });
      setSelectedAgentToAdd("");
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
    },
    onError: () => {
      toast({
        title: t('chat:agentManagement.addFailed'),
        description: t('chat:agentManagement.addFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // 캐릭터를 에이전트로 변환하고 채팅방에 추가하는 뮤테이션
  const addCharacterMutation = useMutation({
    mutationFn: async ({ characterId, character, relationship, languagePreference, debateIntensity }: {
      characterId: number;
      character: any;
      relationship: RelationshipType;
      languagePreference: LanguageOption;
      debateIntensity: number;
    }) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/character-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          characterId, 
          character, 
          relationship, 
          languagePreference, 
          debateIntensity 
        }),
      });
      if (!response.ok) throw new Error('Failed to add character');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "캐릭터 추가 완료",
        description: "채팅방에 캐릭터가 추가되었습니다.",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
    },
    onError: (error: any) => {
      toast({
        title: "캐릭터 추가 실패",
        description: error.message || "채팅방에 캐릭터를 추가하지 못했습니다.",
        variant: "destructive",
      });
    },
  });

  // 관계 업데이트 뮤테이션
  const updateRelationshipMutation = useMutation({
    mutationFn: async ({ agentId, relationship }: { agentId: number; relationship: RelationshipType }) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/agents/${agentId}/user-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationshipType: relationship }),
      });
      if (!response.ok) throw new Error('Failed to update relationship');
      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: t('chat:agentManagement.relationshipSaveSuccess'),
        description: t('chat:agentManagement.relationshipSaveSuccessDesc'),
      });
      setPendingRelationshipUpdates(prev => ({
        ...prev,
        [variables.agentId]: false
      }));
      // 관계 정보도 업데이트된 값으로 설정
      setAgentRelationships(prev => ({
        ...prev,
        [variables.agentId]: variables.relationship
      }));
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
    },
    onError: () => {
      toast({
        title: t('chat:agentManagement.relationshipSaveFailed'),
        description: t('chat:agentManagement.relationshipSaveFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // 언어 설정 업데이트 뮤테이션
  const updateLanguageMutation = useMutation({
    mutationFn: async ({ agentId, language }: { agentId: number; language: LanguageOption }) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/agents/${agentId}/user-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ languagePreference: language }),
      });
      if (!response.ok) throw new Error('Failed to update language');
      return response.json();
    },
    onSuccess: (_, variables) => {
      toast({
        title: t('chat:agentManagement.languageSaveSuccess'),
        description: t('chat:agentManagement.languageSaveSuccessDesc'),
      });
      setPendingLanguageUpdates(prev => ({
        ...prev,
        [variables.agentId]: false
      }));
      // 언어 정보도 업데이트된 값으로 설정
      setAgentLanguages(prev => ({
        ...prev,
        [variables.agentId]: variables.language
      }));
    },
    onError: () => {
      toast({
        title: t('chat:agentManagement.languageSaveFailed'),
        description: t('chat:agentManagement.languageSaveFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // Canon Lock 설정 업데이트 뮤테이션
  const updateCanonMutation = useMutation({
    mutationFn: async ({ agentId, strictMode, customRule }: { agentId: number; strictMode: string | null; customRule: string }) => {
      const response = await fetch(`/api/agents/${agentId}/canon`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strictMode, customRule }),
      });
      if (!response.ok) throw new Error('Failed to update canon lock');
      return response.json();
    },
    onSuccess: (_, variables) => {
      const modeLabel = variables.strictMode === 'biblical' ? '성경적' :
                        variables.strictMode === 'teacher' ? '선생님' :
                        variables.strictMode === 'customer_service' ? '서비스 상담사' :
                        variables.strictMode === 'custom' ? '직접 작성' : '비활성화';
      toast({
        title: "Canon Lock 저장 완료",
        description: `Canon Lock이 ${modeLabel} 모드로 설정되었습니다.`,
      });
      setPendingCanonUpdates(prev => ({
        ...prev,
        [variables.agentId]: false
      }));
      setAgentCanonMode(prev => ({
        ...prev,
        [variables.agentId]: variables.strictMode
      }));
      setAgentCanonCustomRule(prev => ({
        ...prev,
        [variables.agentId]: variables.customRule
      }));
    },
    onError: () => {
      toast({
        title: "Canon Lock 저장 실패",
        description: "Canon Lock 설정 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 추천 캐릭터 삭제 뮤테이션
  const deleteCharacterMutation = useMutation({
    mutationFn: async (characterId: number) => {
      const response = await fetch(`/api/recommended-characters/${characterId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete character');
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "캐릭터 삭제 완료",
        description: data.message,
      });
      // 저장된 추천 캐릭터 목록을 새로고침
      queryClient.invalidateQueries({ queryKey: ['/api/recommended-characters'] });
      // 다이얼로그 닫기
      setDeleteDialogOpen(false);
      setCharacterToDelete(null);
    },
    onError: () => {
      toast({
        title: "삭제 실패",
        description: "캐릭터 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // 에이전트 문서 목록 조회
  const { data: agentDocuments = [], isLoading: isLoadingDocuments } = useQuery({
    queryKey: [`/api/agents/${editingAgent?.id}/documents`],
    enabled: !!editingAgent?.id && showEditModal,
    queryFn: async () => {
      const response = await fetch(`/api/agents/${editingAgent.id}/documents`);
      if (!response.ok) throw new Error('Failed to fetch documents');
      return response.json();
    }
  });

  // 문서 삭제 뮤테이션
  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete document');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "문서 삭제 완료",
        description: "문서가 성공적으로 삭제되었습니다.",
      });
      // 문서 목록 새로고침
      queryClient.invalidateQueries({ queryKey: [`/api/agents/${editingAgent?.id}/documents`] });
      // 다이얼로그 닫기
      setDeleteDocumentDialogOpen(false);
      setDocumentToDelete(null);
    },
    onError: () => {
      toast({
        title: "삭제 실패",
        description: "문서 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Vision API 재처리 뮤테이션
  const [reprocessingDocumentId, setReprocessingDocumentId] = useState<number | null>(null);
  const [visionProgress, setVisionProgress] = useState<{
    documentId: number | null;
    step: string;
    message: string;
    details?: any;
  } | null>(null);
  
  const reprocessVisionMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await fetch(`/api/documents/${documentId}/reprocess-vision`, {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to reprocess document');
      }
      return response.json();
    },
    onSuccess: (data, documentId) => {
      toast({
        title: "Vision API 처리 완료",
        description: `문서가 성공적으로 재처리되었습니다 (${data.visionDuration}초)`,
      });
      // 문서 목록 새로고침
      queryClient.invalidateQueries({ queryKey: [`/api/agents/${editingAgent?.id}/documents`] });
      setReprocessingDocumentId(null);
      setVisionProgress(null);
    },
    onError: (error: any, documentId) => {
      toast({
        title: "Vision API 처리 실패",
        description: error.message || "Vision API 재처리 중 오류가 발생했습니다.",
        variant: "destructive",
      });
      // 실패해도 문서 목록 새로고침 (hasVisionProcessed 상태 업데이트)
      queryClient.invalidateQueries({ queryKey: [`/api/agents/${editingAgent?.id}/documents`] });
      setReprocessingDocumentId(null);
      setVisionProgress(null);
    },
  });
  
  // Vision API 진행 상황 커스텀 이벤트 리스너
  useEffect(() => {
    if (!reprocessingDocumentId) return;
    
    const handleVisionProgress = (event: Event) => {
      const customEvent = event as CustomEvent;
      const data = customEvent.detail;
      
      console.log('[Vision Progress] Received:', data);
      if (data.documentId === reprocessingDocumentId) {
        const progressMessage = data.details?.message || data.step || '처리 중...';
        console.log('[Vision Progress] Setting message:', progressMessage);
        setVisionProgress({
          documentId: data.documentId,
          step: data.step,
          message: progressMessage,
          details: data.details
        });
        
        // Vision API 완료 또는 실패 시 문서 목록 새로고침
        if (data.step === 'completed' || data.step === 'error') {
          console.log('[Vision Progress] Processing finished, refreshing documents...');
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: [`/api/agents/${editingAgent?.id}/documents`] });
          }, 500); // SSE 이벤트 후 DB 업데이트 대기
        }
      }
    };
    
    window.addEventListener('visionProgress', handleVisionProgress);
    
    return () => {
      window.removeEventListener('visionProgress', handleVisionProgress);
    };
  }, [reprocessingDocumentId, editingAgent?.id, queryClient]);

  const handleRelationshipChange = (agentId: number, relationship: RelationshipType) => {
    setAgentRelationships(prev => ({
      ...prev,
      [agentId]: relationship
    }));
    setPendingRelationshipUpdates(prev => ({
      ...prev,
      [agentId]: true
    }));
  };

  const saveRelationshipChange = (agentId: number) => {
    const relationship = agentRelationships[agentId];
    if (relationship) {
      updateRelationshipMutation.mutate({ agentId, relationship });
    }
  };

  // 언어 설정 변경 핸들러
  const handleLanguageChange = (agentId: number, language: LanguageOption) => {
    setAgentLanguages(prev => ({
      ...prev,
      [agentId]: language
    }));
    setPendingLanguageUpdates(prev => ({
      ...prev,
      [agentId]: true
    }));
  };

  const saveLanguageChange = (agentId: number) => {
    const language = agentLanguages[agentId];
    if (language) {
      updateLanguageMutation.mutate({ agentId, language });
    }
  };

  // Canon Lock 설정 변경 핸들러
  const handleCanonModeChange = (agentId: number, mode: string | null) => {
    setAgentCanonMode(prev => ({
      ...prev,
      [agentId]: mode
    }));
    setPendingCanonUpdates(prev => ({
      ...prev,
      [agentId]: true
    }));
  };

  const handleCanonCustomRuleChange = (agentId: number, rule: string) => {
    setAgentCanonCustomRule(prev => ({
      ...prev,
      [agentId]: rule
    }));
    setPendingCanonUpdates(prev => ({
      ...prev,
      [agentId]: true
    }));
  };

  // AI로 역할에서 본질 자동 추출
  const handleGenerateEssence = async (agentId: number) => {
    const roleInput = agentCanonCustomRule[agentId]?.trim();
    if (!roleInput) return;

    setGeneratingEssence(prev => ({ ...prev, [agentId]: true }));

    try {
      const response = await fetch('/api/generate-role-essence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleInput })
      });

      if (!response.ok) {
        throw new Error('본질 추출에 실패했습니다.');
      }

      const data = await response.json();
      
      // 추출된 본질로 업데이트
      setAgentCanonCustomRule(prev => ({
        ...prev,
        [agentId]: data.essence
      }));

      toast({
        title: "본질 추출 완료",
        description: "역할의 본질이 자동으로 추출되었습니다. 원하시면 수정하세요.",
      });
    } catch (error: any) {
      toast({
        title: "본질 추출 실패",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setGeneratingEssence(prev => ({ ...prev, [agentId]: false }));
    }
  };

  const saveCanonChange = (agentId: number) => {
    const mode = agentCanonMode[agentId] || null;
    const customRule = agentCanonCustomRule[agentId] || "";
    updateCanonMutation.mutate({ agentId, strictMode: mode, customRule });
  };

  // 에이전트 편집 핸들러들
  const handleEditAgent = async (agent: any) => {
    setEditingAgent(agent);
    
    // Strict Mode 설정 조회
    let strictModeValue: string | null = null;
    let canonSourcesValue: string[] = [];
    try {
      const canonResponse = await fetch(`/api/agents/${agent.id}/canon`);
      if (canonResponse.ok) {
        const canonData = await canonResponse.json();
        strictModeValue = canonData.strictMode || null;
        canonSourcesValue = canonData.sources || [];
      }
    } catch (error) {
      console.error('Failed to fetch strict mode settings:', error);
    }
    
    setEditForm({
      name: agent.name || "",
      persona: "",  // 추가 설정이므로 빈 값으로 시작
      model: agent.llmModel || agent.model || "gpt-4",  // llmModel 우선 사용
      speakingStyleIntensity: agent.speakingStyleIntensity || "0.50",
      strictMode: strictModeValue,
      canonSources: canonSourcesValue,
      files: []
    });
    
    // 유머 설정 조회
    try {
      const response = await fetch(`/api/agents/${agent.id}/humor`);
      if (response.ok) {
        const humor = await response.json();
        setHumorSettings({
          enabled: humor.enabled || false,
          styles: humor.styles || []
        });
      } else {
        // 유머 설정이 없으면 기본값 사용
        setHumorSettings({ enabled: false, styles: [] });
      }
    } catch (error) {
      console.error('Failed to fetch humor settings:', error);
      setHumorSettings({ enabled: false, styles: [] });
    }
    
    setShowEditModal(true);
  };

  const handleEditFormSubmit = async () => {
    if (!editingAgent || !editForm.name.trim()) return;

    try {
      // 파일이 있으면 처리 상태 표시
      if (editForm.files.length > 0) {
        setIsProcessingDocuments(true);
      }
      
      const formData = new FormData();
      
      // 이름은 항상 전송 (필수 필드)
      formData.append('name', editForm.name);
      
      // 페르소나는 비어있지 않을 때만 전송
      if (editForm.persona.trim()) {
        formData.append('persona', editForm.persona);
      }
      
      // 모델은 기존 값과 다를 때만 전송
      const currentModel = editingAgent.llmModel || editingAgent.model || "gpt-4";
      if (editForm.model !== currentModel) {
        formData.append('model', editForm.model);
      }
      
      // 말투 강도는 기존 값과 다를 때만 전송
      const currentIntensity = editingAgent.speakingStyleIntensity || "0.50";
      if (editForm.speakingStyleIntensity !== currentIntensity) {
        formData.append('speakingStyleIntensity', editForm.speakingStyleIntensity);
      }
      
      
      // 파일들 추가
      editForm.files.forEach((file) => {
        formData.append('files', file);
      });

      const response = await fetch(`/api/agents/${editingAgent.id}`, {
        method: 'PATCH',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to update agent');

      const result = await response.json();
      
      // 문서 업로드 결과가 있으면 상세 정보 표시
      if (result.documentResults && result.documentResults.length > 0) {
        const successCount = result.documentResults.filter((r: any) => r.success).length;
        const failCount = result.documentResults.length - successCount;
        
        // 각 파일별 처리 결과 메시지 생성
        const details = result.documentResults.map((doc: any) => {
          if (doc.success) {
            return `✅ ${doc.filename}\n   📄 추출: ${doc.textLength}자 | 🔍 RAG: ${doc.ragChunks}개 청크`;
          } else {
            return `❌ ${doc.filename}\n   오류: ${doc.error || doc.ragError || '알 수 없는 오류'}`;
          }
        }).join('\n\n');
        
        toast({
          title: `✨ 에이전트 업데이트 완료 (문서 ${successCount}/${result.documentResults.length}개 성공)`,
          description: (
            <div className="text-sm whitespace-pre-wrap font-mono mt-2">
              {details}
            </div>
          ),
          duration: 8000,
        });
      } else {
        toast({
          title: t('chat:agentManagement.editModal.updateSuccess'),
          description: t('chat:agentManagement.editModal.updateSuccessDesc'),
        });
      }

      // Strict Mode 설정 업데이트
      try {
        const canonResponse = await fetch(`/api/agents/${editingAgent.id}/canon`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            agentId: editingAgent.id,
            strictMode: editForm.strictMode === "none" ? null : editForm.strictMode,  // "선택안함" → null 변환
            sources: editForm.canonSources // 기존 sources 보존
          })
        });
        if (!canonResponse.ok) {
          const errorData = await canonResponse.json();
          console.error('Failed to update canon settings:', errorData);
          toast({
            title: "Canon Lock 저장 실패",
            description: "Canon Lock 설정 저장 중 오류가 발생했습니다.",
            variant: "destructive",
          });
          throw new Error('Canon update failed');
        }
      } catch (error) {
        console.error('Failed to update strict mode settings:', error);
        throw error;  // 에러를 상위로 전파하여 모달이 닫히지 않도록 함
      }

      // 유머 설정 업데이트
      try {
        const humorResponse = await fetch(`/api/agents/${editingAgent.id}/humor`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(humorSettings)
        });
        if (!humorResponse.ok) {
          const errorData = await humorResponse.json();
          console.error('Failed to update humor settings:', errorData);
          toast({
            title: "유머 설정 저장 실패",
            description: "유머 설정 저장 중 오류가 발생했습니다.",
            variant: "destructive",
          });
          throw new Error('Humor update failed');
        }
      } catch (error) {
        console.error('Failed to update humor settings:', error);
        throw error;  // 에러를 상위로 전파하여 모달이 닫히지 않도록 함
      }

      setShowEditModal(false);
      
      // 문서 목록 캐시 갱신 (문서가 업로드된 경우)
      if (result.documentResults && result.documentResults.length > 0) {
        queryClient.invalidateQueries({ queryKey: [`/api/agents/${editingAgent.id}/documents`] });
      }
      
      setEditingAgent(null);
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
    } catch (error) {
      toast({
        title: t('chat:agentManagement.editModal.updateFailed'),
        description: t('chat:agentManagement.editModal.updateFailedDesc'),
        variant: "destructive",
      });
    } finally {
      setIsProcessingDocuments(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files || []);
      setEditForm(prev => ({
        ...prev,
        files: newFiles
      }));
      
      // 파일별 처리 상태 초기화
      setFileProcessingStatuses(newFiles.map(file => ({
        file,
        status: 'pending'
      })));
    }
  };
  
  // 개별 파일 처리 함수
  const handleProcessSingleFile = async (fileIndex: number) => {
    if (!editingAgent) return;
    
    const fileStatus = fileProcessingStatuses[fileIndex];
    if (!fileStatus || fileStatus.status === 'processing') return;
    
    // 처리 시작
    setFileProcessingStatuses(prev => prev.map((fs, idx) => 
      idx === fileIndex ? { ...fs, status: 'processing', stage: '📄 로컬 텍스트 추출' } : fs
    ));
    
    try {
      const formData = new FormData();
      formData.append('files', fileStatus.file);
      
      const response = await fetch(`/api/agents/${editingAgent.id}`, {
        method: 'PATCH',
        body: formData,
      });
      
      if (!response.ok) throw new Error('Failed to process file');
      
      const result = await response.json();
      
      // 처리 결과 업데이트
      if (result.documentResults && result.documentResults.length > 0) {
        const docResult = result.documentResults[0];
        
        setFileProcessingStatuses(prev => prev.map((fs, idx) => 
          idx === fileIndex ? {
            ...fs,
            status: docResult.success ? 'success' : 'error',
            stage: docResult.success ? '✅ 완료' : '❌ 실패',
            result: {
              textLength: docResult.textLength,
              ragChunks: docResult.ragChunks,
              error: docResult.error || docResult.ragError
            }
          } : fs
        ));
        
        toast({
          title: docResult.success ? '✅ 문서 처리 완료' : '❌ 문서 처리 실패',
          description: docResult.success 
            ? `📄 추출: ${docResult.textLength}자 | 🔍 RAG: ${docResult.ragChunks}개 청크`
            : `오류: ${docResult.error || docResult.ragError || '알 수 없는 오류'}`,
          variant: docResult.success ? 'default' : 'destructive',
          duration: 5000,
        });
      }
      
      // 문서 목록 캐시 갱신
      queryClient.invalidateQueries({ queryKey: [`/api/agents/${editingAgent.id}/documents`] });
      // 에이전트 목록 새로고침
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
      
    } catch (error) {
      setFileProcessingStatuses(prev => prev.map((fs, idx) => 
        idx === fileIndex ? {
          ...fs,
          status: 'error',
          stage: '❌ 실패',
          result: { error: error instanceof Error ? error.message : '처리 실패' }
        } : fs
      ));
      
      toast({
        title: '❌ 문서 처리 실패',
        description: error instanceof Error ? error.message : '처리 중 오류가 발생했습니다',
        variant: 'destructive',
      });
    }
  };

  const handleGoBack = () => {
    setLocation(`/group-chat/${groupChatId}`);
  };
  
  // 캐릭터 추천 요청
  const handleGetRecommendations = async () => {
    if (!recommendationTopic.trim()) {
      toast({
        title: t('chat:agentManagement.recommendedTab.enterTopic'),
        description: t('chat:agentManagement.recommendedTab.enterTopicDesc'),
        variant: "destructive",
      });
      return;
    }
    
    setIsLoadingRecommendations(true);
    try {
      const response = await fetch(`/api/suggest-characters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: recommendationTopic }),
      });
      
      if (response.ok) {
        const data = await response.json();
        setRecommendedCharacters(data.characters || []);
        
        // 저장된 추천 캐릭터 목록을 새로고침
        queryClient.invalidateQueries({ queryKey: ['/api/recommended-characters'] });
        
        toast({
          title: t('chat:agentManagement.recommendedTab.recommendSuccess'),
          description: t('chat:agentManagement.recommendedTab.recommendSuccessDesc', { count: data.characters?.length || 0 }),
        });
        
        console.log('[캐릭터 추천] 성공:', data.characters?.length, '개 캐릭터');
      }
    } catch (error) {
      toast({
        title: t('chat:agentManagement.recommendedTab.recommendFailed'),
        description: t('chat:agentManagement.recommendedTab.recommendFailedDesc'),
        variant: "destructive",
      });
    } finally {
      setIsLoadingRecommendations(false);
    }
  };
  
  // 에이전트 검색 탭에서 에이전트 선택
  const handleAgentSelectForSearch = (agent: Agent) => {
    setSelectedAgentsForSearch(prev => [...prev, agent]);
  };
  
  // 에이전트 검색 탭에서 에이전트 제거
  const handleAgentRemoveFromSearch = (agentId: number) => {
    setSelectedAgentsForSearch(prev => prev.filter(agent => agent.id !== agentId));
  };
  
  // 선택된 에이전트들을 그룹 채팅에 추가
  const handleAddSelectedAgents = async () => {
    if (selectedAgentsForSearch.length === 0) {
      toast({
        title: t('chat:agentManagement.selectAgentPrompt'),
        description: t('chat:agentManagement.selectAgentPromptDesc'),
        variant: "destructive",
      });
      return;
    }
    
    try {
      for (const agent of selectedAgentsForSearch) {
        await addAgentMutation.mutateAsync(agent.id);
      }
      setSelectedAgentsForSearch([]);
      toast({
        title: t('chat:agentManagement.addSuccessMultiple'),
        description: t('chat:agentManagement.addSuccessMultipleDesc', { count: selectedAgentsForSearch.length }),
      });
    } catch (error) {
      toast({
        title: t('chat:agentManagement.addFailed'),
        description: t('chat:agentManagement.addFailedDesc'),
        variant: "destructive",
      });
    }
  };

  // 사용자가 만든 에이전트인지 확인하는 함수
  const isUserCreatedAgent = (agent: any) => {
    return user && agent.creatorId === user.id;
  };

  // Operations mode가 아닐 때만 groupChat 로딩 체크
  if (!isOperationsMode && !groupChat) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden">
      {/* 헤더 */}
      <div className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoBack}
                className="p-2"
                data-testid="button-back"
              >
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {t('chat:agentManagement.title')}
              </h1>
            </div>
          </div>
        </div>
      </div>

      {/* 메인 콘텐츠 */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 overflow-y-auto">
        {isOperationsMode ? (
          /* Operations mode: 통합 UI */
          <div className="space-y-6">
            {/* 통합 검색창 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                <Input
                  placeholder="에이전트 이름, 설명으로 검색..."
                  value={unifiedSearch}
                  onChange={(e) => setUnifiedSearch(e.target.value)}
                  className="pl-10 text-base"
                  data-testid="input-unified-search"
                />
              </div>
            </div>
            
            {/* 통합 에이전트 목록 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">
                {allAgentsUnified.length}개의 에이전트
              </h3>
              
              {allAgentsUnified.length === 0 ? (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  {unifiedSearch ? '검색 결과가 없습니다.' : '생성한 에이전트가 없습니다.'}
                </div>
              ) : (
                <div className="space-y-4">
                  {allAgentsUnified.map((agent: any) => {
                    const mostRecentChat = agent.groupChats.length > 0 ? agent.groupChats[0] : null;
                    const chatCount = agent.groupChats.length;
                    
                    return (
                      <div key={agent.id} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1">
                            <div 
                              className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                              style={{ backgroundColor: agent.backgroundColor || '#3b82f6' }}
                            >
                              {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) ? (
                                <img 
                                  src={agent.icon} 
                                  alt={`${agent.name} icon`}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-lg">
                                  {agent.icon || "🤖"}
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="font-medium text-gray-900 dark:text-gray-100">{agent.name}</div>
                                {agent.agentType === 'recommended' && (
                                  <Badge variant="secondary" className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300">
                                    추천됨
                                  </Badge>
                                )}
                                {chatCount > 0 && (
                                  <Badge variant="secondary" className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300">
                                    참여 중 ({chatCount}개)
                                  </Badge>
                                )}
                              </div>
                              {agent.description && (
                                <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{agent.description}</div>
                              )}
                              {mostRecentChat && (
                                <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                  최근: {mostRecentChat.title || "제목 없는 대화방"}
                                  {chatCount > 1 && (
                                    <span className="ml-1">외 {chatCount - 1}개</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditAgent(agent)}
                            data-testid={`button-edit-agent-${agent.id}`}
                            className="flex-shrink-0"
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Group chat mode: 기존 Tabs UI */
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="participating" data-testid="tab-participating-agents">
                {t('chat:agentManagement.participating')}
              </TabsTrigger>
              <TabsTrigger value="recommended" data-testid="tab-recommended-agents">
                {t('chat:agentManagement.recommended')}
              </TabsTrigger>
              <TabsTrigger value="search" data-testid="tab-search-agents">
                {t('chat:agentManagement.search')}
              </TabsTrigger>
            </TabsList>
            
            {/* 참여 중인 에이전트 탭 */}
            <TabsContent value="participating" className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
              {/* 현재 참여 중인 에이전트들 */}
              <div>
                <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">{t('chat:agentManagement.participating')}</h3>
                <div className="space-y-4">
                  {isOperationsMode ? (
                    // Operations mode: 본인이 만든 에이전트 전체 표시 (간단한 목록)
                    managedAgents.map((agent: Agent) => {
                      const groupChats = agentGroupChats[agent.id] || [];
                      const mostRecentChat = groupChats.length > 0 ? groupChats[0] : null;
                      const chatCount = groupChats.length;
                      
                      return (
                        <div key={agent.id} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1">
                              <div 
                                className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0"
                                style={{ backgroundColor: agent.backgroundColor || '#3b82f6' }}
                              >
                                {(agent.isCustomIcon && agent.icon?.startsWith('/uploads/')) ? (
                                  <img 
                                    src={agent.icon} 
                                    alt={`${agent.name} icon`}
                                    className="w-full h-full object-cover"
                                  />
                                ) : (
                                  <span className="text-lg">
                                    {agent.icon || "🤖"}
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-gray-100">{agent.name}</div>
                                {agent.description && (
                                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{agent.description}</div>
                                )}
                                {mostRecentChat && (
                                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                    {mostRecentChat.title || "제목 없는 대화방"}
                                    {chatCount > 1 && (
                                      <span className="ml-1">외 {chatCount - 1}개</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditAgent(agent)}
                              data-testid={`button-edit-agent-${agent.id}`}
                              className="flex-shrink-0"
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    // Group chat mode: 그룹 채팅의 에이전트 표시
                    groupChat?.agents?.map((groupAgent: any) => (
                    <div key={groupAgent.agentId} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-10 h-10 rounded-full flex items-center justify-center overflow-hidden"
                            style={{ backgroundColor: groupAgent.agent?.backgroundColor || '#3b82f6' }}
                          >
                            {(groupAgent.agent?.isCustomIcon && groupAgent.agent?.icon?.startsWith('/uploads/')) ? (
                              <img 
                                src={groupAgent.agent.icon} 
                                alt={`${groupAgent.agent.name} icon`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-lg">
                                {groupAgent.agent?.icon || "🤖"}
                              </span>
                            )}
                          </div>
                          <span className="font-medium text-gray-900 dark:text-gray-100">{groupAgent.agent?.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {/* 사용자가 만든 에이전트인 경우에만 편집 버튼 표시 */}
                          {isUserCreatedAgent(groupAgent.agent) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditAgent(groupAgent.agent)}
                              data-testid={`button-edit-agent-${groupAgent.agentId}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeAgentMutation.mutate(groupAgent.agentId)}
                            disabled={removeAgentMutation.isPending}
                            data-testid={`button-remove-agent-${groupAgent.agentId}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                      
                      {/* 관계 설정 */}
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-sm text-gray-600 dark:text-gray-400 min-w-fit">{t('chat:agentManagement.relationship')}</span>
                        <Select 
                          value={agentRelationships[groupAgent.agentId] || RELATIONSHIP_TYPES[0]}
                          onValueChange={(value) => handleRelationshipChange(groupAgent.agentId, value as RelationshipType)}
                        >
                          <SelectTrigger className="flex-1 max-w-xs">
                            <SelectValue>
                              {t(`chat:relationshipTypes.${agentRelationships[groupAgent.agentId] || RELATIONSHIP_TYPES[0]}`)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {RELATIONSHIP_TYPES.map((type) => (
                              <SelectItem key={type} value={type}>
                                {t(`chat:relationshipTypes.${type}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {pendingRelationshipUpdates[groupAgent.agentId] && (
                          <Button
                            size="sm"
                            onClick={() => saveRelationshipChange(groupAgent.agentId)}
                            disabled={updateRelationshipMutation.isPending}
                            data-testid={`button-save-relationship-${groupAgent.agentId}`}
                          >
                            {t('common:button.save')}
                          </Button>
                        )}
                      </div>

                      {/* 언어 설정 */}
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-sm text-gray-600 dark:text-gray-400 min-w-fit">{t('chat:agentManagement.language')}</span>
                        <Select 
                          value={agentLanguages[groupAgent.agentId] || "question_language"}
                          onValueChange={(value) => handleLanguageChange(groupAgent.agentId, value as LanguageOption)}
                        >
                          <SelectTrigger className="flex-1 max-w-xs">
                            <SelectValue>
                              {t(`chat:agentManagement.languageOptions.${agentLanguages[groupAgent.agentId] || "question_language"}`)}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {LANGUAGE_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {t(`chat:agentManagement.languageOptions.${option}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {pendingLanguageUpdates[groupAgent.agentId] && (
                          <Button
                            size="sm"
                            onClick={() => saveLanguageChange(groupAgent.agentId)}
                            disabled={updateLanguageMutation.isPending}
                            data-testid={`button-save-language-${groupAgent.agentId}`}
                          >
                            {t('common:button.save')}
                          </Button>
                        )}
                      </div>

                      {/* Canon Lock 설정 */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-600 dark:text-gray-400 min-w-fit">Canon Lock</span>
                          <Select 
                            value={agentCanonMode[groupAgent.agentId] || "none"}
                            onValueChange={(value) => handleCanonModeChange(groupAgent.agentId, value === "none" ? null : value)}
                          >
                            <SelectTrigger className="flex-1 max-w-xs">
                              <SelectValue placeholder="선택안함">
                                {agentCanonMode[groupAgent.agentId] === 'biblical' ? '성경적' :
                                 agentCanonMode[groupAgent.agentId] === 'teacher' ? '선생님' :
                                 agentCanonMode[groupAgent.agentId] === 'customer_service' ? '서비스 상담사' :
                                 agentCanonMode[groupAgent.agentId] === 'custom' ? '직접 작성' : '선택안함'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">선택안함</SelectItem>
                              <SelectItem value="biblical">성경적 (목사님용)</SelectItem>
                              <SelectItem value="teacher">선생님</SelectItem>
                              <SelectItem value="customer_service">서비스 상담사</SelectItem>
                              <SelectItem value="custom">📝 직접 작성</SelectItem>
                            </SelectContent>
                          </Select>
                          {pendingCanonUpdates[groupAgent.agentId] && (
                            <Button
                              size="sm"
                              onClick={() => saveCanonChange(groupAgent.agentId)}
                              disabled={updateCanonMutation.isPending}
                              data-testid={`button-save-canon-${groupAgent.agentId}`}
                            >
                              {t('common:button.save')}
                            </Button>
                          )}
                        </div>
                        
                        {/* Custom Rule 입력 필드 (custom 선택 시에만 표시) */}
                        {agentCanonMode[groupAgent.agentId] === 'custom' && (
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-sm text-gray-700 dark:text-gray-300">역할의 본질</Label>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleGenerateEssence(groupAgent.agentId)}
                                disabled={!agentCanonCustomRule[groupAgent.agentId]?.trim() || generatingEssence[groupAgent.agentId]}
                                className="text-xs"
                                data-testid={`button-generate-essence-${groupAgent.agentId}`}
                              >
                                {generatingEssence[groupAgent.agentId] ? '추출 중...' : 'AI로 본질 추출'}
                              </Button>
                            </div>
                            <Textarea
                              className="w-full resize-none"
                              rows={Math.min(10, Math.max(3.5, Math.ceil((agentCanonCustomRule[groupAgent.agentId]?.length || 0) / 50)))}
                              placeholder="역할을 입력하거나 본질을 직접 작성하세요.&#10;예시 역할: 수학 학원 선생님&#10;예시 본질: 학생의 수준에 맞춰 단계적으로 설명하고, 이해를 확인하며, 격려를 아끼지 않는다."
                              value={agentCanonCustomRule[groupAgent.agentId] || ""}
                              onChange={(e) => handleCanonCustomRuleChange(groupAgent.agentId, e.target.value)}
                              data-testid={`textarea-custom-rule-${groupAgent.agentId}`}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                  )}
                  
                  {/* 에이전트 없음 메시지 */}
                  {isOperationsMode && !managedAgents?.length && !savedCharactersData?.characters?.length && (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      아직 생성한 에이전트가 없습니다
                    </div>
                  )}
                  {!isOperationsMode && !groupChat?.agents?.length && (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                      {t('chat:agentManagement.noAgents')}
                    </div>
                  )}
                </div>
              </div>

              {/* Operations mode: 추천 캐릭터로 생성한 에이전트 표시 (간단한 목록) */}
              {isOperationsMode && savedCharactersData?.characters && savedCharactersData.characters.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">추천 캐릭터로 생성한 에이전트</h3>
                  <div className="space-y-4">
                    {savedCharactersData.characters.map((character: any) => {
                      const charData = character.characterData;
                      // 추천 캐릭터는 agentId를 가지고 있음
                      const agent = managedAgents.find(a => a.id === character.agentId);
                      const groupChats = agent ? agentGroupChats[agent.id] || [] : [];
                      const mostRecentChat = groupChats.length > 0 ? groupChats[0] : null;
                      const chatCount = groupChats.length;
                      
                      return (
                        <div key={character.id} className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 flex-1">
                              <div 
                                className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                                style={{ backgroundColor: charData.backgroundColor || '#3b82f6' }}
                              >
                                <span className="text-lg">{charData.icon || "⭐"}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-gray-900 dark:text-gray-100">{charData.name}</div>
                                {charData.description && (
                                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{charData.description}</div>
                                )}
                                {mostRecentChat && (
                                  <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                    {mostRecentChat.title || "제목 없는 대화방"}
                                    {chatCount > 1 && (
                                      <span className="ml-1">외 {chatCount - 1}개</span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                            {agent && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleEditAgent(agent)}
                                data-testid={`button-edit-agent-${agent.id}`}
                                className="flex-shrink-0"
                              >
                                <Edit className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 에이전트 추가 */}
              <div>
                <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">{t('chat:agentManagement.add')}</h3>
                <div className="flex gap-3">
                  <Select value={selectedAgentToAdd} onValueChange={setSelectedAgentToAdd}>
                    <SelectTrigger className="flex-1 max-w-xs">
                      <SelectValue placeholder={t('chat:agentManagement.addAgent')} />
                    </SelectTrigger>
                    <SelectContent>
                      {(Array.isArray(availableAgents) ? availableAgents : [])
                        .filter((agent: any) => !groupChat?.agents?.some((ga: any) => ga.agentId === agent.id))
                        .map((agent: any) => (
                          <SelectItem key={agent.id} value={agent.id.toString()}>
                            {agent.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    onClick={() => selectedAgentToAdd && addAgentMutation.mutate(parseInt(selectedAgentToAdd))}
                    disabled={!selectedAgentToAdd || addAgentMutation.isPending}
                    data-testid="button-add-agent"
                  >
                    {addAgentMutation.isPending ? t('chat:agentManagement.adding') : t('common:button.add')}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
          
          {/* 추천된 에이전트 탭 */}
          <TabsContent value="recommended" className="space-y-6">
            {/* 저장된 추천 캐릭터 목록 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
              <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" />
                {t('chat:agentManagement.recommendedTab.savedCharacters')}
              </h3>
              
              {isLoadingSavedCharacters ? (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400">{t('chat:agentManagement.recommendedTab.loading')}</p>
                </div>
              ) : savedCharactersData?.characters && savedCharactersData.characters.length > 0 ? (
                <div>
                  {/* 검색 필드 */}
                  <div className="mb-4">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <Input
                        type="text"
                        placeholder="캐릭터 이름, 설명, 주제로 검색..."
                        value={recommendedCharacterSearch}
                        onChange={(e) => setRecommendedCharacterSearch(e.target.value)}
                        className="pl-10"
                        data-testid="input-search-recommended-characters"
                      />
                    </div>
                  </div>
                  
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    {(() => {
                      const filtered = savedCharactersData.characters.filter((savedChar: any) => {
                        if (!recommendedCharacterSearch) return true;
                        const searchLower = recommendedCharacterSearch.toLowerCase();
                        const character = savedChar.characterData;
                        return (
                          character.name?.toLowerCase().includes(searchLower) ||
                          character.description?.toLowerCase().includes(searchLower) ||
                          savedChar.topic?.toLowerCase().includes(searchLower) ||
                          character.expertise?.toLowerCase().includes(searchLower)
                        );
                      });
                      return recommendedCharacterSearch
                        ? `검색 결과: ${filtered.length}개 / 전체: ${savedCharactersData.characters.length}개`
                        : t('chat:agentManagement.recommendedTab.totalCount', { count: savedCharactersData.characters.length });
                    })()}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {savedCharactersData.characters
                      .filter((savedChar: any) => {
                        if (!recommendedCharacterSearch) return true;
                        const searchLower = recommendedCharacterSearch.toLowerCase();
                        const character = savedChar.characterData;
                        return (
                          character.name?.toLowerCase().includes(searchLower) ||
                          character.description?.toLowerCase().includes(searchLower) ||
                          savedChar.topic?.toLowerCase().includes(searchLower) ||
                          character.expertise?.toLowerCase().includes(searchLower)
                        );
                      })
                      .map((savedChar: any, index: number) => {
                      const character = savedChar.characterData;
                      const isExpanded = expandedCharacterIds.has(savedChar.id);
                      
                      return (
                        <Card 
                          key={savedChar.id} 
                          className="cursor-pointer hover:shadow-md transition-shadow relative"
                          onClick={() => {
                            setExpandedCharacterIds(prev => {
                              const newSet = new Set(prev);
                              if (isExpanded) {
                                newSet.delete(savedChar.id);
                              } else {
                                newSet.add(savedChar.id);
                              }
                              return newSet;
                            });
                          }}
                        >
                          <CardContent className="p-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 mb-2">
                                <div 
                                  className="w-10 h-10 rounded-full flex items-center justify-center text-2xl flex-shrink-0"
                                  style={{ backgroundColor: character.color || '#3b82f6' }}
                                >
                                  {character.icon || "🤖"}
                                </div>
                                <h5 className="font-medium text-gray-900 dark:text-gray-100 flex-1">
                                  {character.name}
                                </h5>
                                {/* 삭제 버튼 */}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCharacterToDelete({ id: savedChar.id, name: character.name });
                                    setDeleteDialogOpen(true);
                                  }}
                                  className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                                  title="캐릭터 삭제"
                                >
                                  <X className="w-4 h-4 text-gray-500 hover:text-red-500" />
                                </button>
                              </div>
                              <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                                {character.description}
                              </p>
                              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                {t('chat:agentManagement.recommendedTab.topic')} {savedChar.topic} • {new Date(savedChar.createdAt).toLocaleDateString()}
                              </div>
                              {character.expertise && (
                                <div className="text-xs text-gray-600 dark:text-gray-400">
                                  {t('chat:agentManagement.recommendedTab.expertise')} {character.expertise}
                                </div>
                              )}
                              
                              {/* 확장된 상태일 때 설정 표시 */}
                              {isExpanded && (
                                <div className="pt-3 border-t mt-3" onClick={(e) => e.stopPropagation()}>
                                  <div className="grid grid-cols-2 gap-3">
                                    <div>
                                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                                        나와의 관계 설정
                                      </label>
                                      <Select 
                                        value={characterRelationships[savedChar.id] || "assistant"} 
                                        onValueChange={(value: RelationshipType) => {
                                          setCharacterRelationships(prev => ({
                                            ...prev,
                                            [savedChar.id]: value
                                          }));
                                        }}
                                      >
                                        <SelectTrigger className="w-full bg-white dark:bg-gray-800">
                                          <SelectValue>
                                            {t(`chat:relationshipTypes.${characterRelationships[savedChar.id] || "assistant"}`)}
                                          </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                          {RELATIONSHIP_TYPES.map((relationship) => (
                                            <SelectItem key={relationship} value={relationship}>
                                              {t(`chat:relationshipTypes.${relationship}`)}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>

                                    <div>
                                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 block">
                                        사용 언어 설정
                                      </label>
                                      <Select 
                                        value={characterLanguages[savedChar.id] || "question_language"} 
                                        onValueChange={(value: LanguageOption) => {
                                          setCharacterLanguages(prev => ({
                                            ...prev,
                                            [savedChar.id]: value
                                          }));
                                        }}
                                      >
                                        <SelectTrigger className="w-full bg-white dark:bg-gray-800">
                                          <SelectValue placeholder="언어 선택" />
                                        </SelectTrigger>
                                        <SelectContent>
                                          {LANGUAGE_OPTIONS.map((option) => (
                                            <SelectItem key={option} value={option}>
                                              {LANGUAGE_LABELS[option]}
                                            </SelectItem>
                                          ))}
                                        </SelectContent>
                                      </Select>
                                    </div>
                                  </div>

                                  {/* 토론 강도 슬라이더 */}
                                  <div className="pt-3">
                                    <div className="flex items-center justify-between mb-2">
                                      <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                        토론 강도
                                      </label>
                                      <span className="text-xs text-gray-500 dark:text-gray-400">
                                        {((characterDebateIntensities[savedChar.id] ?? 0.5) * 100).toFixed(0)}%
                                      </span>
                                    </div>
                                    <Slider
                                      value={[(characterDebateIntensities[savedChar.id] ?? 0.5) * 100]}
                                      onValueChange={(values) => {
                                        setCharacterDebateIntensities(prev => ({
                                          ...prev,
                                          [savedChar.id]: values[0] / 100
                                        }));
                                      }}
                                      min={0}
                                      max={100}
                                      step={10}
                                      className="w-full"
                                    />
                                    <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mt-1">
                                      <span>부드러움</span>
                                      <span>강함</span>
                                    </div>
                                  </div>
                                  
                                  {/* 채팅방에 추가 버튼 */}
                                  {!isOperationsMode && groupChatId && (
                                    <Button 
                                      className="w-full mt-3"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        // 채팅방에 캐릭터를 에이전트로 변환하여 추가
                                        addCharacterMutation.mutate({
                                          characterId: savedChar.id,
                                          character: character,
                                          relationship: characterRelationships[savedChar.id] || "assistant",
                                          languagePreference: characterLanguages[savedChar.id] || "question_language",
                                          debateIntensity: characterDebateIntensities[savedChar.id] ?? 0.5
                                        });
                                      }}
                                      disabled={addCharacterMutation.isPending}
                                    >
                                      {addCharacterMutation.isPending ? "추가 중..." : "채팅방에 추가"}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-gray-500 dark:text-gray-400">
                    {t('chat:agentManagement.recommendedTab.noSaved')}
                  </p>
                </div>
              )}
            </div>
            
            {/* 추가 가능한 에이전트 (공개 에이전트 중 현재 채팅방에 없는 것) */}
            {!isOperationsMode && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Plus className="w-5 h-5 text-green-500" />
                  추가 가능한 에이전트
                </h3>
                
                {/* 검색 필드 */}
                <div className="mb-4">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <Input
                      type="text"
                      placeholder="에이전트 이름 또는 설명으로 검색..."
                      value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                      className="pl-10"
                      data-testid="input-search-available-agents"
                    />
                  </div>
                </div>
                
                {(() => {
                  // 본인이 생성한 에이전트 + 공개 에이전트를 모두 포함
                  const allAgents = [
                    ...(Array.isArray(managedAgents) ? managedAgents : []),
                    ...(Array.isArray(availableAgents) ? availableAgents : [])
                  ];
                  
                  // 중복 제거 (ID 기준)
                  const uniqueAgents = allAgents.filter((agent, index, self) => 
                    index === self.findIndex((a) => a.id === agent.id)
                  );
                  
                  const availableToAdd = uniqueAgents
                    .filter((agent: any) => !groupChat?.agents?.some((ga: any) => ga.agentId === agent.id))
                    .filter((agent: any) => {
                      if (!agentSearch) return true;
                      const searchLower = agentSearch.toLowerCase();
                      return (
                        agent.name?.toLowerCase().includes(searchLower) ||
                        agent.description?.toLowerCase().includes(searchLower)
                      );
                    });
                  
                  const totalAvailableCount = uniqueAgents.filter((agent: any) => 
                    !groupChat?.agents?.some((ga: any) => ga.agentId === agent.id)
                  ).length;
                  
                  return (
                    <>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        {agentSearch
                          ? `검색 결과: ${availableToAdd.length}개 / 전체: ${totalAvailableCount}개`
                          : `현재 채팅방에 추가할 수 있는 에이전트: ${availableToAdd.length}개`}
                      </p>
                      
                      {availableToAdd.length > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 max-h-96 overflow-y-auto">
                          {availableToAdd.map((agent: any) => (
                            <Card 
                              key={agent.id} 
                              className="hover:shadow-md transition-shadow"
                            >
                              <CardContent className="p-4">
                                <div className="flex items-start gap-3">
                                  <div
                                    className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0"
                                    style={{ backgroundColor: agent.backgroundColor || '#3b82f6' }}
                                  >
                                    {agent.icon === 'fas fa-user' ? '👤' : '🤖'}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h5 className="font-medium text-gray-900 dark:text-gray-100 truncate">
                                      {agent.name}
                                    </h5>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2 mt-1">
                                      {agent.description}
                                    </p>
                                    <Button
                                      size="sm"
                                      className="mt-3 w-full"
                                      onClick={() => addAgentMutation.mutate(agent.id)}
                                      disabled={addAgentMutation.isPending}
                                      data-testid={`button-add-agent-${agent.id}`}
                                    >
                                      {addAgentMutation.isPending ? '추가 중...' : '채팅방에 추가'}
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                          {agentSearch ? '검색 결과가 없습니다.' : '추가 가능한 에이전트가 없습니다.'}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
            
            {/* 캐릭터 추천 시스템 */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
              <div>
                <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-yellow-500" />
                  {t('chat:agentManagement.recommendedTab.system')}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                  {t('chat:agentManagement.recommendedTab.systemNote')}
                </p>
                <div className="flex gap-3">
                  <Input
                    placeholder={t('chat:agentManagement.recommendedTab.topicPlaceholder')}
                    value={recommendationTopic}
                    onChange={(e) => setRecommendationTopic(e.target.value)}
                    className="flex-1"
                    data-testid="input-recommendation-topic"
                  />
                  <Button
                    onClick={handleGetRecommendations}
                    disabled={isLoadingRecommendations || !recommendationTopic.trim()}
                    data-testid="button-get-recommendations"
                  >
                    {isLoadingRecommendations ? t('chat:agentManagement.recommendedTab.gettingRecommendations') : t('chat:agentManagement.recommendedTab.getRecommendations')}
                  </Button>
                </div>
              </div>
              
              {/* 추천된 캐릭터 목록 */}
              {recommendedCharacters.length > 0 && (
                <div>
                  <h4 className="text-md font-medium mb-3 text-gray-900 dark:text-gray-100">
                    {t('chat:agentManagement.recommendedTab.recommendedCount', { count: recommendedCharacters.length })}
                  </h4>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {recommendedCharacters.map((character, index) => (
                      <Card key={index} className="cursor-pointer hover:shadow-md transition-shadow">
                        <CardContent className="p-4">
                          <div className="space-y-2">
                            <h5 className="font-medium text-gray-900 dark:text-gray-100">
                              {character.name || `${t('chat:agentManagement.recommendedTab.character')} ${index + 1}`}
                            </h5>
                            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3">
                              {character.description || character.persona || t('chat:agentManagement.recommendedTab.noDescription')}
                            </p>
                            {character.expertise && (
                              <div className="flex flex-wrap gap-1">
                                {character.expertise.split(',').slice(0, 3).map((skill: string, skillIndex: number) => (
                                  <Badge key={skillIndex} variant="secondary" className="text-xs">
                                    {skill.trim()}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
              
              {recommendedCharacters.length === 0 && !isLoadingRecommendations && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  {t('chat:agentManagement.recommendedTab.startPrompt')}
                </div>
              )}
            </div>
          </TabsContent>
          
          {/* 에이전트 검색 탭 */}
          <TabsContent value="search" className="space-y-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-6">
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {t('chat:agentManagement.searchTab.title')}
                  </h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <Input
                      placeholder={t('chat:agentManagement.searchTab.placeholder')}
                      value={agentSearch}
                      onChange={(e) => setAgentSearch(e.target.value)}
                      className="pl-10 w-64"
                      data-testid="input-agent-search"
                    />
                  </div>
                </div>
                
                {/* 사용 가능한 에이전트 목록 */}
                <div className="space-y-3 max-h-80 overflow-y-auto">
                  {filteredAgents.map((agent) => (
                    <div
                      key={agent.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer transition-colors"
                      onClick={() => handleAgentSelectForSearch(agent)}
                      data-testid={`agent-search-item-${agent.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                          style={{ backgroundColor: agent.backgroundColor }}
                        >
                          {agent.icon === 'fas fa-user' ? '👤' : '🤖'}
                        </div>
                        <div>
                          <div className="font-medium text-gray-900 dark:text-gray-100">{agent.name}</div>
                          <div className="text-sm text-gray-500 dark:text-gray-400 truncate max-w-96">
                            {agent.description}
                          </div>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
                
                {filteredAgents.length === 0 && (
                  <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                    {agentSearch ? t('chat:agentManagement.searchTab.noResults') : t('chat:agentManagement.searchTab.searchPrompt')}
                  </div>
                )}
              </div>
              
              {/* 선택된 에이전트 목록 */}
              {selectedAgentsForSearch.length > 0 && (
                <div>
                  <h4 className="text-md font-medium mb-3 text-gray-900 dark:text-gray-100">
                    {t('chat:agentManagement.searchTab.selectedCount', { count: selectedAgentsForSearch.length })}
                  </h4>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedAgentsForSearch.map((agent) => (
                      <Badge
                        key={agent.id}
                        variant="secondary"
                        className="flex items-center gap-2 p-2"
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs"
                          style={{ backgroundColor: agent.backgroundColor }}
                        >
                          {agent.icon === 'fas fa-user' ? '👤' : '🤖'}
                        </div>
                        <span>{agent.name}</span>
                        <X 
                          className="w-4 h-4 cursor-pointer hover:text-red-500" 
                          onClick={() => handleAgentRemoveFromSearch(agent.id)}
                        />
                      </Badge>
                    ))}
                  </div>
                  <Button
                    onClick={handleAddSelectedAgents}
                    disabled={addAgentMutation.isPending}
                    data-testid="button-add-selected-agents"
                  >
                    {addAgentMutation.isPending ? t('chat:agentManagement.searchTab.addingSelected') : t('chat:agentManagement.searchTab.addSelected', { count: selectedAgentsForSearch.length })}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
        )}
      </div>

      {/* 편집 모달 */}
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle>{t('chat:agentManagement.editModal.title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 px-6 py-4 overflow-y-auto flex-1">
            {/* 이름 */}
            <div>
              <Label htmlFor="agent-name">{t('chat:agentManagement.editModal.name')}</Label>
              <Input
                id="agent-name"
                value={editForm.name}
                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder={t('chat:agentManagement.editModal.namePlaceholder')}
                data-testid="input-agent-name"
              />
            </div>

            {/* 페르소나 */}
            <div>
              <Label htmlFor="agent-persona">{t('chat:agentManagement.editModal.persona')}</Label>
              <Textarea
                id="agent-persona"
                value={editForm.persona}
                onChange={(e) => setEditForm(prev => ({ ...prev, persona: e.target.value }))}
                placeholder={t('chat:agentManagement.editModal.personaPlaceholder')}
                rows={4}
                data-testid="textarea-agent-persona"
              />
              <p className="text-sm text-gray-500 mt-1">
                {t('chat:agentManagement.editModal.personaNote')}
              </p>
            </div>

            {/* LLM 모델 */}
            <div>
              <Label htmlFor="agent-model">{t('chat:agentManagement.editModal.model')}</Label>
              <Select
                value={editForm.model}
                onValueChange={(value) => setEditForm(prev => ({ ...prev, model: value }))}
              >
                <SelectTrigger data-testid="select-agent-model">
                  <SelectValue placeholder={t('chat:agentManagement.editModal.modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4">GPT-4</SelectItem>
                  <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                  <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                  <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* 말투 강도 */}
            <div>
              <Label htmlFor="speaking-intensity">
                말투 강도 ({((parseFloat(editForm.speakingStyleIntensity) || 0.5) * 100).toFixed(0)}%)
              </Label>
              <div className="flex items-center gap-4 mt-2">
                <span className="text-xs text-gray-500">약함</span>
                <input
                  id="speaking-intensity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={parseFloat(editForm.speakingStyleIntensity) || 0.5}
                  onChange={(e) => setEditForm(prev => ({ ...prev, speakingStyleIntensity: e.target.value }))}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  data-testid="slider-speaking-intensity"
                />
                <span className="text-xs text-gray-500">강함</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                0.7 이상: 캐릭터 고유 말투 완전 유지 (정보형 질문에도 적용)
              </p>
            </div>

            {/* Strict Mode 설정 */}
            <div className="space-y-2">
              <Label>Strict Mode (정확성 엄격 모드)</Label>
              <Select
                value={editForm.strictMode || "none"}
                onValueChange={(value) => setEditForm(prev => ({ 
                  ...prev, 
                  strictMode: value === "none" ? null : value 
                }))}
                data-testid="select-strict-mode"
              >
                <SelectTrigger>
                  <SelectValue placeholder="도메인 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">비활성화</SelectItem>
                  <SelectItem value="biblical">성경적 정확성 (Canon Lock)</SelectItem>
                  <SelectItem value="historical">역사적 정확성</SelectItem>
                  <SelectItem value="scientific">과학적 정확성</SelectItem>
                  <SelectItem value="legal">법적 정확성</SelectItem>
                  <SelectItem value="academic">학술적 정확성</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500">
                {editForm.strictMode === "biblical" && "성경 내용에만 근거한 신학적으로 엄격한 답변"}
                {editForm.strictMode === "historical" && "역사적 사실과 기록에만 근거한 답변"}
                {editForm.strictMode === "scientific" && "검증된 과학 이론과 데이터에만 근거한 답변"}
                {editForm.strictMode === "legal" && "실제 법조문과 판례에만 근거한 답변"}
                {editForm.strictMode === "academic" && "논문과 학술 자료에만 근거한 답변"}
                {!editForm.strictMode && "정확성 제한 없음"}
              </p>
            </div>

            {/* 유머 설정 */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="humor-enabled"
                  checked={humorSettings.enabled}
                  onCheckedChange={(checked) => setHumorSettings(prev => ({ ...prev, enabled: checked as boolean }))}
                  data-testid="checkbox-humor-enabled"
                />
                <Label htmlFor="humor-enabled" className="cursor-pointer">
                  유머 활성화
                </Label>
              </div>
              
              {humorSettings.enabled && (
                <div className="ml-6 space-y-2">
                  <Label className="text-sm text-gray-600">유머 스타일 선택</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {HUMOR_STYLES.map(style => {
                      const labels: Record<string, string> = {
                        wit: "위트 (재치있는 한 마디)",
                        wordplay: "말장난 (언어유희)",
                        reaction: "리액션 (과장된 반응)",
                        dry: "드라이 (건조한 유머)",
                        self_deprecating: "자조 (자기 비하)",
                        goofy: "허당 (엉뚱함)",
                        pattern: "패턴 (반복 개그)",
                        wholesome: "훈훈 (따뜻한 유머)"
                      };
                      
                      return (
                        <div key={style} className="flex items-center gap-2">
                          <Checkbox
                            id={`humor-style-${style}`}
                            checked={humorSettings.styles.includes(style)}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setHumorSettings(prev => ({ ...prev, styles: [...prev.styles, style] }));
                              } else {
                                setHumorSettings(prev => ({ ...prev, styles: prev.styles.filter(s => s !== style) }));
                              }
                            }}
                            data-testid={`checkbox-humor-${style}`}
                          />
                          <Label htmlFor={`humor-style-${style}`} className="cursor-pointer text-sm">
                            {labels[style]}
                          </Label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* 파일 업로드 */}
            <div>
              <Label htmlFor="agent-files">{t('chat:agentManagement.editModal.fileUpload')}</Label>
              <div className="flex items-center gap-3">
                <input
                  id="agent-files"
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  className="hidden"
                  accept=".txt,.doc,.docx,.pdf,.ppt,.pptx"
                  data-testid="input-agent-files"
                />
                <Button
                  variant="outline"
                  onClick={() => document.getElementById('agent-files')?.click()}
                  data-testid="button-file-upload"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {t('chat:agentManagement.editModal.selectFiles')}
                </Button>
                {editForm.files.length > 0 && (
                  <span className="text-sm text-gray-600">
                    {t('chat:agentManagement.editModal.filesSelected', { count: editForm.files.length })}
                  </span>
                )}
              </div>
              {editForm.files.length > 0 && (
                <div className="mt-2 space-y-2">
                  {editForm.files.map((file, index) => {
                    const status = fileProcessingStatuses[index];
                    return (
                      <div key={index} className="border rounded-lg p-3 bg-gray-50">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {file.name}
                              </span>
                              <span className="text-xs text-gray-500 flex-shrink-0">
                                ({(file.size / 1024 / 1024).toFixed(2)} MB)
                              </span>
                            </div>
                            
                            {/* 처리 상태 표시 */}
                            {status && status.status !== 'pending' && (
                              <div className="mt-2">
                                {status.status === 'processing' && (
                                  <div className="flex items-center gap-2">
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                                    <span className="text-xs text-blue-700">{status.stage}</span>
                                  </div>
                                )}
                                
                                {status.status === 'success' && status.result && (
                                  <div className="text-xs text-green-700 space-y-1">
                                    <div className="font-medium">{status.stage}</div>
                                    <div>📄 추출: {status.result.textLength}자 | 🔍 RAG: {status.result.ragChunks}개 청크</div>
                                  </div>
                                )}
                                
                                {status.status === 'error' && (
                                  <div className="text-xs text-red-700 space-y-1">
                                    <div className="font-medium">{status.stage}</div>
                                    <div>오류: {status.result?.error || '알 수 없는 오류'}</div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          
                          <Button
                            size="sm"
                            variant={status?.status === 'success' ? 'outline' : 'default'}
                            onClick={() => handleProcessSingleFile(index)}
                            disabled={status?.status === 'processing'}
                            className="flex-shrink-0"
                          >
                            {status?.status === 'processing' ? '처리 중...' : 
                             status?.status === 'success' ? '재처리' : 
                             status?.status === 'error' ? '다시 시도' : 
                             '처리'}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 업로드된 문서 목록 */}
            <div>
              <Label>업로드된 문서</Label>
              {isLoadingDocuments ? (
                <div className="mt-2 flex items-center justify-center p-6 border border-dashed rounded-lg bg-gray-50">
                  <div className="flex items-center gap-2 text-gray-500">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                    <span className="text-sm">문서 목록 불러오는 중...</span>
                  </div>
                </div>
              ) : agentDocuments.length === 0 ? (
                <div className="mt-2 flex items-center justify-center p-6 border border-dashed rounded-lg bg-gray-50">
                  <p className="text-sm text-gray-500">업로드된 문서가 없습니다.</p>
                </div>
              ) : (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-2">{agentDocuments.length}개의 문서</div>
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {agentDocuments.map((doc: any) => {
                      const visionAnalysis = doc.visionAnalysis;
                      const fileName = doc.originalName?.toLowerCase() || '';
                      const isPDF = fileName.endsWith('.pdf');
                      const isPPTX = fileName.endsWith('.pptx') || fileName.endsWith('.ppt');
                      const isImage = fileName.endsWith('.png') || fileName.endsWith('.jpg') || 
                                      fileName.endsWith('.jpeg') || fileName.endsWith('.webp') || 
                                      fileName.endsWith('.gif');
                      const supportsVision = isPDF || isPPTX || isImage;
                      const hasVisionAnalysis = supportsVision && visionAnalysis;
                      const hasVisionProcessed = visionAnalysis?.hasVisionProcessed;
                      const showVisionButton = supportsVision; // PDF, PPTX, 이미지 파일에 Vision 버튼 표시
                      
                      return (
                      <div key={doc.id} className="border rounded-lg p-3 bg-white hover:bg-gray-50 transition-colors">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-gray-500 flex-shrink-0" />
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {doc.originalName}
                              </span>
                              <span className="text-xs text-gray-500 flex-shrink-0">
                                ({(doc.size / 1024 / 1024).toFixed(2)} MB)
                              </span>
                              {hasVisionProcessed && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                                  <Sparkles className="w-3 h-3" />
                                  Vision 완료
                                </span>
                              )}
                            </div>
                            
                            {/* 문서 정보 표시 */}
                            <div className="mt-1 text-xs text-gray-600 space-y-0.5">
                              {doc.description && (
                                <div className="line-clamp-2">{doc.description}</div>
                              )}
                              <div className="flex items-center gap-3 text-gray-500">
                                <span>📄 추출: {doc.content?.length || 0}자</span>
                                <span>🔍 RAG: {doc.chunkCount || 0}개 청크</span>
                                <span>{new Date(doc.createdAt).toLocaleDateString('ko-KR')}</span>
                              </div>
                              
                              {/* Vision API 처리 중일 때 진행 상황 표시 */}
                              {reprocessingDocumentId === doc.id && visionProgress?.documentId === doc.id && visionProgress && (
                                <div className="mt-2 p-3 border rounded bg-blue-50 border-blue-300">
                                  <div className="flex items-start gap-2">
                                    <div className="flex-shrink-0 mt-0.5">
                                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
                                    </div>
                                    <div className="flex-1">
                                      <div className="font-bold text-sm text-blue-900 flex items-center gap-2">
                                        Vision API 처리 중
                                        {visionProgress?.details?.currentStep && visionProgress?.details?.totalSteps && (
                                          <span className="text-xs font-normal text-blue-600">
                                            ({visionProgress.details.currentStep}/{visionProgress.details.totalSteps} 단계)
                                          </span>
                                        )}
                                      </div>
                                      
                                      {/* 진행률 바 */}
                                      {visionProgress?.details?.currentStep && visionProgress?.details?.totalSteps && (
                                        <div className="w-full bg-blue-200 rounded-full h-1.5 mt-2 mb-1">
                                          <div 
                                            className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                                            style={{ 
                                              width: `${(visionProgress.details.currentStep / visionProgress.details.totalSteps) * 100}%` 
                                            }}
                                          ></div>
                                        </div>
                                      )}
                                      
                                      <div className="text-xs mt-1 text-blue-800">
                                        {visionProgress?.message || '처리 중...'}
                                      </div>
                                      
                                      {/* 부가 정보 */}
                                      <div className="text-xs mt-2 space-y-0.5 text-blue-700">
                                        {visionProgress?.details?.totalImages && (
                                          <div>📸 추출된 이미지: {visionProgress.details.totalImages}개</div>
                                        )}
                                        {visionProgress?.details?.validImages && (
                                          <div>✅ 처리 가능: {visionProgress.details.validImages}개</div>
                                        )}
                                        {visionProgress?.details?.skippedImages > 0 && (
                                          <div>⚠️ 스킵됨: {visionProgress.details.skippedImages}개 (WMF/EMF)</div>
                                        )}
                                        {visionProgress?.details?.gridSize && (
                                          <div>🔲 Grid 크기: {visionProgress.details.gridSize[0]}×{visionProgress.details.gridSize[1]}px</div>
                                        )}
                                        {visionProgress?.details?.pagesAnalyzed && (
                                          <div>📄 분석된 페이지: {visionProgress.details.pagesAnalyzed}개</div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                              
                              {/* Vision 분석 정보 (항상 표시) */}
                              {hasVisionAnalysis && (() => {
                                const score = visionAnalysis.visionScore || 0;
                                const recommendationLevel = visionAnalysis.recommendationLevel || 
                                  (score >= 10 ? 'highly_recommended' : 
                                   score >= 7 ? 'recommended' : 
                                   score >= 4 ? 'optional' : 'unnecessary');
                                
                                // Vision 사용 후: benefits 표시
                                if (hasVisionProcessed) {
                                  return (
                                    <div className="mt-2 p-2 border rounded bg-green-50 border-green-300">
                                      <div className="flex items-start gap-2">
                                        <div className="flex-shrink-0 mt-0.5">
                                          <span className="text-base">✅</span>
                                        </div>
                                        <div className="flex-1">
                                          <div className="font-bold text-xs text-green-900">
                                            Vision API 분석 완료
                                          </div>
                                          <div className="text-xs mt-0.5 text-green-800">
                                            {visionAnalysis.benefits && visionAnalysis.benefits.length > 0 ? (
                                              <>
                                                <div className="mt-1"><strong>얻은 성과:</strong></div>
                                                {visionAnalysis.benefits.map((benefit: string, idx: number) => (
                                                  <div key={idx} className="mt-0.5">• {benefit}</div>
                                                ))}
                                              </>
                                            ) : (
                                              <>
                                                • 문서의 시각적 콘텐츠를 분석했습니다<br/>
                                                • 예상 비용: ${visionAnalysis.estimatedCost?.toFixed(4) || '0.0000'}
                                              </>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }
                                
                                // Vision 사용 전: 추천 레벨 + 이유 표시
                                const isHighlyRecommended = recommendationLevel === 'highly_recommended';
                                const isRecommended = recommendationLevel === 'recommended';
                                const isOptional = recommendationLevel === 'optional';
                                const isUnnecessary = recommendationLevel === 'unnecessary';
                                
                                return (
                                  <div className={`mt-2 p-2 border rounded ${
                                    isHighlyRecommended 
                                      ? 'bg-red-50 border-red-300' 
                                      : isRecommended
                                      ? 'bg-orange-50 border-orange-300'
                                      : isOptional
                                      ? 'bg-yellow-50 border-yellow-300'
                                      : 'bg-gray-50 border-gray-200'
                                  }`}>
                                    <div className="flex items-start gap-2">
                                      <div className="flex-shrink-0 mt-0.5">
                                        {isHighlyRecommended ? (
                                          <span className="text-base">🔥</span>
                                        ) : isRecommended ? (
                                          <span className="text-base">⭐</span>
                                        ) : isOptional ? (
                                          <span className="text-base">ℹ️</span>
                                        ) : (
                                          <span className="text-base">✅</span>
                                        )}
                                      </div>
                                      <div className="flex-1">
                                        <div className={`font-bold text-xs ${
                                          isHighlyRecommended 
                                            ? 'text-red-900' 
                                            : isRecommended
                                            ? 'text-orange-900'
                                            : isOptional
                                            ? 'text-yellow-900'
                                            : 'text-gray-700'
                                        }`}>
                                          {isHighlyRecommended && '🔥 적극 추천'}
                                          {isRecommended && '⭐ 추천'}
                                          {isOptional && 'ℹ️ 선택적'}
                                          {isUnnecessary && '✅ 불필요'}
                                        </div>
                                        <div className={`text-xs mt-0.5 ${
                                          isHighlyRecommended 
                                            ? 'text-red-800' 
                                            : isRecommended
                                            ? 'text-orange-800'
                                            : isOptional
                                            ? 'text-yellow-800'
                                            : 'text-gray-600'
                                        }`}>
                                          • Vision 점수: <strong>{score}/10</strong><br/>
                                          • 다이어그램: {visionAnalysis.diagramCount || 0}개 감지<br/>
                                          • 예상 비용: ${visionAnalysis.estimatedCost?.toFixed(4) || '0.0000'}
                                        </div>
                                        
                                        {/* 감지된 이유 표시 */}
                                        {visionAnalysis.reasons?.length > 0 && (
                                          <div className={`text-xs mt-1.5 pt-1.5 border-t ${
                                            isHighlyRecommended 
                                              ? 'border-red-200 text-red-600' 
                                              : isRecommended
                                              ? 'border-orange-200 text-orange-600'
                                              : isOptional
                                              ? 'border-yellow-200 text-yellow-600'
                                              : 'border-gray-200 text-gray-500'
                                          }`}>
                                            <strong>이유:</strong><br/>
                                            {visionAnalysis.reasons.map((reason: string, idx: number) => (
                                              <div key={idx}>• {reason}</div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                          
                          <div className="flex gap-2 flex-shrink-0">
                            {showVisionButton && (() => {
                              const score = visionAnalysis?.visionScore || 0;
                              const recommendationLevel = visionAnalysis?.recommendationLevel || 
                                (score >= 10 ? 'highly_recommended' : 
                                 score >= 7 ? 'recommended' : 
                                 score >= 4 ? 'optional' : 'unnecessary');
                              
                              const isHighlyRecommended = recommendationLevel === 'highly_recommended';
                              const isRecommended = recommendationLevel === 'recommended';
                              const isOptional = recommendationLevel === 'optional';
                              
                              return (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    setReprocessingDocumentId(doc.id);
                                    reprocessVisionMutation.mutate(doc.id);
                                  }}
                                  disabled={reprocessingDocumentId === doc.id || reprocessVisionMutation.isPending}
                                  className={
                                    hasVisionProcessed
                                      ? "border-green-400 bg-green-50 text-green-700 hover:bg-green-100"
                                      : isHighlyRecommended 
                                      ? "border-red-400 bg-red-50 text-red-700 hover:bg-red-100 font-semibold" 
                                      : isRecommended
                                      ? "border-orange-400 bg-orange-50 text-orange-700 hover:bg-orange-100"
                                      : isOptional
                                      ? "border-yellow-400 bg-yellow-50 text-yellow-700 hover:bg-yellow-100"
                                      : "border-gray-300 text-gray-700 hover:bg-gray-50"
                                  }
                                >
                                  {reprocessingDocumentId === doc.id ? (
                                    <div className="flex items-center gap-1">
                                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                                      <span className="text-xs">
                                        {visionProgress?.documentId === doc.id && visionProgress?.message
                                          ? visionProgress.message
                                          : '처리 중...'}
                                      </span>
                                    </div>
                                  ) : hasVisionProcessed ? (
                                    <div className="flex items-center gap-1">
                                      <Sparkles className="w-3.5 h-3.5" />
                                      <span className="text-xs">Vision 재실행</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      {isHighlyRecommended && <span>🔥</span>}
                                      {isRecommended && <span>⭐</span>}
                                      {isOptional && <span>ℹ️</span>}
                                      {!isHighlyRecommended && !isRecommended && !isOptional && <Sparkles className="w-3.5 h-3.5" />}
                                      <span className="text-xs">Vision API</span>
                                    </div>
                                  )}
                                </Button>
                              );
                            })()}
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                setDocumentToDelete({ id: doc.id, originalName: doc.originalName });
                                setDeleteDocumentDialogOpen(true);
                              }}
                              disabled={deleteDocumentMutation.isPending}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          {/* 버튼들 - 고정 푸터 */}
          <div className="px-6 py-4 border-t bg-white flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setShowEditModal(false)}
              data-testid="button-cancel-edit"
            >
              {t('common:button.cancel')}
            </Button>
            <Button
              onClick={handleEditFormSubmit}
              disabled={!editForm.name.trim()}
              data-testid="button-save-edit"
            >
              {t('common:button.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 캐릭터 삭제 확인 다이얼로그 */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>캐릭터 삭제 확인</AlertDialogTitle>
            <AlertDialogDescription>
              정말 <span className="font-semibold text-gray-900 dark:text-gray-100">{characterToDelete?.name}</span>을(를) 삭제하시겠습니까?
              {characterToDelete && (
                <div className="mt-2 text-sm">
                  이 캐릭터가 에이전트로 변환되어 참여 중인 그룹 채팅방이 있다면, 모든 채팅방에서 자동으로 퇴장됩니다.
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setDeleteDialogOpen(false);
              setCharacterToDelete(null);
            }}>
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (characterToDelete) {
                  deleteCharacterMutation.mutate(characterToDelete.id);
                }
              }}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 문서 삭제 확인 다이얼로그 */}
      <AlertDialog open={deleteDocumentDialogOpen} onOpenChange={setDeleteDocumentDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>문서 삭제 확인</AlertDialogTitle>
            <AlertDialogDescription>
              정말 <span className="font-semibold text-gray-900 dark:text-gray-100">{documentToDelete?.originalName}</span>을(를) 삭제하시겠습니까?
              <div className="mt-2 text-sm">
                이 문서와 관련된 모든 RAG 청크도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel 
              onClick={() => {
                setDeleteDocumentDialogOpen(false);
                setDocumentToDelete(null);
              }}
              disabled={deleteDocumentMutation.isPending}
            >
              취소
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (documentToDelete) {
                  deleteDocumentMutation.mutate(documentToDelete.id);
                }
              }}
              disabled={deleteDocumentMutation.isPending}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {deleteDocumentMutation.isPending ? '삭제 중...' : '삭제'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}