
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, FileText, Upload, Trash2, RefreshCw, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useLanguage } from "@/contexts/LanguageContext";

interface UserFileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

interface UserFile {
  id: string;
  filename: string;
  originalName: string;
  size: number;
  uploadedAt: string;
  status: string;
  userCount: number;
  statusText: string;
}

export default function UserFileUploadModal({ isOpen, onClose, onSuccess }: UserFileUploadModalProps) {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [validateOnly, setValidateOnly] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<UserFile | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useLanguage();

  // 업로드된 사용자 파일 목록 조회
  const { data: userFiles = [], isLoading: isLoadingUserFiles, refetch: refetchUserFiles } = useQuery<UserFile[]>({
    queryKey: ["/api/admin/user-files"],
    enabled: isOpen,
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const results = [];
      
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("overwriteExisting", overwriteExisting.toString());
        formData.append("validateOnly", validateOnly.toString());

        const response = await fetch(`/api/admin/users/upload`, {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`${response.status}: ${errorText}`);
        }

        const result = await response.json();
        results.push({ file: file.name, ...result });
      }
      
      return results;
    },
    onSuccess: (data: any[]) => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/users"]
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/user-files"]
      });
      
      setSelectedFiles([]);
      setOverwriteExisting(false);
      setValidateOnly(false);

      const successCount = data.length;
      const actionText = validateOnly ? '검증' : overwriteExisting ? '덮어쓰기' : '추가';
      toast({
        title: `파일 업로드 완료`,
        description: `${successCount}개 파일이 성공적으로 ${actionText} 처리되었습니다.`,
      });

      if (onSuccess) {
        onSuccess();
      }
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: "인증 오류",
          description: "다시 로그인해주세요.",
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
      } else {
        toast({
          title: "업로드 실패",
          description: error.message || "파일 업로드에 실패했습니다.",
          variant: "destructive",
        });
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const response = await fetch(`/api/admin/user-files/${fileId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`${response.status}: ${errorText}`);
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/user-files"]
      });
      toast({
        title: t('file.deleteComplete'),
        description: t('file.deleteSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('file.deleteFailed'),
        description: error.message || t('file.deleteError'),
        variant: "destructive",
      });
    },
  });

  const validateFile = (file: File) => {
    const allowedTypes = [
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv'
    ];

    const fileName = file.name.toLowerCase();
    const isValidExtension = fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv');

    if (!allowedTypes.includes(file.type) && !isValidExtension) {
      toast({
        title: t('file.unsupportedFormat'),
        description: t('file.formatRequirement'),
        variant: "destructive",
      });
      return false;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast({
        title: t('file.sizeExceeded'),
        description: t('file.sizeLimit'),
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    Array.from(files).forEach(file => {
      if (validateFile(file)) {
        validFiles.push(file);
      }
    });
    
    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }
    event.target.value = '';
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;

    const validFiles: File[] = [];
    files.forEach(file => {
      if (validateFile(file)) {
        validFiles.push(file);
      }
    });
    
    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearAllFiles = () => {
    setSelectedFiles([]);
  };

  const handleUpload = () => {
    if (selectedFiles.length > 0) {
      uploadMutation.mutate(selectedFiles);
    }
  };

  const handleDownloadSample = async () => {
    try {
      const response = await fetch('/api/admin/users/sample', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(t('file.downloadFailed'));
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = t('file.sampleFileName');
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      toast({
        title: t('file.downloadFailed'),
        description: t('file.downloadError'),
        variant: "destructive",
      });
    }
  };

  const handleDelete = (file: UserFile) => {
    setFileToDelete(file);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (fileToDelete) {
      deleteMutation.mutate(fileToDelete.id);
      setDeleteDialogOpen(false);
      setFileToDelete(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-background border border-border rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-hidden shadow-lg" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center space-x-3">
            <FileText className="w-5 h-5 text-gray-900 dark:text-white" />
            <h3 className="text-lg font-medium text-foreground korean-text">
              사용자 파일 업로드
            </h3>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="p-2">
            <X className="w-5 h-5" />
          </Button>
        </div>

        {/* Modal Content */}
        <div className="p-6 max-h-[75vh] overflow-y-auto">
          {/* 현재 시스템에 적용된 문서 정보 */}
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-blue-900 dark:text-blue-100 korean-text">
                업로드된 파일 ({userFiles.filter(file => file.status === 'applied').length}개)
              </h4>
              <span className="text-xs text-blue-700 dark:text-blue-300 korean-text">
                사용자 데이터 관련 파일들
              </span>
            </div>
            
            {isLoadingUserFiles ? (
              <div className="flex items-center justify-center py-4">
                <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                <span className="ml-2 text-sm text-blue-700 dark:text-blue-300">로딩 중...</span>
              </div>
            ) : userFiles.filter(file => file.status === 'applied').length > 0 ? (
              <div className="space-y-2">
                {userFiles
                  .filter(file => file.status === 'applied')
                  .slice(0, 3)
                  .map((file) => (
                    <div key={file.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border">
                      <div className="flex items-center space-x-3">
                        <FileText className="w-4 h-4 text-blue-600 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate korean-text">
                            {file.originalName}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {new Date(file.uploadedAt).toLocaleString('ko-KR', {
                              year: 'numeric',
                              month: '2-digit', 
                              day: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit'
                            })} • {(file.size / (1024 * 1024)).toFixed(2)} MB
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Badge 
                          variant="secondary" 
                          className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 korean-text"
                        >
                          {file.userCount}명 조직 반영됨
                        </Badge>
                        <Badge 
                          variant="secondary"
                          className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 korean-text"
                        >
                          최종 반영됨
                        </Badge>
                      </div>
                    </div>
                  ))}
                {userFiles.filter(file => file.status === 'applied').length > 3 && (
                  <div className="text-center pt-2">
                    <span className="text-xs text-blue-600 dark:text-blue-400 korean-text">
                      외 {userFiles.filter(file => file.status === 'applied').length - 3}개 파일 더 있음
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4">
                <FileText className="w-8 h-8 text-blue-400 mx-auto mb-2" />
                <p className="text-sm text-blue-600 dark:text-blue-400 korean-text">
                  아직 시스템에 적용된 사용자 파일이 없습니다.
                </p>
              </div>
            )}
          </div>

          {/* File Format Requirements */}
          <div className="mb-6 bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-yellow-900 dark:text-yellow-100">파일 형식 요구사항</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadSample}
                className="korean-text text-green-700 border-green-300 hover:bg-green-100"
              >
                <Download className="w-4 h-4 mr-1" />
                샘플 파일 다운로드
              </Button>
            </div>
            <div className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
              <p>• 첫 번째 행: 헤더 (사용자 ID, 이름, 이메일, 조직 등)</p>
              <p>• 지원 파일 형식: XLSX, XLS, CSV</p>
              <p>• 업로드 제한: 파일당 최대 50MB까지 업로드 가능</p>
            </div>
          </div>

          {/* File Upload Section */}
          <div 
            className={`mb-6 p-8 border-2 border-dashed rounded-xl transition-all duration-200 cursor-pointer ${
              isDragOver 
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 scale-[1.02]' 
                : selectedFiles.length > 0
                ? 'border-green-400 bg-green-50 dark:bg-green-900/20'
                : 'border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50 hover:bg-gray-100 dark:hover:bg-gray-800 hover:border-gray-400'
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
              const fileInput = document.getElementById('user-file-upload') as HTMLInputElement;
              if (fileInput) {
                fileInput.click();
              }
            }}
          >
            <div className="text-center">
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <Upload className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h4 className="text-lg font-medium text-foreground mb-2 korean-text">Excel 또는 CSV 파일을 드래그하거나 클릭하여 업로드</h4>
                  <p className="text-sm text-gray-500 mb-4">
                    지원 파일 : XLSX, XLS, CSV (파일당 최대 50MB)
                  </p>
                </div>
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="default"
                    className="korean-text bg-blue-600 hover:bg-blue-700"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    파일 선택
                  </Button>
                </div>
              </div>
            </div>
            <input
              id="user-file-upload"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              multiple
              key="user-file-input"
            />
          </div>

          {/* 선택된 파일 목록 */}
          {selectedFiles.length > 0 && (
            <div className="border border-blue-200 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-800 rounded-lg p-4 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100">선택된 파일 ({selectedFiles.length}개)</h3>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={handleClearAllFiles}
                  className="text-red-600 hover:text-red-700 border-red-200 hover:border-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  전체 삭제
                </Button>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {selectedFiles.map((file, index) => (
                  <div 
                    key={index}
                    className="flex items-center justify-between p-3 bg-white dark:bg-blue-950 border border-blue-200 dark:border-blue-700 rounded-md"
                  >
                    <div className="flex items-center space-x-3 flex-1 min-w-0">
                      <FileText className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100 truncate">{file.name}</p>
                        <p className="text-xs text-blue-600 dark:text-blue-400">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFile(index)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 p-1"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload Options */}
          <div className="mb-6">
            <Label className="text-sm font-medium mb-3 block korean-text">업로드 옵션</Label>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="overwrite-existing"
                  checked={overwriteExisting}
                  onCheckedChange={(checked) => setOverwriteExisting(checked === true)}
                />
                <Label htmlFor="overwrite-existing" className="text-sm korean-text">
                  기존 사용자 정보 덮어쓰기 (모든 기존 사용자 데이터 삭제 후 새 데이터로 교체)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="validate-only"
                  checked={validateOnly}
                  onCheckedChange={(checked) => setValidateOnly(checked === true)}
                />
                <Label htmlFor="validate-only" className="text-sm korean-text">
                  검증만 수행 (실제 저장하지 않고 파일 유효성만 확인)
                </Label>
              </div>
            </div>
            
            {/* 동작 방식 설명 */}
            <div className="mt-4 p-4 bg-muted rounded-lg">
              <h5 className="text-sm font-medium mb-2 korean-text">동작 방식 안내</h5>
              <div className="text-xs text-muted-foreground space-y-1 korean-text">
                {overwriteExisting ? (
                  <>
                    <p>• 기존 사용자 데이터를 모두 삭제합니다</p>
                    <p>• 새로 업로드된 사용자 데이터로 완전히 교체합니다</p>
                  </>
                ) : (
                  <>
                    <p>• 기존 사용자 데이터는 모두 보존됩니다</p>
                    <p>• 동일한 사용자 ID 또는 이메일이 있는 경우: 기존 정보 유지</p>
                    <p>• 새로 포함된 사용자만 추가 등록됩니다</p>
                  </>
                )}
                {validateOnly && <p>• 파일 유효성만 검증하고 실제 저장은 하지 않습니다</p>}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-3 pt-4 border-t border-border mb-6">
            <Button 
              variant="outline" 
              onClick={onClose} 
              className="flex-1 korean-text h-12"
              disabled={uploadMutation.isPending}
            >
              취소
            </Button>
            <Button
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploadMutation.isPending}
              className="flex-1 korean-text relative h-12 bg-blue-600 hover:bg-blue-700 text-white font-medium"
            >
              {uploadMutation.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  {validateOnly ? "검증 중..." : "업로드 중..."}
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  {validateOnly ? "검증 시작" : "업로드 시작"}
                </>
              )}
            </Button>
          </div>

          {/* Uploaded Files List */}
          <div className="pt-6 border-t border-border">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-base font-medium text-foreground korean-text">업로드된 사용자 파일</h4>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetchUserFiles()}
                disabled={isLoadingUserFiles}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${isLoadingUserFiles ? 'animate-spin' : ''}`} />
                새로고침
              </Button>
            </div>
            
            {isLoadingUserFiles ? (
              <div className="text-center py-4">
                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                <p className="text-sm text-muted-foreground korean-text">파일 목록 로딩 중...</p>
              </div>
            ) : userFiles && userFiles.length > 0 ? (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {userFiles.map((file) => (
                  <div key={file.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                    <div className="flex-1 min-w-0">
                      <h5 className="text-sm font-medium korean-text truncate">{file.filename}</h5>
                      <div className="flex items-center space-x-4 text-xs text-muted-foreground mt-1">
                        <span>크기: {(file.size / 1024 / 1024).toFixed(2)} MB</span>
                        <span>업로드: {new Date(file.uploadedAt).toLocaleDateString('ko-KR')}</span>
                        <span>사용자: {file.userCount}명</span>
                        <Badge variant={
                          file.status === 'applied' ? 'default' :
                          file.status === 'validated' ? 'secondary' :
                          file.status === 'partially_applied' ? 'outline' : 'destructive'
                        }>
                          {file.statusText}
                        </Badge>
                      </div>
                    </div>
                    <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                      <AlertDialogTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleDelete(file)}
                          className="text-destructive hover:text-destructive-foreground hover:bg-destructive ml-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle className="korean-text">파일 삭제 확인</AlertDialogTitle>
                          <AlertDialogDescription className="korean-text">
                            '{fileToDelete?.filename}' 파일을 정말로 삭제하시겠습니까? 
                            이 작업은 되돌릴 수 없습니다.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel className="korean-text">취소</AlertDialogCancel>
                          <AlertDialogAction 
                            onClick={confirmDelete}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 korean-text"
                          >
                            삭제
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground">
                <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p className="korean-text">업로드된 사용자 파일이 없습니다</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
