import { ForbiddenException } from '@nestjs/common';
import type { CommunityViewer } from '../community/community.service';

/** Đại lý đang chọn của nhân viên; nông dân không có. */
export function ownOrganization(v: CommunityViewer): string {
  const membership = v.memberships.find((m) => m.id === v.organizationId);
  if (!membership || v.role === 'farmer')
    throw new ForbiddenException('Cần tài khoản đại lý.');
  return membership.id;
}

/** Như ownOrganization nhưng chỉ chủ hoặc quản lý. */
export function managerOrganization(v: CommunityViewer): string {
  const id = ownOrganization(v);
  if (v.role !== 'owner' && v.role !== 'manager')
    throw new ForbiddenException(
      'Chỉ chủ hoặc quản lý đại lý được quản lý gian hàng.',
    );
  return id;
}
