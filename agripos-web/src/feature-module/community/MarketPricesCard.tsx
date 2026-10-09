import { useEffect, useState, type CSSProperties } from 'react';
import { IconClock } from '@tabler/icons-react';
import { PillGroup } from '../../components/ui';
import { matchingApi } from '../../services/agrilink-matching.service';
import type { DailyPriceCommodity } from '../../services/agrilink-matching.types';
import { useCountUp } from '../../utils/motion';
import { firstWithData, formatPrice, priceChange, pricesDate, pricesUpdatedLabel, regionDateNote } from './marketPrices';

/** Giá chạy từ giá của tab trước (cùng dòng) sang giá mới khi đổi tab (mockup 53 · M14). */
function PriceValue({ value, from }: { value: number; from?: number }) {
  return <strong>{formatPrice(useCountUp(value, from))}</strong>;
}

/** Khung "Giá nông sản hôm nay" ở cột phải Cộng đồng (mockup 52). */
export default function MarketPricesCard() {
  const [list, setList] = useState<DailyPriceCommodity[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState<DailyPriceCommodity['key'] | null>(null);
  // Giá đang hiện trước khi đổi tab — điểm xuất phát cho số chạy; rỗng ở lần tải đầu.
  const [fromPrices, setFromPrices] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;
    matchingApi
      .dailyPrices()
      .then((data) => {
        if (!alive) return;
        setList(data.commodities);
        setActive(firstWithData(data.commodities));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const current = list?.find((c) => c.key === active) ?? null;
  // Ngày của giá (ngày lễ, cuối tuần không có giá mới thì là phiên gần nhất).
  const date = current ? pricesDate(current.regions) : '';
  return (
    <section className="cm-card cm-side-card cm-prices" aria-label="Giá nông sản hôm nay">
      <div className="cm-section-head">
        <h2>
          Giá nông sản hôm nay{date && <span className="cm-prices-date">{date}</span>}
        </h2>
      </div>
      <p className="cm-prices-sub">Giá thu mua tại vườn · đ/kg</p>
      {failed ? (
        <p className="cm-muted">Chưa tải được giá. Vui lòng thử lại sau.</p>
      ) : !list ? (
        <p className="cm-muted">Đang tải giá…</p>
      ) : (
        <>
          <PillGroup className="cm-feed-sort cm-prices-tabs" role="group" aria-label="Chọn nông sản" activeKey={active ?? ''}>
            {list.map((c) => (
              <button
                key={c.key}
                type="button"
                className={c.key === active ? 'active' : ''}
                aria-pressed={c.key === active}
                onClick={() => {
                  if (c.key === active) return;
                  setFromPrices(current?.regions.map((r) => r.price) ?? []);
                  setActive(c.key);
                }}
              >
                {c.label}
              </button>
            ))}
          </PillGroup>
          {current && current.regions.length === 0 ? (
            <p className="cm-muted">Chưa có giá {current.label.toLowerCase()}.</p>
          ) : (
            <div key={active} className={`cm-price-rows${fromPrices.length ? ' is-swap' : ''}`}>
              {current?.regions.map((r, i) => {
                const change = priceChange(r.change);
                return (
                  <div className="cm-price-row" key={r.name} style={{ '--i': i } as CSSProperties}>
                    <span>
                      {r.name}
                      {regionDateNote(r.recordedAt, date) && <small> · {regionDateNote(r.recordedAt, date)}</small>}
                    </span>
                    <PriceValue value={r.price} from={fromPrices[i]} />
                    <span className={`cm-price-change ${change?.tone ?? ''}`}>{change?.text ?? ''}</span>
                  </div>
                );
              })}
            </div>
          )}
          {current?.world && (
            <div className="cm-price-world">
              <span>Thế giới · {current.world.label}</span>
              <strong>
                {formatPrice(current.world.price)} {current.world.unit}
              </strong>
            </div>
          )}
          {current && (current.regions.length > 0 || current.world) && (
            <p className="cm-price-note">
              <IconClock size={14} aria-hidden="true" />
              <span>
                {pricesUpdatedLabel(current.updatedAt)}
                {current.sources.length > 0 && ` · Nguồn: ${current.sources.join(', ')}`}. Giá tham khảo, không phải báo giá
                của đại lý.
              </span>
            </p>
          )}
          <div className="cm-price-soon">
            <span>Sầu riêng — sắp có</span>
            <span>Lúa gạo — sắp có</span>
          </div>
        </>
      )}
    </section>
  );
}
