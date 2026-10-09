import type { OrderEvent } from '../../../services/agrilink.types';
import { fmtDateTime } from '../../../utils/formatters';
import { statusLabels } from '../labels';
export default function OrderTimeline({ events }: { events: OrderEvent[] }) {
  return (
    <ol className="list-group list-group-flush">
      {events.map((event, i) => (
        <li className="list-group-item ps-0" key={`${event.createdAt}-${i}`}>
          <div className="d-flex justify-content-between gap-2">
            <strong>{statusLabels[event.toStatus]}</strong>
            <small className="text-muted">{fmtDateTime(event.createdAt)}</small>
          </div>
          <small className="text-muted">{event.actorName}</small>
          {event.note && <p className="mb-0 mt-1">{event.note}</p>}
        </li>
      ))}
    </ol>
  );
}
