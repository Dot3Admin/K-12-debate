import React, { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
// Dialog 컴포넌트 제거 - 사용자 정의 모달로 교체
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useFormChanges } from "@/hooks/useFormChanges";
import { Agent } from "@/types/agent";
import { eventBus, EVENTS } from "@/utils/eventBus";
import { 
  User, GraduationCap, Code, Bot, FlaskRound, 
  Map, Languages, Dumbbell, Database, Lightbulb, 
  Heart, Calendar, Pen, FileText, Camera, 
  X, Image 
} from "lucide-react";

interface IconChangeModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

const availableIcons = [
  { name: "졸업모자", icon: GraduationCap, value: "fas fa-graduation-cap" },
  { name: "코드", icon: Code, value: "fas fa-code" },
  { name: "로봇", icon: Bot, value: "fas fa-robot" },
  { name: "사용자", icon: User, value: "fas fa-user" },
  { name: "플라스크", icon: FlaskRound, value: "fas fa-flask" },
  { name: "지도", icon: Map, value: "fas fa-map" },
  { name: "언어", icon: Languages, value: "fas fa-language" },
  { name: "덤벨", icon: Dumbbell, value: "fas fa-dumbbell" },
  { name: "데이터베이스", icon: Database, value: "fas fa-database" },
  { name: "전구", icon: Lightbulb, value: "fas fa-lightbulb" },
  { name: "하트", icon: Heart, value: "fas fa-heart" },
  { name: "캘린더", icon: Calendar, value: "fas fa-calendar" },
  { name: "펜", icon: Pen, value: "fas fa-pen" },
  { name: "문서", icon: FileText, value: "fas fa-file-alt" }
];

const colorOptions = [
  { name: "파란색", value: "#3b82f6", bgClass: "bg-blue-500" },
  { name: "초록색", value: "#10b981", bgClass: "bg-emerald-500" },
  { name: "보라색", value: "#8b5cf6", bgClass: "bg-violet-500" },
  { name: "빨간색", value: "#ef4444", bgClass: "bg-red-500" },
  { name: "주황색", value: "#f97316", bgClass: "bg-orange-500" },
  { name: "분홍색", value: "#ec4899", bgClass: "bg-pink-500" },
  { name: "노란색", value: "#eab308", bgClass: "bg-yellow-500" },
  { name: "청록색", value: "#06b6d4", bgClass: "bg-cyan-500" },
  { name: "회색", value: "#6b7280", bgClass: "bg-gray-500" },
  { name: "남색", value: "#4338ca", bgClass: "bg-indigo-600" }
];

