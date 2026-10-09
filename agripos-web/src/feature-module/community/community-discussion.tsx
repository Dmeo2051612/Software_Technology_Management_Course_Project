import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { IconCheck, IconCornerDownRight, IconSend } from "@tabler/icons-react";
import {
  communityApi,
  communityError,
  type CommunityComment,
  type CommunityPost,
  type CommunityViewer,
} from "../../services/community.service";
import { Avatar, EmptyState, timeLabel } from "./community-widgets";

export default function CommunityDiscussion({
  post,
  viewer,
  refresh,
  onReport,
  composerSlot,
}: {
  post: CommunityPost;
  viewer: CommunityViewer;
  refresh: () => void;
  onReport: (id: string) => void;
  /** Trong cửa sổ bài viết: ô bình luận nằm ở chân cửa sổ (ngoài vùng cuộn), kiểu Facebook. */
  composerSlot?: HTMLElement | null;
}) {
  const modal = composerSlot !== undefined;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [items, setItems] = useState<CommunityComment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [reply, setReply] = useState<CommunityComment | null>(null);
  const [editing, setEditing] = useState<CommunityComment | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [revision, setRevision] = useState(0);
  // Nút gửi: vòng xoay khi đang gửi, dấu tích xanh 1,2 giây khi xong (mockup 53 · M16).
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => setSent(false), 1200);
    return () => window.clearTimeout(timer);
  }, [sent]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    communityApi
      .comments(post.id)
      .then((data) => {
        if (active) {
          setItems(data.items);
          setCursor(data.nextCursor);
        }
      })
      .catch((e) => {
        if (active) setError(communityError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [post.id, post.commentCount, revision]);
  useEffect(() => {
    if (composerSlot) inputRef.current?.focus();
  }, [composerSlot]);
  const mutate = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setRevision((n) => n + 1);
      refresh();
      return true;
    } catch (e) {
      setError(communityError(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    setSending(true);
    const ok = await mutate(() =>
      editing
        ? communityApi.editComment(editing.id, body)
        : communityApi.comment(post.id, body, requestId, reply?.id),
    ).finally(() => setSending(false));
    if (ok) {
      setSent(true);
      setBody("");
      setReply(null);
      setEditing(null);
      setRequestId(crypto.randomUUID());
    }
  };
  const startReply = (comment: CommunityComment) => {
    setReply(comment);
    setEditing(null);
    setBody("");
    setRequestId(crypto.randomUUID());
    inputRef.current?.focus();
  };
  const banner = (reply || editing) && (
    <div className="cm-reply-banner">
      <span>
        {editing ? "Chỉnh sửa bình luận" : <>Đang trả lời <b>{reply?.author.name}</b></>}
      </span>
      <button
        type="button"
        onClick={() => {
          setReply(null);
          setEditing(null);
          setBody("");
        }}
      >
        Hủy
      </button>
    </div>
  );
  const canComment = post.state === "published" && !viewer.suspended;
  const modalComposer = canComment ? (
    <form
      className="cm-modal-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) void submit();
      }}
    >
      {banner}
      <div className="cm-modal-compose-row">
        <Avatar name={viewer.displayName} />
        <div className="cm-modal-field">
          <textarea
            ref={inputRef}
            aria-label="Viết bình luận"
            maxLength={2000}
            rows={1}
            placeholder={`Viết bình luận dưới tên ${viewer.displayName}…`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${e.target.scrollHeight}px`;
            }}
            onKeyDown={(e) => {
              // Enter gửi, Shift+Enter xuống dòng (như Facebook).
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (body.trim() && !busy) void submit();
              }
            }}
            disabled={busy}
          />
          <button
            type="submit"
            className={`agl-send${sending ? " is-busy" : sent ? " is-sent" : ""}`}
            aria-label={sending ? "Đang gửi" : editing ? "Lưu bình luận" : "Gửi bình luận"}
            disabled={busy || !body.trim()}
          >
            <IconSend size={18} className="agl-send-icon" />
            <span className="agl-send-spin" aria-hidden="true" />
            <IconCheck size={20} className="agl-send-ok" aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  ) : (
    <p className="cm-notice">
      {viewer.suspended
        ? "Quyền bình luận của bạn đang bị tạm khóa."
        : "Bài viết chưa mở thảo luận."}
    </p>
  );
  return (
    <section className={modal ? "cm-discussion cm-discussion-modal" : "cm-card cm-discussion"} aria-label="Thảo luận">
      {modal ? (
        <div className="cm-modal-comments-head">Bình luận · cũ nhất trước</div>
      ) : (
        <div className="cm-section-head">
          <h2>
            Cuộc trò chuyện <span>{post.commentCount}</span>
          </h2>
          <span>Mới nhất ở cuối</span>
        </div>
      )}
      {error && (
        <div className="cm-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p className="cm-loading" role="status">
          Đang tải thảo luận…
        </p>
      ) : items.length === 0 && modal ? (
        <p className="cm-muted cm-modal-empty">Chưa có bình luận. Hãy là người đầu tiên chia sẻ.</p>
      ) : items.length === 0 ? (
        <EmptyState title="Bắt đầu một cuộc trò chuyện">
          Một kinh nghiệm nhỏ của bạn có thể giúp ích cho người khác.
        </EmptyState>
      ) : (
        <div className="cm-comments">
          {items.map((comment) => (
            <article
              className={`cm-comment ${comment.parentId ? "reply" : ""}`}
              key={comment.id}
            >
              <Avatar name={comment.author.name} />
              <div className="cm-comment-main">
                <div className="cm-comment-bubble">
                  <Link to={`/community/members/${comment.author.id}`}>
                    {comment.author.name}
                  </Link>
                  {comment.parentId && (
                    <small>
                      <IconCornerDownRight size={13} /> Trả lời bình luận
                    </small>
                  )}
                  <p>{comment.body}</p>
                </div>
                {post.helpfulCommentId === comment.id && (
                  <span className="cm-helpful">
                    <IconCheck size={14} />
                    Tác giả đánh dấu hữu ích
                  </span>
                )}
                <div className="cm-comment-tools">
                  <time>{timeLabel(comment.createdAt)}</time>
                  {!comment.parentId && (
                    <button
                      disabled={busy || viewer.suspended}
                      onClick={() => startReply(comment)}
                    >
                      Trả lời
                    </button>
                  )}
                  {comment.author.id === viewer.id ? (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditing(comment);
                          setReply(null);
                          setBody(comment.body);
                          inputRef.current?.focus();
                        }}
                      >
                        Sửa
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Xóa bình luận này?"))
                            void mutate(() =>
                              communityApi.deleteComment(comment.id),
                            );
                        }}
                      >
                        Xóa
                      </button>
                    </>
                  ) : (
                    <button onClick={() => onReport(comment.id)}>
                      Báo cáo
                    </button>
                  )}
                  {post.author.id === viewer.id && post.kind === "question" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void mutate(() =>
                          communityApi.helpful(
                            post.id,
                            comment.id,
                            post.helpfulCommentId !== comment.id,
                          ),
                        )
                      }
                    >
                      {post.helpfulCommentId === comment.id
                        ? "Bỏ hữu ích"
                        : "Hữu ích"}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {cursor && (
        <button
          className="cm-button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const data = await communityApi.comments(post.id, cursor);
              setItems((current) => [...current, ...data.items]);
              setCursor(data.nextCursor);
            } catch (e) {
              setError(communityError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Xem thêm bình luận
        </button>
      )}
      {modal ? (
        composerSlot && createPortal(modalComposer, composerSlot)
      ) : canComment ? (
        <form
          className="cm-comment-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {banner}
          <label htmlFor="cm-comment-input">Chia sẻ ý kiến của bạn</label>
          <textarea
            ref={inputRef}
            id="cm-comment-input"
            required
            maxLength={2000}
            rows={3}
            placeholder="Viết câu trả lời hoặc chia sẻ kinh nghiệm…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={busy}
          />
          <button
            className="cm-button primary"
            type="submit"
            disabled={busy || !body.trim()}
          >
            <IconSend size={17} />
            {busy ? "Đang gửi…" : editing ? "Lưu bình luận" : "Gửi bình luận"}
          </button>
        </form>
      ) : (
        <p className="cm-notice">
          {viewer.suspended
            ? "Quyền bình luận của bạn đang bị tạm khóa."
            : "Bài viết chưa mở thảo luận."}
        </p>
      )}
    </section>
  );
}
