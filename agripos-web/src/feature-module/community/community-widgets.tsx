import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { initials } from '../../utils/initials';
import { normalizeImageUrl } from '../../utils/imageUrl';
import {
  IconBookmark,
  IconHeart,
  IconHeartFilled,
  IconMessageCircle,
  IconBell,
  IconDots,
  IconX,
  IconMapPin,
  IconBuildingStore,
  IconBulb,
  IconHelpCircle,
  IconChartLine,
} from "@tabler/icons-react";
import VerifiedBadge from "../../components/brand/VerifiedBadge";
import {
  communityApi,
  type CommunityComment,
  type CommunityPost,
} from "../../services/community.service";

export const KINDS: Record<string, string> = {
  question: "Hỏi đáp",
  experience: "Kinh nghiệm",
  market: "Thị trường",
  announcement: "Từ đại lý",
};
// Nhãn loại bài phân biệt bằng icon (bảng màu xám – trắng, mockup 50 bản E).
const KIND_ICONS: Record<string, ReactNode> = {
  experience: <IconBulb size={14} />,
  question: <IconHelpCircle size={14} />,
  market: <IconChartLine size={14} />,
  announcement: <IconBuildingStore size={14} />,
};
export const STATES: Record<string, string> = {
  draft: "Bản nháp",
  published: "Đã đăng",
  hidden: "Đã ẩn",
  deleted: "Đã xóa",
};
export const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export function Avatar({
  name,
  business = false,
  imageUrl,
}: {
  name: string;
  business?: boolean;
  /** Logo đại lý (nếu có) thay cho icon cửa hàng. */
  imageUrl?: string | null;
}) {
  const src = imageUrl ? normalizeImageUrl(imageUrl) : null;
  return (
    <span
      className={`cm-avatar ${business ? "business" : ""}${src ? " has-image" : ""}`}
      aria-hidden="true"
    >
      {src ? <img src={src} alt="" loading="lazy" /> : business ? <IconBuildingStore size={22} /> : initials(name)}
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`cm-dialog ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      aria-label={title}
    >
      <div className="cm-dialog-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="cm-icon-button"
          aria-label="Đóng"
          onClick={onClose}
        >
          <IconX size={21} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function PrivateImage({
  id,
  onRemove,
}: {
  id: string;
  onRemove?: () => void;
}) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    communityApi
      .media(id)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);
  return (
    <div className="cm-image-wrap">
      {url ? (
        <button
          className="cm-image-button"
          type="button"
          onClick={() => setZoom(true)}
          aria-label="Xem ảnh lớn"
        >
          <img src={url} alt="Ảnh đính kèm bài viết" />
        </button>
      ) : (
        <div className="cm-image-placeholder">
          {failed ? "Ảnh không còn khả dụng" : "Đang tải ảnh…"}
        </div>
      )}
      {onRemove && (
        <button
          className="cm-image-remove"
          type="button"
          aria-label="Bỏ ảnh"
          onClick={onRemove}
        >
          <IconX size={16} />
        </button>
      )}
      {zoom && (
        <Modal title="Ảnh bài viết" onClose={() => setZoom(false)} wide>
          <img
            className="cm-full-image"
            src={url}
            alt="Ảnh đính kèm bài viết"
          />
        </Modal>
      )}
    </div>
  );
}

export type PostCommand = "edit" | "delete" | "report" | "block";
export function PostCard({
  post,
  userId,
  viewerName,
  topicNames,
  onAction,
  onCommand,
  detail = false,
  onOpen,
  revealIndex,
}: {
  post: CommunityPost;
  userId: string;
  viewerName: string;
  topicNames: Record<string, string>;
  detail?: boolean;
  onAction: (
    post: CommunityPost,
    kind: "like" | "bookmark" | "subscription",
  ) => Promise<void>;
  onCommand: (command: PostCommand, post: CommunityPost) => void;
  /** Có thì các liên kết bình luận mở cửa sổ bài viết thay vì chuyển trang. */
  onOpen?: () => void;
  /** Thứ tự trên bảng tin — bài trượt lên lần lượt khi tải (mockup 53 · M2). */
  revealIndex?: number;
}) {
  const [busy, setBusy] = useState(false);
  // Lần bấm thích gần nhất của người xem: tim bật + tia bắn, số lượt thích lăn (mockup 53 · M1).
  const [likeBurst, setLikeBurst] = useState(0);
  // Giữ Ctrl/Cmd+bấm (mở tab mới) như liên kết thường.
  const openHere = (e: MouseEvent) => {
    if (!onOpen || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    onOpen();
  };
  const [previewComments, setPreviewComments] = useState<CommunityComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  useEffect(() => { if (detail || post.commentCount < 1) return; let active = true; communityApi.comments(post.id).then(page => { if(active) setPreviewComments(page.items.slice(0,1)); }).catch(() => {}); return () => { active = false; }; }, [post.id, post.commentCount, detail]);
  const own = post.author.id === userId;
  const perform = async (kind: "like" | "bookmark" | "subscription") => {
    if (kind === "like") setLikeBurst((n) => n + 1);
    setBusy(true);
    try {
      await onAction(post, kind);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article
      className={`cm-card cm-post ${post.state !== "published" ? "unpublished" : ""}${revealIndex != null ? " cm-reveal" : ""}`}
      style={revealIndex != null ? ({ "--i": Math.min(revealIndex, 6) } as CSSProperties) : undefined}
    >
      <header className="cm-post-head">
        <Link
          to={
            post.organization
              ? `/community/businesses/${post.organization.id}`
              : `/community/members/${post.author.id}`
          }
        >
          <Avatar
            name={post.organization?.name || post.author.name}
            business={!!post.organization}
          />
        </Link>
        <div className="cm-author">
          <Link
            to={
              post.organization
                ? `/community/businesses/${post.organization.id}`
                : `/community/members/${post.author.id}`
            }
          >
            {post.organization?.name || post.author.name}
            {post.organization?.verified && <VerifiedBadge size={15} />}
          </Link>
          <span>
            {post.organization
              ? "Đại lý"
              : post.author.role === "farmer"
                ? "Nông dân"
                : "Thành viên đại lý"}{" "}
            · {timeLabel(post.createdAt)}
          </span>
        </div>
        <span className={`cm-kind ${post.kind}`}>{KIND_ICONS[post.kind]}{KINDS[post.kind]}</span>
        <details className="cm-post-menu">
          <summary aria-label="Tùy chọn bài viết">
            <IconDots size={20} />
          </summary>
          <div>
            {own ? (
              <>
                {["draft", "published"].includes(post.state) && (
                  <button onClick={() => onCommand("edit", post)}>
                    Chỉnh sửa bài
                  </button>
                )}
                <button onClick={() => onCommand("delete", post)}>
                  Xóa bài viết
                </button>
              </>
            ) : (
              <>
                <button onClick={() => onCommand("report", post)}>
                  Báo cáo bài viết
                </button>
                <button onClick={() => onCommand("block", post)}>
                  Chặn tác giả
                </button>
              </>
            )}
          </div>
        </details>
      </header>
      {post.state !== "published" && (
        <div className="cm-notice">
          {STATES[post.state]}
          {post.moderationReason ? ` — ${post.moderationReason}` : ""}
        </div>
      )}
      <div className={`cm-post-body ${detail ? "" : "clamped"}`}>
        {post.body}
      </div>
      {post.mediaIds.length > 0 && post.state !== "hidden" && (
        <div className={`cm-images count-${post.mediaIds.length}`}>
          {post.mediaIds.map((id) => (
            <PrivateImage key={id} id={id} />
          ))}
        </div>
      )}
      {post.kind === "market" && (
        <div className="cm-market-note">
          Nguồn: {post.source} · Ghi nhận: {post.observedAt}
          <br />
          Thông tin chia sẻ từ thành viên, không phải báo giá giao dịch.
        </div>
      )}
      <div className="cm-tags">
        {post.topics.map((topic) => (
          <Link
            key={topic}
            to={`/community?topic=${encodeURIComponent(topic)}`}
          >
            #{topicNames[topic] || topic}
          </Link>
        ))}
        {post.crop && <span>{post.crop}</span>}
        {post.region && (
          <span>
            <IconMapPin size={13} />
            {post.region}
          </span>
        )}
      </div>
      {post.state === 'published' && <div className="cm-post-counts"><span className="cm-like-count" aria-label={`${post.likeCount} lượt thích`}>{post.likeCount > 0 && <><span className="cm-like-dot"><IconHeartFilled size={16} /></span><span key={post.likeCount} className={likeBurst ? `agl-roll ${post.liked ? "up" : "down"}` : undefined}>{post.likeCount}</span></>}</span><Link to={`/community/posts/${post.id}`} onClick={openHere}>{post.commentCount} bình luận</Link></div>}
      {post.state === "published" && (
        <footer className="cm-post-actions">
          <button
            className={post.liked ? "selected" : ""}
            disabled={busy}
            aria-pressed={post.liked}
            onClick={() => void perform("like")}
          >
            <span className="agl-heart">
              {post.liked ? <IconHeartFilled size={19} className={`cm-heart-on${likeBurst ? " agl-pop" : ""}`} /> : <IconHeart size={19} />}
              {post.liked && likeBurst > 0 && (
                <span key={likeBurst} className="agl-burst" aria-hidden="true">
                  {[22, 67, 112, 157, 202, 247, 292, 337].map((a) => (
                    <i key={a} style={{ "--a": `${a}deg` } as CSSProperties} />
                  ))}
                </span>
              )}
            </span>
            <span className="cm-mobile-count">{post.likeCount || ''}</span> Thích
          </button>
          <Link to={`/community/posts/${post.id}`} onClick={openHere}>
            <IconMessageCircle size={19} />
            <span className="cm-mobile-count">{post.commentCount || ''}</span><span className="cm-desktop-label">Bình luận</span><span className="cm-mobile-label">Thảo luận</span>
          </Link>
          <button
            className={post.saved ? "selected" : ""}
            disabled={busy}
            aria-pressed={post.saved}
            onClick={() => void perform("bookmark")}
          >
            <IconBookmark size={18} />
            {post.saved ? "Đã lưu" : "Lưu"}
          </button>
          <button
            className={post.subscribed ? "selected" : ""}
            disabled={busy}
            aria-pressed={post.subscribed}
            title="Theo dõi phản hồi"
            onClick={() => void perform("subscription")}
          >
            <IconBell size={18} />
            <span className="cm-follow-label">
              {post.subscribed ? "Đang theo dõi" : "Theo dõi"}
            </span>
          </button>
        </footer>
      )}
      {!detail && post.state === 'published' && <div className="cm-post-preview-comments">{previewComments[0] && <div className="cm-post-preview-comment"><Avatar name={previewComments[0].author.name} /><div><strong>{previewComments[0].author.name}</strong><p>{previewComments[0].body}</p></div></div>}{post.commentCount > 1 && <Link to={`/community/posts/${post.id}`} className="cm-comment-more" onClick={openHere}>Xem thêm bình luận</Link>}<form onSubmit={async e => { e.preventDefault(); if(!commentText.trim()) return; try { await communityApi.comment(post.id, commentText.trim(), crypto.randomUUID()); setCommentText(''); setCommentError(''); const page = await communityApi.comments(post.id); setPreviewComments(page.items.slice(0,1)); } catch { setCommentError('Chưa gửi được bình luận. Vui lòng thử lại.'); } }}><Avatar name={viewerName} /><input aria-label="Viết bình luận" placeholder="Viết bình luận…" value={commentText} onChange={e => setCommentText(e.target.value)} /><button type="submit" disabled={!commentText.trim()} aria-label="Gửi bình luận"><IconMessageCircle size={18} /></button></form>{commentError && <small role="alert" className="text-danger">{commentError}</small>}</div>}
    </article>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="cm-card cm-empty">
      <span className="cm-empty-icon">
        <IconMessageCircle size={29} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
