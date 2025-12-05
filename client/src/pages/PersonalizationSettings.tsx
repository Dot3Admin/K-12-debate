import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Save,
  X,
  ArrowLeft,
  Sparkles
} from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

const LIFE_STAGE_OPTIONS = [
  { value: "EC", label: "아동 전기 (7-9세)", labelEn: "Early Childhood (7-9)" },
  { value: "LC", label: "아동 후기 (10-12세)", labelEn: "Late Childhood (10-12)" },
  { value: "EA", label: "초기 청소년기 (13-15세)", labelEn: "Early Adolescence (13-15)" },
  { value: "AD", label: "청소년기 (16-18세)", labelEn: "Adolescence (16-18)" },
  { value: "YA1", label: "청년 전기 (19-25세)", labelEn: "Emerging Adulthood (19-25)" },
  { value: "YA2", label: "청년 후기 (26-35세)", labelEn: "Early Adulthood (26-35)" },
  { value: "MA1", label: "중년 전기 (36-50세)", labelEn: "Midlife Transition (36-50)" },
  { value: "MA2", label: "중년 후기 (51-65세)", labelEn: "Mature Adulthood (51-65)" },
  { value: "FS", label: "원숙기 (66세 이상)", labelEn: "Fulfillment Stage (66+)" },
];

interface UserData {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  nickname?: string;
  age?: number;
  gender?: string;
  country?: string;
  religion?: string;
  occupation?: string;
  lifeStage?: string;
}

