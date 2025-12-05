import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { X, FileText, Upload, AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

interface GroupFileUploadModalProps {
  groupChatId: number;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export default function GroupFileUploadModal({ groupChatId, isOpen, onClose, onSuccess }: GroupFileUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState({
    selectedFiles: [] as File[],
    isDragOver: false,
    documentType: "기타",
    documentDescription: "",
    showErrorModal: false,
    errorMessage: "",
    forceRender: 0
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 모달이 열릴 때마다 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setState(prev => ({
        ...prev,
        selectedFiles: [],
        isDragOver: false,
        documentType: "기타",
        documentDescription: "",
        showErrorModal: false,
        errorMessage: "",
        forceRender: prev.forceRender + 1
      }));
      
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, [isOpen]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => ({ ...prev, isDragOver: true }));
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => ({ ...prev, isDragOver: false }));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setState(prev => ({ ...prev, isDragOver: false }));
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      setState(prev => ({
        ...prev,
        selectedFiles: [...prev.selectedFiles, ...files].slice(0, 8),
        forceRender: prev.forceRender + 1
      }));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setState(prev => ({
        ...prev,
        selectedFiles: [...prev.selectedFiles, ...files].slice(0, 8),
        forceRender: prev.forceRender + 1
      }));
    }
  };

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const results = [];
      
      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('documentType', state.documentType);
        formData.append('description', state.documentDescription);

        const response = await fetch(`/api/group-chats/${groupChatId}/documents`, {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || '업로드 실패');
        }

        const result = await response.json();
        results.push({ file, result });
      }
      
      return results;
    },
    onSuccess: (results: any[]) => {
      toast({
        title: "성공",
        description: `${results.length}개의 문서가 그룹 채팅에 성공적으로 업로드되었습니다.`,
      });
      
      // 그룹 채팅 관련 쿼리 무효화
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}/documents`] });
      queryClient.invalidateQueries({ queryKey: [`/api/group-chats/${groupChatId}`] });
      
      if (onSuccess) {
        onSuccess(`${results.length}개의 문서가 그룹 채팅에 성공적으로 업로드되었습니다.`);
      }
      
      onClose();
    },
    onError: (error) => {
      console.error("업로드 오류:", error);
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
      setState(prev => ({
        ...prev,
        showErrorModal: true,
        errorMessage
      }));
    }
  });

  const handleUpload = () => {
    if (state.selectedFiles.length > 0 && state.documentType) {
      uploadMutation.mutate(state.selectedFiles);
    }
  };
  
  const removeFile = (index: number) => {
    const updatedFiles = state.selectedFiles.filter((_, i) => i !== index);
    setState(prev => ({
      ...prev,
      selectedFiles: updatedFiles,
      forceRender: prev.forceRender + 1
    }));
  };
  
  const clearAllFiles = () => {
    setState(prev => ({
      ...prev,
      selectedFiles: [],
      forceRender: prev.forceRender + 1
    }));
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Main Upload Modal */}
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={onClose}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full max-h-[90vh] md:max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
          {/* Header - 고정 */}
          <div className="flex items-center justify-between p-3 border-b bg-white dark:bg-gray-800 rounded-t-2xl flex-shrink-0">
            <div className="flex items-center space-x-2 pl-6">
              <FileText className="w-5 h-5 text-black dark:text-white" />
              <h2 className="text-lg font-medium korean-text">그룹 채팅 문서 업로드</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-10 h-10" />
            </Button>
          </div>

          {/* Content - 스크롤 가능 */}
          <div className="flex-1 overflow-y-auto">
            <div className="p-4 md:p-6 space-y-6">
              {/* Info Message */}
              <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
                <p className="text-sm text-blue-700 dark:text-blue-300 korean-text">
                  그룹 채팅에 업로드된 문서는 모든 참여 AI 에이전트가 참조할 수 있습니다.
                </p>
              </div>

              {/* File Upload Section */}
              <div 
                className={`p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-center cursor-pointer hover:border-blue-400 transition-all duration-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
                  state.isDragOver 
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                    : ''
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => {
                  if (fileInputRef.current) {
                    fileInputRef.current.click();
                  }
                }}
              >
                <div className="text-center space-y-4">
                  <div className="w-16 h-16 mx-auto bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                    <FileText className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-gray-900 dark:text-gray-100 korean-text">파일을 여기로 드래그하거나 클릭하여 업로드하세요</p>
                    <p className="text-sm text-gray-500 mt-2 korean-text">
                      지원 파일 : TXT, DOCX (권장)<br />
                      (최대 8개 / 파일당 최대 50MB)
                    </p>
                  </div>
                  <Button 
                    variant="default" 
                    type="button" 
                    className="korean-text bg-blue-600 hover:bg-blue-700 text-white"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (fileInputRef.current) {
                        fileInputRef.current.click();
                      }
                    }}
                  >
                    파일 선택
                  </Button>
                </div>
                <input
                  ref={fileInputRef}
                  id="file-upload"
                  type="file"
                  multiple
                  accept=".txt,.docx"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {/* Selected Files Section */}
              {state.selectedFiles.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 korean-text">
                      선택된 파일 ({state.selectedFiles.length}개)
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearAllFiles}
                      className="text-red-600 hover:text-red-700 korean-text"
                    >
                      모두 제거
                    </Button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {state.selectedFiles.map((file, index) => (
                      <div key={`${file.name}-${file.size}-${index}-${state.forceRender}`} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                        <div className="flex items-center space-x-3 min-w-0 flex-1">
                          <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate korean-text">
                              {file.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFile(index)}
                          className="text-red-600 hover:text-red-700 flex-shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Document Type Section */}
              <div className="space-y-2">
                <Label htmlFor="document-type" className="text-sm font-medium korean-text text-gray-900 dark:text-gray-100">
                  문서 종류
                </Label>
                <Select value={state.documentType} onValueChange={(value) => setState(prev => ({ ...prev, documentType: value }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="z-[10000]">
                    <SelectItem value="강의 자료">강의 자료</SelectItem>
                    <SelectItem value="교육과정">교육과정</SelectItem>
                    <SelectItem value="정책 문서">정책 문서</SelectItem>
                    <SelectItem value="매뉴얼">매뉴얼</SelectItem>
                    <SelectItem value="양식">양식</SelectItem>
                    <SelectItem value="공지사항">공지사항</SelectItem>
                    <SelectItem value="기타">기타</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Document Description Section */}
              <div className="space-y-2">
                <Label htmlFor="document-description" className="text-sm font-medium korean-text text-gray-900 dark:text-gray-100">
                  문서 설명
                </Label>
                <Textarea
                  id="document-description"
                  placeholder="업로드하는 문서에 대한 설명을 입력하세요"
                  value={state.documentDescription}
                  onChange={(e) => setState(prev => ({ ...prev, documentDescription: e.target.value }))}
                  className="resize-none korean-text h-20"
                  rows={3}
                />
              </div>
            </div>
          </div>
            
          {/* 고정 버튼 영역 */}
          <div className="border-t p-4 bg-white dark:bg-gray-800 rounded-b-2xl flex-shrink-0">
            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={onClose}
                className="flex-1 korean-text"
                disabled={uploadMutation.isPending}
              >
                취소
              </Button>
              <Button
                onClick={handleUpload}
                disabled={state.selectedFiles.length === 0 || !state.documentType || uploadMutation.isPending}
                className="flex-1 korean-text"
                type="submit"
              >
                {uploadMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    업로드 중...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4 mr-2" />
                    업로드 시작
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Error Modal */}
      {state.showErrorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000] p-4" onClick={() => setState(prev => ({ ...prev, showErrorModal: false, errorMessage: "" }))}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header - 고정 */}
            <div className="flex items-center justify-between p-3 border-b bg-white dark:bg-gray-800 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center space-x-2 pl-6">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
                <h2 className="text-lg font-medium korean-text">업로드 실패</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setState(prev => ({ ...prev, showErrorModal: false, errorMessage: "" }))}>
                <X className="w-10 h-10" />
              </Button>
            </div>
            
            {/* Content */}
            <div className="p-6">
              <p className="text-gray-600 dark:text-gray-300 text-center mb-6">
                {state.errorMessage}
              </p>
            </div>
            
            {/* Footer - 고정 */}
            <div className="border-t p-4 bg-white dark:bg-gray-800 rounded-b-2xl flex-shrink-0">
              <div className="flex justify-center">
                <Button
                  onClick={() => setState(prev => ({ ...prev, showErrorModal: false, errorMessage: "" }))}
                  className="korean-text px-8"
                >
                  확인
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}