import { useEffect, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { MoneyText } from '../../../components/ui';
import { agrilinkManageApi, apiError } from '../../../services/agrilink.service';
import type { MatchData, OrderDetail } from '../../../services/agrilink.types';
import { fmtKg, toLocalDateString } from '../../../utils/formatters';
import { parseWeightCode } from '../../../utils/weightCode';
import { validQuantity } from '../validation';
import {
  buildCompletePayload,
  canConfirmParty,
  completeDiscount,
  completeTotal,
  validateCompleteForm,
  type CompleteForm,
} from './completeOrder';

type Props = {
  order: OrderDetail;
  onClose: () => void;
  onDone: (order: OrderDetail) => void;
  onConflict: (message: string) => void;
};

function PartyStep({
  order,
  match,
  matchFailed,
  party,
  onChange,
}: {
  order: OrderDetail;
  match: MatchData | null;
  matchFailed: boolean;
  party: CompleteForm['party'];
  onChange: (party: CompleteForm['party']) => void;
}) {
  return (
    <div>
      <h5>{order.kind === 'buy' ? 'Chọn khách hàng' : 'Chọn nông dân'}</h5>
      {!match && !matchFailed && <p>Đang tìm đối tác phù hợp...</p>}
      {matchFailed && (
        <p className="text-warning" role="alert">
          Không tải được gợi ý khách — bạn vẫn có thể tạo mới.
        </p>
      )}
      {(match || matchFailed) && (
        <div className="d-grid gap-2">
          {match?.linked && (
            <label className="card p-3 mb-0 flex-row align-items-center gap-2">
              <input
                type="radio"
                checked={party.mode === 'linked'}
                onChange={() => onChange({ mode: 'linked', id: match.linked!.id })}
              />{' '}
              Đã liên kết: {match.linked.name} · {match.linked.phone}
            </label>
          )}
          {match?.suggestions.filter((person) => person.id !== match.linked?.id).map((person) => (
            <label className="card p-3 mb-0 flex-row align-items-center gap-2" key={person.id}>
              <input
                type="radio"
                checked={party.mode === 'suggestion' && party.id === person.id}
                onChange={() => onChange({ mode: 'suggestion', id: person.id })}
              />{' '}
              {person.name} · {person.phone}
            </label>
          ))}
          <label className="card p-3 mb-0 flex-row align-items-center gap-2">
            <input
              type="radio"
              checked={party.mode === 'new'}
              onChange={() => onChange({ mode: 'new' })}
            />{' '}
            Tạo mới từ thông tin đơn ({order.contactName}, {order.contactPhone})
          </label>
        </div>
      )}
    </div>
  );
}

function GoodsStep({
  order,
  form,
  set,
  weightText,
  setWeightText,
  addWeight,
  total,
  discount,
}: {
  order: OrderDetail;
  form: CompleteForm;
  set: (patch: Partial<CompleteForm>) => void;
  weightText: string;
  setWeightText: (text: string) => void;
  addWeight: () => void;
  total: number;
  discount: number;
}) {
  if (order.kind === 'buy')
    return (
      <>
        <h5>Chốt dòng hàng</h5>
        {order.items.map((item) => (
          <div className="row g-2 align-items-end mb-3" key={item.id}>
            <div className="col-md-5">
              <strong>{item.itemName}</strong>
            </div>
            <div className="col">
              <label className="form-label">Số lượng ({item.unit})</label>
              <input
                className="form-control"
                type="number"
                min="0.001"
                step="0.001"
                value={form.lines[item.id]?.quantity ?? ''}
                onChange={(e) =>
                  set({
                    lines: {
                      ...form.lines,
                      [item.id]: { ...form.lines[item.id], quantity: Number(e.target.value) },
                    },
                  })
                }
              />
            </div>
            <div className="col">
              <label className="form-label">Đơn giá</label>
              <input
                className="form-control"
                type="number"
                min="0"
                step="0.01"
                value={form.lines[item.id]?.unitPrice ?? ''}
                onChange={(e) =>
                  set({
                    lines: {
                      ...form.lines,
                      [item.id]: { ...form.lines[item.id], unitPrice: Number(e.target.value) },
                    },
                  })
                }
              />
            </div>
          </div>
        ))}
        <strong>
          Tổng chốt: <MoneyText value={total} />
        </strong>
        {discount > 0 && (
          <p className="mb-0 text-success">
            Voucher "{order.voucherTitle}": −<MoneyText value={discount} /> · Khách phải trả{' '}
            <MoneyText value={total - discount} bold />
          </p>
        )}
      </>
    );
  return (
    <>
      <h5>Cân hàng</h5>
      <div className="d-flex gap-2 mb-3">
        <input
          className="form-control"
          value={weightText}
          onChange={(e) => setWeightText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addWeight();
            }
          }}
          placeholder="Mã cân 3–4 số hoặc kg"
          aria-label="Trọng lượng"
        />
        <button type="button" className="btn btn-outline-primary" onClick={addWeight}>
          Thêm cân
        </button>
      </div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        {form.weights.map((weight, i) => (
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            key={i}
            onClick={() => set({ weights: form.weights.filter((_, j) => i !== j) })}
          >
            {fmtKg(weight)} ×
          </button>
        ))}
      </div>
      <p>Tổng cân: {fmtKg(form.weights.reduce((a, b) => a + b, 0))}</p>
      <label className="form-label">Giá mỗi kg</label>
      <input
        className="form-control mb-3"
        type="number"
        min="0"
        step="0.01"
        value={form.pricePerKg}
        onChange={(e) => set({ pricePerKg: Number(e.target.value) })}
      />
      <label className="form-label">Ngày cân</label>
      <input
        className="form-control"
        type="date"
        value={form.weighDate}
        onChange={(e) => set({ weighDate: e.target.value })}
      />
    </>
  );
}

