export type ThreadKind = 'chat' | 'complaint' | 'support';
export type ThreadSide = 'buyer' | 'dealer' | 'admin';
export type ThreadStatus = 'open' | 'dealer_replied' | 'escalated' | 'resolved' | 'answered' | 'closed';

export interface ThreadSummary {
  id: string;
  kind: ThreadKind;
  code: string;
  buyerId: string;
  organizationId: string | null;
  orderId: string | null;
  status: ThreadStatus;
  category: string | null;
  subject: string;
  buyerWish: string | null;
  dealerProposal: string | null;
  blockedByBuyer: boolean;
  escalatedAt: string | null;
  resolvedAt: string | null;
  resolution: 'agreed' | 'buyer_favored' | 'dealer_favored' | 'settled' | null;
  resolutionNote: string;
  createdAt: string;
  lastMessageAt: string;
  dealerName: string | null;
  dealerLogoUrl: string | null;
  buyerName: string;
  orderCode: string | null;
  orderKind: 'buy' | 'sell' | null;
  lastMessage: { body: string; side: string; hasImages: boolean; orderId: string | null; createdAt: string } | null;
  unread?: boolean;
}

export interface ThreadOrder {
  id: string;
  code: string;
  kind: 'buy' | 'sell';
  status: string;
  total: number;
  createdAt: string;
}

export interface ThreadDetail extends ThreadSummary {
  side: ThreadSide;
  orders?: ThreadOrder[];
  dealerRegion?: string | null;
  dealerVerified?: boolean;
  autoEscalateAt?: string | null;
}

export interface MessageOrderCard {
  id: string;
  code: string;
  kind: 'buy' | 'sell';
  status: string;
  total: number;
  fulfillment: string;
  items: { name: string; quantity: number; unit: string }[] | null;
}

export interface ChatMessage {
  id: string;
  senderSide: 'buyer' | 'dealer' | 'admin' | 'system';
  senderId: string | null;
  senderName: string | null;
  staffName?: string | null;
  body: string;
  images: string[];
  createdAt: string;
  order?: MessageOrderCard | null;
}

export interface UnreadCount {
  chat: number;
  other: number;
}
