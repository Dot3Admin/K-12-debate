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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Smile, Edit2, Trash2, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Tone Profile Schema
const toneProfileSchema = z.object({
  name: z.string().min(1, "이름을 입력하세요"),
  description: z.string().min(1, "설명을 입력하세요"),
  speakingStyle: z.string().min(1, "말투 스타일을 입력하세요"),
  intensity: z.preprocess((val) => (val === '' ? undefined : Number(val)), z.number().min(1).max(10)),
  emotionalExpression: z.string().min(1, "감정 표현을 입력하세요"),
  humorEnabled: z.boolean(),
  humorStyles: z.string().optional(),
  speakingStyleRules: z.string().min(1, "말투 규칙을 입력하세요"),
  emotionalExpressionRules: z.string().optional(),
  prohibitedExpressions: z.string().optional(),
  humorPrinciples: z.string().optional(),
});

type ToneProfileFormData = z.infer<typeof toneProfileSchema>;

interface ToneProfile {
  id: number;
  name: string;
  description: string;
  speakingStyle: string;
  intensity: number;
  emotionalExpression: string;
  humorEnabled: boolean;
  humorStyles: string[];
  toneRules: {
    speakingStyle: string[];
    emotionalExpression: string[];
    prohibitedExpressions: string[];
    humorPrinciples: string[];
  };
}

