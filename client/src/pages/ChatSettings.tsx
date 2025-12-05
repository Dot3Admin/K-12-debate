import { useState, useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, Heart, Trash2, Eye, Copy, ChevronDown, Check, Globe, Lock, Code } from "lucide-react";
import type { GroupChatWithDetails } from "@/types/agent";
import { apiRequest } from "@/lib/queryClient";

export default function ChatSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { groupChatId: groupChatIdFromParams } = useParams();
  const [location, setLocation] = useLocation();
  
  // Extract groupChatId from URL if useParams doesn't work (TabletLayout case)
  const groupChatId = groupChatIdFromParams || (() => {
    const match = location.match(/\/group-chat\/(\d+)/);
    return match ? match[1] : null;
  })();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 설정 상태
  const [newChatTitle, setNewChatTitle] = useState("");
  const [newLanguageLevel, setNewLanguageLevel] = useState<number | null>(null);
  const [newProvider, setNewProvider] = useState<"openai" | "gemini">("openai");
  const [newGptModel, setNewGptModel] = useState("gpt-4o-mini");
  const [newGptTemperature, setNewGptTemperature] = useState(1.0);
  const [newMetaPrompt, setNewMetaPrompt] = useState("");
  const [isGeneratingMatrix, setIsGeneratingMatrix] = useState(false);
  
  // 공유 설정 상태
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [embedEnabled, setEmbedEnabled] = useState(false);
  const [sharingMode, setSharingMode] = useState<"shared" | "template">("shared");
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  
  // 커스텀 프롬프트 상태
  const [customUnifiedPrompt, setCustomUnifiedPrompt] = useState("");
  const [customScenarioPrompt, setCustomScenarioPrompt] = useState("");
  const [customMatrixPrompt, setCustomMatrixPrompt] = useState("");

  // 그룹 채팅 정보 조회
  const { data: groupChat } = useQuery<GroupChatWithDetails>({
    queryKey: [`/api/group-chats/${groupChatId}`],
  });

  // 관계 매트릭스 정보 조회
  const { data: relationshipMatrixData } = useQuery({
    queryKey: [`/api/group-chats/${groupChatId}/relationship-matrix`],
  });
  const hasMatrix = !!relationshipMatrixData && relationshipMatrixData.hasOwnProperty('data');

  // 커스텀 프롬프트 정보 조회
  const { data: promptsData } = useQuery<{
    customUnifiedPrompt: string | null;
    customScenarioPrompt: string | null;
    customMatrixPrompt: string | null;
  }>({
    queryKey: [`/api/group-chats/${groupChatId}/prompts/preview`],
  });

  // 기본 프롬프트 템플릿 조회
  const { data: defaultPrompts } = useQuery<{
    unifiedPrompt: string;
    scenarioPrompt: string;
    matrixPrompt: string;
  }>({
    queryKey: ['/api/prompts/defaults'],
  });

  // 현재 값으로 초기화
  useEffect(() => {
    if (groupChat) {
      setNewChatTitle(groupChat.title || "");
      setNewLanguageLevel(groupChat.languageLevel ?? null);
      setNewProvider((groupChat as any).provider || "openai");
      setNewGptModel(groupChat.model || "gpt-4o-mini");
      setNewGptTemperature(groupChat.temperature !== undefined ? groupChat.temperature : 1.0);
      setNewMetaPrompt(groupChat.metaPrompt || "");
      
      // 공유 설정 초기화 - embedEnabled와 visibility는 이제 독립적
      setEmbedEnabled(groupChat.embedEnabled || false);
      setVisibility(groupChat.visibility === 'public' ? 'public' : 'private');
      setSharingMode(groupChat.sharingMode || 'shared');
      setAllowedDomains(groupChat.allowedDomains || []);
    }
  }, [groupChat]);

  // 커스텀 프롬프트 초기화
  useEffect(() => {
    if (promptsData) {
      setCustomUnifiedPrompt(promptsData.customUnifiedPrompt || "");
      setCustomScenarioPrompt(promptsData.customScenarioPrompt || "");
      setCustomMatrixPrompt(promptsData.customMatrixPrompt || "");
    }
  }, [promptsData]);

  // 제목 업데이트 mutation
  const updateTitleMutation = useMutation({
    mutationFn: async (newTitle: string) => {
      return await apiRequest("PATCH", `/api/group-chats/${groupChatId}/title`, { title: newTitle });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
      toast({
        description: t('chat:chatSettings.titleUpdated'),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || t('chat:chatSettings.titleUpdateFailed'),
      });
    },
  });

  // 언어 레벨 업데이트 mutation
  const updateLanguageLevelMutation = useMutation({
    mutationFn: async (newLevel: number | null) => {
      return await apiRequest("PATCH", `/api/group-chats/${groupChatId}/language-level`, { languageLevel: newLevel });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      toast({
        description: t('chat:chatSettings.languageLevelUpdated'),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || t('chat:chatSettings.languageLevelUpdateFailed'),
      });
    },
  });

  // 공유 설정 업데이트 mutation
  const updateSharingSettingsMutation = useMutation({
    mutationFn: async (settings: { visibility: string; embedEnabled?: boolean; sharingMode?: string; allowedDomains?: string[] }) => {
      return await apiRequest("PATCH", `/api/group-chats/${groupChatId}/sharing-settings`, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
      toast({
        description: "공유 설정이 업데이트되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || "공유 설정 업데이트 실패",
      });
    },
  });

  // AI 설정 업데이트 mutation
  const updateAISettingsMutation = useMutation({
    mutationFn: async (settings: { provider: string; model: string; temperature: number }) => {
      return await apiRequest("PATCH", `/api/group-chats/${groupChatId}/ai-settings`, settings);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      toast({
        description: "AI 설정이 업데이트되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || "AI 설정 업데이트 실패",
      });
    },
  });

  // 메타 프롬프트 업데이트 mutation
  const updateMetaPromptMutation = useMutation({
    mutationFn: async (metaPrompt: string) => {
      return await apiRequest("PATCH", `/api/group-chats/${groupChatId}/meta-prompt`, { metaPrompt });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      toast({
        description: "메타 프롬프트가 업데이트되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || "메타 프롬프트 업데이트 실패",
      });
    },
  });

  // 커스텀 프롬프트 업데이트 mutation
  const updateCustomPromptsMutation = useMutation({
    mutationFn: async (prompts: { customUnifiedPrompt?: string; customScenarioPrompt?: string; customMatrixPrompt?: string }) => {
      return await apiRequest("PATCH", `/api/group-chats/${groupChatId}/custom-prompts`, prompts);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/prompts/preview`] });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      toast({
        description: "커스텀 프롬프트가 업데이트되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || "커스텀 프롬프트 업데이트 실패",
      });
    },
  });

  // 관계 매트릭스 생성 mutation
  const generateMatrixMutation = useMutation({
    mutationFn: async () => {
      setIsGeneratingMatrix(true);
      return await apiRequest("POST", `/api/group-chats/${groupChatId}/relationship-matrix`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/relationship-matrix`] });
      setIsGeneratingMatrix(false);
      toast({
        description: t('chat:chatSettings.matrixGenerated'),
      });
    },
    onError: (error: any) => {
      setIsGeneratingMatrix(false);
      toast({
        variant: "destructive",
        description: error.message || t('chat:chatSettings.matrixGenerateFailed'),
      });
    },
  });

  // 관계 매트릭스 삭제 mutation
  const deleteMatrixMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/group-chats/${groupChatId}/relationship-matrix`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/relationship-matrix`] });
      toast({
        description: t('chat:chatSettings.matrixDeleted'),
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || t('chat:chatSettings.matrixDeleteFailed'),
      });
    },
  });

  // 대화 내용 지우기 mutation
  const deleteAllMessagesMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/group-chats/${groupChatId}/messages`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/messages`] });
      queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
      toast({
        description: "모든 대화 내용이 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        description: error.message || "대화 내용 삭제에 실패했습니다.",
      });
    },
  });

  // 저장 핸들러
  const handleSave = async () => {
    const titleChanged = newChatTitle.trim() && newChatTitle.trim() !== (groupChat?.title || "");
    const levelChanged = newLanguageLevel !== (groupChat?.languageLevel ?? null);
    const providerChanged = newProvider !== ((groupChat as any)?.provider || "openai");
    const modelChanged = newGptModel !== (groupChat?.model || "gpt-4o-mini");
    const temperatureChanged = newGptTemperature !== (groupChat?.temperature !== undefined ? groupChat.temperature : 1.0);
    const aiSettingsChanged = providerChanged || modelChanged || temperatureChanged;
    
    // 공유 설정 변경 확인
    const currentVisibility = groupChat?.visibility || 'private';
    const currentEmbedEnabled = groupChat?.embedEnabled || false;
    const visibilityChanged = visibility !== currentVisibility;
    const embedChanged = embedEnabled !== currentEmbedEnabled;
    const sharingModeChanged = sharingMode !== (groupChat?.sharingMode || 'shared');
    const sharingSettingsChanged = visibilityChanged || embedChanged || sharingModeChanged;
    
    console.log('[handleSave] 변경 감지:', {
      currentVisibility,
      currentEmbedEnabled,
      visibility,
      embedEnabled,
      visibilityChanged,
      embedChanged,
      sharingModeChanged,
      sharingSettingsChanged
    });
    
    if (!titleChanged && !levelChanged && !aiSettingsChanged && !sharingSettingsChanged) {
      setLocation(`/group-chat/${groupChatId}`);
      return;
    }

    try {
      const promises = [];
      
      if (titleChanged) {
        promises.push(updateTitleMutation.mutateAsync(newChatTitle.trim()));
      }
      
      if (levelChanged) {
        promises.push(updateLanguageLevelMutation.mutateAsync(newLanguageLevel));
      }
      
      if (aiSettingsChanged) {
        promises.push(updateAISettingsMutation.mutateAsync({ 
          provider: newProvider,
          model: newGptModel, 
          temperature: newGptTemperature 
        }));
      }
      
      if (sharingSettingsChanged) {
        console.log('[저장 전] embedEnabled:', embedEnabled, 'visibility:', visibility);
        promises.push(updateSharingSettingsMutation.mutateAsync({
          visibility,
          embedEnabled,
          sharingMode,
          allowedDomains: embedEnabled ? allowedDomains : undefined
        }));
      }
      
      await Promise.all(promises);
      
      setLocation(`/group-chat/${groupChatId}`);
    } catch (error) {
      console.error('Settings save error:', error);
    }
  };

  // 관리자 권한 체크
  const isAdmin = user && (user.role === 'master_admin' || user.role === 'agent_admin');

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setLocation(`/group-chat/${groupChatId}`)}
          className="mr-2"
          data-testid="button-back"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-xl font-semibold text-gray-900">
          {t('chat:chatSettings.title')}
        </h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* 대화방 제목 */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              {t('chat:chatSettings.chatTitle')}
            </label>
            <input
              type="text"
              value={newChatTitle}
              onChange={(e) => setNewChatTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newChatTitle.trim() && !updateTitleMutation.isPending) {
                  e.preventDefault();
                  updateTitleMutation.mutate(newChatTitle.trim());
                }
              }}
              placeholder={groupChat?.title || t('chat:chatSettings.chatTitlePlaceholder')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              maxLength={100}
              data-testid="input-chat-title"
            />
            <p className="text-xs text-gray-500 mt-1">
              {t('chat:chatSettings.characterCount', {count: newChatTitle.length})}
            </p>
          </div>

          {/* 챗봇 언어 레벨 - 관리자 전용 */}
          {isAdmin && <>
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">
              {t('chat:chatSettings.languageLevel')}
            </label>
            <Select 
              value={newLanguageLevel === null ? "none" : newLanguageLevel.toString()} 
              onValueChange={(value) => setNewLanguageLevel(value === "none" ? null : parseInt(value))}
            >
              <SelectTrigger className="w-full" data-testid="select-language-level">
                <SelectValue placeholder={t('chat:input.languageLevelPlaceholder')}>
                  {newLanguageLevel === null ? "미적용" : 
                   newLanguageLevel === 1 ? "1단계 - 단어 하나" :
                   newLanguageLevel === 2 ? "2단계 - 주어 + 동사" :
                   newLanguageLevel === 3 ? "3단계 - 간단한 두 문장" :
                   newLanguageLevel === 4 ? "4단계 - 기본 연결 표현" :
                   newLanguageLevel === 5 ? "5단계 - 이유 표현과 조건문" :
                   newLanguageLevel === 6 ? "6단계 - 완전 자유 표현" : ""}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">미적용</span>
                    <span className="text-xs text-gray-500">AI가 자유롭게 응답 (제약 없음)</span>
                  </div>
                </SelectItem>
                <SelectItem value="1">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">1단계 - 단어 하나</span>
                    <span className="text-xs text-gray-500">예: "좋아", "네", "안녕"</span>
                  </div>
                </SelectItem>
                <SelectItem value="2">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">2단계 - 주어 + 동사</span>
                    <span className="text-xs text-gray-500">예: "나 좋아", "날씨 좋아"</span>
                  </div>
                </SelectItem>
                <SelectItem value="3">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">3단계 - 간단한 두 문장</span>
                    <span className="text-xs text-gray-500">예: "날씨 좋아. 나 기뻐." (기본값)</span>
                  </div>
                </SelectItem>
                <SelectItem value="4">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">4단계 - 기본 연결 표현</span>
                    <span className="text-xs text-gray-500">예: "돈 벌고 투자해", "-고", "-아서/-어서" 사용</span>
                  </div>
                </SelectItem>
                <SelectItem value="5">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">5단계 - 이유 표현과 조건문</span>
                    <span className="text-xs text-gray-500">예: "돈 벌어서 투자해", "만약 기회 있으면 해볼래"</span>
                  </div>
                </SelectItem>
                <SelectItem value="6">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">6단계 - 완전 자유 표현</span>
                    <span className="text-xs text-gray-500">제한 없는 자연스러운 표현</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500 mt-2">
              {t('chat:chatSettings.languageLevelDesc')}
            </p>
          </div>

          {/* AI 설정 섹션 - 관리자 전용 */}
          <div className="border-t pt-6">
            <label className="text-sm font-medium text-gray-700 block mb-3">
              AI 설정
            </label>
            
            {/* LLM 제공자 선택 */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">
                LLM 제공자
              </label>
              <Select value={newProvider} onValueChange={(value: "openai" | "gemini") => {
                setNewProvider(value);
                // 제공자 변경 시 기본 모델로 설정
                if (value === "openai") {
                  setNewGptModel("gpt-4o-mini");
                } else if (value === "gemini") {
                  setNewGptModel("gemini-2.0-flash-lite");
                }
              }} data-testid="select-provider">
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="제공자 선택" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">OpenAI</span>
                      <span className="text-xs text-gray-500">GPT-4o, GPT-4-turbo 등</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="gemini">
                    <div className="flex flex-col items-start">
                      <span className="font-medium">Google Gemini</span>
                      <span className="text-xs text-gray-500">Gemini 2.5 Pro, 2.0 Flash 등</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-2">
                사용할 AI 제공자를 선택하세요
              </p>
            </div>

            {/* LLM 모델 선택 */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">
                {newProvider === "openai" ? "GPT 모델" : "Gemini 모델"}
              </label>
              <Select value={newGptModel} onValueChange={(value) => setNewGptModel(value)}>
                <SelectTrigger className="w-full" data-testid="select-gpt-model">
                  <SelectValue placeholder="모델 선택" />
                </SelectTrigger>
                <SelectContent>
                  {newProvider === "openai" ? (
                    <>
                      <SelectItem value="gpt-4o">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">GPT-4o</span>
                          <span className="text-xs text-gray-500">가장 정확한 응답 (느림, 비용 높음)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gpt-4o-mini">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">GPT-4o-mini</span>
                          <span className="text-xs text-gray-500">빠른 응답 (기본값, 적당한 정확도)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gpt-4-turbo">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">GPT-4-turbo</span>
                          <span className="text-xs text-gray-500">빠른 GPT-4</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gpt-4">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">GPT-4</span>
                          <span className="text-xs text-gray-500">고품질 응답</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gpt-3.5-turbo">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">GPT-3.5-turbo</span>
                          <span className="text-xs text-gray-500">가장 빠름 (낮은 정확도)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="o1-preview">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">o1-preview</span>
                          <span className="text-xs text-gray-500">최신 reasoning 모델 (매우 느림)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="o1-mini">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">o1-mini</span>
                          <span className="text-xs text-gray-500">빠른 reasoning 모델</span>
                        </div>
                      </SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="gemini-2.5-pro">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">gemini-2.5-pro</span>
                          <span className="text-xs text-gray-500">가장 강력한 최신 모델</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini-2.5-flash">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">gemini-2.5-flash</span>
                          <span className="text-xs text-gray-500">빠르고 강력 (최신 버전)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini-2.0-flash">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">gemini-2.0-flash</span>
                          <span className="text-xs text-gray-500">안정적인 표준 모델 (권장)</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="gemini-2.0-flash-lite">
                        <div className="flex flex-col items-start">
                          <span className="font-medium">gemini-2.0-flash-lite</span>
                          <span className="text-xs text-gray-500">가장 빠름 (과부하 방지, 권장)</span>
                        </div>
                      </SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-2">
                {newProvider === "openai" 
                  ? "정확도가 중요하면 gpt-4o, 속도가 중요하면 gpt-4o-mini를 선택하세요"
                  : "빠른 응답: gemini-2.0-flash-lite (권장), 복잡한 작업: gemini-2.5-pro"
                }
              </p>
            </div>

            {/* Temperature 슬라이더 */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">
                Temperature: {Number(newGptTemperature ?? 1.0).toFixed(2)}
              </label>
              <Slider
                value={[Number(newGptTemperature ?? 1.0)]}
                onValueChange={(values) => setNewGptTemperature(values[0])}
                min={0}
                max={2}
                step={0.1}
                className="w-full"
                data-testid="slider-temperature"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>0.0 (정확)</span>
                <span>1.0 (균형)</span>
                <span>2.0 (창의적)</span>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                0.0-0.3: 사실 기반 응답, 0.7-1.0: 균형잡힌 응답, 1.5-2.0: 창의적 응답
              </p>
            </div>

            {/* AI 설정 저장 버튼 */}
            <Button 
              onClick={() => {
                updateAISettingsMutation.mutate({
                  provider: newProvider,
                  model: newGptModel,
                  temperature: newGptTemperature
                });
              }}
              disabled={updateAISettingsMutation.isPending}
              className="w-full"
              data-testid="button-save-ai-settings"
            >
              {updateAISettingsMutation.isPending ? "저장 중..." : "AI 설정 저장"}
            </Button>
          </div>

          {/* 공유 설정 섹션 */}
          <div className="border-t pt-6">
            <label className="text-sm font-medium text-gray-700 block mb-3">
              공유 설정
            </label>
            
            {/* 공개 범위 */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">
                공개 범위
              </label>
              <RadioGroup value={visibility} onValueChange={(value: "public" | "private") => setVisibility(value)} className="space-y-2">
                <div className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  visibility === 'public' 
                    ? 'bg-blue-50 border-blue-400' 
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`} onClick={() => setVisibility('public')}>
                  <RadioGroupItem value="public" id="public" />
                  <Label htmlFor="public" className="flex items-center cursor-pointer flex-1">
                    <Globe className={`h-4 w-4 mr-2 ${visibility === 'public' ? 'text-blue-600' : 'text-gray-400'}`} />
                    <div className="flex-1">
                      <div className={`font-medium ${visibility === 'public' ? 'text-blue-900' : 'text-gray-700'}`}>공개</div>
                      <div className="text-xs text-gray-500">(모든 사용자가 참여 가능)</div>
                    </div>
                    {visibility === 'public' && (
                      <Check className="h-5 w-5 text-blue-600 ml-2" />
                    )}
                  </Label>
                </div>
                <div className={`flex items-center space-x-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  visibility === 'private' 
                    ? 'bg-gray-50 border-gray-400' 
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`} onClick={() => setVisibility('private')}>
                  <RadioGroupItem value="private" id="private" />
                  <Label htmlFor="private" className="flex items-center cursor-pointer flex-1">
                    <Lock className={`h-4 w-4 mr-2 ${visibility === 'private' ? 'text-gray-700' : 'text-gray-400'}`} />
                    <div className="flex-1">
                      <div className={`font-medium ${visibility === 'private' ? 'text-gray-900' : 'text-gray-700'}`}>비공개</div>
                      <div className="text-xs text-gray-500">(초대된 사용자만 참여 가능)</div>
                    </div>
                    {visibility === 'private' && (
                      <Check className="h-5 w-5 text-gray-700 ml-2" />
                    )}
                  </Label>
                </div>
              </RadioGroup>
            </div>

            {/* 웹 페이지 임베드 */}
            <div className="mb-4">
              <div className={`flex items-center justify-between p-3 rounded-lg border-2 transition-all ${
                embedEnabled 
                  ? 'bg-purple-50 border-purple-300' 
                  : 'bg-gray-50 border-gray-200'
              }`}>
                <div className="flex items-center space-x-2">
                  <Code className={`h-4 w-4 ${embedEnabled ? 'text-purple-600' : 'text-gray-500'}`} />
                  <label className="text-sm font-medium text-gray-700">
                    웹 페이지 임베드
                  </label>
                  <span className={`text-xs font-semibold ${
                    embedEnabled ? 'text-purple-700' : 'text-gray-500'
                  }`}>
                    {embedEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                <Switch 
                  checked={embedEnabled} 
                  onCheckedChange={setEmbedEnabled}
                />
              </div>
              
              {/* 임베드 활성화 시 임베드 코드 표시 */}
              {embedEnabled && (
                <div className="space-y-3 mt-3">
                  {groupChat?.embedCode ? (
                    <>
                      <p className="text-xs text-gray-600">
                        아래 HTML 코드를 복사하여 웹 페이지에 붙여넣으면 이 채팅방을 임베드할 수 있습니다.
                      </p>
                      
                      {/* 임베드 코드 표시 */}
                      <div className="relative">
                        <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 font-mono text-sm text-gray-800 overflow-x-auto">
                          {`<iframe src="${window.location.origin}/embed/${groupChat.embedCode}" width="100%" height="600px" frameborder="0"></iframe>`}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="absolute top-2 right-2"
                          onClick={() => {
                            const embedCode = `<iframe src="${window.location.origin}/embed/${groupChat.embedCode}" width="100%" height="600px" frameborder="0"></iframe>`;
                            navigator.clipboard.writeText(embedCode);
                            toast({ 
                              description: "임베드 코드가 클립보드에 복사되었습니다."
                            });
                          }}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      
                      {/* 허용된 도메인 정보 */}
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                        <p className="text-sm font-medium text-blue-900 mb-1">
                          허용된 도메인
                        </p>
                        {groupChat.allowedDomains && groupChat.allowedDomains.length > 0 ? (
                          <ul className="text-sm text-blue-800 space-y-1">
                            {groupChat.allowedDomains.map((domain, idx) => (
                              <li key={idx} className="flex items-center">
                                <Check className="h-3 w-3 mr-2" />
                                {domain}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-blue-800">
                            모든 웹사이트에서 임베드 가능
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                      <p className="text-sm text-yellow-800">
                        💡 임베드 코드를 생성하려면 <strong>저장</strong> 버튼을 클릭하세요.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 공유 모드 */}
            <div className="mb-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">
                공유 모드
              </label>
              <div className="space-y-2">
                <div 
                  className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                    sharingMode === "shared" 
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                  onClick={() => setSharingMode("shared")}
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900 dark:text-white">실제 대화방 공유</span>
                    <span className="text-xs text-gray-500">(사용자들이 같은 대화방을 공유)</span>
                  </div>
                  {sharingMode === "shared" && (
                    <Check className="h-5 w-5 text-blue-600" />
                  )}
                </div>
                <div 
                  className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${
                    sharingMode === "template" 
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20" 
                      : "border-gray-300 hover:border-gray-400"
                  }`}
                  onClick={() => setSharingMode("template")}
                >
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-900 dark:text-white">템플릿 공유</span>
                    <span className="text-xs text-gray-500">(각 사용자가 복사본 생성)</span>
                  </div>
                  {sharingMode === "template" && (
                    <Check className="h-5 w-5 text-blue-600" />
                  )}
                </div>
              </div>
            </div>

          </div>

          {/* 대화 관리 섹션 - 관리자 전용 */}
          <div className="border-t pt-6">
            <label className="text-sm font-medium text-gray-700 block mb-3">
              대화 관리
            </label>
            
            {/* 대화 내용 지우기 */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-medium text-amber-900 mb-1">
                    대화 내용 지우기
                  </h3>
                  <p className="text-xs text-amber-700">
                    이 대화방의 모든 메시지가 영구적으로 삭제됩니다. 이 작업은 되돌릴 수 없습니다.
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      disabled={deleteAllMessagesMutation.isPending}
                      data-testid="button-delete-all-messages"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      대화 내용 지우기
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>정말로 모든 대화 내용을 삭제하시겠습니까?</AlertDialogTitle>
                      <AlertDialogDescription>
                        이 대화방의 모든 메시지가 영구적으로 삭제됩니다. 삭제된 내용은 복구할 수 없습니다.
                        <br /><br />
                        <span className="font-semibold text-red-600">이 작업은 되돌릴 수 없습니다.</span>
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="focus:ring-0 focus:ring-offset-0">취소</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteAllMessagesMutation.mutate()}
                        className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                      >
                        {deleteAllMessagesMutation.isPending ? "삭제 중..." : "삭제"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>

          {/* 개발자 전용 영역 - 관리자 전용, 축소됨 */}
          <Collapsible open={false} className="border-t pt-6">
            <CollapsibleTrigger asChild>
              <Button 
                variant="ghost" 
                className="w-full flex items-center justify-between p-4 hover:bg-gray-50"
                disabled
              >
                <span className="text-sm font-medium text-gray-700">개발자 전용 영역 (접근 제한)</span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 pt-4">
              {/* 메타 프롬프트 섹션 */}
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-2">
                  메타 프롬프트 (시스템 프롬프트)
                </label>
                <textarea
                  value={newMetaPrompt}
                  onChange={(e) => setNewMetaPrompt(e.target.value)}
                  placeholder="개발자 입력 필드"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-sm"
                  rows={8}
                  data-testid="textarea-meta-prompt"
                  disabled
                />
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs text-gray-500">
                    메타 프롬프트는 AI의 역할, 톤, 제약사항 등을 지정합니다
                  </p>
                  <Button
                    size="sm"
                    onClick={() => updateMetaPromptMutation.mutate(newMetaPrompt)}
                    disabled={updateMetaPromptMutation.isPending}
                    data-testid="button-save-meta-prompt"
                  >
                    {updateMetaPromptMutation.isPending ? "저장 중..." : "저장"}
                  </Button>
                </div>
              </div>

              {/* 커스텀 프롬프트 섹션 */}
              <div className="pt-6">
                <div className="mb-4">
                  <h3 className="text-sm font-medium text-gray-700 mb-1">커스텀 시스템 프롬프트</h3>
                  <p className="text-xs text-gray-500">기본 프롬프트를 완전히 교체합니다. 비워두면 기본 프롬프트 사용</p>
                </div>

                {/* 통합 프롬프트 */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">
                      통합 프롬프트 (Unified Prompt)
                    </label>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs" data-testid="button-view-default-unified-prompt" disabled>
                          <Eye className="h-3 w-3 mr-1" />
                          기본 프롬프트 보기
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-default-unified-prompt">
                        <DialogHeader>
                          <DialogTitle>통합 프롬프트 - 기본 템플릿</DialogTitle>
                          <DialogDescription>
                            시스템이 기본으로 사용하는 통합 프롬프트입니다. 아래 내용을 복사하여 수정할 수 있습니다.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="relative">
                            <pre className="bg-gray-50 p-4 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap" data-testid="pre-default-unified-prompt">
                              {defaultPrompts?.unifiedPrompt || "로딩 중..."}
                            </pre>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="absolute top-2 right-2"
                              onClick={() => {
                                navigator.clipboard.writeText(defaultPrompts?.unifiedPrompt || "")
                                  .then(() => {
                                    toast({ description: "클립보드에 복사되었습니다." });
                                  })
                                  .catch(() => {
                                    toast({ 
                                      variant: "destructive",
                                      description: "클립보드 복사에 실패했습니다." 
                                    });
                                  });
                              }}
                              data-testid="button-copy-unified-prompt"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <textarea
                    value={customUnifiedPrompt}
                    onChange={(e) => setCustomUnifiedPrompt(e.target.value)}
                    placeholder="개발자 입력 필드"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-xs"
                    rows={10}
                    data-testid="textarea-custom-unified-prompt"
                    disabled
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    일반 대화에서 사용되는 기본 프롬프트
                  </p>
                </div>

                {/* 시나리오 프롬프트 */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">
                      시나리오 프롬프트 (Scenario Prompt)
                    </label>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs" data-testid="button-view-default-scenario-prompt" disabled>
                          <Eye className="h-3 w-3 mr-1" />
                          기본 프롬프트 보기
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-default-scenario-prompt">
                        <DialogHeader>
                          <DialogTitle>시나리오 프롬프트 - 기본 템플릿</DialogTitle>
                          <DialogDescription>
                            시스템이 기본으로 사용하는 시나리오 프롬프트입니다. 아래 내용을 복사하여 수정할 수 있습니다.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="relative">
                            <pre className="bg-gray-50 p-4 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap" data-testid="pre-default-scenario-prompt">
                              {defaultPrompts?.scenarioPrompt || "로딩 중..."}
                            </pre>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="absolute top-2 right-2"
                              onClick={() => {
                                navigator.clipboard.writeText(defaultPrompts?.scenarioPrompt || "")
                                  .then(() => {
                                    toast({ description: "클립보드에 복사되었습니다." });
                                  })
                                  .catch(() => {
                                    toast({ 
                                      variant: "destructive",
                                      description: "클립보드 복사에 실패했습니다." 
                                    });
                                  });
                              }}
                              data-testid="button-copy-scenario-prompt"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <textarea
                    value={customScenarioPrompt}
                    onChange={(e) => setCustomScenarioPrompt(e.target.value)}
                    placeholder="개발자 입력 필드"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-xs"
                    rows={10}
                    data-testid="textarea-custom-scenario-prompt"
                    disabled
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    전체 시나리오 생성에 사용되는 프롬프트
                  </p>
                </div>

                {/* 매트릭스 프롬프트 */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-gray-700">
                      매트릭스 프롬프트 (Matrix Prompt)
                    </label>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm" className="text-xs" data-testid="button-view-default-matrix-prompt" disabled>
                          <Eye className="h-3 w-3 mr-1" />
                          기본 프롬프트 보기
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto" data-testid="dialog-default-matrix-prompt">
                        <DialogHeader>
                          <DialogTitle>매트릭스 프롬프트 - 기본 템플릿</DialogTitle>
                          <DialogDescription>
                            시스템이 기본으로 사용하는 매트릭스 프롬프트입니다. 아래 내용을 복사하여 수정할 수 있습니다.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-3">
                          <div className="relative">
                            <pre className="bg-gray-50 p-4 rounded-md text-xs font-mono overflow-x-auto whitespace-pre-wrap" data-testid="pre-default-matrix-prompt">
                              {defaultPrompts?.matrixPrompt || "로딩 중..."}
                            </pre>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="absolute top-2 right-2"
                              onClick={() => {
                                navigator.clipboard.writeText(defaultPrompts?.matrixPrompt || "")
                                  .then(() => {
                                    toast({ description: "클립보드에 복사되었습니다." });
                                  })
                                  .catch(() => {
                                    toast({ 
                                      variant: "destructive",
                                      description: "클립보드 복사에 실패했습니다." 
                                    });
                                  });
                              }}
                              data-testid="button-copy-matrix-prompt"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  <textarea
                    value={customMatrixPrompt}
                    onChange={(e) => setCustomMatrixPrompt(e.target.value)}
                    placeholder="개발자 입력 필드"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none font-mono text-xs"
                    rows={10}
                    data-testid="textarea-custom-matrix-prompt"
                    disabled
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    스트리밍 응답 생성에 사용되는 프롬프트
                  </p>
                </div>

                {/* 저장 버튼 */}
                <div className="flex justify-end mt-4">
                  <Button
                    size="sm"
                    onClick={() => updateCustomPromptsMutation.mutate({
                      customUnifiedPrompt: customUnifiedPrompt.trim() || undefined,
                      customScenarioPrompt: customScenarioPrompt.trim() || undefined,
                      customMatrixPrompt: customMatrixPrompt.trim() || undefined,
                    })}
                    disabled={updateCustomPromptsMutation.isPending}
                    data-testid="button-save-custom-prompts"
                  >
                    {updateCustomPromptsMutation.isPending ? "저장 중..." : "커스텀 프롬프트 저장"}
                  </Button>
                </div>
              </div>

              {/* 관계 매트릭스 관리 섹션 */}
              {groupChat && groupChat.agents.length >= 2 && (
                <div className="border-t pt-6">
                  <label className="text-sm font-medium text-gray-700 block mb-3">
                    {t('chat:chatSettings.relationshipMatrix')}
                  </label>
                  <div className="space-y-3">
                    <p className="text-sm text-gray-600">
                      {t('chat:chatSettings.relationshipMatrixDesc')}
                    </p>
                    
                    {hasMatrix ? (
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-2 bg-green-500 rounded-full"></div>
                          <span className="text-sm text-green-700">{t('chat:chatSettings.matrixExists')}</span>
                        </div>
                        <div className="flex space-x-2">
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => generateMatrixMutation.mutate()}
                            disabled={generateMatrixMutation.isPending || isGeneratingMatrix}
                            data-testid="button-regenerate-matrix"
                          >
                            {(generateMatrixMutation.isPending || isGeneratingMatrix) ? t('chat:chatSettings.matrixGenerating') : t('chat:chatSettings.matrixRegenerate')}
                          </Button>
                          <Button 
                            size="sm" 
                            variant="destructive"
                            onClick={() => deleteMatrixMutation.mutate()}
                            disabled={deleteMatrixMutation.isPending || isGeneratingMatrix}
                            data-testid="button-delete-matrix"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {t('chat:chatSettings.matrixDelete')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center space-x-2">
                          <div className="h-2 w-2 bg-gray-400 rounded-full"></div>
                          <span className="text-sm text-gray-600">{t('chat:chatSettings.matrixNone')}</span>
                        </div>
                        <Button 
                          size="sm" 
                          onClick={() => generateMatrixMutation.mutate()}
                          disabled={generateMatrixMutation.isPending || isGeneratingMatrix}
                          data-testid="button-generate-matrix"
                        >
                          <Heart className="mr-2 h-4 w-4" />
                          {(generateMatrixMutation.isPending || isGeneratingMatrix) ? t('chat:chatSettings.matrixGenerating') : t('chat:chatSettings.matrixGenerate')}
                        </Button>
                      </div>
                    )}
                    
                    <p className="text-xs text-gray-500">
                      {t('chat:chatSettings.matrixAutoReset')}
                    </p>
                  </div>
                </div>
              )}
              
              {/* 관계 매트릭스가 2개 미만일 때 안내 */}
              {groupChat && groupChat.agents.length < 2 && (
                <div className="border-t pt-6">
                  <label className="text-sm font-medium text-gray-700 block mb-3">
                    {t('chat:chatSettings.relationshipMatrix')}
                  </label>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-sm text-amber-800">
                      {t('chat:chatSettings.matrixMinRequired')}
                    </p>
                  </div>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
          </>}
        </div>
      </div>

      {/* Footer Actions */}
      <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-100">
        <Button 
          variant="outline" 
          onClick={() => setLocation(`/group-chat/${groupChatId}`)}
          data-testid="button-cancel-settings"
        >
          {t('chat:chatSettings.cancel')}
        </Button>
        <Button 
          onClick={handleSave}
          disabled={updateTitleMutation.isPending || updateLanguageLevelMutation.isPending || updateAISettingsMutation.isPending || updateSharingSettingsMutation.isPending}
          data-testid="button-save-settings"
        >
          {t('chat:chatSettings.save')}
        </Button>
      </div>
    </div>
  );
}
