import { useEffect, useRef, useState } from "react";
import { IconX } from "@tabler/icons-react";
import { prefersReducedMotion } from "../../utils/motion";
import type { CommunityPost, CommunityViewer } from "../../services/community.service";
import CommunityDiscussion from "./community-discussion";
import { PostCard, type PostCommand } from "./community-widgets";

/**
 * Cửa sổ "Bài viết của …" kiểu Facebook: mở ngay trên bảng tin (không chuyển trang),
 * nền phía sau mờ kiểu kính, thân cửa sổ cuộn, ô bình luận luôn ở chân cửa sổ.
 */
export default function CommunityPostModal({
  post,
  viewer,
  topicNames,
  onClose,
  onAction,
  onCommand,
  onChanged,
  onReport,
}: {
  post: CommunityPost;
  viewer: CommunityViewer;
  topicNames: Record<string, string>;
  onClose: () => void;
  onAction: (post: CommunityPost, kind: "like" | "bookmark" | "subscription") => Promise<void>;
  onCommand: (command: PostCommand, post: CommunityPost) => void;
  onChanged: () => void;
  onReport: (commentId: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  // Đóng: cửa sổ thu lại + nền kính tan (180ms, agrilink-motion.css · M4) rồi mới gỡ khỏi trang.
  const [closing, setClosing] = useState(false);
  const close = () => (prefersReducedMotion() ? onClose() : setClosing(true));
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(onClose, 180);
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);
  const author = post.organization?.name || post.author.name;
  return (
    <dialog
      ref={ref}
      className={`cm-post-modal${closing ? " is-closing" : ""}`}
      aria-label={`Bài viết của ${author}`}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      // Bấm ra ngoài (vùng nền của <dialog>) để đóng.
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="cm-post-modal-inner">
        <header className="cm-post-modal-head">
          <h2>Bài viết của {author}</h2>
          <button type="button" aria-label="Đóng" onClick={close}>
            <IconX size={22} />
          </button>
        </header>
        <div className="cm-post-modal-body">
          <PostCard
            post={post}
            detail
            userId={viewer.id}
            viewerName={viewer.displayName}
            topicNames={topicNames}
            onAction={onAction}
            onCommand={onCommand}
            onOpen={() => slot?.querySelector("textarea")?.focus()}
          />
          <CommunityDiscussion
            post={post}
            viewer={viewer}
            refresh={onChanged}
            onReport={onReport}
            composerSlot={slot}
          />
        </div>
        <div className="cm-post-modal-foot" ref={setSlot} />
      </div>
    </dialog>
  );
}
