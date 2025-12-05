import { useState, useEffect } from "react";

export function useIsTablet() {
  const [isTablet, setIsTablet] = useState(() => {
    // Initialize with actual window size if available (client-side)
    if (typeof window !== 'undefined') {
      return window.innerWidth >= 768;
    }
    return false;
  });

  useEffect(() => {
    const checkTablet = () => {
      setIsTablet(window.innerWidth >= 768);
    };

    // Check immediately on mount in case initial state was wrong
    checkTablet();
    window.addEventListener("resize", checkTablet);

    return () => window.removeEventListener("resize", checkTablet);
  }, []);

  return isTablet;
}