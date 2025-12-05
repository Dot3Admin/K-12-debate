import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { X, Save, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useFormChanges } from "@/hooks/useFormChanges";
import type { Agent } from "@/types/agent";

interface ChatbotSettingsModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  onCancel?: (message: string) => void;
}

interface ChatbotSettings {
  llmModel: string;
  chatbotType: string;
  visibility: string;
  upperCategory?: string;
  lowerCategory?: string;
  detailCategory?: string;
  webSearchEnabled?: boolean;
  searchEngine?: string;
  bingApiKey?: string;
}

const LLM_MODELS = [
  { value: "gpt-4o", label: "GPT-4o (추천)" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini (빠름)" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo (경제적)" }
];

const CHATBOT_TYPES = [
  { 
    value: "strict-doc", 
    label: "문서 기반 전용",
    description: "문서 기반 응답만 가능, 문서 외 질문은 부드럽게 거절"
  },
  { 
    value: "doc-fallback-llm", 
    label: "문서 우선 + LLM",
    description: "문서를 우선 사용하고 없으면 일반 LLM 결과 출력"
  },
  { 
    value: "general-llm", 
    label: "LLM 전용",
    description: "일반 LLM 챗봇처럼 자유 대화"
  }
];

const VISIBILITY_OPTIONS = [
  { 
    value: "public", 
    label: "조직 전체 - 소속 조직의 모든 구성원이 사용 가능" 
  },
  { 
    value: "group", 
    label: "그룹 지정 - 특정 그룹의 사용자만 사용 가능" 
  },
  { 
    value: "user", 
    label: "사용자 지정 - 개별 사용자 선택" 
  },
  { 
    value: "private", 
    label: "프라이빗 - 관리자만 사용 가능" 
  }
];

