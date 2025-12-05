import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, User, UserCheck, Activity, Bell, MessageCircle, CreditCard, Settings } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";

export default function AgentManagement() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { t } = useLanguage();
  const { user } = useAuth();

  // Check if user has agent management permissions
  const hasAgentManagementRole = user?.role === 'agent_admin' || user?.role === 'master_admin' || user?.userType === 'admin' || user?.id === 'master_admin';

  // Placeholder for pending requests count
  const [pendingRequests] = useState(3);

  // Settings item component matching the reference image
  const SettingItem = ({ 
    icon: Icon, 
    title, 
    subtitle, 
    onClick, 
    badge 
  }: { 
    icon: any; 
    title: string; 
    subtitle: string; 
    onClick?: () => void; 
    badge?: number | null;
  }) => (
    <button 
      onClick={onClick}
      className="w-full flex items-center px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors"
    >
      <div className="mr-4">
        <Icon className="w-6 h-6 text-gray-700" />
      </div>
      <div className="flex-1 text-left">
        <div className="text-gray-900 font-normal">{title}</div>
        {subtitle && <div className="text-gray-500 text-sm mt-0.5">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-2">
        {badge && (
          <span className="bg-red-500 text-white text-xs font-semibold px-2 py-0.5 rounded-full">
            {badge}
          </span>
        )}
        <ChevronRight className="w-5 h-5 text-gray-400" />
      </div>
    </button>
  );

  // Section header component
  const SectionHeader = ({ title }: { title: string }) => (
    <div className="px-4 py-2 text-sm font-semibold text-gray-500 bg-gray-50">
      {title}
    </div>
  );

  // Show access denied message if user doesn't have permissions
  if (!hasAgentManagementRole) {
    return (
      <div className="px-4 py-6">
        <div className="text-center korean-text">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
            <Settings className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">{t('agent.noManagementPermission')}</h3>
          <p className="text-muted-foreground">
            에이전트 관리 권한이 없습니다. 관리자에게 문의하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="pb-6">
      {/* Agent Management Section */}
      <div className="bg-white mt-3">
        <SectionHeader title="에이전트 관리" />
        <div className="border-b border-gray-200">
          <SettingItem
            icon={User}
            title="에이전트 관리"
            subtitle="이름, 관계, 언어, 관계 등"
            onClick={() => setLocation('/agent-management')}
          />
        </div>
      </div>

      {/* Member Management */}
      <div className="bg-white mt-3">
        <SectionHeader title="회원 관리" />
        <div className="border-b border-gray-200">
          <SettingItem
            icon={UserCheck}
            title="회원 신청 관리"
            subtitle="가입 신청 승인 및 차단"
            badge={pendingRequests > 0 ? pendingRequests : null}
            onClick={() => {
              toast({
                title: "준비 중",
                description: "회원 신청 관리 기능은 곧 제공됩니다.",
              });
            }}
          />
          <SettingItem
            icon={Activity}
            title="고민 및 질문 분석"
            subtitle="고민 / 질문 / 연령 / 지역 / 성별 데이터 분석"
            onClick={() => {
              toast({
                title: "준비 중",
                description: "고민 및 질문 분석 기능은 곧 제공됩니다.",
              });
            }}
          />
        </div>
      </div>

      {/* App Settings */}
      <div className="bg-white mt-3">
        <SectionHeader title="앱 설정" />
        <div className="border-b border-gray-200">
          <SettingItem
            icon={Bell}
            title="알림 설정"
            subtitle="푸시 알림 및 이메일 설정"
            onClick={() => {
              toast({
                title: "준비 중",
                description: "알림 설정 기능은 곧 제공됩니다.",
              });
            }}
          />
        </div>
      </div>

      {/* Community Features */}
      <div className="bg-white mt-3">
        <SectionHeader title="커뮤니티" />
        <div className="border-b border-gray-200">
          <SettingItem
            icon={MessageCircle}
            title="익명 고민 상담"
            subtitle="교인들의 익명 고민 확인 및 답변"
            onClick={() => {
              toast({
                title: "준비 중",
                description: "익명 고민 상담 기능은 곧 제공됩니다.",
              });
            }}
          />
        </div>
      </div>

      {/* Payment */}
      <div className="bg-white mt-3">
        <SectionHeader title="결제" />
        <div className="border-b border-gray-200">
          <SettingItem
            icon={CreditCard}
            title="결제 관리"
            subtitle="헌금 내역 및 결제 수단 관리"
            onClick={() => {
              toast({
                title: "준비 중",
                description: "결제 관리 기능은 곧 제공됩니다.",
              });
            }}
          />
        </div>
      </div>
    </div>
  );
}
