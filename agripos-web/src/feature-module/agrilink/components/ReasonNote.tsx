import './reasonNote.css';

/** Lý do huỷ / từ chối đơn: khối nền xám nhạt có viền màu, chữ tối dễ đọc (thay hộp vàng chói). */
export default function ReasonNote({ kind, text }: { kind: 'cancel' | 'reject'; text: string }) {
  return (
    <div className={`reason-note reason-note-${kind}`} role="note">
      <i className={`ti ${kind === 'cancel' ? 'ti-circle-x' : 'ti-ban'}`} aria-hidden="true" />
      <div>
        <strong>{kind === 'cancel' ? 'Lý do huỷ' : 'Lý do từ chối'}</strong>
        <span>{text}</span>
      </div>
    </div>
  );
}
