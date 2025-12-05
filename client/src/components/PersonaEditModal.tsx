import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { X, Save, User, Lock, Smile } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useFormChanges } from "@/hooks/useFormChanges";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import type { Agent } from "@/types/agent";

interface PersonaEditModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
  onCancel?: (message: string) => void;
}

interface PersonaData {
  nickname: string;
  speechStyle: string;
  knowledgeArea: string;
  personality: string;
  additionalPrompt: string;
  extraPrompt: string;
  canonProfileId: number | null;
  toneProfileId: number | null;
}

interface CanonSettings {
  enabled: boolean;
  sources: number[];
}

interface HumorSettings {
  enabled: boolean;
  maxHumorTokens: number;
  stageDirectionMode: "auto" | "always" | "never";
  styles: string[];
}

export default function PersonaEditModal({ agent, isOpen, onClose, onSuccess, onCancel }: PersonaEditModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // 원본 데이터 (초기값)
  const [originalData, setOriginalData] = useState<PersonaData>({
    nickname: agent.name || "",
    speechStyle: agent.speechStyle || "친근하고 도움이 되는 말투",
    knowledgeArea: agent.description || "",
    personality: agent.personality || "친절하고 전문적인 성격으로 정확한 정보를 제공",
    additionalPrompt: agent.additionalPrompt || "",
    extraPrompt: agent.extraPrompt || "",
    canonProfileId: (agent as any).canonProfileId || null,
    toneProfileId: (agent as any).toneProfileId || null
  });
  
  const [personaData, setPersonaData] = useState<PersonaData>({
    nickname: agent.name || "",
    speechStyle: agent.speechStyle || "친근하고 도움이 되는 말투",
    knowledgeArea: agent.description || "",
    personality: agent.personality || "친절하고 전문적인 성격으로 정확한 정보를 제공",
    additionalPrompt: agent.additionalPrompt || "",
    extraPrompt: agent.extraPrompt || "",
    canonProfileId: (agent as any).canonProfileId || null,
    toneProfileId: (agent as any).toneProfileId || null
  });

  // Canon Lock 설정
  const [canonSettings, setCanonSettings] = useState<CanonSettings>({
    enabled: false,
    sources: []
  });
  
  const [originalCanon, setOriginalCanon] = useState<CanonSettings>({
    enabled: false,
    sources: []
  });

  // Humor 설정
  const [humorSettings, setHumorSettings] = useState<HumorSettings>({
    enabled: false,
    maxHumorTokens: 100,
    stageDirectionMode: "auto",
    styles: ["wit", "reaction"]
  });
  
  const [originalHumor, setOriginalHumor] = useState<HumorSettings>({
    enabled: false,
    maxHumorTokens: 100,
    stageDirectionMode: "auto",
    styles: ["wit", "reaction"]
  });

  // 변경사항 감지
  const hasPersonaChanges = useFormChanges(personaData, originalData);
  const hasCanonChanges = useFormChanges(canonSettings, originalCanon);
  const hasHumorChanges = useFormChanges(humorSettings, originalHumor);
  const hasChanges = hasPersonaChanges || hasCanonChanges || hasHumorChanges;

  // Canon Lock 설정 조회
  const { data: canonData } = useQuery<CanonSettings>({
    queryKey: ["/api/agents", agent.id, "canon"],
    enabled: isOpen
  });

  // Humor 설정 조회
  const { data: humorData } = useQuery<HumorSettings>({
    queryKey: ["/api/agents", agent.id, "humor"],
    enabled: isOpen
  });

  // 문서 목록 조회 (Canon Lock sources용)
  const { data: documents } = useQuery<any[]>({
    queryKey: ["/api/agents", agent.id, "documents"],
    enabled: isOpen
  });

  // Canon/Tone Profile 목록 조회
  const { data: canonProfiles } = useQuery<any[]>({
    queryKey: ["/api/canon-profiles"],
    enabled: isOpen
  });

  const { data: toneProfiles } = useQuery<any[]>({
    queryKey: ["/api/tone-profiles"],
    enabled: isOpen
  });

  // Update form data when agent changes
  useEffect(() => {
    const newData = {
      nickname: agent.name || "",
      speechStyle: agent.speechStyle || "친근하고 도움이 되는 말투",
      knowledgeArea: agent.description || "",
      personality: agent.personality || "친절하고 전문적인 성격으로 정확한 정보를 제공",
      additionalPrompt: agent.additionalPrompt || "",
      extraPrompt: agent.extraPrompt || "",
      canonProfileId: (agent as any).canonProfileId || null,
      toneProfileId: (agent as any).toneProfileId || null
    };
    
    setOriginalData(newData);
    setPersonaData(newData);
  }, [agent]);

  // Update Canon settings when loaded
  useEffect(() => {
    if (canonData) {
      const newCanon = {
        enabled: canonData.enabled || false,
        sources: canonData.sources || []
      };
      setCanonSettings(newCanon);
      setOriginalCanon(newCanon);
    }
  }, [canonData]);

  // Update Humor settings when loaded
  useEffect(() => {
    if (humorData) {
      const newHumor = {
        enabled: humorData.enabled || false,
        maxHumorTokens: humorData.maxHumorTokens || 100,
        stageDirectionMode: humorData.stageDirectionMode || "auto",
        styles: humorData.styles || ["wit", "reaction"]
      };
      setHumorSettings(newHumor);
      setOriginalHumor(newHumor);
    }
  }, [humorData]);

  const updatePersonaMutation = useMutation({
    mutationFn: async (data: PersonaData) => {
      const response = await apiRequest("PUT", `/api/agents/${agent.id}/persona`, data);
      return response.json();
    },
    onSuccess: (updatedAgent) => {
      toast({
        title: "페르소나 업데이트 완료",
        description: "에이전트 페르소나가 성공적으로 업데이트되었습니다.",
      });
      
      // Send completion message to chat
      if (onSuccess) {
        const changes = [];
        if (personaData.nickname !== agent.name) changes.push(`닉네임: ${personaData.nickname}`);
        if (personaData.knowledgeArea !== agent.description) changes.push(`지식 분야: ${personaData.knowledgeArea}`);
        if (personaData.speechStyle !== agent.speechStyle) changes.push(`말투 스타일: ${personaData.speechStyle}`);
        
        const changeText = changes.length > 0 ? changes.join(', ') + ' 변경됨. ' : '';
        onSuccess(`${changeText}페르소나 설정이 저장되었습니다.`);
      }
      
      // Immediately update the cache with the fresh data from server
      queryClient.setQueryData(["/api/agents"], (oldAgents: Agent[] | undefined) => {
        if (!oldAgents) return oldAgents;
        return oldAgents.map(a => 
          a.id === agent.id ? updatedAgent : a
        );
      });
      
      // Force a fresh fetch to ensure consistency
      queryClient.invalidateQueries({
        queryKey: ["/api/agents"]
      });
      
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "업데이트 실패",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCanonMutation = useMutation({
    mutationFn: async (data: CanonSettings) => {
      const response = await apiRequest("PUT", `/api/agents/${agent.id}/canon`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Canon Lock 설정 저장 완료",
        description: "RAG 검색 범위가 업데이트되었습니다.",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/agents", agent.id, "canon"]
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Canon Lock 저장 실패",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateHumorMutation = useMutation({
    mutationFn: async (data: HumorSettings) => {
      const response = await apiRequest("PUT", `/api/agents/${agent.id}/humor`, data);
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Humor 설정 저장 완료",
        description: "응답 스타일이 업데이트되었습니다.",
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/agents", agent.id, "humor"]
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Humor 저장 실패",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // 변경사항이 있는 항목만 업데이트
    const promises = [];
    
    if (hasPersonaChanges) {
      promises.push(updatePersonaMutation.mutateAsync(personaData));
    }
    
    if (hasCanonChanges) {
      promises.push(updateCanonMutation.mutateAsync(canonSettings));
    }
    
    if (hasHumorChanges) {
      promises.push(updateHumorMutation.mutateAsync(humorSettings));
    }
    
    // 모든 변경사항 저장
    try {
      await Promise.all(promises);
      if (hasPersonaChanges) {
        onClose();
      }
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

  const handleInputChange = (field: keyof PersonaData, value: string) => {
    setPersonaData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleClose = () => {
    if (onCancel) {
      onCancel("페르소나 편집을 취소하였습니다.");
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={handleClose}>
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[90vh] md:max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header - 고정, 높이 50% 줄임 */}
        <div className="flex items-center justify-between p-3 border-b bg-white rounded-t-2xl flex-shrink-0">
          <div className="flex items-center space-x-2 pl-6">
            <User className="w-5 h-5 text-black dark:text-white" />
            <h2 className="text-lg font-medium korean-text">페르소나 설정</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose}>
            <X className="w-10 h-10" />
          </Button>
        </div>

        {/* Content - 스크롤 가능 */}
        <div className="flex-1 overflow-y-auto">
          <form onSubmit={handleSubmit} className="p-6 space-y-6" id="persona-form">
          {/* Nickname */}
          <div className="space-y-2">
            <Label htmlFor="nickname" className="korean-text">닉네임</Label>
            <Input
              id="nickname"
              value={personaData.nickname}
              onChange={(e) => handleInputChange('nickname', e.target.value)}
              placeholder="예: 민지, 도우미, 상담봇"
              className="korean-text"
            />
          </div>

          {/* Speech Style */}
          <div className="space-y-2">
            <Label htmlFor="speechStyle" className="korean-text">말투 스타일</Label>
            <Textarea
              id="speechStyle"
              value={personaData.speechStyle}
              onChange={(e) => handleInputChange('speechStyle', e.target.value)}
              placeholder="예: 친구처럼 편안한 말투로 말해주세요."
              className="korean-text resize-none"
              rows={3}
            />
          </div>

          {/* Knowledge Area */}
          <div className="space-y-2">
            <Label htmlFor="knowledgeArea" className="korean-text">역할/ 지식/ 전문 분야</Label>
            <Textarea
              id="knowledgeArea"
              value={personaData.knowledgeArea}
              onChange={(e) => handleInputChange('knowledgeArea', e.target.value)}
              placeholder="예: 입학상담, 진로코칭, 프로그래밍, 영어 에세이 등"
              className="korean-text resize-none"
              rows={3}
            />
          </div>

          {/* Canon Profile 선택 */}
          <div className="space-y-2">
            <Label htmlFor="canonProfile" className="korean-text">
              Canon Profile (역할 및 책임 - 무엇을 말할지)
            </Label>
            <Select
              value={personaData.canonProfileId?.toString() || "none"}
              onValueChange={(value) => {
                setPersonaData(prev => ({
                  ...prev,
                  canonProfileId: value === "none" ? null : parseInt(value)
                }));
              }}
            >
              <SelectTrigger className="korean-text" data-testid="select-canon-profile">
                <SelectValue placeholder="Canon Profile 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">기본 설정 (Profile 미사용)</SelectItem>
                {canonProfiles?.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id.toString()}>
                    {profile.name} - {profile.description || profile.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Tone Profile 선택 */}
          <div className="space-y-2">
            <Label htmlFor="toneProfile" className="korean-text">
              Tone Profile (말투 및 스타일 - 어떻게 말할지)
            </Label>
            <Select
              value={personaData.toneProfileId?.toString() || "none"}
              onValueChange={(value) => {
                setPersonaData(prev => ({
                  ...prev,
                  toneProfileId: value === "none" ? null : parseInt(value)
                }));
              }}
            >
              <SelectTrigger className="korean-text" data-testid="select-tone-profile">
                <SelectValue placeholder="Tone Profile 선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">기본 설정 (Profile 미사용)</SelectItem>
                {toneProfiles?.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id.toString()}>
                    {profile.name} - {profile.description || `강도: ${profile.intensity}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Personality */}
          <div className="space-y-2">
            <Label htmlFor="personality" className="korean-text">성격 특성</Label>
            <Textarea
              id="personality"
              value={personaData.personality}
              onChange={(e) => handleInputChange('personality', e.target.value)}
              placeholder="예: 친절하고 인내심 있는 성격, 논리적인 사고, 유머감각 있음 등"
              className="korean-text resize-none"
              rows={3}
            />
          </div>

          {/* Additional Prompt */}
          <div className="space-y-2">
            <Label htmlFor="additionalPrompt" className="korean-text">추가 프롬프트</Label>
            <Textarea
              id="additionalPrompt"
              value={personaData.additionalPrompt}
              onChange={(e) => handleInputChange('additionalPrompt', e.target.value)}
              placeholder="예: 간단하고 정중한 말투로, 최대 5줄 이내 요약&#10;예: 숫자와 항목이 있는 리스트 형식으로 대답&#10;예: 감정적인 질문에는 공감 표현을 포함"
              className="korean-text resize-none"
              rows={3}
            />
          </div>

          {/* Extra Prompt */}
          <div className="space-y-2">
            <Label htmlFor="extraPrompt" className="korean-text">추가 프롬프트</Label>
            <Textarea
              id="extraPrompt"
              value={personaData.extraPrompt}
              onChange={(e) => handleInputChange('extraPrompt', e.target.value)}
              placeholder="예: 간단하고 정중한 말투로, 최대 5줄 이내 요약&#10;예: 숫자와 항목이 있는 리스트 형식으로 대답&#10;예: 감정적인 질문에는 공감 표현을 포함"
              className="korean-text resize-none"
              rows={4}
            />
          </div>

          {/* 고급 설정: 토큰 최적화 */}
          <Accordion type="single" collapsible className="border rounded-lg">
            <AccordionItem value="token-optimization">
              <AccordionTrigger className="px-4 korean-text">
                🎯 고급 설정 (토큰 최적화)
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 space-y-6">
                
                {/* Canon Lock 섹션 */}
                <div className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Lock className="w-4 h-4" />
                      <Label className="korean-text font-semibold">Canon Lock (RAG 검색 범위 제한)</Label>
                    </div>
                    <Switch
                      checked={canonSettings.enabled}
                      onCheckedChange={(checked) => setCanonSettings(prev => ({ ...prev, enabled: checked }))}
                      data-testid="switch-canon-enabled"
                    />
                  </div>
                  
                  {canonSettings.enabled && (
                    <div className="space-y-2">
                      <Label className="korean-text text-sm">검색할 문서 선택:</Label>
                      {documents && documents.length > 0 ? (
                        <div className="space-y-2 max-h-40 overflow-y-auto border rounded p-2">
                          {documents.map((doc: any) => (
                            <div key={doc.id} className="flex items-center space-x-2">
                              <Checkbox
                                id={`doc-${doc.id}`}
                                checked={canonSettings.sources.includes(doc.id)}
                                onCheckedChange={(checked) => {
                                  setCanonSettings(prev => ({
                                    ...prev,
                                    sources: checked
                                      ? [...prev.sources, doc.id]
                                      : prev.sources.filter(id => id !== doc.id)
                                  }));
                                }}
                                data-testid={`checkbox-canon-doc-${doc.id}`}
                              />
                              <label htmlFor={`doc-${doc.id}`} className="korean-text text-sm cursor-pointer">
                                {doc.title || doc.originalFilename}
                              </label>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="korean-text text-sm text-gray-500">문서가 없습니다. 먼저 문서를 업로드하세요.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Humor Settings 섹션 */}
                <div className="space-y-4 p-4 border rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Smile className="w-4 h-4" />
                      <Label className="korean-text font-semibold">Humor 설정 (응답 길이 제어)</Label>
                    </div>
                    <Switch
                      checked={humorSettings.enabled}
                      onCheckedChange={(checked) => setHumorSettings(prev => ({ ...prev, enabled: checked }))}
                      data-testid="switch-humor-enabled"
                    />
                  </div>
                  
                  {humorSettings.enabled && (
                    <div className="space-y-4">
                      {/* Max Humor Tokens */}
                      <div className="space-y-2">
                        <Label htmlFor="maxHumorTokens" className="korean-text text-sm">
                          최대 토큰 수 (응답 길이):
                        </Label>
                        <Input
                          id="maxHumorTokens"
                          type="number"
                          min={50}
                          max={500}
                          value={humorSettings.maxHumorTokens}
                          onChange={(e) => setHumorSettings(prev => ({ 
                            ...prev, 
                            maxHumorTokens: parseInt(e.target.value) || 100 
                          }))}
                          className="korean-text"
                          data-testid="input-humor-max-tokens"
                        />
                      </div>

                      {/* Stage Direction Mode */}
                      <div className="space-y-2">
                        <Label htmlFor="stageMode" className="korean-text text-sm">
                          Stage Direction 모드:
                        </Label>
                        <Select
                          value={humorSettings.stageDirectionMode}
                          onValueChange={(value: "auto" | "always" | "never") => 
                            setHumorSettings(prev => ({ ...prev, stageDirectionMode: value }))
                          }
                        >
                          <SelectTrigger className="korean-text" data-testid="select-stage-mode">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto (자동)</SelectItem>
                            <SelectItem value="always">Always (항상 사용)</SelectItem>
                            <SelectItem value="never">Never (사용 안 함)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Humor Styles */}
                      <div className="space-y-2">
                        <Label className="korean-text text-sm">유머 스타일:</Label>
                        <div className="space-y-2">
                          {["wit", "reaction", "sarcasm", "playful"].map((style) => (
                            <div key={style} className="flex items-center space-x-2">
                              <Checkbox
                                id={`style-${style}`}
                                checked={humorSettings.styles.includes(style)}
                                onCheckedChange={(checked) => {
                                  setHumorSettings(prev => ({
                                    ...prev,
                                    styles: checked
                                      ? [...prev.styles, style]
                                      : prev.styles.filter(s => s !== style)
                                  }));
                                }}
                                data-testid={`checkbox-humor-style-${style}`}
                              />
                              <label htmlFor={`style-${style}`} className="korean-text text-sm cursor-pointer capitalize">
                                {style}
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          </form>
        </div>
        
        {/* 고정 버튼 영역 */}
        <div className="border-t p-3 flex-shrink-0">
          <div className="flex space-x-3">
            <Button 
              type="button" 
              variant="outline" 
              className="flex-1 korean-text"
              onClick={handleClose}
            >
              취소
            </Button>
            <Button 
              form="persona-form"
              type="submit" 
              className="flex-1 korean-text"
              disabled={updatePersonaMutation.isPending || !hasChanges}
            >
              <Save className="w-4 h-4 mr-2" />
              {updatePersonaMutation.isPending ? "저장 중..." : "저장"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}