export default function IconChangeModal({ agent, isOpen, onClose, onSuccess }: IconChangeModalProps) {
  // Early return if agent is not available
  if (!agent) {
    return null;
  }

  // 파일 입력은 동적으로 생성하므로 ref 불필요
  
  // 모달이 완전히 렌더링되었는지 추적
  const [isModalReady, setIsModalReady] = useState(false);
  
  // 모달이 열릴 때 렌더링 완료를 기다림
  useEffect(() => {
    if (isOpen) {
      // 짧은 딜레이 후 모달이 준비되었다고 설정
      const timer = setTimeout(() => {
        setIsModalReady(true);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setIsModalReady(false);
    }
  }, [isOpen]);

  // 원본 데이터 (초기값)
  const [originalData, setOriginalData] = useState({
    icon: agent.icon || "User",
    backgroundColor: agent.backgroundColor || "#3b82f6",
    isUsingCustomImage: agent.isCustomIcon || false,
    customImage: agent.isCustomIcon ? agent.icon : null
  });
  
  const [selectedIcon, setSelectedIcon] = useState(agent.icon || "User");
  const [selectedColor, setSelectedColor] = useState(agent.backgroundColor || "#3b82f6");
  const [customImage, setCustomImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isUsingCustomImage, setIsUsingCustomImage] = useState(false);

  // 현재 상태 객체 (변경사항 감지용)
  const currentData = {
    icon: isUsingCustomImage ? (customImage || imageFile?.name) : selectedIcon,
    backgroundColor: selectedColor,
    isUsingCustomImage,
    customImage: isUsingCustomImage ? (customImage || imageFile?.name) : null
  };

  // 변경사항 감지
  const hasChanges = useFormChanges(currentData, originalData);
  
  // Debug: Log isOpen state
  useEffect(() => {
    console.log(`IconChangeModal: isOpen=${isOpen}, agentId=${agent.id}`);
  }, [isOpen, agent.id]);

  // Reset state when modal opens/closes or agent changes
  useEffect(() => {
    if (isOpen) {
      const newOriginalData = {
        icon: agent.icon || "User",
        backgroundColor: agent.backgroundColor || "#3b82f6",
        isUsingCustomImage: agent.isCustomIcon || false,
        customImage: agent.isCustomIcon ? agent.icon : null
      };
      
      setOriginalData(newOriginalData);
      setSelectedIcon(agent.icon || "User");
      setSelectedColor(agent.backgroundColor || "#3b82f6");
      // Always start with basic icon tab
      setIsUsingCustomImage(false);
      setCustomImage(null);
      setImageFile(null);
      
      // If agent has custom icon, store the current image but don't show it initially
      if (agent.isCustomIcon && agent.icon) {
        setCustomImage(agent.icon);
      }
    }
  }, [isOpen, agent]);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const updateIconMutation = useMutation({
    mutationFn: async (data: { icon?: string; backgroundColor: string; customImageFile?: File }) => {
      if (data.customImageFile) {
        // Upload custom image first
        const formData = new FormData();
        formData.append('image', data.customImageFile);
        
        const uploadResponse = await fetch(`/api/agents/${agent.id}/icon-upload`, {
          method: 'POST',
          body: formData,
          credentials: 'include'
        });
        
        if (!uploadResponse.ok) {
          throw new Error('이미지 업로드에 실패했습니다.');
        }
        
        const uploadResult = await uploadResponse.json();
        
        // Update agent with custom image path
        const response = await apiRequest("PATCH", `/api/agents/${agent.id}`, {
          icon: uploadResult.imagePath,
          backgroundColor: data.backgroundColor,
          isCustomIcon: true
        });
        return await response.json();
      } else {
        // Update with standard icon
        const response = await apiRequest("PATCH", `/api/agents/${agent.id}`, {
          icon: data.icon,
          backgroundColor: data.backgroundColor,
          isCustomIcon: false
        });
        return await response.json();
      }
    },
    onSuccess: async (response) => {
      console.log("Icon change success, using server response data:", response);
      
      // Get updated agent data from server response
      const updatedAgentData = (response as any).agent;
      
      if (!updatedAgentData) {
        console.error("No agent data in server response");
        return;
      }
      
      // Step 1: Update agent cache with actual server data
      queryClient.setQueryData(["/api/agents"], (oldData: any[]) => {
        if (!oldData) return oldData;
        return oldData.map((agentItem: any) => {
          if (agentItem.id === agent.id) {
            return {
              ...agentItem,
              icon: updatedAgentData.icon,
              backgroundColor: updatedAgentData.backgroundColor,
              isCustomIcon: updatedAgentData.isCustomIcon
            };
          }
          return agentItem;
        });
      });

      // Step 2: Update managed agents cache with actual server data
      queryClient.setQueryData(["/api/agents/managed"], (oldData: any[]) => {
        if (!oldData) return oldData;
        return oldData.map((agentItem: any) => {
          if (agentItem.id === agent.id) {
            return {
              ...agentItem,
              icon: updatedAgentData.icon,
              backgroundColor: updatedAgentData.backgroundColor,
              isCustomIcon: updatedAgentData.isCustomIcon
            };
          }
          return agentItem;
        });
      });
      
      // Step 3: Update conversations cache with actual server data
      queryClient.setQueryData(["/api/conversations"], (oldData: any[]) => {
        if (!oldData) return oldData;
        return oldData.map((conv: any) => {
          if (conv.agentId === agent.id) {
            return {
              ...conv,
              agent: {
                ...conv.agent,
                icon: updatedAgentData.icon,
                backgroundColor: updatedAgentData.backgroundColor,
                isCustomIcon: updatedAgentData.isCustomIcon
              }
            };
          }
          return conv;
        });
      });
      
      console.log("Cache updated with server data, forcing UI refresh...");
      
      // Step 4: Update modal state to reflect changes immediately
      setSelectedIcon(updatedAgentData.icon);
      setSelectedColor(updatedAgentData.backgroundColor);
      if (updatedAgentData.isCustomIcon && updatedAgentData.icon?.startsWith('/uploads/')) {
        setCustomImage(updatedAgentData.icon);
        setIsUsingCustomImage(true);
      } else {
        setCustomImage(null);
        setIsUsingCustomImage(false);
      }
      
      // Step 5: Force comprehensive invalidation and immediate refetch
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/agents"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/agents/managed"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/agents"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/conversations"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/conversations", agent.id] })
      ]).then(() => {
        // Immediately refetch all agent data
        return Promise.all([
          queryClient.refetchQueries({ queryKey: ["/api/agents"] }),
          queryClient.refetchQueries({ queryKey: ["/api/admin/agents"] })
        ]);
      });
      
      // Step 6: Emit global events for immediate UI updates
      console.log("Emitting global agent update events...");
      eventBus.emit(EVENTS.AGENT_ICON_CHANGED, { 
        agentId: agent.id, 
        icon: updatedAgentData.icon, 
        backgroundColor: updatedAgentData.backgroundColor,
        isCustomIcon: updatedAgentData.isCustomIcon 
      });
      eventBus.emit(EVENTS.FORCE_REFRESH_AGENTS);
      
      // Step 6.5: NUCLEAR OPTION - Direct window function call for fallback
      try {
        // Call global refresh functions if available for both Home and TabletLayout
        if (typeof (window as any).forceRefreshAgents === 'function') {
          console.log("Calling window.forceRefreshAgents for Home...");
          (window as any).forceRefreshAgents();
        }
        if (typeof (window as any).forceRefreshAgentsTablet === 'function') {
          console.log("Calling window.forceRefreshAgentsTablet for TabletLayout...");
          (window as any).forceRefreshAgentsTablet();
        }
      } catch (e) {
        console.log("Window function call failed:", e);
      }
      
      // Step 7: NUCLEAR OPTION - Force immediate refetch with multiple strategies
      // Strategy 1: Immediate invalidation
      queryClient.removeQueries({ queryKey: ["/api/agents"] });
      
      // Strategy 2: Force refetch with delay
      setTimeout(async () => {
        await Promise.all([
          queryClient.refetchQueries({ queryKey: ["/api/agents"], type: "all" }),
          queryClient.refetchQueries({ queryKey: ["/api/conversations"], type: "all" }),
          queryClient.refetchQueries({ queryKey: ["/api/admin/agents"], type: "all" }),
        ]);
        console.log("Force refetch completed after icon change");
      }, 50);
      
      // Strategy 3: Force page reload to ensure all UI components show updated icon
      setTimeout(() => {
        console.log("Forcing page reload to ensure icon change is visible everywhere");
        window.location.reload();
      }, 1000);
      
      // Step 7: Close modal and show success message
      toast({
        title: "아이콘 변경 완료",
        description: "에이전트 아이콘과 배경색이 성공적으로 변경되었습니다.",
      });
      
      onSuccess?.("아이콘과 배경색이 성공적으로 변경되었습니다.");
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: "아이콘 변경 실패",
        description: error.message || "아이콘 변경 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log("🔥 handleFileChange called!", event);
    console.log("🔥 event.target:", event.target);
    console.log("🔥 event.target.files:", event.target.files);
    
    const file = event.target.files?.[0];
    console.log("🔥 Selected file:", file);
    
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        console.log("❌ Invalid file type:", file.type);
        toast({
          title: "잘못된 파일 형식",
          description: "이미지 파일만 업로드할 수 있습니다.",
          variant: "destructive",
        });
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        console.log("❌ File too large:", file.size);
        toast({
          title: "파일 크기 초과",
          description: "이미지 파일은 5MB 이하여야 합니다.",
          variant: "destructive",
        });
        return;
      }
      
      console.log("✅ Setting file and custom image state");
      setImageFile(file);
      setIsUsingCustomImage(true);
      
      // Create preview URL
      const reader = new FileReader();
      reader.onload = (e) => {
        console.log("✅ FileReader loaded, setting custom image preview");
        setCustomImage(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    } else {
      console.log("❌ No file selected");
    }
  };

  const handleSubmit = () => {
    if (isUsingCustomImage && imageFile) {
      updateIconMutation.mutate({
        backgroundColor: selectedColor,
        customImageFile: imageFile
      });
    } else {
      updateIconMutation.mutate({
        icon: selectedIcon,
        backgroundColor: selectedColor
      });
    }
  };

  const selectedIconComponent = availableIcons.find(icon => icon.value === selectedIcon)?.icon || User;
  const SelectedIconComponent = selectedIconComponent;

  const handleClose = React.useCallback((e?: React.MouseEvent) => {
    console.log("IconChangeModal handleClose called");
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    onClose();
  }, [onClose]);

  const handleCancelClick = React.useCallback((e: React.MouseEvent) => {
    console.log("IconChangeModal Cancel button clicked");
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }, [onClose]);

  const handleXClick = React.useCallback((e: React.MouseEvent) => {
    console.log("IconChangeModal X button clicked");
    e.preventDefault();
    e.stopPropagation();
    onClose();
  }, [onClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4" onClick={handleBackdropClick}>
      <div className="bg-background border border-border rounded-2xl max-w-md w-full max-h-[90vh] md:max-h-[80vh] flex flex-col shadow-lg" onClick={(e) => e.stopPropagation()}>
        {/* Fixed Header */}
        <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
          <div className="flex items-center space-x-2 pl-6">
            <Image className="w-5 h-5 text-black dark:text-white" />
            <h3 className="text-lg font-medium text-foreground korean-text">아이콘 변경</h3>
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleXClick}
            type="button"
          >
            <X className="w-10 h-10" />
          </Button>
        </div>
        
        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
          {/* Preview */}
          <div className="flex justify-center">
            <div 
              className="w-16 h-16 rounded-2xl flex items-center justify-center overflow-hidden"
              style={{ backgroundColor: selectedColor }}
            >
              {isUsingCustomImage && customImage ? (
                <img 
                  src={customImage} 
                  alt="Custom icon preview" 
                  className="w-full h-full object-cover"
                />
              ) : (
                <SelectedIconComponent className="w-8 h-8 text-white" />
              )}
            </div>
          </div>

          {/* Upload Type Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">아이콘 유형</Label>
            <div className="flex gap-2">
              <div
                className={`flex-1 px-4 py-2 text-center text-sm font-medium rounded-md cursor-pointer transition-colors ${
                  !isUsingCustomImage 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-background border border-input hover:bg-accent hover:text-accent-foreground"
                }`}
                onClick={() => {
                  setIsUsingCustomImage(false);
                  setCustomImage(null);
                  setImageFile(null);
                }}
              >
                기본 아이콘
              </div>
              <div
                className={`flex-1 px-4 py-2 text-center text-sm font-medium rounded-md cursor-pointer transition-colors ${
                  isUsingCustomImage 
                    ? "bg-primary text-primary-foreground" 
                    : "bg-background border border-input hover:bg-accent hover:text-accent-foreground"
                } ${!isModalReady ? 'pointer-events-none opacity-50' : 'pointer-events-auto'}`}
                onMouseDown={(e) => {
                  if (!isModalReady) return;
                  
                  e.preventDefault();
                  e.stopPropagation();
                  console.log("🎯 Native mousedown event - Image upload clicked");
                  
                  // 네이티브 DOM 접근으로 파일 입력 생성
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/jpeg,image/png,image/gif,image/webp';
                  input.style.display = 'none';
                  
                  input.onchange = (event) => {
                    const target = event.target as HTMLInputElement;
                    const file = target.files?.[0];
                    console.log("🎯 Native file selected:", file);
                    
                    if (file) {
                      handleFileChange({ target: { files: [file] } } as any);
                    }
                    
                    // 정리
                    document.body.removeChild(input);
                  };
                  
                  // DOM에 추가하고 즉시 클릭
                  document.body.appendChild(input);
                  setIsUsingCustomImage(true);
                  
                  // 다음 틱에서 클릭하여 React 상태 업데이트가 완료된 후 실행
                  setTimeout(() => {
                    input.click();
                  }, 0);
                }}
              >
                이미지 업로드
              </div>
            </div>
          </div>



          {/* Icon Selection - Always show */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">아이콘 선택</Label>
            <div className="grid grid-cols-5 gap-2">
              {availableIcons.map((iconOption) => {
                const IconComponent = iconOption.icon;
                return (
                  <Button
                    type="button"
                    key={iconOption.value}
                    variant={selectedIcon === iconOption.value ? "default" : "outline"}
                    size="sm"
                    className="h-12 w-12 p-0 relative z-10 pointer-events-auto"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      console.log("Icon button clicked:", iconOption.value);
                      setSelectedIcon(iconOption.value);
                    }}
                  >
                    <IconComponent className="w-5 h-5 pointer-events-none" />
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Color Selection - Always show */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">배경색 선택</Label>
            <div className="grid grid-cols-5 gap-2">
              {colorOptions.map((colorOption) => (
                <Button
                  type="button"
                  key={colorOption.value}
                  variant="outline"
                  size="sm"
                  className={`h-12 w-12 p-0 border-2 relative z-10 pointer-events-auto ${
                    selectedColor === colorOption.value ? "border-foreground" : "border-border"
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log("Color button clicked:", colorOption.value);
                    setSelectedColor(colorOption.value);
                  }}
                >
                  <div 
                    className={`w-8 h-8 rounded ${colorOption.bgClass} pointer-events-none`}
                  />
                </Button>
              ))}
            </div>
          </div>

          </div>
        </div>
        
        {/* Fixed Footer */}
        <div className="border-t p-3 flex-shrink-0">
          <div className="flex space-x-3">
            <Button 
              type="button" 
              variant="outline" 
              className="flex-1 korean-text"
              onClick={handleCancelClick} 
              disabled={updateIconMutation.isPending}
            >
              취소
            </Button>
            <Button 
              type="button"
              className="flex-1 korean-text"
              onClick={handleSubmit} 
              disabled={updateIconMutation.isPending || !hasChanges}
            >
              {updateIconMutation.isPending ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>변경 중...</span>
                </div>
              ) : (
                <div className="flex items-center space-x-2">
                  <Image className="w-4 h-4" />
                  <span>아이콘 변경</span>
                </div>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}