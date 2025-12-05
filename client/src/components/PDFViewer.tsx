import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { X, Download, FileText } from "lucide-react";

interface PDFViewerProps {
  documentId: number;
  documentName: string;
  onClose: () => void;
  onContentExtracted?: (content: string) => void;
}

export default function PDFViewer({ documentId, documentName, onClose, onContentExtracted }: PDFViewerProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>('');

  useEffect(() => {
    const loadPDF = async () => {
      try {
        setIsLoading(true);
        
        // Create download URL for PDF
        const downloadUrl = `/api/documents/${documentId}/download`;
        setPdfUrl(downloadUrl);
        
        setIsLoading(false);
      } catch (err) {
        console.error('PDF loading error:', err);
        setError('PDF 파일을 불러올 수 없습니다.');
        setIsLoading(false);
      }
    };

    loadPDF();
  }, [documentId]);

  const handleExtractText = async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/reprocess`, {
        method: 'POST',
        credentials: 'include'
      });

      if (response.ok) {
        const result = await response.json();
        if (onContentExtracted && result.content) {
          onContentExtracted(result.content);
        }
        alert(`텍스트 추출 완료: ${result.extractedLength || '0'}자`);
      } else {
        alert('텍스트 추출에 실패했습니다.');
      }
    } catch (error) {
      console.error('Text extraction error:', error);
      alert('텍스트 추출 중 오류가 발생했습니다.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-4xl h-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 truncate">
            {documentName}
          </h2>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExtractText}
              className="flex items-center space-x-2"
            >
              <FileText className="w-4 h-4" />
              <span>텍스트 추출</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const link = document.createElement('a');
                link.href = pdfUrl;
                link.download = documentName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }}
              className="flex items-center space-x-2"
            >
              <Download className="w-4 h-4" />
              <span>다운로드</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="p-2"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 overflow-hidden">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">PDF 로딩 중...</div>
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-500">{error}</div>
            </div>
          )}
          
          {!isLoading && !error && (
            <div className="w-full h-full bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
              <iframe
                src={`${pdfUrl}#toolbar=1&navpanes=1&scrollbar=1`}
                className="w-full h-full border-0"
                title={documentName}
                style={{ minHeight: '500px' }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}