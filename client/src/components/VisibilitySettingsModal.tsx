import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Globe, X, Save, Eye, EyeOff } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useFormChanges } from "@/hooks/useFormChanges";

interface VisibilitySettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: any;
}

const VisibilitySettingsModal = ({ isOpen, onClose, agent }: VisibilitySettingsModalProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // 원본 데이터 (초기값)
  const [originalData, setOriginalData] = useState({
    visibility: agent?.visibility || "public",
    isVisible: agent?.isActive !== false,
    selectedUpperCategory: agent?.upperCategory || "",
    selectedLowerCategory: agent?.lowerCategory || "",
    selectedDetailCategory: agent?.detailCategory || ""
  });
  
  const [visibility, setVisibility] = useState<"public" | "group">("public");
  const [isVisible, setIsVisible] = useState(true);
  const [selectedUpperCategory, setSelectedUpperCategory] = useState("");
  const [selectedLowerCategory, setSelectedLowerCategory] = useState("");
  const [selectedDetailCategory, setSelectedDetailCategory] = useState("");

  // 현재 상태 객체 (변경사항 감지용)
  const currentData = {
    visibility,
    isVisible,
    selectedUpperCategory,
    selectedLowerCategory,
    selectedDetailCategory
  };

  // 변경사항 감지
  const hasChanges = useFormChanges(currentData, originalData);

  // Fetch current user data
  const { data: user } = useQuery({
    queryKey: ["/api/user"],
  });

  // Fetch organization categories
  const { data: organizationCategories = [] } = useQuery({
    queryKey: ["/api/organization-categories"],
  });

  // Check if user is master admin or agent admin
  const isMasterAdmin = (user as any)?.role === 'master_admin' || (user as any)?.systemRole === 'master_admin';
  const isAgentAdmin = (user as any)?.role === 'agent_admin' || isMasterAdmin;
  const canEditVisibility = isAgentAdmin;

  // Initialize settings from agent data
  useEffect(() => {
    if (agent) {
      const newOriginalData = {
        visibility: agent.visibility || "public",
        isVisible: agent.isActive !== false,
        selectedUpperCategory: agent.upperCategory || "",
        selectedLowerCategory: agent.lowerCategory || "",
        selectedDetailCategory: agent.detailCategory || ""
      };
      
      setOriginalData(newOriginalData);
      setVisibility(agent.visibility || "public");
      setIsVisible(agent.isActive !== false);
      setSelectedUpperCategory(agent.upperCategory || "");
      setSelectedLowerCategory(agent.lowerCategory || "");
      setSelectedDetailCategory(agent.detailCategory || "");
    }
  }, [agent]);

  // Helper functions for category filtering
  const getUpperCategories = () => {
    const categories = Array.from(new Set((organizationCategories as any[]).map((org: any) => org.upperCategory)));
    return categories.filter(Boolean);
  };

  const getLowerCategories = (upperCategory: string) => {
    if (!upperCategory) return [];
    const categories = (organizationCategories as any[])
      .filter((org: any) => org.upperCategory === upperCategory)
      .map((org: any) => org.lowerCategory);
    return Array.from(new Set(categories)).filter(Boolean);
  };

  const getDetailCategories = (upperCategory: string, lowerCategory: string) => {
    if (!upperCategory || !lowerCategory) return [];
    const categories = (organizationCategories as any[])
      .filter((org: any) => 
        org.upperCategory === upperCategory && 
        org.lowerCategory === lowerCategory
      )
      .map((org: any) => org.detailCategory);
    return Array.from(new Set(categories)).filter(Boolean);
  };

  // Update visibility settings mutation
  const updateVisibilityMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch(`/api/agents/${agent.id}/visibility`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to update visibility settings');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/agents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/agents/managed'] });
      toast({
        title: "공개 설정 변경 완료",
        description: "에이전트 공개 설정이 성공적으로 변경되었습니다.",
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "공개 설정 변경 실패",
        description: "설정 변경 중 오류가 발생했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const visibilityData = {
      visibility,
      isActive: isVisible,
      upperCategory: visibility === "group" ? selectedUpperCategory : "",
      lowerCategory: visibility === "group" ? selectedLowerCategory : "",
      detailCategory: visibility === "group" ? selectedDetailCategory : "",
    };

    updateVisibilityMutation.mutate(visibilityData);
  };

  const handleClose = () => {
    if (!updateVisibilityMutation.isPending) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-3 border-b">
          <div className="flex items-center space-x-3">
            <Globe className="w-5 h-5 text-gray-900" />
            <h2 className="text-lg font-medium korean-text">공개 설정</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Agent Organization Info */}
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h3 className="font-medium korean-text text-sm mb-3">에이전트 소속 조직</h3>
              <div className="px-4 py-3 bg-white border border-green-300 rounded-md korean-text text-gray-900 font-medium">
                {(user as any)?.upperCategory || "인문대학"} &gt; {(user as any)?.lowerCategory || "국어국문학과"} &gt; {(user as any)?.detailCategory || "현대 문학 전공"}
              </div>
            </div>

            {/* Non-Admin Info Message */}
            {!canEditVisibility && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                <div className="flex items-start space-x-2">
                  <Globe className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-medium korean-text text-sm mb-1">공개 설정 안내</h4>
                    <p className="text-sm text-gray-600 korean-text">
                      공개 범위 설정은 에이전트 관리자만 변경할 수 있습니다. 
                      현재는 조회만 가능합니다.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Agent Sharing Target */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h3 className="font-medium korean-text text-sm mb-3">에이전트 공유 대상</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 korean-text">공개 범위:</span>
                  <span className="text-sm font-medium korean-text">
                    {visibility === "public" ? "조직 전체" : "특정 그룹"}
                  </span>
                </div>
                {visibility === "group" && selectedUpperCategory && (
                  <div className="space-y-2">
                    <span className="text-sm text-gray-600 korean-text">공개 대상:</span>
                    <div className="px-4 py-3 bg-white border border-green-300 rounded-md korean-text text-gray-900 font-medium">
                      {selectedUpperCategory}
                      {selectedLowerCategory && ` > ${selectedLowerCategory}`}
                      {selectedDetailCategory && ` > ${selectedDetailCategory}`}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Visibility Scope - For Agent Admin and Master Admin */}
            {canEditVisibility && (
              <div className="space-y-2">
                <Label className="korean-text">공개 범위</Label>
                <Select
                  value={visibility}
                  onValueChange={(value: "public" | "group") => {
                    setVisibility(value);
                    if (value === "public") {
                      setSelectedUpperCategory("");
                      setSelectedLowerCategory("");
                      setSelectedDetailCategory("");
                    }
                  }}
                >
                  <SelectTrigger className="korean-text">
                    <SelectValue placeholder="공개 범위를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="z-[10000]">
                    <SelectItem value="public" className="korean-text">
                      조직 전체 - 모든 구성원이 사용 가능
                    </SelectItem>
                    <SelectItem value="group" className="korean-text">
                      특정 그룹 - 선택한 조직의 구성원만 사용 가능
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}



            {/* Group Category Selection - For Agent Admin and Master Admin */}
            {canEditVisibility && visibility === 'group' && (
              <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                <h4 className="font-medium korean-text text-sm">공개 대상 조직 선택</h4>
                <div className="grid grid-cols-1 gap-4">
                  {/* Upper Category */}
                  <div className="space-y-2">
                    <Label className="korean-text text-sm">상위 조직 *</Label>
                    <Select
                      value={selectedUpperCategory}
                      onValueChange={(value) => {
                        setSelectedUpperCategory(value);
                        setSelectedLowerCategory("");
                        setSelectedDetailCategory("");
                      }}
                    >
                      <SelectTrigger className="korean-text">
                        <SelectValue placeholder="상위 조직을 선택하세요" />
                      </SelectTrigger>
                      <SelectContent className="z-[10000]">
                        {getUpperCategories().map((category) => (
                          <SelectItem key={category} value={category} className="korean-text">
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Lower Category */}
                  <div className="space-y-2">
                    <Label className="korean-text text-sm">하위 조직</Label>
                    <Select
                      value={selectedLowerCategory}
                      onValueChange={(value) => {
                        setSelectedLowerCategory(value);
                        setSelectedDetailCategory("");
                      }}
                      disabled={!selectedUpperCategory}
                    >
                      <SelectTrigger className="korean-text">
                        <SelectValue placeholder="하위 조직을 선택하세요" />
                      </SelectTrigger>
                      <SelectContent className="z-[10000]">
                        <SelectItem value="" className="korean-text">전체</SelectItem>
                        {getLowerCategories(selectedUpperCategory).map((category) => (
                          <SelectItem key={category} value={category} className="korean-text">
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Detail Category */}
                  <div className="space-y-2">
                    <Label className="korean-text text-sm">세부 조직</Label>
                    <Select
                      value={selectedDetailCategory}
                      onValueChange={setSelectedDetailCategory}
                      disabled={!selectedUpperCategory || !selectedLowerCategory}
                    >
                      <SelectTrigger className="korean-text">
                        <SelectValue placeholder="세부 조직을 선택하세요" />
                      </SelectTrigger>
                      <SelectContent className="z-[10000]">
                        <SelectItem value="" className="korean-text">전체</SelectItem>
                        {getDetailCategories(selectedUpperCategory, selectedLowerCategory).map((category) => (
                          <SelectItem key={category} value={category} className="korean-text">
                            {category}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {selectedUpperCategory && (
                  <div className="mt-4 p-3 bg-white rounded border">
                    <p className="text-sm font-medium korean-text text-gray-700">공개 대상:</p>
                    <p className="text-sm korean-text text-blue-600">
                      {selectedUpperCategory}
                      {selectedLowerCategory && ` > ${selectedLowerCategory}`}
                      {selectedDetailCategory && ` > ${selectedDetailCategory}`}
                      {!selectedLowerCategory && " (전체 하위 조직)"}
                      {selectedLowerCategory && !selectedDetailCategory && " (전체 세부 조직)"}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Visibility Status */}
            <div className="space-y-4">
              <Label className="korean-text font-medium">공개 여부</Label>
              <div className="flex items-center justify-between p-4 border rounded-lg bg-gray-50">
                <div className="flex items-center space-x-3">
                  {isVisible ? (
                    <Eye className="w-5 h-5 text-green-600" />
                  ) : (
                    <EyeOff className="w-5 h-5 text-red-600" />
                  )}
                  <span className={`korean-text font-medium ${
                    isVisible ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {isVisible ? '공개' : '비공개'}
                  </span>
                </div>
                <Switch
                  checked={isVisible}
                  onCheckedChange={setIsVisible}
                  className="data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-red-400"
                />
              </div>
            </div>

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
                disabled={!canEditVisibility || updateVisibilityMutation.isPending || !hasChanges || (canEditVisibility && visibility === "group" && !selectedUpperCategory)}
                className="flex-1 korean-text"
                title={!canEditVisibility ? "에이전트 관리자만 설정을 변경할 수 있습니다" : ""}
              >
                {updateVisibilityMutation.isPending ? (
                  <div className="flex items-center space-x-2">
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>저장 중...</span>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2">
                    <Save className="w-4 h-4" />
                    <span>{canEditVisibility ? "설정 저장" : "조회 전용"}</span>
                  </div>
                )}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default VisibilitySettingsModal;