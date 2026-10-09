import api from "./api";

export interface CommunityPerson {
  id: string;
  name: string;
  role: string;
}
export interface CommunityPost {
  id: string;
  body: string;
  kind: string;
  state: string;
  crop: string;
  region: string;
  source: string;
  observedAt: string;
  topics: string[];
  createdAt: string;
  updatedAt: string;
  author: CommunityPerson;
  organization: { id: string; name: string; verified?: boolean } | null;
  mediaIds: string[];
  likeCount: number;
  commentCount: number;
  liked: boolean;
  saved: boolean;
  subscribed: boolean;
  helpfulCommentId: string | null;
  moderationReason?: string;
}
export interface CommunityComment {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: string;
  author: CommunityPerson;
}
export interface CommunityViewer {
  id: string;
  role: string;
  displayName: string;
  suspended: boolean;
  platformRole: "admin" | "moderator" | null;
  bio: string;
  region: string;
  crops: string;
  memberships: {
    id: string;
    name: string;
    canPublish: boolean;
    communityEnabled: boolean;
  }[];
}
export interface CommunityOverview {
  viewer: CommunityViewer;
  topics: { id: string; name: string; description: string }[];
  counts: { posts: number; contributors: number };
  businesses: { id: string; name: string; region: string; bio: string }[];
}
export interface PostInput {
  body: string;
  kind: string;
  state: string;
  crop: string;
  region: string;
  source: string;
  observedAt: string;
  topics: string[];
  mediaIds: string[];
  organizationId?: string;
  requestId: string;
}
export interface CommunityNotification {
  id: string;
  kind: string;
  postId: string | null;
  readAt: string | null;
  createdAt: string;
  actorName: string;
  /** Câu mô tả do API tạo (có thể thiếu ở API cũ). */
  text?: string;
  /** Đường dẫn đích do API tạo (null khi không có đích). */
  link?: string | null;
}
export interface CommunityProfile {
  id: string;
  name: string;
  role?: string;
  bio: string;
  region: string;
  crops?: string;
  /** Chỉ có ở hồ sơ đại lý. */
  verified?: boolean;
}
export interface CommunityReport {
  id: string;
  reason: string;
  state: string;
  postId: string;
  commentId: string | null;
  content: string;
  contentState: string;
  authorId: string;
  authorName: string;
  suspended: boolean;
  createdAt: string;
  history: { action: string; reason: string; at: string }[];
}
export interface CommunityOrganization {
  id: string;
  name: string;
  bio: string;
  region: string;
  communityEnabled: boolean;
  members: number;
}
export interface CommunityMember {
  id: string;
  name: string;
  role: string;
  active: boolean;
  canPublish: boolean;
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
const unwrap = async <T>(request: Promise<{ data: { data: T } }>) =>
  (await request).data.data;

export const communityApi = {
  overview: () => unwrap<CommunityOverview>(api.get("/community/me")),
  posts: (params: Record<string, string>) =>
    unwrap<Page<CommunityPost>>(api.get("/community/posts", { params })),
  post: (id: string) =>
    unwrap<CommunityPost>(api.get(`/community/posts/${id}`)),
  save: (data: PostInput, id?: string) =>
    unwrap<CommunityPost>(
      id
        ? api.patch(`/community/posts/${id}`, data)
        : api.post("/community/posts", data),
    ),
  remove: (id: string) => api.delete(`/community/posts/${id}`),
  action: (id: string, kind: string, on: boolean) =>
    on
      ? api.put(`/community/posts/${id}/actions/${kind}`)
      : api.delete(`/community/posts/${id}/actions/${kind}`),
  comments: (id: string, cursor?: string) =>
    unwrap<Page<CommunityComment>>(
      api.get(`/community/posts/${id}/comments`, { params: { cursor } }),
    ),
  comment: (id: string, body: string, requestId: string, parentId?: string) =>
    api.post(`/community/posts/${id}/comments`, { body, requestId, parentId }),
  editComment: (id: string, body: string) =>
    api.patch(`/community/comments/${id}`, { body }),
  deleteComment: (id: string) => api.delete(`/community/comments/${id}`),
  helpful: (id: string, commentId: string, on: boolean) =>
    on
      ? api.put(`/community/posts/${id}/helpful/${commentId}`)
      : api.delete(`/community/posts/${id}/helpful/${commentId}`),
  upload: (file: File) => {
    const data = new FormData();
    data.append("file", file);
    return unwrap<{ id: string }>(
      api.post("/community/media", data, {
        headers: { "Content-Type": "multipart/form-data" },
      }),
    );
  },
  media: async (id: string) =>
    (await api.get<Blob>(`/community/media/${id}`, { responseType: "blob" }))
      .data,
  profile: (id: string) =>
    unwrap<CommunityProfile>(api.get(`/community/members/${id}`)),
  updateProfile: (data: {
    displayName: string;
    bio: string;
    region: string;
    crops: string;
  }) => api.patch("/community/profile", data),
  business: (id: string) =>
    unwrap<CommunityProfile>(api.get(`/community/businesses/${id}`)),
  updateBusiness: (
    id: string,
    data: { name: string; bio: string; region: string },
  ) => api.patch(`/community/businesses/${id}`, data),
  blocks: () =>
    unwrap<{ id: string; name: string }[]>(api.get("/community/blocks")),
  block: (id: string, on: boolean) =>
    on
      ? api.put(`/community/blocks/${id}`)
      : api.delete(`/community/blocks/${id}`),
  report: (targetType: "post" | "comment", targetId: string, reason: string) =>
    api.post("/community/reports", { targetType, targetId, reason }),
  notifications: () =>
    unwrap<{ items: CommunityNotification[]; unread: number }>(
      api.get("/notifications"),
    ),
  read: (id?: string) =>
    api.put(id ? `/notifications/${id}/read` : "/notifications/read"),
  reports: (state: string) =>
    unwrap<CommunityReport[]>(
      api.get("/platform/community/reports", { params: { state } }),
    ),
  moderate: (id: string, action: string, reason: string) =>
    api.post(`/platform/community/reports/${id}/actions`, { action, reason }),
  organizations: () =>
    unwrap<CommunityOrganization[]>(api.get("/platform/organizations")),
  module: (id: string, communityEnabled: boolean) =>
    api.patch(`/platform/organizations/${id}/modules`, { communityEnabled }),
  members: (id: string) =>
    unwrap<CommunityMember[]>(api.get(`/organizations/${id}/members`)),
  membership: (id: string, member: CommunityMember) =>
    api.patch(`/organizations/${id}/members/${member.id}`, {
      active: member.active,
      canPublish: member.canPublish,
    }),
};

export function communityError(error: unknown): string {
  const value = error as { response?: { data?: { message?: string } } };
  return (
    value.response?.data?.message ||
    "Chưa kết nối được máy chủ. Bạn thử lại nhé."
  );
}
