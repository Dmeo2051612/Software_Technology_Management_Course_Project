import { useEffect, useRef, useState } from "react";
import {
  IconPhoto,
  IconEye,
  IconSend,
  IconDeviceFloppy,
} from "@tabler/icons-react";
import {
  communityApi,
  communityError,
  type CommunityOverview,
  type CommunityPost,
  type PostInput,
} from "../../services/community.service";
import { Avatar, KINDS, Modal, PrivateImage } from "./community-widgets";

export type ComposerPreset = { kind?: 'question' | 'market'; topicId?: string; openImages?: boolean };

export default function CommunityComposer({
  overview,
  post,
  preset,
  onClose,
  onSaved,
}: {
  overview: CommunityOverview;
  post?: CommunityPost;
  preset?: ComposerPreset;
  onClose: () => void;
  onSaved: (post: CommunityPost) => void;
}) {
  const [form, setForm] = useState<PostInput>(() => ({
    body: post?.body || "",
    kind: post?.kind || preset?.kind || "question",
    state: post?.state || "draft",
    crop: post?.crop || "",
    region: post?.region || overview.viewer.region,
    source: post?.source || "",
    observedAt: post?.observedAt || "",
    topics: post?.topics || (preset?.topicId ? [preset.topicId] : []),
    mediaIds: post?.mediaIds || [],
    organizationId: post?.organization?.id,
    requestId: crypto.randomUUID(),
  }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (preset?.openImages && !post) fileRef.current?.click();
  }, [preset?.openImages, post]);
  const change = <K extends keyof PostInput>(key: K, value: PostInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const save = async (state: string) => {
    if (!formRef.current?.reportValidity()) return;
    if (form.body.trim().length < 5) {
      setError(
        "Chia sẻ ít nhất 5 ký tự để mọi người hiểu câu chuyện của bạn nhé.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      onSaved(await communityApi.save({ ...form, state }, post?.id));
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files) return;
    if (files.length + form.mediaIds.length > 4) {
      setError("Mỗi bài viết tối đa 4 ảnh.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024) throw new Error("Ảnh tối đa 5 MB.");
        const media = await communityApi.upload(file);
        setForm((current) => ({
          ...current,
          mediaIds: [...current.mediaIds, media.id],
        }));
      }
    } catch (e) {
      setError(
        e instanceof Error && e.message === "Ảnh tối đa 5 MB."
          ? e.message
          : communityError(e),
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  return (
    <Modal
      title={post ? "Chỉnh sửa bài viết" : "Chia sẻ với cộng đồng"}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form
        ref={formRef}
        className="cm-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void save("published");
        }}
      >
        <div className="cm-composer-person">
          <Avatar name={overview.viewer.displayName} />
          <div>
            <strong>{overview.viewer.displayName}</strong>
            <small>Chia sẻ với thành viên AgriLink</small>
          </div>
        </div>
        <div className="cm-form-grid">
          <label>
            Loại bài
            <select
              value={form.kind}
              disabled={busy}
              onChange={(e) => change("kind", e.target.value)}
            >
              {Object.entries(KINDS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Đăng với tư cách
            <select
              value={form.organizationId || ""}
              disabled={busy || !!post}
              onChange={(e) =>
                change("organizationId", e.target.value || undefined)
              }
            >
              <option value="">Cá nhân</option>
              {overview.viewer.memberships
                .filter((m) => m.canPublish && m.communityEnabled)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <label className="cm-body-label">
          Nội dung
          <textarea
            required
            minLength={5}
            maxLength={5000}
            rows={7}
            placeholder="Hôm nay vườn của bạn có gì mới? Đặt một câu hỏi, kể một kinh nghiệm hoặc chia sẻ điều hữu ích…"
            value={form.body}
            disabled={busy}
            onChange={(e) => change("body", e.target.value)}
          />
        </label>
        <div className="cm-character-count">{form.body.length}/5.000</div>
        <fieldset className="cm-topic-picker">
          <legend>Chủ đề · chọn tối đa 3</legend>
          {overview.topics.map((topic) => (
            <label key={topic.id}>
              <input
                type="checkbox"
                disabled={
                  busy ||
                  (!form.topics.includes(topic.id) && form.topics.length >= 3)
                }
                checked={form.topics.includes(topic.id)}
                onChange={(e) =>
                  change(
                    "topics",
                    e.target.checked
                      ? [...form.topics, topic.id]
                      : form.topics.filter((t) => t !== topic.id),
                  )
                }
              />
              <span>{topic.name}</span>
            </label>
          ))}
        </fieldset>
        <div className="cm-form-grid">
          <label>
            Cây trồng
            <input
              maxLength={80}
              value={form.crop}
              placeholder="Ví dụ: Cà phê, thanh long"
              onChange={(e) => change("crop", e.target.value)}
            />
          </label>
          <label>
            Khu vực chia sẻ
            <input
              maxLength={100}
              value={form.region}
              placeholder="Tỉnh hoặc khu vực"
              onChange={(e) => change("region", e.target.value)}
            />
          </label>
        </div>
        {form.kind === "market" && (
          <div className="cm-form-grid">
            <label>
              Nguồn thông tin
              <input
                required
                maxLength={250}
                value={form.source}
                onChange={(e) => change("source", e.target.value)}
                placeholder="Đơn vị hoặc nguồn ghi nhận"
              />
            </label>
            <label>
              Thời điểm ghi nhận
              <input
                required
                type="datetime-local"
                value={form.observedAt}
                onChange={(e) => change("observedAt", e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="cm-images">
          {form.mediaIds.map((id) => (
            <PrivateImage
              key={id}
              id={id}
              onRemove={
                busy
                  ? undefined
                  : () =>
                      change(
                        "mediaIds",
                        form.mediaIds.filter((m) => m !== id),
                      )
              }
            />
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => void upload(e.target.files)}
        />
        <div className="cm-composer-tools">
          <button
            type="button"
            className="cm-button subtle"
            disabled={busy || form.mediaIds.length >= 4}
            onClick={() => fileRef.current?.click()}
          >
            <IconPhoto size={18} />
            Thêm ảnh
          </button>
          <span>JPG, PNG, WebP · tối đa 4 ảnh, 5 MB/ảnh</span>
          <button
            type="button"
            className="cm-button subtle"
            onClick={() => setPreview(!preview)}
          >
            <IconEye size={18} />
            Xem trước
          </button>
        </div>
        {preview && (
          <div className="cm-preview">
            <span className="cm-kind">{KINDS[form.kind]}</span>
            <p>{form.body || "Nội dung xem trước sẽ hiển thị tại đây."}</p>
          </div>
        )}
        <p className="cm-form-hint">
          Chia sẻ kinh nghiệm có ngữ cảnh và tôn trọng nhau. Bạn không cần đưa
          số điện thoại hoặc địa chỉ vườn chi tiết vào bài.
        </p>
        {error && (
          <div className="cm-error" role="alert">
            {error}
          </div>
        )}
        <div className="cm-dialog-footer">
          <button
            type="button"
            className="cm-button secondary"
            disabled={busy}
            onClick={() => void save("draft")}
          >
            <IconDeviceFloppy size={18} />
            Lưu nháp
          </button>
          <button type="submit" className="cm-button primary" disabled={busy}>
            <IconSend size={18} />
            {busy ? "Đang lưu…" : post ? "Lưu và đăng bài" : "Đăng bài viết"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
