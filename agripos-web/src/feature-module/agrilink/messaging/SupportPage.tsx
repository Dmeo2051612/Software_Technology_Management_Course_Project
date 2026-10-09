import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, SkeletonState } from '../../../components/ui';
import { apiError } from '../../../services/agrilink.service';
import { messagingApi, type SupportInput } from '../../../services/agrilink-messaging.service';
import type { ThreadDetail, ThreadSummary } from '../../../services/agrilink-messaging.types';
import { showToast } from '../../../stores/toastStore';
import { fmtDateTime } from '../../../utils/formatters';
import Conversation from './Conversation';
import { COMPLAINT_STATUS, SUPPORT_CATEGORY, SUPPORT_STATUS } from './messaging';
import './messaging.css';

const FAQ = [
  ['Giá thực nhận là gì?', 'Là giá đại lý trả sau khi trừ phí lấy hàng/vận chuyển ước tính, giúp bạn so sánh các đại lý công bằng.'],
  ['Vì sao tin thu mua của đại lý bị ẩn?', 'Giá chưa được cập nhật trong 48 giờ sẽ tự ẩn để tránh giá cũ.'],
  ['Đại lý có biết số điện thoại của tôi không?', 'Chỉ khi bạn đặt đơn hoặc chấp nhận đề nghị. Tin nhắn chỉ hiện tên hiển thị của bạn.'],
  ['Khiếu nại được xử lý thế nào?', 'Đại lý xử lý trước; sau 3 ngày hoặc khi bạn không đồng ý, AgriLink sẽ xem xét và ra quyết định.'],
  ['Làm sao để chặn một đại lý nhắn tin?', 'Mở cuộc trò chuyện với đại lý đó và bấm “Chặn đại lý”. Bạn có thể bỏ chặn bất cứ lúc nào.'],
];

function SupportThread({ id, base }: { id: string; base: string }) {
  const [thread, setThread] = useState<ThreadDetail | null>(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    messagingApi.thread(id).then(setThread).catch((e) => setError(apiError(e)));
  }, [id, refreshKey]);
  if (!thread) return error ? <p className="text-danger">{error}</p> : <SkeletonState variant="detail" />;
  const status = SUPPORT_STATUS[thread.status] ?? { label: thread.status, tone: 'bg-secondary' };
  const close = async () => {
    try {
      await messagingApi.close(thread.id);
      showToast('success', 'Đã đóng yêu cầu');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      showToast('error', apiError(e));
    }
  };
  return (
    <div className="messages-page">
      <Link to={base} className="btn btn-sm btn-outline-secondary mb-3">
        <i className="ti ti-arrow-left me-1" />
        Trung tâm hỗ trợ
      </Link>
      <PageHeader
        title={`${thread.code} · ${thread.subject}`}
        subtitle={`${SUPPORT_CATEGORY[thread.category ?? 'other']} · gửi ${fmtDateTime(thread.createdAt)}`}
        actions={
          <div className="d-flex gap-2 align-items-center">
            <span className={`badge ${status.tone}`}>{status.label}</span>
            {thread.status !== 'closed' && (
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => void close()}>
                Đóng yêu cầu
              </button>
            )}
          </div>
        }
      />
      <div className="card complaint-conv">
        <Conversation
          thread={thread}
          viewer={thread.side}
          refreshKey={refreshKey}
          placeholder="Bổ sung thông tin cho AgriLink…"
          disabledReason={thread.status === 'closed' ? 'Yêu cầu đã đóng. Hãy gửi yêu cầu mới nếu cần hỗ trợ thêm.' : null}
        />
      </div>
    </div>
  );
}

