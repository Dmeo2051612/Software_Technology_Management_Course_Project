import { useEffect, useState } from "react";
import {
  communityApi,
  communityError,
  type CommunityMember,
  type CommunityOverview,
} from "../../services/community.service";
import { Avatar } from "./community-widgets";

export default function CommunitySettings({
  overview,
  onSaved,
}: {
  overview: CommunityOverview;
  onSaved: () => void;
}) {
  const v = overview.viewer;
  const [form, setForm] = useState({
    displayName: v.displayName,
    bio: v.bio,
    region: v.region,
    crops: v.crops,
  });
  const [blocks, setBlocks] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [orgId, setOrgId] = useState(v.memberships[0]?.id || "");
  const [org, setOrg] = useState({ name: "", bio: "", region: "" });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    communityApi
      .blocks()
      .then((data) => {
        if (active) setBlocks(data);
      })
      .catch((e) => {
        if (active) setError(communityError(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (v.role !== "owner" || !orgId) return;
    let active = true;
    Promise.all([communityApi.members(orgId), communityApi.business(orgId)])
      .then(([data, business]) => {
        if (active) {
          setMembers(data);
          setOrg({
            name: business.name,
            bio: business.bio,
            region: business.region,
          });
        }
      })
      .catch((e) => {
        if (active) setError(communityError(e));
      });
    return () => {
      active = false;
    };
  }, [v.role, orgId]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      setMessage("Đã lưu thay đổi.");
      onSaved();
    } catch (e) {
      setError(communityError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cm-settings">
      {error && (
        <div className="cm-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="cm-success" role="status">
          {message}
        </div>
      )}
      <form
        className="cm-card cm-settings-card"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => communityApi.updateProfile(form));
        }}
      >
        <h2>Hồ sơ cộng đồng</h2>
        <p>Những thông tin này được chia sẻ với thành viên AgriLink.</p>
        <label>
          Tên hiển thị
          <input
            required
            minLength={2}
            maxLength={100}
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </label>
        <label>
          Giới thiệu
          <textarea
            maxLength={1000}
            rows={3}
            value={form.bio}
            placeholder="Đôi nét về bạn và công việc làm nông…"
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </label>
        <div className="cm-form-grid">
          <label>
            Khu vực
            <input
              maxLength={100}
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            />
          </label>
          <label>
            Cây trồng quan tâm
            <input
              maxLength={150}
              value={form.crops}
              onChange={(e) => setForm({ ...form, crops: e.target.value })}
            />
          </label>
        </div>
        <button className="cm-button primary" disabled={busy || v.suspended}>
          Lưu hồ sơ
        </button>
      </form>
      {v.role === "owner" && orgId && (
        <section className="cm-card cm-settings-card">
          <h2>Trang đại lý và quyền đăng bài</h2>
          {v.memberships.length > 1 && (
            <label>
              Doanh nghiệp
              <select value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                {v.memberships.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => communityApi.updateBusiness(orgId, org));
            }}
          >
            <label>
              Tên đại lý
              <input
                required
                minLength={2}
                maxLength={150}
                value={org.name}
                onChange={(e) => setOrg({ ...org, name: e.target.value })}
              />
            </label>
            <label>
              Giới thiệu
              <textarea
                maxLength={1000}
                rows={3}
                value={org.bio}
                onChange={(e) => setOrg({ ...org, bio: e.target.value })}
              />
            </label>
            <label>
              Khu vực hoạt động
              <input
                maxLength={100}
                value={org.region}
                onChange={(e) => setOrg({ ...org, region: e.target.value })}
              />
            </label>
            <button disabled={busy} className="cm-button secondary">
              Lưu trang đại lý
            </button>
          </form>
          <h3 className="cm-member-title">Đại diện doanh nghiệp</h3>
          <p>
            Cho phép nhân viên đăng bài với tên đại lý. Việc ngừng thành viên
            cũng chặn quyền vào dữ liệu doanh nghiệp.
          </p>
          {members.map((member) => (
            <div className="cm-member-row" key={member.id}>
              <Avatar name={member.name} />
              <div>
                <strong>{member.name}</strong>
                <small>
                  {member.role === "owner" ? "Chủ đại lý" : "Nhân viên"}
                </small>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={member.canPublish}
                  disabled={busy || member.role === "owner"}
                  onChange={(e) => {
                    const next = { ...member, canPublish: e.target.checked };
                    void run(async () => {
                      await communityApi.membership(orgId, next);
                      setMembers((current) =>
                        current.map((m) => (m.id === next.id ? next : m)),
                      );
                    });
                  }}
                />
                Đăng bài đại lý
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={member.active}
                  disabled={busy || member.role === "owner"}
                  onChange={(e) => {
                    const next = { ...member, active: e.target.checked };
                    void run(async () => {
                      await communityApi.membership(orgId, next);
                      setMembers((current) =>
                        current.map((m) => (m.id === next.id ? next : m)),
                      );
                    });
                  }}
                />
                Hoạt động
              </label>
            </div>
          ))}
        </section>
      )}
      <section className="cm-card cm-settings-card">
        <h2>Tài khoản đã chặn</h2>
        <p>
          Hai bên sẽ không thấy bài viết, bình luận và thông báo tương tác của
          nhau.
        </p>
        {blocks.length ? (
          blocks.map((block) => (
            <div className="cm-member-row" key={block.id}>
              <Avatar name={block.name} />
              <strong>{block.name}</strong>
              <button
                className="cm-button secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await communityApi.block(block.id, false);
                    setBlocks((current) =>
                      current.filter((b) => b.id !== block.id),
                    );
                  })
                }
              >
                Bỏ chặn
              </button>
            </div>
          ))
        ) : (
          <p className="cm-muted">Bạn chưa chặn tài khoản nào.</p>
        )}
      </section>
    </div>
  );
}
