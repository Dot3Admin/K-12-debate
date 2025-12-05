import React from 'react';
import { Button } from '@/components/ui/button';

const StyleDemo = () => {
  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      {/* Text Styles Section */}
      <div className="space-y-6">
        <h1 className="text-h1">Text Styles Demo</h1>
        
        <div className="space-y-4 bg-white dark:bg-gray-800 p-6 rounded-lg border">
          <h2 className="text-h2">Typography Showcase</h2>
          
          <div className="space-y-3">
            <div>
              <span className="text-caption mb-1 block">H1 Title (32px, bold)</span>
              <h1 className="text-h1">메인 타이틀 텍스트 스타일</h1>
            </div>
            
            <div>
              <span className="text-caption mb-1 block">H2 Section Title (24px, semi-bold)</span>
              <h2 className="text-h2">섹션 타이틀 텍스트 스타일</h2>
            </div>
            
            <div>
              <span className="text-caption mb-1 block">Subtitle (18px, medium)</span>
              <p className="text-subtitle">부제목 텍스트 스타일입니다</p>
            </div>
            
            <div>
              <span className="text-caption mb-1 block">Body Text (16px, regular)</span>
              <p className="text-body">본문 텍스트 스타일입니다. 일반적인 내용을 표시할 때 사용됩니다.</p>
            </div>
            
            <div>
              <span className="text-caption mb-1 block">Caption (12px, light gray)</span>
              <p className="text-caption">캡션 및 설명글 텍스트 스타일입니다</p>
            </div>
            
            <div>
              <span className="text-caption mb-1 block">Button Text (14px, bold, uppercase)</span>
              <span className="text-button">BUTTON TEXT STYLE</span>
            </div>
          </div>
        </div>
      </div>

      {/* Button Styles Section */}
      <div className="space-y-6">
        <h2 className="text-h2">Button Styles Demo</h2>
        
        <div className="space-y-6 bg-white dark:bg-gray-800 p-6 rounded-lg border">
          <div className="space-y-4">
            <h3 className="text-subtitle">기본 버튼 (.button)</h3>
            <div className="flex flex-wrap gap-4">
              <button className="button">기본 버튼</button>
              <button className="button" disabled>비활성화 버튼</button>
            </div>
            <p className="text-caption">배경색: #1F75FE, 글자색: #fff, radius: 8px, padding: 10px 16px</p>
          </div>
          
          <div className="space-y-4">
            <h3 className="text-subtitle">강조 버튼 (.button-primary)</h3>
            <div className="flex flex-wrap gap-4">
              <button className="button-primary">강조 버튼</button>
              <button className="button-primary" disabled>비활성화 강조 버튼</button>
            </div>
            <p className="text-caption">더 진한 배경색과 hover 효과, 그림자 포함</p>
          </div>

          <div className="space-y-4">
            <h3 className="text-subtitle">크기별 버튼 예시</h3>
            <div className="flex flex-wrap items-center gap-4">
              <button className="button text-xs px-3 py-1.5">작은 버튼</button>
              <button className="button">기본 크기</button>
              <button className="button text-lg px-6 py-3">큰 버튼</button>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-subtitle">Shadcn UI Button 비교</h3>
            <div className="flex flex-wrap gap-4">
              <Button variant="default">Shadcn 기본</Button>
              <Button variant="outline">Shadcn 아웃라인</Button>
              <Button variant="ghost">Shadcn 고스트</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Examples */}
      <div className="space-y-6">
        <h2 className="text-h2">Interactive Examples</h2>
        
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border space-y-4">
          <h3 className="text-subtitle">실제 사용 예시</h3>
          
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-body font-medium">파일 업로드</h4>
                <p className="text-caption">문서를 선택하여 업로드하세요</p>
              </div>
              <button className="button">파일 선택</button>
            </div>
            
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-body font-medium">에이전트 생성</h4>
                <p className="text-caption">새로운 AI 에이전트를 만들어보세요</p>
              </div>
              <button className="button-primary">에이전트 생성</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StyleDemo;