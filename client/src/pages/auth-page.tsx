import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Settings, Globe, Eye, EyeOff, GraduationCap, UserCheck, Shield, User, ChevronDown, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThemeSelector } from "@/components/ThemeSelector";
import { LanguageSelector } from "@/components/LanguageSelector";
import { useLanguage } from "@/contexts/LanguageContext";
import FloatingChatWidget from "@/components/FloatingChatWidget";

import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";

const createLoginSchema = (t: (key: string) => string) => z.object({
  username: z.string().min(1, t('auth.usernameRequired') || "Username is required"),
  password: z.string().min(1, t('auth.passwordRequired') || "Password is required"),
});

const createRegisterSchema = (t: (key: string) => string) => z.object({
  username: z.string().min(1, t('auth.usernameRequired') || "Username is required"),
  password: z.string().min(6, t('auth.passwordMinLength') || "Password must be at least 6 characters"),
  firstName: z.string().min(1, t('auth.firstNameRequired') || "First name is required"),
  lastName: z.string().min(1, t('auth.lastNameRequired') || "Last name is required"),
  email: z.string().email(t('auth.emailInvalid') || "Invalid email").optional().or(z.literal("")),
  userType: z.enum(["student", "faculty"]),
});

const languages: { code: 'ko' | 'en' | 'jp'; flag: string; name: string }[] = [
  { code: 'ko', flag: '🇰🇷', name: '한국어' },
  { code: 'en', flag: '🇺🇸', name: 'English' },
  { code: 'jp', flag: '🇯🇵', name: '日本語' },
];

interface CallNAskRoom {
  id: number;
  title: string;
  embedCode: string;
  callnaskConfig: { maxAgents: number };
  isCallnaskTemplate: boolean;
}

