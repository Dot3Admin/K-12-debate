
import { useState, useEffect } from "react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { X, Upload, FileText, Download, AlertCircle, CheckCircle, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { useLanguage } from "@/contexts/LanguageContext";
import * as XLSX from 'xlsx';

interface AgentFileUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAgentId?: number | null;
}

export default function AgentFileUploadModal({ isOpen, onClose, selectedAgentId }: AgentFileUploadModalProps) {
  const { t } = useLanguage();
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [clearExisting, setClearExisting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [targetAgentId, setTargetAgentId] = useState<number | null>(selectedAgentId || null);

  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadResult, setUploadResult] = useState<any>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch all agents for selection
  const { data: allAgents = [] } = useQuery({
    queryKey: ['/api/admin/agents'],
    queryFn: async () => {
      const response = await fetch('/api/admin/agents', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch agents');
      }
      return response.json();
    },
    enabled: isOpen
  });

  // Fetch uploaded agent files
  const { data: agentFiles = [], refetch: refetchFiles } = useQuery({
    queryKey: ['/api/admin/agent-files'],
    queryFn: async () => {
      const response = await fetch('/api/admin/agent-files', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch agent files');
      }
      return response.json();
    },
    enabled: isOpen
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const results = [];
      
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("clearExisting", clearExisting.toString());
        
        // Add target agent ID if selected
        if (targetAgentId) {
          formData.append("targetAgentId", targetAgentId.toString());
        } else if (selectedAgentId) {
          formData.append("selectedAgentId", selectedAgentId.toString());
        }

        const response = await fetch("/api/agents/upload", {
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
    onSuccess: (data) => {
      setUploadResult(data);
      
      queryClient.invalidateQueries({
        queryKey: ["/api/agents/managed"]
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/agents"]
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/agents"]
      });
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/agent-files"]
      });
      
      refetchFiles();
      setSelectedFiles([]);
      
      const totalUploaded = Array.isArray(data) ? data.length : (data as any)?.createdCount || (data as any)?.agentCount || 0;
      toast({
        title: t('agent.uploadComplete'),
        description: `${totalUploaded}개의 파일이 업로드되었습니다.`,
      });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: t('agent.authError'),
          description: t('agent.loginAgain'),
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/api/login";
        }, 500);
      } else {
        toast({
          title: t('agent.uploadFailed'),
          description: error.message || t('agent.uploadFailedDesc'),
          variant: "destructive",
        });
      }
    },
  });

  // Delete agent file mutation
  const deleteMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const response = await fetch(`/api/admin/agent-files/${fileId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      if (!response.ok) {
        throw new Error('Failed to delete file');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/agent-files"]
      });
      refetchFiles();
      
      toast({
        title: "파일 삭제 완료",
        description: "업로드된 파일이 성공적으로 삭제되었습니다.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "파일 삭제 실패",
        description: error.message || "파일 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    }
  });

  const validateFile = (file: File) => {
    console.log(`🔍 파일 검증 시작: ${file.name}, 타입: ${file.type}, 크기: ${file.size}`);
    
    // 파일 확장자 기반 검증 (관대한 접근 - 다양한 문서 형식 허용)
    const fileName = file.name.toLowerCase();
    const isValidExtension = fileName.endsWith('.csv') || 
                           fileName.endsWith('.xls') || 
                           fileName.endsWith('.xlsx') ||
                           fileName.endsWith('.pdf') ||
                           fileName.endsWith('.doc') ||
                           fileName.endsWith('.docx') ||
                           fileName.endsWith('.txt') ||
                           fileName.endsWith('.ppt') ||
                           fileName.endsWith('.pptx');
    
    const allowedTypes = [
      // Excel/CSV
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/csv',
      // PDF
      'application/pdf',
      // Word 문서
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // PowerPoint
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      // 텍스트
      'text/plain',
      '' // 빈 타입도 확장자로 검증
    ];

    console.log(`📋 확장자 유효성: ${isValidExtension}, MIME 타입 유효성: ${allowedTypes.includes(file.type)}`);

    if (!isValidExtension && !allowedTypes.includes(file.type)) {
      console.log(`❌ 지원하지 않는 파일 형식: ${file.name} (${file.type})`);
      toast({
        title: '지원하지 않는 파일 형식',
        description: 'CSV, XLS, XLSX, PDF, DOC, DOCX, TXT, PPT, PPTX 파일만 업로드 가능합니다.',
        variant: "destructive",
      });
      return false;
    }

    if (file.size > 50 * 1024 * 1024) {
      console.log(`❌ 파일 크기 초과: ${file.name} (${file.size} bytes)`);
      toast({
        title: '파일 크기 초과',
        description: '50MB 이하의 파일만 업로드 가능합니다.',
        variant: "destructive",
      });
      return false;
    }

    console.log(`✅ 파일 검증 성공: ${file.name}`);
    return true;
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    console.log('🔍 파일 선택 이벤트 발생');
    const files = event.target.files;
    if (!files || files.length === 0) {
      console.log('❌ 선택된 파일이 없음');
      return;
    }

    console.log('📁 선택된 파일들:', Array.from(files).map(f => ({ name: f.name, type: f.type, size: f.size })));

    const validFiles: File[] = [];
    Array.from(files).forEach(file => {
      console.log(`🔬 파일 검증 중: ${file.name} (타입: ${file.type})`);
      if (validateFile(file)) {
        console.log(`✅ 파일 검증 성공: ${file.name}`);
        validFiles.push(file);
      } else {
        console.log(`❌ 파일 검증 실패: ${file.name}`);
      }
    });

    console.log('✅ 유효한 파일 수:', validFiles.length);
    if (validFiles.length > 0) {
      setSelectedFiles(prev => {
        const newFiles = [...prev, ...validFiles];
        console.log('📂 업데이트된 선택 파일들:', newFiles.map(f => f.name));
        return newFiles;
      });
      setUploadResult(null);
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
      setUploadResult(null);
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

  const handleDownloadSample = () => {
    // 엑셀 데이터 생성
    const headers = ['에이전트명', '소개', '유형', '상위 조직', '하위 조직', '세부 조직', '관리자 ID'];
    const sampleData = [
      ['학생 상담 AI', '학생들의 고민과 상담을 도와주는 AI입니다', '학생', '인문대학', '국어국문학과', '국어국문학과', 'user1081'],
      ['컴퓨터공학과 AI', '컴퓨터공학과 관련 정보를 제공하는 AI입니다', '학교', '공과대학', '컴퓨터공학과', '컴퓨터공학과', 'user1081'],
      ['입학 상담 AI', '대학 입학 관련 정보를 제공하는 AI입니다', '학교', '대학본부', '입학처', '입학관리팀', 'master_admin'],
      ['도서관 안내 AI', '도서관 이용 및 서비스 안내를 제공합니다', '기능형', '대학본부', '도서관', '정보서비스팀', 'user1081'],
      ['진로 상담 AI', '학생들의 진로 상담과 취업 지원을 담당합니다', '그룹', '학생지원처', '진로취업팀', '', 'master_admin']
    ];

    // XLSX 워크시트 생성
    const worksheetData = [headers, ...sampleData];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    
    // 열 너비 설정
    worksheet['!cols'] = [
      { width: 20 }, // 에이전트명
      { width: 40 }, // 소개
      { width: 12 }, // 유형
      { width: 15 }, // 상위 조직
      { width: 15 }, // 하위 조직
      { width: 15 }, // 세부 조직
      { width: 15 }  // 관리자 ID
    ];

    // 워크북 생성
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "에이전트 목록");

    // 파일 다운로드
    XLSX.writeFile(workbook, "에이전트_업로드_샘플.xlsx");
  };

  const resetForm = () => {
    setSelectedFiles([]);
    setClearExisting(false);
    setUploadProgress(0);
    setUploadResult(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4" onClick={handleClose}>
      <div className="bg-background border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-lg" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header - 고정, 높이 50% 줄임 */}
        <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
          <div className="flex items-center space-x-2 pl-6">
            <Upload className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-lg font-medium text-foreground korean-text">
                에이전트 파일 업로드
              </h3>
              <div className="text-sm text-gray-600 mt-1">파일을 업로드해 여러 에이전트를 일괄 등록할 수 있습니다.</div>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleClose} className="p-2">
            <X className="w-10 h-10" />
          </Button>
        </div>

        {/* Modal Content - 스크롤 가능 */}
        <div className="p-6 flex-1 overflow-y-auto">
          {/* 에이전트 선택 섹션 */}
          {selectedAgentId && (
            <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-center space-x-2">
                <User className="w-5 h-5 text-blue-600" />
                <span className="font-medium text-blue-900 dark:text-blue-100">
                  선택된 에이전트: {allAgents.find(agent => agent.id === selectedAgentId)?.name || '알 수 없음'}
                </span>
              </div>
              <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                이 에이전트에게 파일이 업로드됩니다.
              </p>
            </div>
          )}

          {/* 에이전트 선택 드롭다운 (선택된 에이전트가 없는 경우) */}
          {!selectedAgentId && (
            <div className="mb-6">
              <Label className="text-sm font-medium text-gray-700 mb-2 block">
                에이전트 선택 (선택사항)
              </Label>
              <Select value={targetAgentId?.toString() || "all"} onValueChange={(value) => setTargetAgentId(value === "all" ? null : parseInt(value))}>
                <SelectTrigger>
                  <SelectValue placeholder="에이전트를 선택하세요 (전체 업로드는 선택 안 함)" />
                </SelectTrigger>
                <SelectContent className="z-[10000]">
                  <SelectItem value="all">전체 에이전트 업로드</SelectItem>
                  {allAgents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id.toString()}>
                      {agent.name} ({agent.category})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-gray-500 mt-1">
                특정 에이전트 선택 시 해당 에이전트에게만 파일이 업로드됩니다.
              </p>
            </div>
          )}

          {/* File Upload Section */}
          <div 
            className={`mb-6 p-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl text-center cursor-pointer hover:border-blue-400 transition-all duration-200 hover:bg-blue-50 dark:hover:bg-blue-900/20 ${
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
              const fileInput = document.getElementById('agent-file-upload') as HTMLInputElement;
              if (fileInput) {
                fileInput.click();
              }
            }}
          >
            <div className="text-center">
              <div className="space-y-4">
                <div className="w-16 h-16 mx-auto bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center">
                  <FileText className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h4 className="text-lg font-medium text-foreground mb-2 korean-text">파일을 여기로 드래그하거나 클릭하여 업로드하세요</h4>
                  <p className="text-sm text-muted-foreground korean-text mb-4">
                    지원 파일 : CSV, XLS, XLSX, PDF, DOC, DOCX, TXT, PPT, PPTX (최대 50MB)
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="korean-text"
                >
                  {t('agent.selectFile')}
                </Button>
              </div>
            </div>
            <input
              id="agent-file-upload"
              type="file"
              accept=".csv,.xls,.xlsx,.pdf,.doc,.docx,.txt,.ppt,.pptx"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              multiple
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

          {/* 업로드 결과 표시 */}
          {uploadResult && (
            <div className="mb-6 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-center space-x-2 mb-3">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <span className="font-medium text-green-900 dark:text-green-100">업로드 완료</span>
              </div>
              <div className="space-y-2">
                {Array.isArray(uploadResult) ? (
                  uploadResult.map((result, index) => (
                    <div key={index} className="text-sm">
                      <span className="font-medium">{result.file}:</span>
                      <span className="text-green-700 dark:text-green-300 ml-2">
                        {result.createdCount || result.agentCount || 0}개 생성됨
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-green-700 dark:text-green-300">
                    {uploadResult.createdCount || uploadResult.agentCount || 0}개 항목이 생성되었습니다.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Uploaded Files List */}
          {agentFiles.length > 0 && (
            <div className="mb-6 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">업로드된 파일 ({agentFiles.length}개)</Label>
              </div>
              <div className="border rounded-lg p-3 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-800">
                <div className="space-y-2">
                  {agentFiles.map((file: any, index: number) => (
                    <div 
                      key={index}
                      className="flex items-center justify-between p-2 bg-white dark:bg-gray-700 rounded border"
                    >
                      <div className="flex items-center space-x-3 flex-1 min-w-0">
                        <FileText className={`w-4 h-4 flex-shrink-0 ${
                          file.type === 'agent' ? 'text-blue-500' : 
                          file.originalName?.endsWith('.xlsx') || file.originalName?.endsWith('.xls') || file.originalName?.endsWith('.csv') ? 'text-blue-500' : 
                          'text-gray-500'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <p className="text-sm font-medium truncate">{file.originalName || file.fileName}</p>
                            <div className="flex items-center space-x-1">
                              {file.type === 'agent' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                  에이전트 파일
                                </span>
                              )}
                              {file.status === 'applied' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                  최종 반영됨
                                </span>
                              )}
                              {file.status === 'partially_applied' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                                  부분 반영됨
                                </span>
                              )}
                              {file.status === 'failed' && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                                  실패
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500">
                              {file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString('ko-KR', {
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                              }) : '날짜 없음'} • {((file.size || 0) / 1024).toFixed(1)} KB
                            </p>
                            {file.agentCount && (
                              <p className="text-xs text-gray-600 font-medium">
                                {file.agentCount}개 에이전트 생성
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deleteMutation.mutate(file.id)}
                        disabled={deleteMutation.isPending}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 ml-2"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

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
              <p>• 첫 번째 행: 헤더 (에이전트명, 소개, 유형, 상위 조직, 하위 조직, 세부 조직, 관리자 ID)</p>
              <p>• 에이전트명: 에이전트의 이름 (필수)</p>
              <p>• 소개: 에이전트 기능이나 역할에 대한 소개 (선택)</p>
              <p>• 유형: 학교, 교수, 학생, 그룹, 기능형 중 선택 (필수)</p>
              <p>• 조직 정보: 에이전트가 소속된 조직 계층 구조 (상위 조직은 필수, 하위/세부 조직은 선택)</p>
              <p>• 관리자 ID: 에이전트를 관리할 사용자 ID</p>
            </div>
          </div>

          {/* Upload Options */}
          <div className="mb-6">
            <Label>업로드 옵션</Label>
            <div className="mt-2 space-y-2">
              <div className="flex items-center space-x-2">
                <input 
                  type="checkbox" 
                  id="clear-existing" 
                  className="rounded" 
                  checked={clearExisting}
                  onChange={(e) => setClearExisting(e.target.checked)}
                />
                <Label htmlFor="clear-existing">기존 에이전트 정보 덮어쓰기</Label>
              </div>
            </div>
          </div>

          {/* Upload Result */}
          {uploadResult && (
            <div className={`mb-6 p-4 rounded-lg border ${
              (Array.isArray(uploadResult) ? uploadResult.every(r => r.success) : uploadResult.success)
                ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800'
                : 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800'
            }`}>
              <div className="flex items-center space-x-2 mb-2">
                {(Array.isArray(uploadResult) ? uploadResult.every(r => r.success) : uploadResult.success) ? (
                  <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-600" />
                )}
                <span className={`font-medium korean-text ${
                  (Array.isArray(uploadResult) ? uploadResult.every(r => r.success) : uploadResult.success) 
                    ? 'text-green-800 dark:text-green-200' : 'text-red-800 dark:text-red-200'
                }`}>
                  {(Array.isArray(uploadResult) ? uploadResult.every(r => r.success) : uploadResult.success) 
                    ? t('agent.uploadSuccess') : t('agent.uploadFailed')}
                </span>
              </div>
              
              {/* 배열 결과 처리 */}
              {Array.isArray(uploadResult) ? (
                <div className="space-y-2">
                  {uploadResult.map((result, index) => (
                    <div key={index} className="text-sm">
                      <p className={`korean-text ${
                        result.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                      }`}>
                        <span className="font-medium">{result.file}:</span> {result.message}
                      </p>
                      {result.agentCount && (
                        <p className={`text-sm korean-text mt-1 ${
                          result.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                        }`}>
                          {t('agent.processedAgents')}: {result.agentCount}개
                        </p>
                      )}
                      {result.documentCount && (
                        <p className={`text-sm korean-text mt-1 ${
                          result.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                        }`}>
                          문서 업로드: {result.documentCount}개
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  <p className={`text-sm korean-text ${
                    uploadResult.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                  }`}>
                    {uploadResult.message}
                  </p>
                  {uploadResult.agentCount && (
                    <p className={`text-sm korean-text mt-1 ${
                      uploadResult.success ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                    }`}>
                      {t('agent.processedAgents')}: {uploadResult.agentCount}개
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Progress Bar */}
          {uploadMutation.isPending && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium korean-text">{t('agent.uploading')}</span>
                <span className="text-sm text-muted-foreground">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

        </div>
        
        {/* 고정 버튼 영역 */}
        <div className="border-t p-3 flex-shrink-0">
          <div className="flex justify-end space-x-2">
            <Button variant="outline" onClick={handleClose}>
              취소
            </Button>
            <Button 
              onClick={handleUpload}
              disabled={selectedFiles.length === 0 || uploadMutation.isPending}
            >
              {uploadMutation.isPending ? `업로드 중... (${uploadProgress}%)` : `업로드 시작`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
