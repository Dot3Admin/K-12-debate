import { useState, useMemo } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, X, UserPlus } from "lucide-react";
import type { GroupChatWithDetails } from "@/types/agent";
import { apiRequest } from "@/lib/queryClient";

export default function UserManagement() {
  const { t } = useTranslation();
  const { groupChatId: groupChatIdFromParams } = useParams();
  const [location, setLocation] = useLocation();
  
  // Extract groupChatId from URL if useParams doesn't work (TabletLayout case)
  const groupChatId = groupChatIdFromParams || (() => {
    const match = location.match(/\/group-chat\/(\d+)/);
    return match ? match[1] : null;
  })();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 상태 관리
  const [selectedUserToAdd, setSelectedUserToAdd] = useState("");
  const [userSearchInput, setUserSearchInput] = useState("");

  // 현재 사용자 조회
  const { data: user } = useQuery({
    queryKey: ['/api/user'],
  });

  // 그룹 채팅 정보 조회
  const { data: groupChat } = useQuery<GroupChatWithDetails>({
    queryKey: [`/api/group-chats/${groupChatId}`],
  });

  // 사용 가능한 사용자 목록 조회
  const { data: availableUsers = [] } = useQuery({
    queryKey: ['/api/users'],
  });

  // 검색어에 따른 사용자 필터링
  const filteredAvailableUsers = useMemo(() => {
    if (!userSearchInput || !Array.isArray(availableUsers)) return [];
    
    const searchLower = userSearchInput.toLowerCase();
    const currentMemberIds = groupChat?.members?.map((m: any) => m.userId) || [];
    
    return availableUsers
      .filter((user: any) => 
        !currentMemberIds.includes(user.id) &&
        (
          user.name?.toLowerCase().includes(searchLower) ||
          user.username?.toLowerCase().includes(searchLower) ||
          user.email?.toLowerCase().includes(searchLower)
        )
      )
      .slice(0, 10);
  }, [userSearchInput, availableUsers, groupChat?.members]);

  // 사용자 추가 뮤테이션
  const addUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId })
      });
      if (!response.ok) throw new Error('Failed to add user');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t('chat:userModal.addSuccess'),
        description: t('chat:userModal.addSuccessDesc'),
      });
      setSelectedUserToAdd("");
      setUserSearchInput("");
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
    },
    onError: () => {
      toast({
        title: t('chat:userModal.addFailed'),
        description: t('chat:userModal.addFailedDesc'),
        variant: "destructive",
      });
    },
  });

  // 사용자 제거 뮤테이션
  const removeUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch(`/api/group-chats/${groupChatId}/members/${userId}`, {
        method: 'DELETE'
      });
      if (!response.ok) throw new Error('Failed to remove user');
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: t('chat:userModal.removeSuccess'),
        description: t('chat:userModal.removeSuccessDesc'),
      });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
    },
    onError: () => {
      toast({
        title: t('chat:userModal.removeFailed'),
        description: t('chat:userModal.removeFailedDesc'),
        variant: "destructive",
      });
    },
  });

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-gray-900">
      {/* 헤더 */}
      <div className="border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setLocation(`/group-chat/${groupChatId}`)}
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            data-testid="button-back"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('chat:userModal.title')}
          </h1>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          
          {/* 현재 참여자 목록 */}
          {groupChat && (
            <div>
              <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300">
                {t('chat:userModal.currentParticipants')} ({t('chat:userModal.memberCount', {count: groupChat?.members?.length || 0})})
              </h3>
              <div className="space-y-2">
                {groupChat?.members && groupChat.members.length > 0 ? (
                  groupChat.members.map((member: any) => (
                    <div 
                      key={member.userId} 
                      className="flex items-center justify-between py-3 px-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-blue-600 dark:text-blue-400">
                            {(member.user?.name || member.userId)?.charAt(0)?.toUpperCase() || 'U'}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">
                            {member.user?.name || member.userId}
                          </p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {member.user?.email || `${member.userId}@univ.edu`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {member.userId === groupChat?.createdBy && (
                          <Badge variant="secondary" className="text-xs">
                            {t('chat:userModal.owner')}
                          </Badge>
                        )}
                        {/* 방장이 아니면서 본인이 방장이거나 본인 계정인 경우 제거 버튼 표시 */}
                        {member.userId !== groupChat?.createdBy && ((user as any)?.id === groupChat?.createdBy || member.userId === (user as any)?.id) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => removeUserMutation.mutate(member.userId)}
                            disabled={removeUserMutation.isPending}
                            className="h-8 w-8 p-0"
                            data-testid={`button-remove-user-${member.userId}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      멤버 정보를 로딩 중입니다...
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 새 사용자 추가 */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-sm font-medium mb-3 text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <UserPlus className="w-4 h-4" />
              {t('chat:userModal.newUserInvite')}
            </h3>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  type="text"
                  placeholder={t('chat:userModal.userSearchPlaceholder')}
                  value={userSearchInput}
                  onChange={(e) => setUserSearchInput(e.target.value)}
                  onBlur={() => {
                    // 지연시켜서 클릭 이벤트가 발생할 수 있도록 함
                    setTimeout(() => setUserSearchInput(""), 200);
                  }}
                  className="w-full"
                  data-testid="input-user-search"
                />
                {/* 검색 결과 드롭다운 */}
                {userSearchInput && filteredAvailableUsers.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 max-h-60 overflow-y-auto mt-1">
                    {filteredAvailableUsers.map((user: any) => (
                      <div
                        key={user.id}
                        className="p-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                        onClick={() => {
                          setSelectedUserToAdd(user.id);
                          setUserSearchInput("");
                        }}
                        data-testid={`user-option-${user.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center">
                            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                              {(user.name || user.username)?.charAt(0)?.toUpperCase() || 'U'}
                            </span>
                          </div>
                          <div>
                            <span className="font-medium text-sm text-gray-900 dark:text-white">
                              {user.name || user.username}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">
                              ({user.email})
                            </span>
                            {user.upper_category && (
                              <div className="text-xs text-gray-400 dark:text-gray-500">
                                {[user.upper_category, user.lower_category, user.detail_category]
                                  .filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button
                onClick={() => selectedUserToAdd && addUserMutation.mutate(selectedUserToAdd)}
                disabled={!selectedUserToAdd || addUserMutation.isPending}
                size="default"
                className="px-6"
                data-testid="button-add-user"
              >
                {addUserMutation.isPending ? "초대 중..." : "초대"}
              </Button>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
              {t('chat:userModal.searchHint')}
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
