import { useEffect, useState } from 'react';

/**
 * 폼 데이터의 변경사항을 감지하는 커스텀 훅
 * @param currentData 현재 폼 데이터
 * @param originalData 원본 데이터 (초기값)
 * @returns hasChanges - 변경사항이 있는지 여부
 */
export function useFormChanges<T extends Record<string, any>>(
  currentData: T,
  originalData: T
): boolean {
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // 깊은 비교를 통해 변경사항 감지
    const checkChanges = () => {
      const keys = Object.keys(currentData);
      
      for (const key of keys) {
        const currentValue = currentData[key];
        const originalValue = originalData[key];
        
        // 값이 다르면 변경사항 있음
        if (currentValue !== originalValue) {
          return true;
        }
      }
      
      return false;
    };

    setHasChanges(checkChanges());
  }, [currentData, originalData]);

  return hasChanges;
}

/**
 * 배열이나 객체를 포함한 복잡한 데이터 구조의 변경사항을 감지하는 훅
 * @param currentData 현재 폼 데이터
 * @param originalData 원본 데이터 (초기값)
 * @returns hasChanges - 변경사항이 있는지 여부
 */
export function useDeepFormChanges<T>(
  currentData: T,
  originalData: T
): boolean {
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    // JSON.stringify를 사용한 깊은 비교
    const currentJson = JSON.stringify(currentData);
    const originalJson = JSON.stringify(originalData);
    
    setHasChanges(currentJson !== originalJson);
  }, [currentData, originalData]);

  return hasChanges;
}