import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import type { ImageContent } from "@/lib/types";
import { messageAttachmentSource, persistedImageSource } from "@/lib/persisted-image";

export function MessageImage({
  image,
  onLoad,
  attachment = false,
}: {
  image: ImageContent;
  onLoad?: (entryId: string, blockIndex?: number) => Promise<void>;
  attachment?: boolean;
}) {
  const { t } = useI18n();
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const deferred = image.deferredContent;
  const src = attachment ? messageAttachmentSource(image) : persistedImageSource(image);
  const entryId = deferred?.entryId;
  const blockIndex = deferred?.blockIndex;

  useEffect(() => {
    if (!entryId || !target.current) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(target.current);
    return () => observer.disconnect();
  }, [entryId, blockIndex]);

  useEffect(() => {
    if (!visible || !entryId || !onLoad) return;
    let active = true;
    setFailed(false);
    void onLoad(entryId, blockIndex).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [visible, entryId, blockIndex, onLoad, attempt]);

  if (src) {
    return (
      <img
        className={attachment ? "ppt-dsh-user-image" : "ppt-dsh-reply-image"}
        src={src}
        alt={attachment ? t("messageImageAttachment", "Image attachment") : t("replyImage", "Image in reply")}
        loading="lazy"
      />
    );
  }
  if (!deferred) return null;
  return (
    <div ref={target} className="ppt-dsh-message-image-status">
      <span role="status">
        {failed || !onLoad
          ? t("replyImageLoadError", "Could not load this image from history.")
          : t("replyImageLoading", "Loading image…")}
      </span>
      {failed && onLoad && (
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          {t("replyImageRetry", "Retry loading image")}
        </button>
      )}
    </div>
  );
}