function PaymentStep({
  order,
  form,
  set,
  total,
  discount,
}: {
  order: OrderDetail;
  form: CompleteForm;
  set: (patch: Partial<CompleteForm>) => void;
  total: number;
  discount: number;
}) {
  return (
    <>
      <h5>Thanh toán</h5>
      <div className="card mb-3">
        <div className="card-body">
          {discount > 0 && (
            <p className="mb-1">
              Tổng chốt <MoneyText value={total} /> · Voucher{' '}
              <span className="text-success">
                −<MoneyText value={discount} />
              </span>
            </p>
          )}
          <strong>
            {discount > 0 ? 'Khách phải trả' : 'Tổng giá trị'}: <MoneyText value={total - discount} />
          </strong>
          <p className="mb-0">
            {order.kind === 'sell'
              ? fmtKg(form.weights.reduce((a, b) => a + b, 0))
              : `${order.items.length} dòng hàng`}
          </p>
        </div>
      </div>
      {order.kind === 'buy' ? (
        <>
          <label className="form-label">Hình thức thanh toán</label>
          <select
            className="form-select mb-3"
            value={form.paymentMethod}
            onChange={(e) =>
              set({ paymentMethod: e.target.value as CompleteForm['paymentMethod'], paidAmount: 0 })
            }
          >
            <option value="cash">Tiền mặt</option>
            <option value="transfer">Chuyển khoản</option>
            <option value="debt">Ghi nợ</option>
            <option value="partial">Trả một phần</option>
          </select>
          {form.paymentMethod === 'partial' && (
            <>
              <label className="form-label">Số tiền đã trả</label>
              <input
                className="form-control"
                type="number"
                min="0"
                step="0.01"
                value={form.paidAmount}
                onChange={(e) => set({ paidAmount: Number(e.target.value) })}
              />
            </>
          )}
        </>
      ) : (
        <>
          <label className="form-label">Số tiền đã trả cho nông dân (0 = ghi nợ)</label>
          <input
            className="form-control"
            type="number"
            min="0"
            step="0.01"
            value={form.paidAmount}
            onChange={(e) => set({ paidAmount: Number(e.target.value) })}
          />
        </>
      )}
    </>
  );
}

