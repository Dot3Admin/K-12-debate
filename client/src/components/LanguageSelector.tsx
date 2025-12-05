import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage, Language } from "@/contexts/LanguageContext";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

const languages: { code: Language; flag: string; name: string }[] = [
  { code: 'ko', flag: '🇰🇷', name: '한국어' },
  { code: 'en', flag: '🇺🇸', name: 'English' },
  { code: 'jp', flag: '🇯🇵', name: '日本語' },
];

export function LanguageSelector() {
  const { language, setLanguage, t } = useLanguage();
  const { toast } = useToast();
  const { user } = useAuth();
  const currentLang = languages.find(lang => lang.code === language);

  const updateLanguageMutation = useMutation({
    mutationFn: async (newLanguage: Language) => {
      return await apiRequest('PATCH', '/api/user/profile', { preferredLanguage: newLanguage });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
    },
    onError: () => {
      toast({
        title: t('error.updateFailed'),
        description: t('error.languageUpdateFailed'),
        variant: "destructive",
      });
    },
  });

  const handleLanguageChange = (newLanguage: Language) => {
    setLanguage(newLanguage);
    
    if (user) {
      updateLanguageMutation.mutate(newLanguage);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 px-3 w-full justify-start hover:bg-transparent">
          <Globe className="w-4 h-4 mr-2" />
          <span className="text-sm mr-1">{currentLang?.flag}</span>
          <span className="text-sm font-medium">{currentLang?.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {languages.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleLanguageChange(lang.code)}
            className={`cursor-pointer ${language === lang.code ? 'bg-accent' : ''}`}
            data-testid={`language-option-${lang.code}`}
          >
            <span className="mr-2">{lang.flag}</span>
            <span>{lang.name}</span>
            {language === lang.code && <span className="ml-auto text-xs">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}