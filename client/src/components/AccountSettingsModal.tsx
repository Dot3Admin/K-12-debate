import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { 
  User, 
  Building, 
  Edit,
  Key,
  Save,
  X,
  CheckCircle,
  Sun,
  Moon
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useTheme } from "@/contexts/ThemeContext";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface UserData {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  userType: string;
  status?: string;
  role?: string;
  upperCategory?: string;
  lowerCategory?: string;
  detailCategory?: string;
  position?: string;
  createdAt?: string;
  lastLoginAt?: string;
  userMemo?: string;
  nickname?: string;
  age?: number;
  country?: string;
  religion?: string;
  occupation?: string;
}

interface AccountSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AccountSettingsModal({ isOpen, onClose }: AccountSettingsModalProps) {
  const { t, language } = useLanguage();
  const { theme, setTheme, actualTheme } = useTheme();
  const { toast } = useToast();
  
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  
  // Form states for inline editing
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  
  // Password change states
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: user, isLoading, refetch } = useQuery<UserData>({
    queryKey: ['/api/user'],
    enabled: isOpen,
  });

  // Initialize form when user data is loaded
  useEffect(() => {
    if (user) {
      const currentName = user.name || `${user.lastName || ""}${user.firstName || ""}`;
      const currentEmail = user.email || "";
      setEditName(currentName);
      setEditEmail(currentEmail);
      setHasChanges(false);
    }
  }, [user]);

  // Reset states when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowPasswordChange(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setHasChanges(false);
    }
  }, [isOpen]);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return language === 'ko' ? '정보 없음' : 'No information';
    try {
      if (language === 'ko') {
        return format(new Date(dateString), "yyyy년 MM월 dd일 HH:mm", { locale: ko });
      } else {
        return format(new Date(dateString), "MMM dd, yyyy HH:mm");
      }
    } catch {
      return language === 'ko' ? '정보 없음' : 'No information';
    }
  };

  const getUserTypeLabel = (userType: string) => {
    if (language === 'ko') {
      switch (userType) {
        case "student": return "학생";
        case "faculty": return "교직원";
        case "admin": return "관리자";
        default: return userType;
      }
    } else {
      switch (userType) {
        case "student": return "Student";
        case "faculty": return "Faculty";
        case "admin": return "Administrator";
        default: return userType;
      }
    }
  };

  const getRoleLabel = (role: string) => {
    const roleMap: { [key: string]: { ko: string, en: string } } = {
      "일반 사용자": { ko: "일반 사용자", en: "Regular User" },
      "regular_user": { ko: "일반 사용자", en: "Regular User" },
      "마스터 관리자": { ko: "마스터 관리자", en: "Master Admin" },
      "master_admin": { ko: "마스터 관리자", en: "Master Admin" },
      "운영 관리자": { ko: "운영 관리자", en: "Operation Manager" },
      "operation_admin": { ko: "운영 관리자", en: "Operation Manager" },
      "카테고리 관리자": { ko: "카테고리 관리자", en: "Category Manager" },
      "category_admin": { ko: "카테고리 관리자", en: "Category Manager" },
      "에이전트 관리자": { ko: "에이전트 관리자", en: "Agent Manager" },
      "agent_admin": { ko: "에이전트 관리자", en: "Agent Manager" },
      "QA 관리자": { ko: "QA 관리자", en: "QA Manager" },
      "qa_admin": { ko: "QA 관리자", en: "QA Manager" },
      "문서 관리자": { ko: "문서 관리자", en: "Document Manager" },
      "document_admin": { ko: "문서 관리자", en: "Document Manager" },
      "외부 사용자": { ko: "외부 사용자", en: "External User" },
      "external_user": { ko: "외부 사용자", en: "External User" },
    };

    const roleInfo = roleMap[role];
    if (roleInfo) {
      return language === 'ko' ? roleInfo.ko : roleInfo.en;
    }
    return role || (language === 'ko' ? '알 수 없음' : 'Unknown');
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active": return "default";
      case "inactive": return "secondary";
      case "locked": return "destructive";
      case "pending": return "outline";
      default: return "secondary";
    }
  };

  const getStatusLabel = (status: string) => {
    if (language === 'ko') {
      switch (status) {
        case "active": return "활성";
        case "inactive": return "비활성";
        case "locked": return "잠금";
        case "pending": return "대기중";
        default: return status || "알 수 없음";
      }
    } else {
      switch (status) {
        case "active": return "Active";
        case "inactive": return "Inactive";
        case "locked": return "Locked";
        case "pending": return "Pending";
        default: return status || "Unknown";
      }
    }
  };

  // Track changes for save button
  const checkForChanges = (updates: Partial<{
    name: string;
    email: string;
  }>) => {
    const hasChange = 
      updates.name !== (user?.name || `${user?.lastName || ""}${user?.firstName || ""}`) ||
      updates.email !== (user?.email || "");
    setHasChanges(hasChange);
  };

  const handleNameChange = (value: string) => {
    setEditName(value);
    checkForChanges({ name: value, email: editEmail });
  };

  const handleEmailChange = (value: string) => {
    setEditEmail(value);
    checkForChanges({ name: editName, email: value });
  };

  const updateProfileMutation = useMutation({
    mutationFn: async (data: {
      name?: string;
      email?: string;
    }) => {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to update profile');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: language === 'ko' ? '프로필 업데이트됨' : 'Profile Updated',
        description: language === 'ko' ? '프로필이 성공적으로 업데이트되었습니다.' : 'Your profile has been updated successfully.',
      });
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    },
    onError: () => {
      toast({
        title: language === 'ko' ? '오류' : 'Error',
        description: language === 'ko' ? '프로필 업데이트 중 오류가 발생했습니다.' : 'An error occurred while updating your profile.',
        variant: "destructive",
      });
    },
  });

  // Password change mutation
  const changePasswordMutation = useMutation({
    mutationFn: async (data: {
      currentPassword: string;
      newPassword: string;
    }) => {
      const response = await fetch('/api/user/password', {
        method: 'PATCH',
        body: JSON.stringify(data),
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to change password');
      }
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: language === 'ko' ? '비밀번호 변경됨' : 'Password Changed',
        description: language === 'ko' ? '비밀번호가 성공적으로 변경되었습니다.' : 'Your password has been changed successfully.',
      });
      setShowPasswordChange(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: () => {
      toast({
        title: language === 'ko' ? '오류' : 'Error',
        description: language === 'ko' ? '비밀번호 변경 중 오류가 발생했습니다.' : 'An error occurred while changing your password.',
        variant: "destructive",
      });
    },
  });

  const handleSaveProfile = () => {
    updateProfileMutation.mutate({
      name: editName,
      email: editEmail,
    });
  };

  const handleChangePassword = () => {
    if (newPassword !== confirmPassword) {
      toast({
        title: language === 'ko' ? '오류' : 'Error',
        description: language === 'ko' ? '새 비밀번호가 일치하지 않습니다.' : 'New passwords do not match.',
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: language === 'ko' ? '오류' : 'Error',
        description: language === 'ko' ? '비밀번호는 최소 6자 이상이어야 합니다.' : 'Password must be at least 6 characters long.',
        variant: "destructive",
      });
      return;
    }

    changePasswordMutation.mutate({
      currentPassword,
      newPassword,
    });
  };

  const handleResetChanges = () => {
    if (user) {
      const originalName = user.name || `${user.lastName || ""}${user.firstName || ""}`;
      const originalEmail = user.email || "";
      setEditName(originalName);
      setEditEmail(originalEmail);
      setHasChanges(false);
    }
  };

  const toggleTheme = () => {
    setTheme(actualTheme === 'dark' ? 'light' : 'dark');
  };

  if (isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-lg">
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!user) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-lg">
          <div className="text-center py-8">
            <p>{language === 'ko' ? '사용자 정보를 불러올 수 없습니다.' : 'Unable to load user information.'}</p>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pb-4">
          <DialogTitle className="text-xl font-bold korean-text">
            {language === 'ko' ? '계정 정보' : 'Account Information'}
          </DialogTitle>
          <DialogDescription>
            {language === 'ko' ? '계정 정보를 확인하고 편집할 수 있습니다.' : 'View and edit your account information.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-blue-500" />
              <h3 className="text-lg font-semibold korean-text">
                {language === 'ko' ? '기본 정보' : 'Basic Information'}
              </h3>
            </div>
            
            <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div className="space-y-2">
                <Label htmlFor="editName" className="text-sm text-gray-600 dark:text-gray-400">
                  {language === 'ko' ? '이름' : 'Name'}
                </Label>
                <Input
                  id="editName"
                  value={editName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="korean-text"
                  placeholder={language === 'ko' ? '이름을 입력하세요' : 'Enter your name'}
                />
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {language === 'ko' ? 'ID' : 'Username'}
                </span>
                <span className="font-mono text-sm">{user.username}</span>
              </div>

              <div className="space-y-2">
                <Label htmlFor="editEmail" className="text-sm text-gray-600 dark:text-gray-400">
                  {language === 'ko' ? '이메일' : 'Email'}
                </Label>
                <Input
                  id="editEmail"
                  type="email"
                  value={editEmail}
                  onChange={(e) => handleEmailChange(e.target.value)}
                  placeholder={language === 'ko' ? '이메일을 입력하세요' : 'Enter your email'}
                />
              </div>



              {/* Save/Reset buttons when changes detected */}
              {hasChanges && (
                <div className="flex gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                  <Button 
                    onClick={handleSaveProfile}
                    disabled={updateProfileMutation.isPending}
                    size="sm"
                    className="korean-text flex-1"
                  >
                    <Save className="w-4 h-4 mr-2" />
                    {updateProfileMutation.isPending ? 
                      (language === 'ko' ? '저장 중...' : 'Saving...') : 
                      (language === 'ko' ? '저장' : 'Save')
                    }
                  </Button>
                  
                  <Button 
                    onClick={handleResetChanges}
                    variant="outline"
                    size="sm"
                    className="korean-text flex-1"
                  >
                    <X className="w-4 h-4 mr-2" />
                    {language === 'ko' ? '취소' : 'Reset'}
                  </Button>
                </div>
              )}
            </div>
          </div>


          {/* Organization Information */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Building className="h-5 w-5 text-green-500" />
              <h3 className="text-lg font-semibold korean-text">
                {language === 'ko' ? '조직 정보' : 'Organization Information'}
              </h3>
            </div>
            
            <div className="space-y-3">
              {/* Primary Organization */}
              <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border-l-4 border-green-500">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-green-700 dark:text-green-400">
                    {language === 'ko' ? '소속' : 'Primary Organization'}
                  </span>
                  <Badge variant="outline" className="text-xs korean-text">
                    {user.position || (language === 'ko' ? '직책 미정' : 'Position TBD')}
                  </Badge>
                </div>
                
                <div className="space-y-1">
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {user.upperCategory && (
                      <span className="korean-text font-medium">{user.upperCategory}</span>
                    )}
                    {user.lowerCategory && (
                      <>
                        {user.upperCategory && <span className="mx-1">›</span>}
                        <span className="korean-text font-medium">{user.lowerCategory}</span>
                      </>
                    )}
                    {user.detailCategory && (
                      <>
                        {(user.upperCategory || user.lowerCategory) && <span className="mx-1">›</span>}
                        <span className="korean-text font-medium">{user.detailCategory}</span>
                      </>
                    )}
                  </div>
                  
                  {!user.upperCategory && !user.lowerCategory && !user.detailCategory && (
                    <div className="text-sm text-gray-500 italic">
                      {language === 'ko' ? '소속 조직 정보 없음' : 'No organization information'}
                    </div>
                  )}
                </div>
              </div>
              
              {/* Future: Additional Organizations can be added here */}
              {/* This structure supports multiple organization memberships */}
            </div>
          </div>

          <Separator />

          {/* Theme Settings */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              {actualTheme === 'dark' ? (
                <Moon className="h-5 w-5 text-purple-500" />
              ) : (
                <Sun className="h-5 w-5 text-yellow-500" />
              )}
              <h3 className="text-lg font-semibold korean-text">
                {language === 'ko' ? '테마 설정' : 'Theme Settings'}
              </h3>
            </div>
            
            <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <Button
                onClick={toggleTheme}
                variant="outline"
                className="w-full flex items-center justify-center gap-3 h-12 korean-text"
              >
                {actualTheme === 'dark' ? (
                  <>
                    <Sun className="h-5 w-5" />
                    {language === 'ko' ? '라이트 모드' : 'Light Mode'}
                  </>
                ) : (
                  <>
                    <Moon className="h-5 w-5" />
                    {language === 'ko' ? '다크 모드' : 'Dark Mode'}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Password Change Section */}
          {showPasswordChange && (
            <>
              <Separator />
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-red-500" />
                  <h3 className="text-lg font-semibold korean-text">
                    {language === 'ko' ? '비밀번호 변경' : 'Change Password'}
                  </h3>
                </div>
                
                <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div>
                    <Label htmlFor="currentPassword">
                      {language === 'ko' ? '현재 비밀번호' : 'Current Password'}
                    </Label>
                    <Input
                      id="currentPassword"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                    />
                  </div>
                  
                  <div>
                    <Label htmlFor="newPassword">
                      {language === 'ko' ? '새 비밀번호' : 'New Password'}
                    </Label>
                    <Input
                      id="newPassword"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="confirmPassword">
                      {language === 'ko' ? '새 비밀번호 확인' : 'Confirm New Password'}
                    </Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button 
                      onClick={() => setShowPasswordChange(false)}
                      variant="outline"
                      className="korean-text flex-1"
                    >
                      <X className="w-4 h-4 mr-2" />
                      {language === 'ko' ? '취소' : 'Cancel'}
                    </Button>
                    
                    <Button 
                      onClick={handleChangePassword}
                      disabled={changePasswordMutation.isPending}
                      className="korean-text flex-1"
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      {changePasswordMutation.isPending ? 
                        (language === 'ko' ? '변경 중...' : 'Changing...') : 
                        (language === 'ko' ? '비밀번호 변경' : 'Change Password')
                      }
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Action Buttons */}
          <Separator />
          
          <div className="flex flex-wrap gap-3 pt-4">
            {!showPasswordChange && (
              <Button 
                onClick={() => setShowPasswordChange(true)}
                variant="outline"
                className="korean-text flex-1 min-w-[120px]"
              >
                <Key className="w-4 h-4 mr-2" />
                {language === 'ko' ? '비밀번호 변경' : 'Change Password'}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}