export default function ChatbotSettingsModal({ agent, isOpen, onClose, onSuccess, onCancel }: ChatbotSettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // 원본 데이터 (초기값)
  const [originalSettings, setOriginalSettings] = useState<ChatbotSettings>({
    llmModel: (agent as any).llmModel || "gpt-4o",
    chatbotType: (agent as any).chatbotType || "general-llm",
    visibility: (agent as any).visibility || "public",
    upperCategory: (agent as any).upperCategory || "",
    lowerCategory: (agent as any).lowerCategory || "",
    detailCategory: (agent as any).detailCategory || "",
    webSearchEnabled: (agent as any).webSearchEnabled || false,
    searchEngine: (agent as any).searchEngine || "bing",
    bingApiKey: (agent as any).bingApiKey || ""
  });
  
  // Initialize settings first
  const [settings, setSettings] = useState<ChatbotSettings>({
    llmModel: (agent as any).llmModel || "gpt-4o",
    chatbotType: (agent as any).chatbotType || "general-llm",
    visibility: (agent as any).visibility || "public",
    upperCategory: (agent as any).upperCategory || "",
    lowerCategory: (agent as any).lowerCategory || "",
    detailCategory: (agent as any).detailCategory || "",
    webSearchEnabled: (agent as any).webSearchEnabled || false,
    searchEngine: (agent as any).searchEngine || "bing",
    bingApiKey: (agent as any).bingApiKey || ""
  });

  // 변경사항 감지
  const hasChanges = useFormChanges(settings, originalSettings);

  // Update settings when agent changes
  useEffect(() => {
    const newSettings = {
      llmModel: (agent as any).llmModel || "gpt-4o",
      chatbotType: (agent as any).chatbotType || "general-llm",
      visibility: (agent as any).visibility || "public",
      upperCategory: (agent as any).upperCategory || "",
      lowerCategory: (agent as any).lowerCategory || "",
      detailCategory: (agent as any).detailCategory || "",
      webSearchEnabled: (agent as any).webSearchEnabled || false,
      searchEngine: (agent as any).searchEngine || "bing",
      bingApiKey: (agent as any).bingApiKey || ""
    };
    
    setOriginalSettings(newSettings);
    setSettings(newSettings);
  }, [agent]);

  // Fetch organization categories
  const { data: organizationCategories = [], isLoading: isLoadingOrgs } = useQuery({
    queryKey: ["/api/organization-categories"],
    enabled: isOpen,
  });

  // State for selected users (moved before the query that uses them)
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [userUpperCategory, setUserUpperCategory] = useState("");
  const [userLowerCategory, setUserLowerCategory] = useState("");
  const [userDetailCategory, setUserDetailCategory] = useState("");

  // Fetch users for user selection using search API with category filters
  const { data: users = [], isLoading: isLoadingUsers } = useQuery({
    queryKey: ["/api/users/search", userUpperCategory, userLowerCategory, userDetailCategory],
    enabled: isOpen && settings.visibility === "user",
    queryFn: () => {
      const params = new URLSearchParams();
      if (userUpperCategory && userUpperCategory !== "all") params.append("upperCategory", userUpperCategory);
      if (userLowerCategory && userLowerCategory !== "all") params.append("lowerCategory", userLowerCategory);
      if (userDetailCategory && userDetailCategory !== "all") params.append("detailCategory", userDetailCategory);
      
      return fetch(`/api/users/search?${params.toString()}`).then(res => res.json());
    }
  });

  // Get unique upper categories
  const getUpperCategories = () => {
    if (!organizationCategories || !Array.isArray(organizationCategories)) return [];
    const upperCats = organizationCategories.map((org: any) => org.upperCategory).filter(Boolean);
    const uniqueSet = new Set(upperCats);
    const result: string[] = [];
    uniqueSet.forEach(cat => result.push(cat));
    return result;
  };

  // Get lower categories for selected upper category
  const getLowerCategories = (upperCategory: string) => {
    if (!upperCategory || !organizationCategories || !Array.isArray(organizationCategories)) return [];
    const lowerCats = organizationCategories
      .filter((org: any) => org.upperCategory === upperCategory)
      .map((org: any) => org.lowerCategory)
      .filter(Boolean);
    const uniqueSet = new Set(lowerCats);
    const result: string[] = [];
    uniqueSet.forEach(cat => result.push(cat));
    return result;
  };

  // Get detail categories for selected upper and lower categories
  const getDetailCategories = (upperCategory: string, lowerCategory: string) => {
    if (!upperCategory || !lowerCategory || !organizationCategories || !Array.isArray(organizationCategories)) return [];
    const detailCats = organizationCategories
      .filter((org: any) => org.upperCategory === upperCategory && org.lowerCategory === lowerCategory)
      .map((org: any) => org.detailCategory)
      .filter(Boolean);
    const uniqueSet = new Set(detailCats);
    const result: string[] = [];
    uniqueSet.forEach(cat => result.push(cat));
    return result;
  };



  // Filter users based on search and category
  const filteredUsers = users.filter((user: any) => {
    // Search filter
    const matchesSearch = !userSearch || 
      user.name?.toLowerCase().includes(userSearch.toLowerCase()) ||
      user.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
      user.email?.toLowerCase().includes(userSearch.toLowerCase());
    
    // Category filters - empty string, "all", or undefined means show all
    const matchesUpperCategory = !userUpperCategory || userUpperCategory === "all" || 
      user.upperCategory === userUpperCategory;
    
    const matchesLowerCategory = !userLowerCategory || userLowerCategory === "all" || 
      user.lowerCategory === userLowerCategory;
    
    const matchesDetailCategory = !userDetailCategory || userDetailCategory === "all" || 
      user.detailCategory === userDetailCategory;
    
    const allMatches = matchesSearch && matchesUpperCategory && matchesLowerCategory && matchesDetailCategory;
    
    // Debug logging - show results when filters are applied
    if ((userUpperCategory && userUpperCategory !== "all") || 
        (userLowerCategory && userLowerCategory !== "all") || 
        (userDetailCategory && userDetailCategory !== "all") ||
        userSearch ||
        allMatches) {
      console.log('🔍 사용자 필터링:', user.name || user.username, {
        필터조건: { 
          상위조직: userUpperCategory || '전체', 
          하위조직: userLowerCategory || '전체', 
          세부조직: userDetailCategory || '전체',
          검색어: userSearch || '없음'
        },
        사용자조직: { 
          상위: user.upperCategory || '없음', 
          하위: user.lowerCategory || '없음', 
          세부: user.detailCategory || '없음' 
        },
        매칭결과: { 
          검색: matchesSearch, 
          상위: matchesUpperCategory, 
          하위: matchesLowerCategory, 
          세부: matchesDetailCategory 
        },
        최종결과: allMatches ? '✅ 포함' : '❌ 제외'
      });
    }
    
    return allMatches;
  });

  // Debug logging after filteredUsers is defined
  console.log("Organization categories loaded:", organizationCategories, "isLoading:", isLoadingOrgs);
  console.log("Upper categories:", getUpperCategories());
  console.log("Users data:", users, "isLoading:", isLoadingUsers, "visibility:", settings.visibility);
  console.log("Filtered users count:", users.length, "->", filteredUsers?.length || 0);
  
  // Refetch users when category selection changes
  const { refetch: refetchUsers } = useQuery({
    queryKey: ["/api/users/search", userUpperCategory, userLowerCategory, userDetailCategory],
    enabled: false, // Don't auto-fetch, only on demand
  });
  
  // Auto-refetch when user category filters change
  useEffect(() => {
    if (isOpen && settings.visibility === "user") {
      refetchUsers();
    }
  }, [userUpperCategory, userLowerCategory, userDetailCategory, settings.visibility, isOpen, refetchUsers]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: ChatbotSettings) => {
      const requestData = {
        ...data,
        selectedUsers: settings.visibility === 'user' ? selectedUsers : undefined
      };
      const response = await apiRequest("PATCH", `/api/agents/${agent.id}/settings`, requestData);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "챗봇 설정 업데이트 완료",
        description: "챗봇 설정이 성공적으로 업데이트되었습니다.",
      });
      
      // Send completion message to chat
      if (onSuccess) {
        const modelLabel = LLM_MODELS.find(m => m.value === settings.llmModel)?.label || settings.llmModel;
        const typeLabel = CHATBOT_TYPES.find(t => t.value === settings.chatbotType)?.label || settings.chatbotType;
        const visibilityLabel = VISIBILITY_OPTIONS.find(v => v.value === settings.visibility)?.label || settings.visibility;
        
        let message = `챗봇 설정이 저장되었습니다.\n\nLLM 모델: ${modelLabel}\n챗봇 유형: ${typeLabel}\n공유 범위: ${visibilityLabel}`;
        
        // 웹 검색 설정 정보 추가
        if (settings.chatbotType === "llm-with-web-search") {
          message += `\n웹 검색 사용: ${settings.webSearchEnabled ? '활성화' : '비활성화'}`;
          if (settings.webSearchEnabled && settings.searchEngine) {
            message += `\n검색 엔진: ${settings.searchEngine === 'bing' ? 'Bing Search API' : settings.searchEngine}`;
          }
        }
        
        if (settings.visibility === 'group' && settings.upperCategory) {
          message += `\n조직: ${settings.upperCategory}`;
          if (settings.lowerCategory) {
            message += ` > ${settings.lowerCategory}`;
          }
          if (settings.detailCategory) {
            message += ` > ${settings.detailCategory}`;
          }
        }
        
        if (settings.visibility === 'user' && selectedUsers.length > 0) {
          message += `\n선택된 사용자: ${selectedUsers.length}명`;
        }
        
        onSuccess(message);
      }
      
      // Invalidate agent data to refresh
      queryClient.invalidateQueries({
        queryKey: [`/api/agents/${agent.id}`]
      });
      
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "설정 업데이트 실패",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettingsMutation.mutate(settings);
  };

  const handleClose = () => {
    if (onCancel) {
      onCancel("챗봇 설정 변경을 취소하였습니다.");
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center space-x-3">
            <Settings className="w-5 h-5 text-black dark:text-white" />
            <h2 className="text-lg font-medium korean-text">모델 및 응답 설정</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Current Settings Info */}
          <div className="bg-gray-50 p-4 rounded-lg space-y-2">
            <h3 className="font-medium korean-text text-sm">현재 설정</h3>
            <div className="text-sm text-gray-600 korean-text">
              <p>LLM 모델: {LLM_MODELS.find(m => m.value === settings.llmModel)?.label}</p>
              <p>응답 생성 방식: {CHATBOT_TYPES.find(t => t.value === settings.chatbotType)?.label}</p>

            </div>
          </div>

          {/* LLM Model Selection */}
          <div className="space-y-2">
            <Label htmlFor="llmModel" className="korean-text">LLM 모델 </Label>
            <Select
              value={settings.llmModel}
              onValueChange={(value) => setSettings(prev => ({ ...prev, llmModel: value }))}
            >
              <SelectTrigger className="korean-text">
                <SelectValue placeholder="LLM 모델을 선택하세요" />
              </SelectTrigger>
              <SelectContent className="z-[10000]">
                {LLM_MODELS.map((model) => (
                  <SelectItem key={model.value} value={model.value} className="korean-text">
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Chatbot Type Selection */}
          <div className="space-y-2">
            <Label htmlFor="chatbotType" className="korean-text">응답 생성 방식 </Label>
            <Select
              value={settings.chatbotType}
              onValueChange={(value) => setSettings(prev => ({ ...prev, chatbotType: value }))}
            >
              <SelectTrigger className="korean-text">
                <SelectValue placeholder="챗봇 유형을 선택하세요" />
              </SelectTrigger>
              <SelectContent className="z-[10000]">
                {CHATBOT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value} className="korean-text">
                    <div>
                      <div className="font-medium">{type.label}</div>
                      <div className="text-xs text-gray-500">{type.description}</div>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Web Search Settings - 조건부 표시 */}
          {settings.chatbotType === "llm-with-web-search" && (
            <div className="space-y-4 border-t pt-4">
              <h3 className="text-sm font-medium korean-text">웹 검색 설정</h3>
              
              {/* Web Search Toggle */}
              <div className="flex items-center justify-between">
                <Label htmlFor="webSearchEnabled" className="korean-text">웹 검색 사용</Label>
                <input
                  type="checkbox"
                  id="webSearchEnabled"
                  checked={settings.webSearchEnabled}
                  onChange={(e) => setSettings(prev => ({ ...prev, webSearchEnabled: e.target.checked }))}
                  className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
              </div>

              {/* Search Engine Selection */}
              {settings.webSearchEnabled && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="searchEngine" className="korean-text">검색 엔진</Label>
                    <Select
                      value={settings.searchEngine}
                      onValueChange={(value) => setSettings(prev => ({ ...prev, searchEngine: value }))}
                    >
                      <SelectTrigger className="korean-text">
                        <SelectValue placeholder="검색 엔진을 선택하세요" />
                      </SelectTrigger>
                      <SelectContent className="z-[10000]">
                        <SelectItem value="bing" className="korean-text">Bing Search API</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Bing API Key Input */}
                  {settings.searchEngine === "bing" && (
                    <div className="space-y-2">
                      <Label htmlFor="bingApiKey" className="korean-text">Bing API 키</Label>
                      <input
                        type="password"
                        id="bingApiKey"
                        value={settings.bingApiKey}
                        onChange={(e) => setSettings(prev => ({ ...prev, bingApiKey: e.target.value }))}
                        placeholder="Bing Search API 키를 입력하세요"
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 korean-text"
                      />
                      
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="flex-1 korean-text"
            >
              취소
            </Button>
            <Button
              type="submit"
              disabled={updateSettingsMutation.isPending || !hasChanges}
              className="flex-1 korean-text"
            >
              {updateSettingsMutation.isPending ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>저장 중...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Save className="w-4 h-4" />
                  <span>설정 저장</span>
                </div>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}