export default function CompleteOrderModal({ order, onClose, onDone, onConflict }: Props) {
  const [step, setStep] = useState(0);
  const [match, setMatch] = useState<MatchData | null>(null);
  const [matchFailed, setMatchFailed] = useState(false);
  const [weightText, setWeightText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<CompleteForm>(() => ({
    party: { mode: 'none' },
    lines: Object.fromEntries(
      order.items.map((item) => [
        item.id,
        {
          quantity: item.finalQuantity ?? item.quantity,
          unitPrice: item.finalUnitPrice ?? item.unitPrice,
        },
      ]),
    ),
    weights: [],
    pricePerKg: order.items[0]?.unitPrice || 0,
    weighDate: toLocalDateString(),
    paymentMethod: 'cash',
    paidAmount: 0,
  }));
  useEffect(() => {
    let active = true;
    setMatch(null);
    setMatchFailed(false);
    agrilinkManageApi
      .match(order.id)
      .then((data) => {
        if (!active) return;
        setMatch(data);
        setForm((s) => ({
          ...s,
          party: data.linked
            ? { mode: 'linked', id: data.linked.id }
            : data.suggestions[0]
              ? { mode: 'suggestion', id: data.suggestions[0].id }
              : { mode: 'none' },
        }));
      })
      .catch(() => {
        // Non-fatal: the dealer can still complete the order via "Tạo mới từ thông
        // tin đơn" (see canConfirmParty / PartyStep's matchFailed branch), so this
        // doesn't block the flow with the generic submit-error banner.
        if (active) setMatchFailed(true);
      });
    return () => {
      active = false;
    };
  }, [order.id]);
  const set = (patch: Partial<CompleteForm>) => setForm((s) => ({ ...s, ...patch }));
  const total = completeTotal(order, form);
  const discount = completeDiscount(order, form);
  const addWeight = () => {
    const raw = weightText.trim();
    const parsed = /^\d{3}$/.test(raw)
      ? parseWeightCode(raw, '3d')
      : /^\d{4}$/.test(raw)
        ? parseWeightCode(raw, '4d_over100')
        : Number(raw.replace(',', '.'));
    if (parsed == null || !validQuantity(parsed)) {
      setError('Mã cân hoặc số kg không hợp lệ (tối đa 3 chữ số thập phân).');
      return;
    }
    set({ weights: [...form.weights, parsed] });
    setWeightText('');
    setError('');
  };
  const next = () => {
    setError('');
    if (step === 0 && !canConfirmParty(form.party, match)) return;
    if (step === 1) {
      const validation = validateCompleteForm(order, {
        ...form,
        paymentMethod: 'debt',
        paidAmount: 0,
      });
      if (validation) {
        setError(validation);
        return;
      }
    }
    setStep(step + 1);
  };
  const complete = async () => {
    const validation = validateCompleteForm(order, form);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError('');
    try {
      onDone(await agrilinkManageApi.complete(order.id, buildCompletePayload(order, form)));
    } catch (e) {
      const message = apiError(e);
      if ((e as { response?: { status?: number } })?.response?.status === 409) onConflict(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };
  const partyChosen = canConfirmParty(form.party, match);
  return (
    <Modal show onHide={onClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Hoàn thành đơn {order.code}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex gap-2 mb-4">
          {[
            'Khách hàng / Nông dân',
            order.kind === 'buy' ? 'Chốt hàng' : 'Cân hàng',
            'Thanh toán',
          ].map((name, i) => (
            <span key={name} className={`badge ${i === step ? 'bg-primary' : 'bg-secondary'}`}>
              {i + 1}. {name}
            </span>
          ))}
        </div>
        {step === 0 && (
          <PartyStep
            order={order}
            match={match}
            matchFailed={matchFailed}
            party={form.party}
            onChange={(party) => set({ party })}
          />
        )}
        {step === 1 && (
          <GoodsStep
            order={order}
            form={form}
            set={set}
            weightText={weightText}
            setWeightText={setWeightText}
            addWeight={addWeight}
            total={total}
            discount={discount}
          />
        )}
        {step === 2 && <PaymentStep order={order} form={form} set={set} total={total} discount={discount} />}
        {error && (
          <p className="text-danger mt-3" role="alert">
            {error}
          </p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <button
          className="btn btn-outline-secondary"
          onClick={
            step
              ? () => {
                  setStep(step - 1);
                  setError('');
                }
              : onClose
          }
        >
          {step ? 'Quay lại' : 'Đóng'}
        </button>
        <button
          className="btn btn-primary"
          disabled={busy || (step === 0 && !partyChosen)}
          onClick={() => (step < 2 ? next() : void complete())}
        >
          {step < 2 ? 'Tiếp tục' : 'Xác nhận hoàn thành'}
        </button>
      </Modal.Footer>
    </Modal>
  );
}
