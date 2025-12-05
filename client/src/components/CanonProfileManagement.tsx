import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { BookOpen, Edit2, Trash2, Plus } from "lucide-react";

// Canon Profile Schema
const canonProfileSchema = z.object({
  name: z.string().min(1, "이름을 입력하세요"),
  description: z.string().min(1, "설명을 입력하세요"),
  domain: z.string().min(1, "도메인을 입력하세요"),
  responsibility: z.string().min(10, "책임 내용을 10자 이상 입력하세요"),
  factRules: z.string().min(1, "사실 규칙을 입력하세요 (줄바꿈으로 구분)"),
  prohibitedClaims: z.string().min(1, "금지 사항을 입력하세요 (줄바꿈으로 구분)"),
  requiredElements: z.string().min(1, "필수 요소를 입력하세요 (줄바꿈으로 구분)"),
});

type CanonProfileFormData = z.infer<typeof canonProfileSchema>;

interface CanonProfile {
  id: number;
  name: string;
  description: string;
  domain: string;
  responsibility: string;
  rules: {
    factRules: string[];
    prohibitedClaims: string[];
    requiredElements: string[];
    sources: string[];
  };
}

export function CanonProfileManagement() {
  const { toast } = useToast();
  const [editingProfile, setEditingProfile] = useState<CanonProfile | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Fetch Canon Profiles
  const { data: profiles, isLoading } = useQuery<CanonProfile[]>({
    queryKey: ['/api/admin/canon-profiles'],
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: CanonProfileFormData) => {
      const payload = {
        name: data.name,
        description: data.description,
        domain: data.domain,
        responsibility: data.responsibility,
        rules: {
          factRules: data.factRules.split('\n').filter(r => r.trim()),
          prohibitedClaims: data.prohibitedClaims.split('\n').filter(r => r.trim()),
          requiredElements: data.requiredElements.split('\n').filter(r => r.trim()),
          sources: []
        }
      };

      if (editingProfile) {
        return apiRequest(`/api/admin/canon-profiles/${editingProfile.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        return apiRequest('/api/admin/canon-profiles', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/canon-profiles'] });
      toast({
        title: editingProfile ? "Canon Profile 수정 완료" : "Canon Profile 생성 완료",
        description: "변경사항이 저장되었습니다.",
      });
      setIsDialogOpen(false);
      setEditingProfile(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "저장 실패",
        description: error.message || "Canon Profile 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/admin/canon-profiles/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/canon-profiles'] });
      toast({
        title: "Canon Profile 삭제 완료",
        description: "Canon Profile이 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "Canon Profile 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  // Form
  const form = useForm<CanonProfileFormData>({
    resolver: zodResolver(canonProfileSchema),
    defaultValues: {
      name: "",
      description: "",
      domain: "",
      responsibility: "",
      factRules: "",
      prohibitedClaims: "",
      requiredElements: "",
    },
  });

  const handleEdit = (profile: CanonProfile) => {
    setEditingProfile(profile);
    form.reset({
      name: profile.name,
      description: profile.description,
      domain: profile.domain,
      responsibility: profile.responsibility,
      factRules: profile.rules.factRules.join('\n'),
      prohibitedClaims: profile.rules.prohibitedClaims.join('\n'),
      requiredElements: profile.rules.requiredElements.join('\n'),
    });
    setIsDialogOpen(true);
  };

  const handleNew = () => {
    setEditingProfile(null);
    form.reset({
      name: "",
      description: "",
      domain: "",
      responsibility: "",
      factRules: "",
      prohibitedClaims: "",
      requiredElements: "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: CanonProfileFormData) => {
    saveMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Canon Profile 관리</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleNew} data-testid="button-new-canon">
              <Plus className="w-4 h-4 mr-2" />
              새 Canon Profile
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingProfile ? "Canon Profile 수정" : "Canon Profile 생성"}
              </DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>이름 *</FormLabel>
                      <FormControl>
                        <Input placeholder="Bible_Canon" {...field} data-testid="input-canon-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>설명 *</FormLabel>
                      <FormControl>
                        <Input placeholder="성경적 사실과 교리를 정확하게 전달하는 Canon" {...field} data-testid="input-canon-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="domain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>도메인 *</FormLabel>
                      <FormControl>
                        <Input placeholder="biblical, educational, medical 등" {...field} data-testid="input-canon-domain" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="responsibility"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>역할 책임 (4단계 구조) *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="1. 공감 표현&#10;2. 원인 탐색&#10;3. 방향 제시&#10;4. 실천 대안"
                          rows={6}
                          {...field}
                          data-testid="textarea-canon-responsibility"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="factRules"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>✅ 사실 규칙 (줄바꿈으로 구분) *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="성경 인용 시 개역개정 성경의 한국어를 그대로 사용&#10;역사적 사실을 왜곡하지 않음"
                          rows={4}
                          {...field}
                          data-testid="textarea-canon-fact-rules"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prohibitedClaims"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>❌ 금지 사항 (줄바꿈으로 구분) *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="성경 내용과 모순되는 주장&#10;신앙 실천 회피에 무조건 동조"
                          rows={4}
                          {...field}
                          data-testid="textarea-canon-prohibited"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="requiredElements"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>⭐ 필수 포함 요소 (줄바꿈으로 구분) *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="성경 말씀 1개 이상 인용 (장절 명시)&#10;원인 탐색 질문 포함&#10;공동체의 중요성 언급"
                          rows={4}
                          {...field}
                          data-testid="textarea-canon-required"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex justify-end space-x-2 pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setIsDialogOpen(false);
                      setEditingProfile(null);
                      form.reset();
                    }}
                    data-testid="button-cancel"
                  >
                    취소
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={saveMutation.isPending}
                    data-testid="button-save-canon"
                  >
                    {saveMutation.isPending ? "저장 중..." : "저장"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {profiles?.map((profile) => (
          <Card key={profile.id} data-testid={`card-canon-${profile.id}`}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-blue-600" />
                  <CardTitle className="text-lg">{profile.name}</CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(profile)}
                    data-testid={`button-edit-canon-${profile.id}`}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (confirm(`"${profile.name}"를 삭제하시겠습니까?`)) {
                        deleteMutation.mutate(profile.id);
                      }
                    }}
                    data-testid={`button-delete-canon-${profile.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">설명</div>
                <div className="text-sm">{profile.description}</div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">도메인</div>
                <div className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded inline-block">
                  {profile.domain}
                </div>
              </div>
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">역할 책임</div>
                <div className="text-xs bg-blue-50 dark:bg-blue-900/20 p-2 rounded whitespace-pre-line">
                  {profile.responsibility}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-gray-600 dark:text-gray-400">✅ 사실 규칙</div>
                  <div className="font-bold">{profile.rules.factRules.length}개</div>
                </div>
                <div>
                  <div className="text-gray-600 dark:text-gray-400">❌ 금지 사항</div>
                  <div className="font-bold">{profile.rules.prohibitedClaims.length}개</div>
                </div>
                <div>
                  <div className="text-gray-600 dark:text-gray-400">⭐ 필수 요소</div>
                  <div className="font-bold">{profile.rules.requiredElements.length}개</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
