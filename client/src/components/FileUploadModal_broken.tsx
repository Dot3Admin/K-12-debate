import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, FileText, Upload, AlertTriangle, CheckCircle, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import type { Agent } from "@/types/agent";

interface FileUploadModalProps {
  agent: Agent;
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (message: string) => void;
}

export default function FileUploadModal({ agent, isOpen, onClose, onSuccess }: FileUploadModalProps) {
  const [state, setState] = useState({
    selectedFiles: [] as File[],
    isDragOver: false,
    documentType: "기타",
    documentDescription: "",
    documentVisibility: true,
    showErrorModal: false,
    errorMessage: "",
    forceRender: 0
  });

  // 디버깅: 컴포넌트 렌더링 시 상태 로그
  console.log("FileUploadModal 렌더링 - selectedFiles:", state.selectedFiles.length, "documentType:", state.documentType, "isOpen:", isOpen, "forceRender:", state.forceRender);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // 모달이 열릴 때마다 상태 초기화
  useEffect(() => {
    if (isOpen) {
      setState({
        selectedFiles: [],
        isDragOver: false,
        documentType: "기타",
        documentDescription: "",
        documentVisibility: true,
        showErrorModal: false,
        errorMessage: "",
        forceRender: 0
      });
      console.log("FileUploadModal 상태 초기화됨");
    }
  }, [isOpen]);

  // Broadcast notification mutation for document uploads
  const broadcastMutation = useMutation({
    mutationFn: async ({ agentId, message }: { agentId: number; message: string }) => {
      const response = await apiRequest("POST", `/api/agents/${agentId}/broadcast`, { message });
      return response.json();
    },
    onSuccess: (data) => {
      console.log(`Document upload notification sent to ${data.totalRecipients} users`);
      queryClient.invalidateQueries({
        queryKey: ["/api/conversations"]
      });
    },
    onError: (error) => {
      console.error("Failed to broadcast document upload notification:", error);
    }
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const results = [];
      
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("documentType", state.documentType);
        formData.append("description", state.documentDescription);
        formData.append("isVisible", state.documentVisibility.toString());
        formData.append("status", "사용 중");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000); // 60초 타임아웃
        
        try {
          const response = await fetch(`/api/agents/${agent.id}/documents`, {
            method: "POST",
            body: formData,
            credentials: "include",
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`${response.status}: ${errorText}`);
          }

          const result = await response.json();
          results.push({ file, result });
        } catch (error: any) {
          clearTimeout(timeoutId);
          if (error.name === 'AbortError') {
            throw new Error('업로드 시간 초과: 파일이 너무 크거나 네트워크가 느립니다.');
          }
          throw error;
        }
      }
      
      return results;
    },
    onSuccess: (results: any[]) => {
      console.log('Document uploads successful:', results);
      
      queryClient.invalidateQueries({
        queryKey: [`/api/agents/${agent.id}/documents`]
      });
      
      const fileNames = results.map(r => r.result.document?.originalName || r.file.name).join(', ');

      // Show success toast message
      toast({
        title: "문서 업로드 완료",
        description: `${results.length}개 파일이 성공적으로 업로드되었습니다.`,
      });

      // Send completion message to chat
      if (onSuccess) {
        onSuccess(`${results.length}개 문서 업로드가 완료되었습니다: ${fileNames}`);
      }

      // Broadcast document upload notification
      broadcastMutation.mutate({
        agentId: agent.id,
        message: `📄 ${results.length}개의 새로운 문서가 업로드되었습니다`
      });

      // Reset form and close modal
      setState(prev => ({
        ...prev,
        selectedFiles: [],
        documentType: "기타",
        documentDescription: "",
        documentVisibility: true
      }));
      onClose();
    },
    onError: (error: any) => {
      console.error('Upload error:', error);
      
      if (isUnauthorizedError(error)) {
        console.log('Unauthorized - redirecting to login');
        return;
      }
      
      setState(prev => ({
        ...prev,
        errorMessage: error.message || '파일 업로드 중 오류가 발생했습니다.',
        showErrorModal: true
      }));
    }
  });

  const validateFile = (file: File): boolean => {
    const allowedTypes = [
      '.pdf', '.doc', '.docx', '.txt', '.ppt', '.pptx', '.xlsx', '.csv', '.hwp',
      '.jpg', '.jpeg', '.png', '.gif'
    ];
    
    const extension = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    
    if (!allowedTypes.includes(extension)) {
      toast({
        title: "지원되지 않는 파일 형식",
        description: `${file.name}: 지원되는 형식은 ${allowedTypes.join(', ')} 입니다.`,
        variant: "destructive",
      });
      return false;
    }
    
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      toast({
        title: "파일 크기 초과",
        description: `${file.name}: 파일 크기는 50MB를 초과할 수 없습니다.`,
        variant: "destructive",
      });
      return false;
    }
    
    return true;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    console.log("파일 선택됨:", files.length, "개");
    
    if (files.length > 0) {
      const newValidFiles: File[] = [];
      
      for (const file of files) {
        // 최대 8개까지만 허용
        if (state.selectedFiles.length + newValidFiles.length >= 8) {
          toast({
            title: "파일 개수 제한",
            description: "최대 8개까지만 선택할 수 있습니다.",
            variant: "destructive",
          });
          break;
        }
        
        if (validateFile(file)) {
          newValidFiles.push(file);
          console.log("유효한 파일 추가됨:", file.name);
        }
      }
      
      if (newValidFiles.length > 0) {
        const updatedFiles = [...state.selectedFiles, ...newValidFiles];
        console.log("파일 선택 전 상태:", state.selectedFiles.length);
        console.log("새로 선택된 파일:", newValidFiles.map(f => f.name));
        console.log("업데이트될 파일 목록:", updatedFiles.map(f => f.name));
        
        setState(prev => ({
          ...prev,
          selectedFiles: updatedFiles,
          forceRender: prev.forceRender + 1
        }));
        
        // 상태 업데이트 확인을 위한 지연된 로그
        setTimeout(() => {
          console.log("상태 업데이트 후 selectedFiles 길이:", updatedFiles.length);
        }, 100);
      }
    }
    
    // 파일 입력 값 리셋
    e.target.value = '';
  };

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
      const newValidFiles: File[] = [];
      
      for (const file of files) {
        // 최대 8개까지만 허용
        if (state.selectedFiles.length + newValidFiles.length >= 8) {
          toast({
            title: "파일 개수 제한",
            description: "최대 8개까지만 선택할 수 있습니다.",
            variant: "destructive",
          });
          break;
        }
        
        if (validateFile(file)) {
          newValidFiles.push(file);
        }
      }
      
      if (newValidFiles.length > 0) {
        const updatedFiles = [...state.selectedFiles, ...newValidFiles];
        console.log("드래그 앤 드롭 전 상태:", state.selectedFiles.length);
        console.log("드래그로 추가된 파일:", newValidFiles.map(f => f.name));
        
        setState(prev => ({
          ...prev,
          selectedFiles: updatedFiles,
          forceRender: prev.forceRender + 1
        }));
        
        setTimeout(() => {
          console.log("드래그 후 상태 업데이트:", updatedFiles.length);
        }, 100);
      }
    }
  };

  const handleUpload = () => {
    if (state.selectedFiles.length > 0) {
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
    console.log("파일 제거됨, 남은 파일:", updatedFiles.length);
  };
  
  const clearAllFiles = () => {
    setState(prev => ({
      ...prev,
      selectedFiles: [],
      forceRender: prev.forceRender + 1
    }));
    console.log("모든 파일 제거됨");
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Main Upload Modal */}
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4" onClick={onClose}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full max-h-[90vh] md:max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
          {/* Header - 고정 */}
          <div className="flex items-center justify-between p-3 border-b bg-white dark:bg-gray-800 rounded-t-2xl flex-shrink-0">
            <div className="flex items-center space-x-2 pl-6">
              <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-lg font-medium korean-text">문서 파일 업로드</h2>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-10 h-10" />
            </Button>
          </div>

          {/* Content - 스크롤 가능 */}
          <div className="flex-1 overflow-y-auto">
              <div className="p-4 md:p-6 space-y-6">
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
                    console.log("드롭 존 클릭됨");
                    const fileInput = document.getElementById('file-upload') as HTMLInputElement;
                    if (fileInput) {
                      fileInput.click();
                      console.log("드롭 존에서 파일 입력 클릭 실행됨");
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
                        지원 파일 : pdf, doc, docx, txt, ppt, pptx, xls, xlsx, csv, hwp, jpg, png, gif<br />
                        (최대 8개 / 파일당 최대 50MB)
                      </p>
                    </div>
                    <Button variant="default" type="button" className="korean-text bg-blue-600 hover:bg-blue-700 text-white">
                      파일 선택
                    </Button>
                  </div>
                  <input
                    id="file-upload"
                    type="file"
                    multiple
                    className="hidden"
                    accept=".pdf,.doc,.docx,.txt,.ppt,.pptx,.xlsx,.csv,.hwp,.jpg,.jpeg,.png,.gif"
                    onChange={handleFileSelect}
                  />
                </div>

                {/* Selected Files Display */}
                {state.selectedFiles.length > 0 && (
                  <div key={`files-${state.forceRender}-${state.selectedFiles.length}`} className="border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 korean-text">
                        선택된 파일 ({state.selectedFiles.length}개)
                      </h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={clearAllFiles}
                        className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        전체 삭제
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {state.selectedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between bg-white dark:bg-blue-950 border border-blue-200 dark:border-blue-700 rounded-md p-3">
                          <div className="flex items-center space-x-3 flex-1 min-w-0">
                            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-medium text-blue-900 dark:text-blue-100 text-sm truncate">
                                  {file.name}
                                </p>
                                {state.documentType && (
                                  <span className="px-2 py-1 text-xs bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 rounded-full">
                                    {state.documentType}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <p className="text-xs text-blue-600 dark:text-blue-400">
                                  {(file.size / 1024 / 1024).toFixed(2)} MB
                                </p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setState(prev => ({ ...prev, documentVisibility: !prev.documentVisibility }))}
                                  className="p-1 h-6 w-6 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800"
                                >
                                  {state.documentVisibility ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                                </Button>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(index)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 ml-2"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Document Information Section */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="document-type" className="text-sm font-medium korean-text">
                        문서 종류 *
                      </Label>
                      <Select value={state.documentType} onValueChange={(value) => setState(prev => ({ ...prev, documentType: value }))}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="문서 종류를 선택하세요" />
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
                    <div className="space-y-2">
                      <Label htmlFor="document-visibility" className="text-sm font-medium korean-text">
                        문서 공개 설정
                      </Label>
                      <Select value={state.documentVisibility.toString()} onValueChange={(value) => setState(prev => ({ ...prev, documentVisibility: value === 'true' }))}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="z-[10000]">
                          <SelectItem value="true">공개</SelectItem>
                          <SelectItem value="false">비공개</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="document-description" className="text-sm font-medium korean-text">
                      문서 설명 (선택)
                    </Label>
                    <Textarea
                      id="document-description"
                      placeholder="문서에 대한 간단한 설명을 입력하세요..."
                      value={state.documentDescription}
                      onChange={(e) => setState(prev => ({ ...prev, documentDescription: e.target.value }))}
                      className="resize-none korean-text"
                      rows={3}
                    />
                  </div>
                </div>
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
                onClick={() => {
                  console.log("업로드 버튼 클릭됨 - 선택된 파일:", state.selectedFiles.length, "문서 타입:", state.documentType);
                  console.log("업로드 버튼 disabled 조건:", {
                    filesLength: state.selectedFiles.length,
                    noFiles: state.selectedFiles.length === 0,
                    noDocType: !state.documentType,
                    uploading: uploadMutation.isPending
                  });
                  handleUpload();
                }}
                disabled={state.selectedFiles.length === 0 || !state.documentType || uploadMutation.isPending}
                className="flex-1 korean-text"
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
                  className="bg-red-600 hover:bg-red-700 text-white px-8 py-2 rounded-lg"
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