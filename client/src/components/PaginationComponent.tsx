import React from 'react';
import { Button } from '@/components/ui/button';

interface PaginationComponentProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  totalItems: number;
  itemsPerPage: number;
  itemName?: string; // 예: "사용자", "에이전트", "문서" 등
  showItemCount?: boolean; // 총계 표시 여부
}

export const PaginationComponent: React.FC<PaginationComponentProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  totalItems,
  itemsPerPage,
  itemName = "항목",
  showItemCount = true
}) => {
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);

  const getPageNumbers = () => {
    const pages = [];
    const showPages = 5; // 표시할 페이지 수
    let startPage = Math.max(1, currentPage - Math.floor(showPages / 2));
    let endPage = Math.min(totalPages, startPage + showPages - 1);

    if (endPage - startPage + 1 < showPages) {
      startPage = Math.max(1, endPage - showPages + 1);
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    return pages;
  };

  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-col items-center justify-center space-y-2 px-6 py-4 text-center">
      {/* 페이지네이션 설명 텍스트 */}
      {showItemCount && (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          전체 {totalItems}개 {itemName} 중 {startItem}-{endItem}개 표시
        </div>
      )}
      
      <div className="flex items-center justify-center space-x-2">
        {/* 페이지네이션 버튼들 */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
        disabled={currentPage === 1}
        className="!w-10 !h-10 !text-sm"
      >
        이전
      </Button>
      {/* 첫 페이지 */}
      {currentPage > 3 && (
        <>
          <Button
            variant={1 === currentPage ? "default" : "outline"}
            size="sm"
            onClick={() => onPageChange(1)}
            className="!w-10 !h-10 !text-sm !min-w-[40px] !max-w-[40px]"
          >
            1
          </Button>
          {currentPage > 4 && <span className="px-2 text-gray-500">...</span>}
        </>
      )}
      {/* 현재 페이지 주변 페이지들 */}
      {getPageNumbers().map((page) => (
        <Button
          key={page}
          variant={page === currentPage ? "default" : "outline"}
          size="sm"
          onClick={() => onPageChange(page)}
          className="!w-10 !h-10 !text-sm !min-w-[40px] !max-w-[40px]"
        >
          {page}
        </Button>
      ))}
      {/* 마지막 페이지 */}
      {currentPage < totalPages - 2 && (
        <>
          {currentPage < totalPages - 3 && <span className="px-2 text-gray-500">...</span>}
          <Button
            variant={totalPages === currentPage ? "default" : "outline"}
            size="sm"
            onClick={() => onPageChange(totalPages)}
            className="!w-10 !h-10 !text-sm !min-w-[40px] !max-w-[40px]"
          >
            {totalPages}
          </Button>
        </>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
        disabled={currentPage === totalPages}
        className="!w-10 !h-10 !text-sm"
      >
        다음
      </Button>
      </div>
    </div>
  );
};