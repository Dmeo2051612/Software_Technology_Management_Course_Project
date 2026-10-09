import api from './api';
import type {
  ChatMessage,
  ThreadDetail,
  ThreadKind,
  ThreadStatus,
  ThreadSummary,
  UnreadCount,
} from './agrilink-messaging.types';

const unwrap = async <T>(request: Promise<{ data: { data: T } }>): Promise<T> => (await request).data.data;
/** api mặc định gửi JSON; FormData cần khai báo multipart. */
const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };
const base = '/marketplace';

export type InboxSide = 'buyer' | 'dealer';
export interface ComplaintInput {
  category: string;
  body: string;
  wish?: 'exchange' | 'refund' | 'notice';
}
export interface ProposalInput {
  proposal: 'refund' | 'exchange' | 'explain' | 'other';
  note: string;
}
export interface SupportInput {
  category: 'account' | 'orders' | 'payment' | 'dealer' | 'other';
  subject: string;
  body: string;
}
export interface ResolveInput {
  resolution: 'buyer_favored' | 'dealer_favored' | 'settled';
  note: string;
}

export const messagingApi = {
  threads: (params: { as: InboxSide; kind?: ThreadKind; status?: ThreadStatus }) =>
    unwrap<ThreadSummary[]>(api.get(`${base}/threads`, { params })),
  unread: (as: InboxSide) => unwrap<UnreadCount>(api.get(`${base}/threads/unread-count`, { params: { as } })),
  thread: (id: string) => unwrap<ThreadDetail>(api.get(`${base}/threads/${id}`)),
  messages: (id: string, cursor: { after?: string; before?: string } = {}) =>
    unwrap<ChatMessage[]>(api.get(`${base}/threads/${id}/messages`, { params: cursor })),
  send: (id: string, input: { body?: string; images?: string[] }) =>
    unwrap<ChatMessage>(api.post(`${base}/threads/${id}/messages`, input)),
  read: (id: string) => unwrap<{ read: boolean }>(api.post(`${base}/threads/${id}/read`)),
  uploadImage: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<{ url: string }>(api.post(`${base}/threads/${id}/images`, form, MULTIPART));
  },
  openChat: (dealerId: string) => unwrap<ThreadDetail>(api.post(`${base}/chats`, { dealerId })),
  chatForOrder: (orderId: string) => unwrap<{ id: string }>(api.get(`${base}/orders/${orderId}/chat`)),
  block: (id: string, blocked: boolean) =>
    unwrap<{ blocked: boolean }>(api.post(`${base}/chats/${id}/${blocked ? 'block' : 'unblock'}`)),
  complain: (orderId: string, input: ComplaintInput) =>
    unwrap<ThreadDetail>(api.post(`${base}/my-orders/${orderId}/complaints`, input)),
  propose: (id: string, input: ProposalInput) => unwrap<ThreadDetail>(api.post(`${base}/threads/${id}/propose`, input)),
  accept: (id: string) => unwrap<ThreadDetail>(api.post(`${base}/threads/${id}/accept`)),
  escalate: (id: string) => unwrap<ThreadDetail>(api.post(`${base}/threads/${id}/escalate`)),
  support: (input: SupportInput) => unwrap<ThreadDetail>(api.post(`${base}/support`, input)),
  close: (id: string) => unwrap<{ closed: boolean }>(api.post(`${base}/threads/${id}/close`)),
  adminThreads: (kind: 'complaint' | 'support', status?: ThreadStatus) =>
    unwrap<ThreadSummary[]>(api.get('/platform/agrilink/threads', { params: status ? { kind, status } : { kind } })),
  resolve: (id: string, input: ResolveInput) =>
    unwrap<ThreadDetail>(api.post(`/platform/agrilink/threads/${id}/resolve`, input)),
};
