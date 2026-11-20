import { CircleCheck, CircleX, Info, TriangleAlert } from "lucide-react";
import type { NoticeItem } from "@/lib/notice-queue";

const noticeIcons = {
  error: CircleX,
  warning: TriangleAlert,
  success: CircleCheck,
  info: Info,
};

export function NoticeShelf({ notices }: { notices: NoticeItem[] }) {
  if (notices.length === 0) return null;

  return (
    <div className="notice-shelf">
      {notices.map((notice) => {
        const Icon = noticeIcons[notice.type];
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            data-tone={notice.type}
            data-exiting={notice.exiting || undefined}
            role={notice.type === "error" ? "alert" : "status"}
          >
            <span className="notice-shelf-icon" aria-hidden="true">
              <Icon size={15} />
            </span>
            <span className="notice-shelf-message">{notice.message}</span>
          </div>
        );
      })}
    </div>
  );
}