export function ToneProfileManagement() {
  const { toast } = useToast();
  const [editingProfile, setEditingProfile] = useState<ToneProfile | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  // Fetch Tone Profiles
  const { data: profiles, isLoading } = useQuery<ToneProfile[]>({
    queryKey: ['/api/admin/tone-profiles'],
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: ToneProfileFormData) => {
      const payload = {
        name: data.name,
        description: data.description,
        speakingStyle: data.speakingStyle,
        intensity: data.intensity,
        emotionalExpression: data.emotionalExpression,
        humorEnabled: data.humorEnabled,
        humorStyles: data.humorStyles ? data.humorStyles.split(',').map(s => s.trim()).filter(s => s) : [],
        toneRules: {
          speakingStyle: data.speakingStyleRules.split('\n').filter(r => r.trim()),
          emotionalExpression: data.emotionalExpressionRules ? data.emotionalExpressionRules.split('\n').filter(r => r.trim()) : [],
          prohibitedExpressions: data.prohibitedExpressions ? data.prohibitedExpressions.split('\n').filter(r => r.trim()) : [],
          humorPrinciples: data.humorPrinciples ? data.humorPrinciples.split('\n').filter(r => r.trim()) : []
        }
      };

      if (editingProfile) {
        return apiRequest(`/api/admin/tone-profiles/${editingProfile.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        return apiRequest('/api/admin/tone-profiles', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/tone-profiles'] });
      toast({
        title: editingProfile ? "Tone Profile 수정 완료" : "Tone Profile 생성 완료",
        description: "변경사항이 저장되었습니다.",
      });
      setIsDialogOpen(false);
      setEditingProfile(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "저장 실패",
        description: error.message || "Tone Profile 저장 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/admin/tone-profiles/${id}`, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/tone-profiles'] });
      toast({
        title: "Tone Profile 삭제 완료",
        description: "Tone Profile이 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "삭제 실패",
        description: error.message || "Tone Profile 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  // Form
  const form = useForm<ToneProfileFormData>({
    resolver: zodResolver(toneProfileSchema),
    defaultValues: {
      name: "",
      description: "",
      speakingStyle: "",
      intensity: 5,
      emotionalExpression: "neutral",
      humorEnabled: false,
      humorStyles: "",
      speakingStyleRules: "",
      emotionalExpressionRules: "",
      prohibitedExpressions: "",
      humorPrinciples: "",
    },
  });

  const handleEdit = (profile: ToneProfile) => {
    setEditingProfile(profile);
    form.reset({
      name: profile.name,
      description: profile.description,
      speakingStyle: profile.speakingStyle,
      intensity: profile.intensity,
      emotionalExpression: profile.emotionalExpression,
      humorEnabled: profile.humorEnabled,
      humorStyles: profile.humorStyles.join(', '),
      speakingStyleRules: profile.toneRules.speakingStyle.join('\n'),
      emotionalExpressionRules: profile.toneRules.emotionalExpression.join('\n'),
      prohibitedExpressions: profile.toneRules.prohibitedExpressions.join('\n'),
      humorPrinciples: profile.toneRules.humorPrinciples.join('\n'),
    });
    setIsDialogOpen(true);
  };

  const handleNew = () => {
    setEditingProfile(null);
    form.reset({
      name: "",
      description: "",
      speakingStyle: "",
      intensity: 5,
      emotionalExpression: "neutral",
      humorEnabled: false,
      humorStyles: "",
      speakingStyleRules: "",
      emotionalExpressionRules: "",
      prohibitedExpressions: "",
      humorPrinciples: "",
    });
    setIsDialogOpen(true);
  };

  const onSubmit = (data: ToneProfileFormData) => {
    saveMutation.mutate(data);
  };

  if (isLoading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Tone Profile 관리</h2>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={handleNew} data-testid="button-new-tone">
              <Plus className="w-4 h-4 mr-2" />
              새 Tone Profile
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingProfile ? "Tone Profile 수정" : "Tone Profile 생성"}
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
                        <Input placeholder="Fun_Tutor" {...field} data-testid="input-tone-name" />
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
                        <Input placeholder="재미있고 친근한 학원 선생님 스타일" {...field} data-testid="input-tone-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="speakingStyle"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>말투 스타일 *</FormLabel>
                        <FormControl>
                          <Input placeholder="밝고 친근한 어조" {...field} data-testid="input-tone-speaking-style" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="intensity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>강도 (1-10) *</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            min={1} 
                            max={10} 
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value))}
                            data-testid="input-tone-intensity"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="emotionalExpression"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>감정 표현 *</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-tone-emotion">
                            <SelectValue placeholder="감정 표현 선택" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="neutral">중립적</SelectItem>
                          <SelectItem value="warm">따뜻한</SelectItem>
                          <SelectItem value="playful">장난스러운</SelectItem>
                          <SelectItem value="restrained">절제된</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="humorEnabled"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>유머 활성화</FormLabel>
                        <div className="text-sm text-gray-500">유머와 농담을 사용합니다</div>
                      </div>
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-tone-humor"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {form.watch('humorEnabled') && (
                  <FormField
                    control={form.control}
                    name="humorStyles"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>유머 스타일 (쉼표로 구분)</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="witty, wholesome, self-deprecating" 
                            {...field} 
                            data-testid="input-tone-humor-styles"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="speakingStyleRules"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>말투 규칙 (줄바꿈으로 구분) *</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="밝고 친근한 어조 사용&#10;이모지 활용 (😊💡)"
                          rows={4}
                          {...field}
                          data-testid="textarea-tone-speaking-rules"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="emotionalExpressionRules"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>감정 표현 규칙 (줄바꿈으로 구분)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="공감 표현을 자주 사용&#10;긍정적인 에너지 전달"
                          rows={3}
                          {...field}
                          data-testid="textarea-tone-emotion-rules"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prohibitedExpressions"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>금지 표현 (줄바꿈으로 구분)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="냉소적이거나 비꼬는 표현&#10;무례한 농담"
                          rows={3}
                          {...field}
                          data-testid="textarea-tone-prohibited"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {form.watch('humorEnabled') && (
                  <FormField
                    control={form.control}
                    name="humorPrinciples"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>⚖️ 유머 원칙 (줄바꿈으로 구분)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="유머는 Canon 책임을 회피하는 수단이 아님&#10;상황이 심각하면 유머 줄이고 진지하게"
                            rows={3}
                            {...field}
                            data-testid="textarea-tone-humor-principles"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

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
                    data-testid="button-save-tone"
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
          <Card key={profile.id} data-testid={`card-tone-${profile.id}`}>
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-2">
                  <Smile className="w-5 h-5 text-purple-600" />
                  <CardTitle className="text-lg">{profile.name}</CardTitle>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleEdit(profile)}
                    data-testid={`button-edit-tone-${profile.id}`}
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
                    data-testid={`button-delete-tone-${profile.id}`}
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
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">말투</div>
                  <div className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs">
                    {profile.speakingStyle}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">강도</div>
                  <div className="text-sm font-bold">{profile.intensity}/10</div>
                </div>
                <div>
                  <div className="text-xs text-gray-600 dark:text-gray-400">감정</div>
                  <div className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded text-xs">
                    {profile.emotionalExpression}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm text-gray-600 dark:text-gray-400">유머:</div>
                {profile.humorEnabled ? (
                  <div className="flex gap-1 flex-wrap">
                    {profile.humorStyles.map((style, i) => (
                      <span key={i} className="text-xs bg-purple-100 dark:bg-purple-900/20 px-2 py-1 rounded">
                        {style}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500">비활성화</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-gray-600 dark:text-gray-400">말투 규칙</div>
                  <div className="font-bold">{profile.toneRules.speakingStyle.length}개</div>
                </div>
                <div>
                  <div className="text-gray-600 dark:text-gray-400">금지 표현</div>
                  <div className="font-bold">{profile.toneRules.prohibitedExpressions.length}개</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
