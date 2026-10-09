import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AgrilinkFulfillment,
  AgrilinkOrderStatus,
} from './entities/agrilink-order.entity';

export type OrderAction =
  | 'confirm'
  | 'reject'
  | 'deliver'
  | 'complete'
  | 'cancel'
  | 'editItems';
export type OrderActor = { side: 'buyer' | 'dealer'; role?: string };

const MANAGERS = ['owner', 'manager'];

export function nextStatus(
  order: { status: AgrilinkOrderStatus; fulfillment: AgrilinkFulfillment },
  action: OrderAction,
  actor: OrderActor,
): AgrilinkOrderStatus {
  const { status, fulfillment } = order;
  const invalid = () =>
    new ConflictException(
      `Không thể "${action}" khi đơn đang ở trạng thái "${status}".`,
    );

  if (actor.side === 'buyer') {
    if (action !== 'cancel')
      throw new ForbiddenException('Người mua không có quyền thao tác này.');
    if (status === 'pending' || status === 'confirmed') return 'cancelled';
    throw invalid();
  }

  const isManager = MANAGERS.includes(actor.role ?? '');
  const cashierComplete =
    actor.role === 'cashier' &&
    action === 'complete' &&
    fulfillment !== 'delivery';
  if (!isManager && !cashierComplete)
    throw new ForbiddenException('Bạn không có quyền thao tác đơn này.');

  switch (action) {
    case 'confirm':
      if (status === 'pending') return 'confirmed';
      break;
    case 'reject':
      if (status === 'pending') return 'rejected';
      break;
    case 'deliver':
      if (status === 'confirmed' && fulfillment === 'delivery')
        return 'delivering';
      break;
    case 'complete':
      if (status === 'confirmed' || status === 'delivering') return 'completed';
      break;
    case 'cancel':
      if (status === 'confirmed' || status === 'delivering') return 'cancelled';
      break;
    case 'editItems':
      if (status === 'pending' || status === 'confirmed') return status;
      break;
  }
  throw invalid();
}
