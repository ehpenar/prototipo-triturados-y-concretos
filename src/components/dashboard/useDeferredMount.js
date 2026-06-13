import { useEffect, useRef, useState } from "react";

export function useDeferredMount(rootMargin = "240px") {
  const [isReady, setIsReady] = useState(false);
  const sentinelRef = useRef(null);

  useEffect(() => {
    if (isReady) return undefined;
    const node = sentinelRef.current;
    if (!node) return undefined;

    if (typeof IntersectionObserver === "undefined") {
      setIsReady(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsReady(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isReady, rootMargin]);

  return { isReady, sentinelRef };
}