function CallNAskRoomsDropdown() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const { data: rooms, isLoading, error } = useQuery<CallNAskRoom[]>({
    queryKey: ['/api/callnask/rooms'],
  });

  const cloneMutation = useMutation({
    mutationFn: async (roomId: number) => {
      const response = await apiRequest('POST', `/api/callnask/rooms/${roomId}/clone`);
      return await response.json() as CallNAskRoom;
    },
    onSuccess: (newRoom) => {
      console.log('[✅ CLONE] 새 채팅방 생성 완료:', newRoom);
      setLocation(`/callnask/${newRoom.embedCode}`);
    },
    onError: (error: any) => {
      console.error('[❌ CLONE] 채팅방 복사 실패:', error);
      const errorMessage = error?.message || '채팅방을 생성하는 중 오류가 발생했습니다.';
      toast({
        title: '오류',
        description: errorMessage,
        variant: 'destructive',
      });
    },
  });

  console.log('[CALLNASK DROPDOWN]', { rooms, isLoading, error });

  // ✅ 템플릿 채팅방만 필터링
  const templateRooms = rooms?.filter(room => room.isCallnaskTemplate) || [];

  if (isLoading || templateRooms.length === 0) {
    console.log('[CALLNASK DROPDOWN] 숨김:', { isLoading, hasRooms: !!rooms, templateCount: templateRooms.length });
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button 
          variant="outline" 
          size="sm"
          className="border-gray-200 hover:bg-gray-50"
          data-testid="button-callnask-rooms"
          disabled={cloneMutation.isPending}
        >
          <MessageCircle className="w-4 h-4 mr-2" />
          <span className="text-sm">AI 채팅방</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-[220px]">
        {templateRooms.map((room) => (
          <DropdownMenuItem
            key={room.embedCode}
            onClick={() => cloneMutation.mutate(room.id)}
            className="cursor-pointer"
            data-testid={`menu-item-room-${room.embedCode}`}
            disabled={cloneMutation.isPending}
          >
            <MessageCircle className="w-4 h-4 mr-2" />
            <span>{room.title}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface TestUser {
  id: string;
  username: string;
  password: string;
  name: string;
  email: string;
  age: number;
  gender: string;
  religion: string;
  occupation: string;
}

const testUsers: TestUser[] = [
  {
    id: "1",
    username: "test001",
    password: "test123",
    name: "박지후",
    email: "park.jihoo@elementary.ac.kr",
    age: 8,
    gender: "남성",
    religion: "기독교",
    occupation: "초등학생 2학년 (아동 전기)"
  },
  {
    id: "2",
    username: "test002",
    password: "test123",
    name: "최유나",
    email: "choi.yuna@elementary.ac.kr",
    age: 11,
    gender: "여성",
    religion: "불교",
    occupation: "초등학생 5학년 (아동 후기)"
  },
  {
    id: "3",
    username: "test003",
    password: "test123",
    name: "이민수",
    email: "lee.minsu@middle.ac.kr",
    age: 14,
    gender: "남성",
    religion: "천주교",
    occupation: "중학생 2학년 (초기 청소년기)"
  },
  {
    id: "4",
    username: "test004",
    password: "test123",
    name: "김민호",
    email: "kim.minho@university.ac.kr",
    age: 17,
    gender: "남성",
    religion: "기독교",
    occupation: "고등학생 (청소년기)"
  },
  {
    id: "5",
    username: "test005",
    password: "test123",
    name: "이수진",
    email: "lee.sujin@university.ac.kr",
    age: 20,
    gender: "여성",
    religion: "불교",
    occupation: "컴퓨터공학과 학생 (청년 전기)"
  },
  {
    id: "6",
    username: "test006",
    password: "test123",
    name: "최윤호",
    email: "choi.yunho@university.ac.kr",
    age: 22,
    gender: "남성",
    religion: "무교",
    occupation: "경영학과 학생 (청년 전기)"
  },
  {
    id: "7",
    username: "test007",
    password: "test123",
    name: "한민정",
    email: "han.minjung@university.ac.kr",
    age: 24,
    gender: "여성",
    religion: "불교",
    occupation: "심리학과 대학원생 (청년 전기)"
  },
  {
    id: "8",
    username: "test008",
    password: "test123",
    name: "강승현",
    email: "kang.seunghyun@university.ac.kr",
    age: 28,
    gender: "남성",
    religion: "천주교",
    occupation: "화학과 박사과정 (청년 후기)"
  },
  {
    id: "9",
    username: "test009",
    password: "test123",
    name: "윤수영",
    email: "yoon.sooyoung@university.ac.kr",
    age: 33,
    gender: "여성",
    religion: "기독교",
    occupation: "건축학과 연구원 (청년 후기)"
  },
  {
    id: "10",
    username: "test010",
    password: "test123",
    name: "정혜진",
    email: "jung.hyejin@university.ac.kr",
    age: 38,
    gender: "여성",
    religion: "기독교",
    occupation: "영어영문학과 교수 (중년 전기)"
  },
  {
    id: "11",
    username: "test011",
    password: "test123",
    name: "박지원",
    email: "park.jiwon@university.ac.kr",
    age: 45,
    gender: "여성",
    religion: "천주교",
    occupation: "수학과 교수 (중년 전기)"
  },
  {
    id: "12",
    username: "test012",
    password: "test123",
    name: "오지훈",
    email: "oh.jihoon@university.ac.kr",
    age: 56,
    gender: "남성",
    religion: "무교",
    occupation: "철학과 교수 (중년 후기)"
  },
  {
    id: "13",
    username: "test013",
    password: "test123",
    name: "임동혁",
    email: "lim.donghyuk@university.ac.kr",
    age: 68,
    gender: "남성",
    religion: "천주교",
    occupation: "법학과 명예교수 (원숙기)"
  }
];

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const { t, language, setLanguage } = useLanguage();
  const [showPassword, setShowPassword] = useState(false);
  const [selectedAccountType, setSelectedAccountType] = useState("");
  const [selectedTestUser, setSelectedTestUser] = useState<string>("");

  const loginSchema = createLoginSchema(t);
  const registerSchema = createRegisterSchema(t);

  type LoginData = z.infer<typeof loginSchema>;
  type RegisterData = z.infer<typeof registerSchema>;

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const registerForm = useForm<RegisterData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      username: "",
      password: "",
      firstName: "",
      lastName: "",
      email: "",
      userType: "student",
    },
  });

  // Handle redirect with useEffect to avoid hooks issue
  useEffect(() => {
    if (user) {
      if (user.username === "master_admin") {
        setLocation("/master-admin");
      } else {
        setLocation("/");
      }
    }
  }, [user, setLocation]);

  const loginMutation = useMutation({
    mutationFn: async (data: LoginData) => {
      const response = await apiRequest("POST", "/api/login", data);
      return response.json();
    },
    onSuccess: async (userData) => {
      // Invalidate and refetch user data to ensure proper authentication state
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      await queryClient.refetchQueries({ queryKey: ["/api/user"] });
      
      // 🚫 리다이렉션 중복 방지: useEffect에서 처리하므로 여기서는 제거
      // useEffect가 user 상태 변경을 감지해서 자동으로 리다이렉션 처리
    },
    onError: (error: Error) => {
      toast({
        title: t('auth.loginFailed'),
        description: t('auth.loginError'),
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (data: RegisterData) => {
      const response = await apiRequest("POST", "/api/register", data);
      return response.json();
    },
    onSuccess: async () => {
      // Invalidate and refetch user data to ensure proper authentication state
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      await queryClient.refetchQueries({ queryKey: ["/api/user"] });
      
      toast({
        title: "회원가입 성공",
        description: "계정이 생성되었습니다. 로그인되었습니다.",
      });
      
      // Small delay to ensure auth state is updated before navigation
      setTimeout(() => {
        setLocation("/");
      }, 100);
    },
    onError: (error: Error) => {
      toast({
        title: "회원가입 실패",
        description: "이미 존재하는 학번/교번이거나 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const onLogin = (data: LoginData) => {
    console.log("로그인 시도:", data);
    loginMutation.mutate(data);
  };

  const onRegister = (data: RegisterData) => {
    registerMutation.mutate(data);
  };

  const handleTestUserSelect = (userId: string) => {
    if (!userId) return;
    
    const user = testUsers.find(u => u.id === userId);
    if (!user) return;
    
    setSelectedTestUser(userId);
    
    loginForm.setValue("username", user.username);
    loginForm.setValue("password", user.password);
    
    setTimeout(() => {
      const formData = { username: user.username, password: user.password };
      onLogin(formData);
    }, 100);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" 
         style={{ 
           background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
         }}>
      {/* Settings dropdown in top right */}
      <div className="fixed top-4 right-4 z-50">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button 
              variant="outline" 
              size="sm"
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <Settings className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1">
              <div className="text-sm text-muted-foreground mb-2">{t('auth.themeSettings')}</div>
              <ThemeSelector />
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="w-full max-w-md mx-auto">
        {/* Main Login Card */}
        <div className="bg-white rounded-3xl shadow-2xl overflow-hidden">
          {/* Header Section */}
          <div className="px-8 pt-12 pb-8 text-center">
            <h1 className="text-3xl font-bold mb-2" style={{ color: '#2056DF' }}>
              {t('auth.title')}
            </h1>
            <p className="text-gray-700 text-sm">
              {t('auth.subtitle')}
            </p>
          </div>

          {/* Form Section */}
          <div className="px-8 pb-8">
            <form onSubmit={(e) => {
              console.log("폼 제출 이벤트");
              loginForm.handleSubmit(onLogin)(e);
            }} className="space-y-6">
              
              

              {/* Username Field */}
              <div>
                <label className="block text-gray-500 text-sm mb-2">계정</label>
                <input
                  type="text"
                  placeholder="계정/이메일 입력"
                  className="w-full px-4 py-4 border-0 border-b-2 border-gray-200 bg-transparent text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-colors text-lg"
                  {...loginForm.register("username")}
                />
                {loginForm.formState.errors.username && (
                  <p className="text-sm text-red-500 mt-1">
                    {loginForm.formState.errors.username.message}
                  </p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-gray-500 text-sm mb-2">{t('auth.password')}</label>
                <div className="relative">
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    placeholder={t('auth.passwordPlaceholder')}
                    className="w-full px-4 py-4 border-0 border-b-2 border-gray-200 bg-transparent text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none transition-colors text-lg pr-12"
                    {...loginForm.register("password")}
                  />
                  <button
                    type="button"
                    className="absolute right-0 top-1/2 transform -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {loginForm.formState.errors.password && (
                  <p className="text-sm text-red-500 mt-1">
                    {loginForm.formState.errors.password.message}
                  </p>
                )}
              </div>

              {/* Test User Selection */}
              <div>
                <label className="block text-gray-500 text-sm mb-2">테스트 사용자 선택</label>
                <Select value={selectedTestUser} onValueChange={handleTestUserSelect}>
                  <SelectTrigger className="w-full border-0 border-b-2 border-gray-200 bg-transparent rounded-none focus:border-blue-500 px-2 py-3">
                    <SelectValue placeholder="사용자를 선택하세요" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[400px]">
                    {testUsers.map((user) => (
                      <SelectItem key={user.id} value={user.id} className="py-3">
                        <div className="flex flex-col gap-1">
                          <div className="font-medium">
                            {user.id}. {user.name} ({user.username})
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {user.email}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-500">
                            {user.gender}, {user.age}세 | {user.religion} | {user.occupation}
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Account Type */}
              <div>
                <label className="block text-gray-500 text-sm mb-4">{t('auth.demoAccounts')}</label>
                <div className="grid grid-cols-3 gap-3">
                  {/* 사용자계정 */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAccountType("student");
                      loginForm.setValue("username", "user1082");
                      loginForm.setValue("password", "student123");
                      // 사용자 계정 자동 로그인
                      setTimeout(() => {
                        const formData = { username: "user1082", password: "student123" };
                        onLogin(formData);
                      }, 100);
                    }}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center space-y-2 ${
                      selectedAccountType === "student" 
                        ? "border-blue-500 bg-blue-50 text-blue-700" 
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    <User className="w-6 h-6" />
                    <span className="text-xs font-medium">사용자 계정</span>
                  </button>

                  {/* 운영자계정 */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAccountType("faculty");
                      loginForm.setValue("username", "user1081");
                      loginForm.setValue("password", "faculty123");
                      // 운영자 계정 자동 로그인
                      setTimeout(() => {
                        const formData = { username: "user1081", password: "faculty123" };
                        onLogin(formData);
                      }, 100);
                    }}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center space-y-2 ${
                      selectedAccountType === "faculty" 
                        ? "border-blue-500 bg-blue-50 text-blue-700" 
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    <Settings className="w-6 h-6" />
                    <span className="text-xs font-medium">운영자 계정</span>
                  </button>

                  {/* 서비스 관리자계정 */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAccountType("master");
                      loginForm.setValue("username", "master_admin");
                      loginForm.setValue("password", "MasterAdmin2024!");
                      // 서비스 관리자 계정은 자동 로그인
                      setTimeout(() => {
                        const formData = { username: "master_admin", password: "MasterAdmin2024!" };
                        onLogin(formData);
                      }, 100);
                    }}
                    className={`p-4 rounded-xl border-2 transition-all duration-200 flex flex-col items-center space-y-2 ${
                      selectedAccountType === "master" 
                        ? "border-blue-500 bg-blue-50 text-blue-700" 
                        : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    <Shield className="w-6 h-6" />
                    <span className="text-xs font-medium">
                      서비스 관리자<br />계정
                    </span>
                  </button>
                </div>
              </div>

              {/* Sign Up Button */}
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white py-4 rounded-2xl font-semibold text-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? t('auth.loggingIn') : t('auth.loginButton')}
              </button>

              
            </form>

            {/* Language & CallNAsk Rooms */}
            <div className="flex justify-center gap-3 mt-6 pb-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button 
                    variant="outline" 
                    size="sm"
                    className="border-gray-200 hover:bg-gray-50"
                  >
                    <Globe className="w-4 h-4 mr-2" />
                    <span className="text-sm">{languages.find(lang => lang.code === language)?.name}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-[160px]">
                  {languages.map((lang) => (
                    <DropdownMenuItem
                      key={lang.code}
                      onClick={() => setLanguage(lang.code)}
                      className={`cursor-pointer ${language === lang.code ? 'bg-accent' : ''}`}
                    >
                      <span className="mr-2">{lang.flag}</span>
                      <span>{lang.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              
              <CallNAskRoomsDropdown />
            </div>
          </div>
        </div>
      </div>

      {/* Floating Chat Widget */}
      <FloatingChatWidget embedCode="3f419167-ada2-4361-be9d-5d9dd9c0d60f" />
    </div>
  );
}