/** Trung tâm hỗ trợ: câu hỏi thường gặp, gửi yêu cầu, theo dõi yêu cầu và khiếu nại. */
export default function SupportPage({ base = '/agrilink/ho-tro' }: { base?: string }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState<SupportInput>({ category: 'account', subject: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requests, setRequests] = useState<ThreadSummary[]>([]);
  const [complaints, setComplaints] = useState<ThreadSummary[]>([]);

  useEffect(() => {
    if (id) return;
    messagingApi.threads({ as: 'buyer', kind: 'support' }).then(setRequests).catch(() => {});
    messagingApi.threads({ as: 'buyer', kind: 'complaint' }).then(setComplaints).catch(() => {});
  }, [id]);

  if (id) return <SupportThread id={id} base={base} />;

  const submit = async () => {
    if (form.subject.trim().length < 5) return setError('Tiêu đề ít nhất 5 ký tự.');
    if (form.body.trim().length < 10) return setError('Nội dung ít nhất 10 ký tự.');
    setBusy(true);
    setError('');
    try {
      const created = await messagingApi.support({ ...form, subject: form.subject.trim(), body: form.body.trim() });
      navigate(`${base}/${created.id}`);
    } catch (e) {
      setError(apiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="messages-page">
      <PageHeader
        title="Trung tâm hỗ trợ"
        subtitle="Câu hỏi thường gặp và gửi yêu cầu cho đội ngũ AgriLink. Có vấn đề với một đơn hàng? Dùng nút “Khiếu nại” trong chi tiết đơn."
      />
      <div className="support-topics">
        <div className="card">
          <strong>Tài khoản & đăng nhập</strong>
          <span className="text-muted small">Quên mật khẩu, đổi số điện thoại…</span>
        </div>
        <div className="card">
          <strong>Đặt đơn & giao nhận</strong>
          <span className="text-muted small">Đặt lịch, huỷ đơn, đổi buổi hẹn…</span>
        </div>
        <div className="card">
          <strong>Thanh toán & giá</strong>
          <span className="text-muted small">Giá thực nhận, phí lấy hàng, khuyến mãi…</span>
        </div>
      </div>
      <div className="complaint-grid">
        <section className="card p-3 support-faq">
          <h2 className="h6">Câu hỏi thường gặp</h2>
          {FAQ.map(([q, a], i) => (
            <details key={q} open={i === 0}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </section>
        <section className="card p-3">
          <h2 className="h6">Gửi yêu cầu hỗ trợ</h2>
          <div className="choice-chips mb-3" role="group" aria-label="Chủ đề">
            {Object.entries(SUPPORT_CATEGORY).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={form.category === key ? 'active' : ''}
                aria-pressed={form.category === key}
                onClick={() => setForm({ ...form, category: key as SupportInput['category'] })}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="form-label w-100">
            Tiêu đề
            <input className="form-control mt-1" maxLength={180} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </label>
          <label className="form-label w-100">
            Nội dung
            <textarea className="form-control mt-1" rows={4} maxLength={2000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          {error && (
            <p className="text-danger small" role="alert">
              {error}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Đang gửi…' : 'Gửi yêu cầu'}
          </button>

          {requests.length > 0 && (
            <>
              <h2 className="h6 mt-4">Yêu cầu của tôi</h2>
              {requests.map((t) => {
                const s = SUPPORT_STATUS[t.status] ?? { label: t.status, tone: 'bg-secondary' };
                return (
                  <Link key={t.id} to={`${base}/${t.id}`} className="thread-row">
                    <span>
                      <strong>
                        {t.code} · {t.subject}
                      </strong>
                      <small>{t.lastMessage?.body}</small>
                    </span>
                    <span className={`badge ${s.tone}`}>{s.label}</span>
                  </Link>
                );
              })}
            </>
          )}
          {complaints.length > 0 && (
            <>
              <h2 className="h6 mt-4">Khiếu nại của tôi</h2>
              {complaints.map((t) => {
                const s = COMPLAINT_STATUS[t.status] ?? { label: t.status, tone: 'bg-secondary' };
                return (
                  <Link key={t.id} to={`/agrilink/khieu-nai/${t.id}`} className="thread-row">
                    <span>
                      <strong>
                        {t.code} · {t.subject}
                      </strong>
                      <small>{t.dealerName}</small>
                    </span>
                    <span className={`badge ${s.tone}`}>{s.label}</span>
                  </Link>
                );
              })}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
