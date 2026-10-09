import { useEffect, useState } from "react";
import {
  communityApi,
  communityError,
  type CommunityOrganization,
  type CommunityReport,
  type CommunityViewer,
} from "../../services/community.service";
import { EmptyState, Modal, timeLabel } from "./community-widgets";

const ACTIONS: Record<string, string> = {
  hide: "Ẩn nội dung",
  restore: "Khôi phục nội dung",
  dismiss: "Bỏ qua báo cáo",
  suspend: "Khóa quyền đăng",
  unsuspend: "Mở quyền đăng",
};
export default function CommunityModeration({
  viewer,
}: {
  viewer: CommunityViewer;
}) {
  const [state, setState] = useState("open");
  const [items, setItems] = useState<CommunityReport[]>([]);
  const [organizations, setOrganizations] = useState<CommunityOrganization[]>(
    [],
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<{
    report: CommunityReport;
    action: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!viewer.platformRole) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    communityApi
      .reports(state)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((e) => {
        if (active) setError(communityError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (viewer.platformRole === "admin")
      communityApi
        .organizations()
        .then((data) => {
          if (active) setOrganizations(data);
        })
        .catch((e) => {
          if (active) setError(communityError(e));
        });
    return () => {
      active = false;
    };
  }, [state, revision, viewer.platformRole]);
  if (!viewer.platformRole)
    return (
      <EmptyState title="Khu vực quản trị nền tảng">
        Tài khoản hiện tại không có quyền kiểm duyệt cộng đồng.
      </EmptyState>
    );
  return (
    <section>
      <div className="cm-tabs">
        <button
          className={state === "open" ? "active" : ""}
          onClick={() => setState("open")}
        >
          Cần xử lý
        </button>
        <button
          className={state === "resolved" ? "active" : ""}
          onClick={() => setState("resolved")}
        >
          Đã xử lý
        </button>
      </div>
      {error && (
        <div className="cm-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p className="cm-loading">Đang tải báo cáo…</p>
      ) : !items.length ? (
        <EmptyState title="Không có báo cáo trong danh sách này">
          Các báo cáo của thành viên sẽ được tập hợp tại đây để xem xét.
        </EmptyState>
      ) : (
        items.map((report) => (
          <article className="cm-card cm-report" key={report.id}>
            <div className="cm-section-head">
              <strong>
                {report.commentId ? "Bình luận" : "Bài viết"} ·{" "}
                {report.authorName}
              </strong>
              <small>{timeLabel(report.createdAt)}</small>
            </div>
            <div className="cm-report-reason">
              <strong>Lý do báo cáo</strong>
              <p>{report.reason}</p>
            </div>
            <blockquote>{report.content}</blockquote>
            <div className="cm-report-actions">
              {Object.entries(ACTIONS)
                .filter(
                  ([action]) =>
                    action !== "restore" || report.contentState === "hidden",
                )
                .filter(
                  ([action]) =>
                    action !== "hide" || report.contentState === "published",
                )
                .filter(
                  ([action]) => action !== "unsuspend" || report.suspended,
                )
                .filter(([action]) => action !== "suspend" || !report.suspended)
                .map(([action, label]) => (
                  <button
                    key={action}
                    className="cm-button secondary"
                    onClick={() => {
                      setSelected({ report, action });
                      setReason("");
                    }}
                  >
                    {label}
                  </button>
                ))}
            </div>
            {report.history.length > 0 && (
              <details>
                <summary>Lịch sử xử lý</summary>
                {report.history.map((entry, index) => (
                  <p key={index}>
                    {ACTIONS[entry.action]} · {timeLabel(entry.at)}
                    <br />
                    {entry.reason}
                  </p>
                ))}
              </details>
            )}
          </article>
        ))
      )}
      {viewer.platformRole === "admin" && (
        <section className="cm-card cm-settings-card">
          <h2>Module theo doanh nghiệp</h2>
          <p>Bật hoặc tạm ngừng cộng đồng cho từng đại lý.</p>
          {organizations.map((org) => (
            <div className="cm-member-row" key={org.id}>
              <div>
                <strong>{org.name}</strong>
                <small>{org.members} thành viên</small>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={org.communityEnabled}
                  disabled={busy}
                  onChange={async (e) => {
                    setBusy(true);
                    try {
                      await communityApi.module(org.id, e.target.checked);
                      setRevision((n) => n + 1);
                    } catch (err) {
                      setError(communityError(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
                Cộng đồng
              </label>
            </div>
          ))}
        </section>
      )}
      {selected && (
        <Modal
          title={ACTIONS[selected.action]}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <form
            className="cm-modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await communityApi.moderate(
                  selected.report.id,
                  selected.action,
                  reason,
                );
                setSelected(null);
                setRevision((n) => n + 1);
              } catch (err) {
                setError(communityError(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Lý do xử lý
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <p>
              Thao tác được ghi vào lịch sử và thông báo tới người liên quan.
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
                onClick={() => setSelected(null)}
                disabled={busy}
              >
                Hủy
              </button>
              <button className="cm-button primary" disabled={busy}>
                Xác nhận
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
