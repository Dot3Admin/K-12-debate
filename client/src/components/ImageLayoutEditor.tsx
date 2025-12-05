import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface ImageLayoutEditorProps {
  imageUrl: string;
  cardWidth: number; // 그리드 단위
  cardHeight: number; // 그리드 단위
  cardX: number; // 그리드 단위
  cardY: number; // 그리드 단위
  initialTransform?: { x: number; y: number; scale: number }; // 기존 transform 정보
  onSave: (croppedBlob: Blob, transform: { x: number; y: number; scale: number }) => void;
  onCancel: () => void;
}

export function ImageLayoutEditor({
  imageUrl,
  cardWidth,
  cardHeight,
  cardX,
  cardY,
  initialTransform,
  onSave,
  onCancel,
}: ImageLayoutEditorProps) {
  // 이미지 변환 상태 (translate + scale)
  // 기존 transform이 있으면 그것을 사용, 없으면 초기값
  console.log('🔧 ImageLayoutEditor initialized with initialTransform:', initialTransform);
  
  const [transform, setTransform] = useState(
    initialTransform || {
      x: 0,
      y: 0,
      scale: 1,
    }
  );
  
  console.log('🔧 Initial transform state:', transform);

  // 터치/드래그 상태
  const [isDragging, setIsDragging] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [lastDistance, setLastDistance] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // CardHome의 실제 그리드 셀 크기 (모바일 기준 고정값)
  // 모바일 화면 390px 기준: (390 - 30) / 4 = 90px
  // 높이: 70px 고정
  // 비율: 90:70 = 1.29:1 (가로로 약간 더 넓은 직사각형)
  const GRID_CELL_WIDTH = 90;
  const GRID_CELL_HEIGHT = 70;
  
  // 카드 픽셀 크기 (CardHome과 동일한 비율)
  const cardPixelWidth = cardWidth * GRID_CELL_WIDTH;
  const cardPixelHeight = cardHeight * GRID_CELL_HEIGHT;
  
  console.log('📐 Card dimensions:', {
    cardWidth,
    cardHeight,
    GRID_CELL_WIDTH,
    GRID_CELL_HEIGHT,
    cardPixelWidth,
    cardPixelHeight,
    ratio: (cardPixelWidth / cardPixelHeight).toFixed(2),
  });

  // 외부 이미지 URL을 프록시를 통해 로드
  const proxiedImageUrl = imageUrl.startsWith('http://') || imageUrl.startsWith('https://')
    ? `/api/card-layout/proxy-image?url=${encodeURIComponent(imageUrl)}`
    : imageUrl;

  // 이미지 로드 시 초기 위치 설정 (카드 중앙에 맞춤)
  useEffect(() => {
    if (!imageRef.current || !containerRef.current) return;
    
    const img = imageRef.current;
    const handleLoad = () => {
      // 이미지가 제대로 로드되었는지 확인
      if (!img.naturalWidth || !img.naturalHeight) {
        console.error('Image failed to load or has invalid dimensions');
        return;
      }

      // initialTransform이 있으면 초기 스케일 설정을 건너뜀 (이미 저장된 상태 사용)
      if (initialTransform) {
        console.log('Using saved transform:', initialTransform);
        return;
      }

      // 이미지를 카드 크기에 맞게 초기 스케일 설정
      const scaleX = cardPixelWidth / img.naturalWidth;
      const scaleY = cardPixelHeight / img.naturalHeight;
      const initialScale = Math.max(scaleX, scaleY); // 카드를 완전히 채우도록

      console.log('Image loaded - setting initial scale:', {
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        cardPixelWidth,
        cardPixelHeight,
        scaleX,
        scaleY,
        initialScale,
      });

      // 이미지를 카드 중앙에 정렬
      setTransform({
        x: 0,
        y: 0,
        scale: initialScale,
      });
    };

    const handleError = () => {
      console.error('Failed to load image:', imageUrl);
    };

    // 이미지 로드 이벤트 리스너 등록
    img.addEventListener('load', handleLoad);
    img.addEventListener('error', handleError);

    // 이미 로드된 경우 즉시 처리
    if (img.complete && img.naturalWidth) {
      handleLoad();
    }

    return () => {
      img.removeEventListener('load', handleLoad);
      img.removeEventListener('error', handleError);
    };
  }, [imageUrl, cardPixelWidth, cardPixelHeight, initialTransform]);

  // 두 터치 포인트 사이 거리 계산
  const getDistance = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 터치 시작
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      // 단일 터치 - 드래그 시작
      setIsDragging(true);
      setStartPos({
        x: e.touches[0].clientX - transform.x,
        y: e.touches[0].clientY - transform.y,
      });
    } else if (e.touches.length === 2) {
      // 두 손가락 터치 - 핀치 시작
      setIsDragging(false);
      const distance = getDistance(e.touches);
      setLastDistance(distance);
    }
  };

  // 터치 이동
  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();

    if (e.touches.length === 1 && isDragging) {
      // 드래그
      setTransform((prev) => ({
        ...prev,
        x: e.touches[0].clientX - startPos.x,
        y: e.touches[0].clientY - startPos.y,
      }));
    } else if (e.touches.length === 2) {
      // 핀치 줌
      const distance = getDistance(e.touches);
      if (distance && lastDistance) {
        const scaleDelta = distance / lastDistance;
        setTransform((prev) => ({
          ...prev,
          scale: Math.max(0.1, Math.min(prev.scale * scaleDelta, 5)),
        }));
        setLastDistance(distance);
      }
    }
  };

  // 터치 종료
  const handleTouchEnd = () => {
    setIsDragging(false);
    setLastDistance(null);
  };

  // 마우스 이벤트 (데스크톱용)
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setStartPos({
      x: e.clientX - transform.x,
      y: e.clientY - transform.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTransform((prev) => ({
      ...prev,
      x: e.clientX - startPos.x,
      y: e.clientY - startPos.y,
    }));
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 마우스 휠로 줌 (데스크톱용)
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((prev) => ({
      ...prev,
      scale: Math.max(0.1, Math.min(prev.scale * delta, 5)),
    }));
  };

  // 저장: 현재 보이는 부분을 크롭하여 Blob 생성
  const handleSave = async () => {
    if (!imageRef.current || !containerRef.current) return;

    const img = imageRef.current;
    const container = containerRef.current;
    
    // 이미지가 제대로 로드되었는지 확인
    if (!img.complete || img.naturalWidth === 0) {
      console.error('Image not loaded yet');
      alert('이미지가 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    
    // Canvas 생성
    const canvas = document.createElement('canvas');
    canvas.width = cardPixelWidth;
    canvas.height = cardPixelHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.error('Failed to get canvas context');
      return;
    }

    // 실제 렌더링된 요소들의 화면 좌표 가져오기
    const containerRect = container.getBoundingClientRect();
    const imgRect = img.getBoundingClientRect();
    
    // 카드 영역 (컨테이너 중앙에 위치, 절대 좌표)
    const cardLeft = containerRect.left + (containerRect.width - cardPixelWidth) / 2;
    const cardTop = containerRect.top + (containerRect.height - cardPixelHeight) / 2;
    const cardRight = cardLeft + cardPixelWidth;
    const cardBottom = cardTop + cardPixelHeight;
    
    // 카드 영역이 렌더링된 이미지 내에서 어디에 있는지 (픽셀 단위, 스케일 적용된 좌표)
    const offsetXInScaledImg = cardLeft - imgRect.left;
    const offsetYInScaledImg = cardTop - imgRect.top;
    
    // 스케일된 이미지 크기
    const scaledImgWidth = imgRect.width;
    const scaledImgHeight = imgRect.height;
    
    // 원본 이미지와 렌더링된 이미지의 비율 계산
    // (getBoundingClientRect는 CSS transform 후의 크기를 반환함)
    const scaleRatioX = img.naturalWidth / scaledImgWidth;
    const scaleRatioY = img.naturalHeight / scaledImgHeight;
    
    // 원본 이미지 좌표로 변환
    const cropX = offsetXInScaledImg * scaleRatioX;
    const cropY = offsetYInScaledImg * scaleRatioY;
    const cropWidth = cardPixelWidth * scaleRatioX;
    const cropHeight = cardPixelHeight * scaleRatioY;

    console.log('🎯 Crop calculation (DOM-based):', {
      containerRect: {
        left: containerRect.left,
        top: containerRect.top,
        width: containerRect.width,
        height: containerRect.height,
      },
      imgRect: {
        left: imgRect.left,
        top: imgRect.top,
        width: imgRect.width,
        height: imgRect.height,
      },
      cardArea: {
        left: cardLeft,
        top: cardTop,
        right: cardRight,
        bottom: cardBottom,
        width: cardPixelWidth,
        height: cardPixelHeight,
      },
      offsetInScaledImg: {
        x: offsetXInScaledImg,
        y: offsetYInScaledImg,
      },
      scaledImgSize: {
        width: scaledImgWidth,
        height: scaledImgHeight,
      },
      naturalImgSize: {
        width: img.naturalWidth,
        height: img.naturalHeight,
      },
      scaleRatio: {
        x: scaleRatioX,
        y: scaleRatioY,
      },
      cropArea: {
        x: cropX,
        y: cropY,
        width: cropWidth,
        height: cropHeight,
      },
    });

    // Canvas에 크롭된 이미지 그리기
    ctx.drawImage(
      img,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cardPixelWidth,
      cardPixelHeight
    );

    // Blob으로 변환
    canvas.toBlob((blob) => {
      if (blob) {
        console.log('✅ 크롭 완료!', { transform });
        // Blob과 transform 정보를 함께 전달
        onSave(blob, transform);
      } else {
        console.error('Failed to create blob');
      }
    }, 'image/png');
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel?.()}>
      <DialogContent className="max-w-[95vw] h-[95vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <DialogTitle>이미지 레이아웃 편집</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            이미지를 드래그하고 확대/축소하여 카드에 맞게 배치하세요. 카드 크기: {cardWidth}×{cardHeight} ({cardPixelWidth}×{cardPixelHeight}px)
          </p>
        </DialogHeader>

        {/* 편집 영역 */}
        <div className="flex-1 overflow-hidden relative bg-gray-100 dark:bg-gray-900 min-h-0">
          <div
            ref={containerRef}
            className="absolute inset-0 flex items-center justify-center overflow-hidden touch-none"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
          >
            {/* 이미지 (배경) */}
            <img
              ref={imageRef}
              src={proxiedImageUrl}
              alt="편집 중인 이미지"
              crossOrigin="anonymous"
              className="absolute select-none"
              draggable={false}
              style={{
                left: '50%',
                top: '50%',
                transform: `translate(calc(-50% + ${transform.x}px), calc(-50% + ${transform.y}px)) scale(${transform.scale})`,
                transformOrigin: 'center',
                cursor: isDragging ? 'grabbing' : 'grab',
                zIndex: 5,
              }}
            />

            {/* 카드 그리드 (오버레이) */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 10 }}>
              <div
                className="relative"
                style={{
                  width: `${cardPixelWidth}px`,
                  height: `${cardPixelHeight}px`,
                  border: '3px solid #3b82f6',
                  boxShadow: '0 0 0 2000px rgba(0,0,0,0.5)',
                }}
              >
                {/* 그리드 선 */}
                <svg
                  className="absolute inset-0 pointer-events-none"
                  style={{ width: '100%', height: '100%' }}
                >
                  {/* 세로 선 */}
                  {Array.from({ length: cardWidth }).map((_, i) => (
                    <line
                      key={`v-${i}`}
                      x1={i * GRID_CELL_WIDTH}
                      y1={0}
                      x2={i * GRID_CELL_WIDTH}
                      y2={cardPixelHeight}
                      stroke="rgba(156,163,175,0.3)"
                      strokeWidth="1"
                    />
                  ))}
                  {/* 가로 선 */}
                  {Array.from({ length: cardHeight }).map((_, i) => (
                    <line
                      key={`h-${i}`}
                      x1={0}
                      y1={i * GRID_CELL_HEIGHT}
                      x2={cardPixelWidth}
                      y2={i * GRID_CELL_HEIGHT}
                      stroke="rgba(156,163,175,0.3)"
                      strokeWidth="1"
                    />
                  ))}
                </svg>
              </div>
            </div>
          </div>
        </div>

        {/* 하단 버튼 */}
        <div className="flex justify-between items-center px-6 py-4 border-t bg-white dark:bg-gray-950 flex-shrink-0">
          <div className="text-sm text-muted-foreground">
            줌: {(transform.scale * 100).toFixed(0)}%
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onCancel}>
              취소
            </Button>
            <Button onClick={handleSave}>저장</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