export default function PersonalizationSettings() {
  const { t, language } = useLanguage();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  // Form states for inline editing
  const [editNickname, setEditNickname] = useState("");
  const [editGender, setEditGender] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [editReligion, setEditReligion] = useState("");
  const [editOccupation, setEditOccupation] = useState("");
  const [editLifeStage, setEditLifeStage] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const { data: user, isLoading } = useQuery<UserData>({
    queryKey: ['/api/user'],
  });

  // Initialize form when user data is loaded
  useEffect(() => {
    if (user) {
      setEditNickname(user.nickname || "");
      setEditGender(user.gender || "");
      setEditCountry(user.country || "");
      setEditReligion(user.religion || "");
      setEditOccupation(user.occupation || "");
      setEditLifeStage(user.lifeStage || "");
      setHasChanges(false);
    }
  }, [user]);

  // Track changes
  const handleNicknameChange = (value: string) => {
    setEditNickname(value);
    setHasChanges(true);
  };

  const handleGenderChange = (value: string) => {
    setEditGender(value);
    setHasChanges(true);
  };

  const handleCountryChange = (value: string) => {
    setEditCountry(value);
    setHasChanges(true);
  };

  const handleReligionChange = (value: string) => {
    setEditReligion(value);
    setHasChanges(true);
  };

  const handleOccupationChange = (value: string) => {
    setEditOccupation(value);
    setHasChanges(true);
  };

  const handleLifeStageChange = (value: string) => {
    setEditLifeStage(value);
    setHasChanges(true);
  };

  const updateProfileMutation = useMutation({
    mutationFn: async (data: Partial<UserData>) => {
      return await apiRequest("PATCH", "/api/user/profile", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      toast({
        title: language === 'ko' ? '프로필 업데이트 성공' : 'Profile Updated',
        description: language === 'ko' ? '프로필 정보가 성공적으로 업데이트되었습니다.' : 'Your profile has been updated successfully.',
        variant: "default",
      });
      setHasChanges(false);
    },
    onError: (error: Error) => {
      console.error('Profile update failed:', error);
      toast({
        title: language === 'ko' ? '프로필 업데이트 실패' : 'Update Failed',
        description: error.message || (language === 'ko' ? '프로필 업데이트에 실패했습니다.' : 'Failed to update profile.'),
        variant: "destructive",
      });
    },
  });

  const handleSaveProfile = async () => {
    const updatedProfile: Partial<UserData> = {
      nickname: editNickname,
      gender: editGender,
      country: editCountry,
      religion: editReligion,
      occupation: editOccupation,
      lifeStage: editLifeStage || undefined,
    };
    
    console.log('[프론트엔드] 저장할 프로필 데이터:', updatedProfile);
    console.log('[프론트엔드] editLifeStage 값:', editLifeStage);
    
    updateProfileMutation.mutate(updatedProfile);
  };

  const handleResetChanges = () => {
    if (user) {
      setEditNickname(user.nickname || "");
      setEditGender(user.gender || "");
      setEditCountry(user.country || "");
      setEditReligion(user.religion || "");
      setEditOccupation(user.occupation || "");
      setEditLifeStage(user.lifeStage || "");
      setHasChanges(false);
    }
  };

  const handleGoBack = () => {
    const previousPath = sessionStorage.getItem('previousPath');
    if (previousPath && previousPath !== '/personalization') {
      sessionStorage.removeItem('previousPath');
      setLocation(previousPath);
    } else {
      setLocation('/');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {language === 'ko' ? '로딩 중...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleGoBack}
              data-testid="button-back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-3">
              <Sparkles className="h-6 w-6 text-purple-500" />
              <h1 className="text-2xl font-bold korean-text">
                {language === 'ko' ? '개인화 설정' : 'Personalization'}
              </h1>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          {/* Description */}
          <div className="mb-6">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {language === 'ko' 
                ? '챗봇이 더 좋은 답변을 제공하기 위한 정보입니다. 선택 사항이며, 정보를 넣은 만큼 답변의 퀄리티가 좋아집니다.' 
                : 'This information helps chatbots provide better answers. All fields are optional, and the more information you provide, the better the response quality.'}
            </p>
          </div>
          
          {/* Form */}
          <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="space-y-2">
              <Label htmlFor="editNickname" className="text-sm text-gray-600 dark:text-gray-400">
                {language === 'ko' ? '호칭' : 'Nickname'}
                <span className="text-xs text-gray-500 ml-2">
                  {language === 'ko' ? '(챗봇이 부르는 이름, 예: 대표님, 홍교수)' : '(How chatbots address you, e.g., Professor, Director)'}
                </span>
              </Label>
              <Input
                id="editNickname"
                data-testid="input-nickname"
                value={editNickname}
                onChange={(e) => handleNicknameChange(e.target.value)}
                className="korean-text"
                placeholder={language === 'ko' ? '예: 대표님, 홍교수' : 'e.g., Professor, Director'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editLifeStage" className="text-sm text-gray-600 dark:text-gray-400">
                {language === 'ko' ? '연령 단계' : 'Life Stage'}
                <span className="text-xs text-gray-500 ml-2">
                  {language === 'ko' ? '(연령대에 맞는 말투 및 주제 조정)' : '(Age-appropriate tone and topics)'}
                </span>
              </Label>
              <Select
                value={editLifeStage}
                onValueChange={handleLifeStageChange}
              >
                <SelectTrigger id="editLifeStage" data-testid="select-life-stage" className="korean-text">
                  <SelectValue placeholder={language === 'ko' ? '연령 단계를 선택하세요' : 'Select your life stage'} />
                </SelectTrigger>
                <SelectContent>
                  {LIFE_STAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} className="korean-text">
                      {language === 'ko' ? option.label : option.labelEn}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="editGender" className="text-sm text-gray-600 dark:text-gray-400">
                {language === 'ko' ? '성별' : 'Gender'}
              </Label>
              <Input
                id="editGender"
                data-testid="input-gender"
                value={editGender}
                onChange={(e) => handleGenderChange(e.target.value)}
                className="korean-text"
                placeholder={language === 'ko' ? '예: 남성, 여성' : 'e.g., Male, Female'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editCountry" className="text-sm text-gray-600 dark:text-gray-400">
                {language === 'ko' ? '국가' : 'Country'}
                <span className="text-xs text-gray-500 ml-2">
                  {language === 'ko' ? '(역사·인물 평가, 가치관 반영)' : '(Historical perspective, cultural context)'}
                </span>
              </Label>
              <Input
                id="editCountry"
                data-testid="input-country"
                value={editCountry}
                onChange={(e) => handleCountryChange(e.target.value)}
                className="korean-text"
                placeholder={language === 'ko' ? '예: 대한민국' : 'e.g., South Korea'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editReligion" className="text-sm text-gray-600 dark:text-gray-400">
                {language === 'ko' ? '종교' : 'Religion'}
                <span className="text-xs text-gray-500 ml-2">
                  {language === 'ko' ? '(세계관 반영)' : '(Worldview consideration)'}
                </span>
              </Label>
              <Input
                id="editReligion"
                data-testid="input-religion"
                value={editReligion}
                onChange={(e) => handleReligionChange(e.target.value)}
                className="korean-text"
                placeholder={language === 'ko' ? '예: 기독교, 불교' : 'e.g., Christianity, Buddhism'}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="editOccupation" className="text-sm text-gray-600 dark:text-gray-400">
                {language === 'ko' ? '직업 / 하는 일 / 역할' : 'Occupation / Role'}
                <span className="text-xs text-gray-500 ml-2">
                  {language === 'ko' ? '(맥락 적합성 향상)' : '(Context relevance improvement)'}
                </span>
              </Label>
              <Input
                id="editOccupation"
                data-testid="input-occupation"
                value={editOccupation}
                onChange={(e) => handleOccupationChange(e.target.value)}
                className="korean-text"
                placeholder={language === 'ko' ? '예: 교수, 학생, CEO' : 'e.g., Professor, Student, CEO'}
              />
            </div>

            {/* Save/Reset buttons when changes detected */}
            {hasChanges && (
              <div className="flex gap-2 pt-4 border-t border-gray-200 dark:border-gray-700">
                <Button 
                  onClick={handleSaveProfile}
                  disabled={updateProfileMutation.isPending}
                  size="sm"
                  className="korean-text flex-1"
                  data-testid="button-save-profile"
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
                  data-testid="button-reset-profile"
                >
                  <X className="w-4 h-4 mr-2" />
                  {language === 'ko' ? '취소' : 'Reset'}
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
