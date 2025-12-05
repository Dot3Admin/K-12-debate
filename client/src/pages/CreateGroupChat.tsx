import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/contexts/LanguageContext";
import { 
  ChevronLeft, 
  Search, 
  Plus, 
  X, 
  Check, 
  MessageCircle,
  Users
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Agent } from "@/types/agent";

interface SelectedAgent {
  id: number;
  name: string;
  icon: string;
  backgroundColor: string;
}

interface InviteUser {
  id: string;
  username: string;
  name?: string;
}

interface CreateGroupChatProps {
  onBack?: () => void;
  onCreateWithCard?: (chatRoomId: number) => void;
}

export default function CreateGroupChat({ onBack, onCreateWithCard }: CreateGroupChatProps = {}) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const { t } = useLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // URL에서 fromCardEditor 파라미터 확인 (모바일 모드용)
  const urlParams = new URLSearchParams(window.location.search);
  const fromCardEditor = urlParams.get('fromCardEditor') === 'true';

  const [groupTitle, setGroupTitle] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("private");
  const [embedEnabled, setEmbedEnabled] = useState(false);
  const [callnaskEnabled, setCallnaskEnabled] = useState(false);
  const [callnaskMaxAgents, setCallnaskMaxAgents] = useState(5);
  const [sharingMode, setSharingMode] = useState<"shared" | "template">("shared");
  const [allowedDomains, setAllowedDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState("");
  const [selectedAgents, setSelectedAgents] = useState<SelectedAgent[]>([]);
  const [invitedUsers, setInvitedUsers] = useState<InviteUser[]>([]);
  const [emailInput, setEmailInput] = useState("");
  const [emailStatus, setEmailStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [agentSearch, setAgentSearch] = useState("");

  const { data: agents = [], isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ['/api/agents/public'],
  });

  const availableAgents = agents.filter(agent => 
    !selectedAgents.some(selected => selected.id === agent.id) &&
    agent.name.toLowerCase().includes(agentSearch.toLowerCase())
  );

  const checkEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await fetch(`/api/users/check-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        throw new Error('Failed to check email');
      }
      return response.json();
    },
    onSuccess: (data: any) => {
      if (data.exists && data.user) {
        setEmailStatus("valid");
        const newUser: InviteUser = {
          id: data.user.id,
          username: data.user.username,
          name: data.user.name || data.user.username
        };
        
        const isAlreadyInvited = invitedUsers.some(u => u.id === newUser.id);
        if (!isAlreadyInvited) {
          setInvitedUsers(prev => [...prev, newUser]);
          setEmailInput("");
          setEmailStatus("idle");
          toast({
            title: t('common.success'),
            description: `${newUser.name}${t('common.added')}`,
          });
        } else {
          toast({
            title: t('error.general.alreadyExists'),
            description: t('chat.groupChat.alreadyInvited'),
            variant: "destructive",
          });
        }
      } else {
        setEmailStatus("invalid");
        toast({
          title: t('error.general.notFound'),
          description: t('chat.groupChat.userNotFound'),
          variant: "destructive",
        });
      }
    },
    onError: () => {
      setEmailStatus("invalid");
      toast({
        title: t('error.general.unknown'),
        description: t('chat.groupChat.emailCheckFailed'),
        variant: "destructive",
      });
    },
  });

  const createGroupChatMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      agentIds: number[];
      userIds: string[];
      visibility: string;
      sharingMode: string;
      embedEnabled?: boolean;
      callnaskEnabled?: boolean;
      callnaskConfig?: { maxAgents: number };
      allowedDomains?: string[];
      createAsCard?: boolean;
    }) => {
      const response = await fetch(`/api/group-chats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        throw new Error('Failed to create group chat');
      }
      return response.json();
    },
    onSuccess: (data: any, variables) => {
      toast({
        title: t('common.success'),
        description: t('chat.groupChat.createSuccess'),
      });
      queryClient.invalidateQueries({ queryKey: ['/api/group-chats'] });
      
      // "새 카드로 만들기"로 생성했으면 카드 생성 콜백 호출
      if (variables.createAsCard && onCreateWithCard) {
        onCreateWithCard(data.id);
      } else if (variables.createAsCard && fromCardEditor) {
        // 모바일 모드: 카드 편집 화면으로 돌아가면서 채팅방 정보 전달
        setLocation(`/card-layout-editor?pendingChatId=${data.id}&pendingChatTitle=${encodeURIComponent(groupTitle.trim())}`);
      } else {
        setLocation(`/group-chat/${data.id}`);
      }
    },
    onError: () => {
      toast({
        title: t('common.failed'),
        description: t('chat.groupChat.createFailed'),
        variant: "destructive",
      });
    },
  });

  const handleAgentSelect = (agent: Agent) => {
    const selectedAgent: SelectedAgent = {
      id: agent.id,
      name: agent.name,
      icon: agent.icon,
      backgroundColor: agent.backgroundColor,
    };
    setSelectedAgents(prev => [...prev, selectedAgent]);
  };

  const handleAgentRemove = (agentId: number) => {
    setSelectedAgents(prev => prev.filter(agent => agent.id !== agentId));
  };

  const handleEmailCheck = () => {
    if (!emailInput.trim()) return;
    setEmailStatus("checking");
    checkEmailMutation.mutate(emailInput.trim());
  };

  const handleInviteUser = () => {
    handleEmailCheck();
  };

  const handleUserRemove = (userId: string) => {
    setInvitedUsers(prev => prev.filter(user => user.id !== userId));
  };

  const handleAddDomain = () => {
    const domain = domainInput.trim();
    if (domain && !allowedDomains.includes(domain)) {
      setAllowedDomains(prev => [...prev, domain]);
      setDomainInput("");
    }
  };

  const handleRemoveDomain = (domainToRemove: string) => {
    setAllowedDomains(prev => prev.filter(domain => domain !== domainToRemove));
  };

  const handleCreateGroupChat = (asCard: boolean = false) => {
    const data = {
      title: groupTitle.trim(),
      agentIds: selectedAgents.map(agent => agent.id),
      userIds: invitedUsers.map(user => user.id),
      visibility: embedEnabled ? "embed" : visibility,
      sharingMode,
      embedEnabled,
      callnaskEnabled: embedEnabled ? callnaskEnabled : false,
      callnaskConfig: embedEnabled && callnaskEnabled ? { maxAgents: callnaskMaxAgents } : undefined,
      allowedDomains: embedEnabled && allowedDomains.length > 0 ? allowedDomains : undefined,
      createAsCard: asCard,
    };

    createGroupChatMutation.mutate(data);
  };

  const canCreate = true;

  return (
    <div className="h-full bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onBack ? onBack() : setLocation("/")}
            >
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <div className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-primary" />
              <h1 className="text-lg font-semibold">{t('chat.groupChat.create')}</h1>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t('chat.groupChat.title')} <span className="text-gray-500 font-normal">({t('common.optional')})</span>
              </label>
              <Input
                placeholder={t('chat.groupChat.titlePlaceholder')}
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
                className="w-full"
              />
              <p className="text-xs text-gray-500">
                {t('chat.groupChat.titleAutoGenerate')}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="space-y-4">
              <label className="text-sm font-medium text-gray-700">
                공개 범위 <span className="text-gray-500 font-normal">(선택사항)</span>
              </label>

              <div className="space-y-3">
                {/* 공개 옵션 */}
                <div
                  onClick={() => setVisibility("public")}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    visibility === "public"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center h-5 mt-0.5">
                      <input
                        type="radio"
                        checked={visibility === "public"}
                        onChange={() => setVisibility("public")}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-900 cursor-pointer">
                        공개
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        LoBo 서비스 안에서 채팅방이 누구에게나 공개 됩니다.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 비공개 옵션 */}
                <div
                  onClick={() => setVisibility("private")}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    visibility === "private"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center h-5 mt-0.5">
                      <input
                        type="radio"
                        checked={visibility === "private"}
                        onChange={() => setVisibility("private")}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-900 cursor-pointer">
                        비공개
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        LoBo 서비스 안에서 초대된 사용자에게만 공개됩니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <label className="text-sm font-medium text-gray-900">
                    웹 페이지 임베드
                  </label>
                  <p className="text-xs text-gray-500 mt-1">
                    웹 페이지에 채팅방을 임베드하여 방문자 누구나 채팅할 수 있습니다.
                  </p>
                </div>
                <Switch
                  checked={embedEnabled}
                  onCheckedChange={setEmbedEnabled}
                  data-testid="switch-embed-enabled"
                />
              </div>

              {/* CallNAsk 모드 (웹 임베드 활성화 시만 표시) */}
              {embedEnabled && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <div className="flex-1">
                    <label className="text-sm font-medium text-gray-900">
                      CallNAsk 모드
                    </label>
                    <p className="text-xs text-gray-500 mt-1">
                      로그인 없이 방문자가 캐릭터를 직접 호출하고 대화할 수 있습니다.
                    </p>
                  </div>
                  <Switch
                    checked={callnaskEnabled}
                    onCheckedChange={setCallnaskEnabled}
                    data-testid="switch-callnask-enabled"
                  />
                </div>
              )}

              {/* CallNAsk 최대 에이전트 수 설정 (CallNAsk 활성화 시만 표시) */}
              {embedEnabled && callnaskEnabled && (
                <div className="pt-4 space-y-3 border-t">
                  <label className="text-sm font-medium text-gray-700">
                    최대 에이전트 수 (1-10명)
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={callnaskMaxAgents}
                      onChange={(e) => setCallnaskMaxAgents(parseInt(e.target.value))}
                      className="flex-1"
                      data-testid="slider-max-agents"
                    />
                    <span className="text-sm font-medium text-gray-900 w-12 text-center">
                      {callnaskMaxAgents}명
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    방문자가 동시에 호출할 수 있는 최대 캐릭터 수입니다.
                  </p>
                </div>
              )}

              {/* 도메인 입력 필드 (웹 임베드 활성화 시만 표시) */}
              {embedEnabled && (
                <div className="pt-4 space-y-3 border-t">
                  <label className="text-sm font-medium text-gray-700">
                    📌 허용할 도메인 <span className="text-gray-500 font-normal">(선택사항)</span>
                  </label>
                  
                  <div className="flex gap-2">
                    <Input
                      placeholder="example.com"
                      value={domainInput}
                      onChange={(e) => setDomainInput(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddDomain();
                        }
                      }}
                      className="flex-1"
                    />
                    <Button
                      onClick={handleAddDomain}
                      disabled={!domainInput.trim()}
                      size="sm"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* 추가된 도메인 태그 목록 */}
                  {allowedDomains.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {allowedDomains.map((domain) => (
                        <Badge
                          key={domain}
                          variant="secondary"
                          className="flex items-center gap-2 px-3 py-1"
                        >
                          <span className="text-sm">{domain}</span>
                          <X
                            className="w-3 h-3 cursor-pointer hover:text-red-500"
                            onClick={() => handleRemoveDomain(domain)}
                          />
                        </Badge>
                      ))}
                    </div>
                  )}

                  <p className="text-xs text-gray-500">
                    ℹ️ 도메인을 추가하면 해당 사이트에서만 채팅방이 표시됩니다. 비워두면 모든 사이트에서 사용 가능합니다.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="space-y-4">
              <label className="text-sm font-medium text-gray-700">
                공유 모드 <span className="text-gray-500 font-normal">(선택사항)</span>
              </label>

              <div className="space-y-3">
                {/* 실제 방 공유 옵션 */}
                <div
                  onClick={() => setSharingMode("shared")}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    sharingMode === "shared"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center h-5 mt-0.5">
                      <input
                        type="radio"
                        checked={sharingMode === "shared"}
                        onChange={() => setSharingMode("shared")}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-900 cursor-pointer">
                        실제 방 공유
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        같은 채팅방을 다른 사용자와 공유합니다. 모든 참여자가 같은 대화 내용을 볼 수 있습니다.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 템플릿 모드 옵션 */}
                <div
                  onClick={() => setSharingMode("template")}
                  className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                    sharingMode === "template"
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex items-center h-5 mt-0.5">
                      <input
                        type="radio"
                        checked={sharingMode === "template"}
                        onChange={() => setSharingMode("template")}
                        className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-sm font-medium text-gray-900 cursor-pointer">
                        템플릿 모드
                      </label>
                      <p className="text-xs text-gray-500 mt-1">
                        채팅방 설정(이름, 에이전트)만 공유하고, 각 사용자마다 별도의 채팅방이 생성됩니다.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  {t('chat.groupChat.selectAgents')} <span className="text-gray-500 font-normal">({t('common.optional')})</span>
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <Input
                    placeholder={t('chat.groupChat.searchAgents')}
                    value={agentSearch}
                    onChange={(e) => setAgentSearch(e.target.value)}
                    className="pl-10 w-48"
                  />
                </div>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {availableAgents.map((agent, index) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => handleAgentSelect(agent)}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                        style={{ backgroundColor: agent.backgroundColor }}
                      >
                        {agent.icon === 'fas fa-user' ? '👤' : '🤖'}
                      </div>
                      <div>
                        <div className="font-medium text-gray-900">{agent.name}</div>
                        <div className="text-sm text-gray-500 truncate max-w-48">
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

              {selectedAgents.length === 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-700">
                    💡 {t('chat.groupChat.defaultLLMInfo')}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {selectedAgents.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">
                  {t('chat.groupChat.selectedAgents')} ({selectedAgents.length}{t('common.count')})
                </label>
                <div className="flex flex-wrap gap-2">
                  {selectedAgents.map((agent) => (
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
                        onClick={() => handleAgentRemove(agent.id)}
                      />
                    </Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-4">
            <div className="space-y-4">
              <label className="text-sm font-medium text-gray-700">
                {t('chat.groupChat.inviteParticipants')}
              </label>
              
              <div className="flex gap-2">
                <Input
                  placeholder={t('chat.groupChat.emailPlaceholder')}
                  value={emailInput}
                  onChange={(e) => {
                    setEmailInput(e.target.value);
                    setEmailStatus("idle");
                  }}
                  className="flex-1"
                />
                {emailStatus === "idle" && (
                  <Button 
                    onClick={handleEmailCheck}
                    disabled={!emailInput.trim() || checkEmailMutation.isPending}
                  >
                    {checkEmailMutation.isPending ? t('common.checking') : t('chat.groupChat.confirm')}
                  </Button>
                )}
                {emailStatus === "valid" && (
                  <Button onClick={handleInviteUser} className="bg-green-600 hover:bg-green-700">
                    <Check className="w-4 h-4 mr-1" />
                    {t('common.invite')}
                  </Button>
                )}
                {emailStatus === "invalid" && (
                  <Button 
                    variant="destructive"
                    onClick={() => {
                      setEmailInput("");
                      setEmailStatus("idle");
                    }}
                  >
                    <X className="w-4 h-4 mr-1" />
                    {t('common.retry')}
                  </Button>
                )}
              </div>

              {invitedUsers.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-gray-700">
                    {t('chat.groupChat.invitedUsers')} ({invitedUsers.length}{t('common.people')})
                  </label>
                  <div className="space-y-2">
                    {invitedUsers.map((user) => (
                      <div
                        key={user.id}
                        className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-gray-500" />
                          <span className="text-sm">{user.name || user.username}</span>
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleUserRemove(user.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

      </div>

      <div className="flex-shrink-0 bg-white border-t border-gray-200 p-4">
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onBack ? onBack() : setLocation("/")}
            data-testid="button-cancel-create-group-chat"
          >
            {t('chat.groupChat.cancel')}
          </Button>
          {(onCreateWithCard || fromCardEditor) && (
            <Button
              variant="outline"
              className="flex-1"
              disabled={!canCreate || createGroupChatMutation.isPending}
              onClick={() => handleCreateGroupChat(true)}
              data-testid="button-create-as-card"
            >
              새 카드로 만들기
            </Button>
          )}
          <Button
            className="flex-1"
            disabled={!canCreate || createGroupChatMutation.isPending}
            onClick={() => handleCreateGroupChat(false)}
            data-testid="button-create-group-chat"
          >
            {createGroupChatMutation.isPending ? t('common.creating') : t('chat.groupChat.createButton')}
          </Button>
        </div>
      </div>
    </div>
  );
}
