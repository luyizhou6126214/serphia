import { useEffect, useRef, useState } from "react";

const LONG_MESSAGE_LENGTH = 2048;

/** Coalesce rapid stream updates while keeping the latest source visible at settlement. */
export function useStreamingMarkdown(source: string, isStreaming?: boolean): string {
  const [snapshot, setSnapshot] = useState(source);
  const latest = useRef(source);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = source;
    if (!isStreaming || source.length <= LONG_MESSAGE_LENGTH) {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      setSnapshot(source);
      return;
    }
    if (timer.current === null) {
      // Larger documents are more expensive to parse, so allow a little more
      // time to combine tokens. This is a throttle, not a trailing debounce.
      const delay = Math.min(300, 100 + Math.floor(source.length / 10000) * 25);
      timer.current = setTimeout(() => {
        timer.current = null;
        setSnapshot(latest.current);
      }, delay);
    }
  }, [source, isStreaming]);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  if (!isStreaming || source.length <= LONG_MESSAGE_LENGTH || !source.startsWith(snapshot)) return source;
  return snapshot;
}
