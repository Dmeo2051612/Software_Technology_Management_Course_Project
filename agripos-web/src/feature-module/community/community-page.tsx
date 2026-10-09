import { fluentColorIcon } from "../../assets/img/fluent-color";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  IconChevronRight,
  IconPlus,
  IconSearch,
  IconPhoto,
  IconHelpCircle,
  IconChartBar,
  IconHash,
  IconCoin,
  IconPlant2,
  IconCalendarEvent,
  IconBug,
  IconPackage,
} from "@tabler/icons-react";
import { agrilinkBuyerApi } from '../../services/agrilink.service';
import { all_routes as routes } from '../../routes/all_routes';
import type { DealerCard } from '../../services/agrilink.types';
import {
  communityApi,
  communityError,
  type CommunityNotification,
  type CommunityOverview,
  type CommunityPost,
  type CommunityProfile,
} from "../../services/community.service";
import CommunityComposer, { type ComposerPreset } from "./community-composer";
import CommunityDiscussion from "./community-discussion";
import CommunityPostModal from "./community-post-modal";
import MarketPricesCard from "./MarketPricesCard";
import CommunityModeration from "./community-moderation";
import CommunitySettings from "./community-settings";
import {
  Avatar,
  EmptyState,
  Modal,
  PostCard,
  type PostCommand,
  timeLabel,
} from "./community-widgets";
import { notificationLink } from "../../utils/notifications";
import "./community.css";
import VerifiedBadge from "../../components/brand/VerifiedBadge";
import { PillGroup } from "../../components/ui";

const postTarget = (item: CommunityNotification): string | null => {
  const id = item.postId?.trim();
  return id && id !== 'null' && id !== 'undefined' ? `/community/posts/${id}` : null;
};
/** Icon riêng cho từng chủ đề (theo tên); chủ đề mới dùng dấu #. */
const TOPIC_ICONS: Record<string, typeof IconHash> = {
  "giá nông sản": IconCoin,
  "kỹ thuật canh tác": IconPlant2,
  "mùa vụ": IconCalendarEvent,
  "sâu bệnh": IconBug,
  "vật tư": IconPackage,
};
// Icon màu (Fluent Color) cho cột trái, kiểu Facebook — thay icon nét trong vòng tròn.
const TOPIC_COLOR_ICONS: Record<string, string> = {
  "giá nông sản": "coin-multiple-48",
  "kỹ thuật canh tác": "lightbulb-filament",
  "mùa vụ": "calendar",
  "sâu bệnh": "warning",
  "vật tư": "toolbox",
};
function ColorIcon({ name }: { name: string }) {
  const src = fluentColorIcon(name);
  return src ? <img className="cm-color-icon" src={src} alt="" aria-hidden="true" /> : null;
}
function TopicColorIcon({ name }: { name: string }) {
  const key = TOPIC_COLOR_ICONS[name.trim().toLocaleLowerCase("vi-VN")];
  return key ? <ColorIcon name={key} /> : <TopicIcon name={name} />;
}
function TopicIcon({ name }: { name: string }) {
  const Icon = TOPIC_ICONS[name.trim().toLocaleLowerCase("vi-VN")] ?? IconHash;
  return <Icon size={19} />;
}
const notificationText = (item: CommunityNotification) => item.kind === 'comment'
  ? 'đã phản hồi cuộc trò chuyện bạn theo dõi'
  : 'đã xử lý một báo cáo liên quan đến bạn';

type View =
  | "feed"
  | "saved"
  | "mine"
  | "following"
  | "notifications"
  | "settings"
  | "moderation"
  | "post"
  | "member"
  | "business";
const pathView = (pathname: string): View =>
  pathname === "/community/saved"
    ? "saved"
    : pathname === "/community/mine"
      ? "mine"
      : pathname === "/community/following"
        ? "following"
        : pathname === "/notifications"
          ? "notifications"
          : pathname === "/community/settings"
            ? "settings"
            : pathname === "/platform/community/reports"
              ? "moderation"
              : pathname.startsWith("/community/posts/")
                ? "post"
                : pathname.startsWith("/community/members/")
                  ? "member"
                  : pathname.startsWith("/community/businesses/")
                    ? "business"
                    : "feed";

export default function CommunityPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = pathView(location.pathname);
  const [overview, setOverview] = useState<CommunityOverview | null>(null);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [notifications, setNotifications] = useState<{
    items: CommunityNotification[];
    unread: number;
  }>({ items: [], unread: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState<CommunityPost | "new" | null>(null);
  const [composerPreset, setComposerPreset] = useState<ComposerPreset | undefined>();
  const openComposer = (preset?: ComposerPreset) => {
    setComposerPreset(preset);
    setComposer('new');
  };
  const [reporting, setReporting] = useState<{
    type: "post" | "comment";
    id: string;
  } | null>(null);
  const [reason, setReason] = useState("");
  // Bài đang mở trong cửa sổ bình luận (bảng tin giữ nguyên phía sau).
  const [openPost, setOpenPost] = useState<CommunityPost | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [dealers, setDealers] = useState<DealerCard[]>([]);
  const [feedSort, setFeedSort] = useState<'new' | 'popular'>('new');
  useEffect(() => { void agrilinkBuyerApi.dealers().then(setDealers).catch(() => {}); }, []);
  const topicNames = useMemo(
    () =>
      Object.fromEntries(
        overview?.topics.map((topic) => [topic.id, topic.name]) || [],
      ),
    [overview],
  );

  const filters = useMemo(() => {
    const value: Record<string, string> = {};
    for (const key of ["q", "topic", "kind", "crop", "region"]) {
      const item = searchParams.get(key);
      if (item) value[key] = item;
    }
    if (["saved", "mine", "following"].includes(view)) value.view = view;
    if (view === "member" && params.id) value.author = params.id;
    if (view === "business" && params.id) value.business = params.id;
    return value;
  }, [searchParams, view, params.id]);

  const loadOverview = useCallback(async () => {
    const data = await communityApi.overview();
    setOverview(data);
    return data;
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([loadOverview(), communityApi.notifications()])
      .then(([, data]) => {
        if (active) setNotifications(data);
      })
      .catch((e) => {
        if (active) setError(communityError(e));
      })
      .finally(() => {
        if (active && ["settings", "moderation"].includes(view))
          setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadOverview, refreshKey, view]);

  useEffect(() => {
    if (["settings", "moderation"].includes(view)) return;
    let active = true;
    setLoading(true);
    setError("");
    setPost(null);
    setProfile(null);
    const request =
      view === "post" && params.id
        ? Promise.all([
            communityApi.post(params.id),
            communityApi.comments(params.id),
          ]).then(([item]) => {
            if (active) setPost(item);
          })
        : view === "notifications"
          ? communityApi.notifications().then((data) => {
              if (active) setNotifications(data);
            })
          : view === "member" && params.id
            ? Promise.all([
                communityApi.profile(params.id),
                communityApi.posts(filters),
              ]).then(([person, page]) => {
                if (active) {
                  setProfile(person);
                  setPosts(page.items);
                  setNextCursor(page.nextCursor);
                }
              })
            : view === "business" && params.id
              ? Promise.all([
                  communityApi.business(params.id),
                  communityApi.posts(filters),
                ]).then(([business, page]) => {
                  if (active) {
                    setProfile(business);
                    setPosts(page.items);
                    setNextCursor(page.nextCursor);
                  }
                })
              : communityApi.posts(filters).then((page) => {
                  if (active) {
                    setPosts(page.items);
                    setNextCursor(page.nextCursor);
                  }
                });
    request
      .catch((e) => {
        if (active) setError(communityError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view, params.id, filters, refreshKey]);

  const refresh = () => setRefreshKey((key) => key + 1);
  const action = async (
    item: CommunityPost,
    kind: "like" | "bookmark" | "subscription",
  ) => {
    const current =
      kind === "like"
        ? item.liked
        : kind === "bookmark"
          ? item.saved
          : item.subscribed;
    await communityApi.action(item.id, kind, !current);
    const patch = <T extends CommunityPost | null>(value: T): T =>
      value?.id === item.id
        ? {
            ...value,
            [kind === "like"
              ? "liked"
              : kind === "bookmark"
                ? "saved"
                : "subscribed"]: !current,
            ...(kind === "like"
              ? { likeCount: value.likeCount + (current ? -1 : 1) }
              : {}),
          }
        : value;
    setPosts((list) => list.map(patch));
    setPost(patch);
    setOpenPost(patch);
  };
  // Sau khi bình luận trong cửa sổ: chỉ tải lại bài đó, không tải lại cả bảng tin.
  const reloadOpenPost = (id: string) => {
    communityApi
      .post(id)
      .then((fresh) => {
        setOpenPost((current) => (current?.id === id ? fresh : current));
        setPosts((list) => list.map((value) => (value.id === id ? fresh : value)));
      })
      .catch((e) => setError(communityError(e)));
  };
  const command = (command: PostCommand, item: CommunityPost) => {
    if (command === "edit") setComposer(item);
    if (
      command === "delete" &&
      window.confirm(
        "Xóa bài viết này? Bài sẽ không còn xuất hiện trong cộng đồng.",
      )
    )
      communityApi
        .remove(item.id)
        .then(() => {
          setOpenPost(null);
          if (view === "post") navigate("/community");
          else refresh();
        })
        .catch((e) => setError(communityError(e)));
    if (command === "report") {
      setReporting({ type: "post", id: item.id });
      setReason("");
    }
    if (
      command === "block" &&
      window.confirm(
        `Chặn ${item.author.name}? Hai bên sẽ không còn thấy nội dung của nhau.`,
      )
    )
      communityApi
        .block(item.author.id, true)
        .then(() => {
          setOpenPost(null);
          refresh();
        })
        .catch((e) => setError(communityError(e)));
  };
  const submitSearch = () => {
    const next = new URLSearchParams(searchParams);
    if (q.trim()) next.set("q", q.trim()); else next.delete("q");
    setSearchParams(next);
    if (view !== "feed") navigate(`/community?${next}`);
  };
  const leftLinks = [
    ["/community", "Bảng tin", <ColorIcon name="home" />, "blue"],
    ["/community/following", "Đang theo dõi", <ColorIcon name="alert" />, "amber"],
    ["/community/saved", "Đã lưu", <ColorIcon name="bookmark" />, "violet"],
    ["/community/mine", "Bài của tôi", <ColorIcon name="comment" />, "sky"],
    [
      "/notifications",
      `Thông báo${notifications.unread ? ` (${notifications.unread})` : ""}`,
      <ColorIcon name="alert-badge" />,
      "red",
    ],
    [
      "/community/settings",
      "Hồ sơ & quyền riêng tư",
      <ColorIcon name="lock-shield" />,
      "slate",
    ],
  ] as const;

  const postList = loading ? (
    <div className="cm-skel-list" role="status">
      <span className="visually-hidden">Đang tải câu chuyện từ cộng đồng…</span>
      {[0, 1].map((i) => (
        <div key={i} className="cm-card cm-skel-post" aria-hidden="true">
          <div className="cm-skel-head">
            <span className="cm-skel-bone cm-skel-avatar" />
            <div style={{ flex: 1, display: "grid", gap: 6 }}>
              <span className="cm-skel-bone cm-skel-line" style={{ width: "38%" }} />
              <span className="cm-skel-bone cm-skel-line" style={{ width: "22%" }} />
            </div>
          </div>
          <span className="cm-skel-bone cm-skel-line" style={{ width: "92%" }} />
          <span className="cm-skel-bone cm-skel-line" style={{ width: "70%" }} />
          {i === 0 && <span className="cm-skel-bone" style={{ height: 180 }} />}
        </div>
      ))}
    </div>
  ) : error ? (
    <div className="cm-error" role="alert">
      {error}
      <button className="cm-link-button" onClick={refresh}>
        Thử lại
      </button>
    </div>
  ) : posts.length ? (
    <>
      {[...posts].sort((a,b) => feedSort === 'popular' ? (b.likeCount + b.commentCount) - (a.likeCount + a.commentCount) : 0).map((item, index) => (
        <PostCard
          key={item.id}
          revealIndex={index}
          post={item}
          userId={overview?.viewer.id || ""}
          viewerName={overview?.viewer.displayName || 'Bạn'}
          topicNames={topicNames}
          onAction={action}
          onCommand={command}
          onOpen={() => setOpenPost(item)}
        />
      ))}
      {nextCursor && (
        <button
          className="cm-button secondary cm-load-more"
          disabled={moreLoading}
          onClick={async () => {
            setMoreLoading(true);
            try {
              const page = await communityApi.posts({
                ...filters,
                cursor: nextCursor,
              });
              setPosts((current) => [...current, ...page.items]);
              setNextCursor(page.nextCursor);
            } catch (e) {
              setError(communityError(e));
            } finally {
              setMoreLoading(false);
            }
          }}
        >
          {moreLoading ? "Đang tải…" : "Xem thêm bài viết"}
        </button>
      )}
    </>
  ) : (
    <EmptyState title="Chưa có bài viết phù hợp">
      Hãy đổi bộ lọc hoặc mở đầu một cuộc trò chuyện mới.
    </EmptyState>
  );

  return (
    <div className="community-page community-desktop">
      <div className="cm-hero">
        <div>
          <span>Cộng đồng AgriLink</span>
          <h1>Cùng nhau làm nông tốt hơn</h1>
          <p>
            Nơi nông dân và đại lý trao đổi kinh nghiệm, chia sẻ thông tin và
            xây dựng những mối quan hệ đáng tin cậy.
          </p>
        </div>
        <button
          className="cm-button primary"
          disabled={!overview || overview.viewer.suspended}
          onClick={() => setComposer("new")}
        >
          <IconPlus size={19} />
          Chia sẻ câu chuyện
        </button>
      </div>
      <div className="cm-layout">
        <aside className="cm-left" aria-label="Điều hướng cộng đồng">
          {overview && <Link className="cm-rail-profile" to={`/community/members/${overview.viewer.id}`}><Avatar name={overview.viewer.displayName} /><strong>{overview.viewer.displayName}</strong></Link>}
          <nav>
            {leftLinks.map(([path, label, icon, tone]) => (
              <Link
                key={path}
                data-tone={tone}
                className={location.pathname === path ? "active" : ""}
                to={path}
              >
                {icon}
                <span>{label}</span>
              </Link>
            ))}
            {overview?.viewer.platformRole && (
              <Link
                data-tone="teal"
                className={view === "moderation" ? "active" : ""}
                to="/platform/community/reports"
              >
                <ColorIcon name="shield-checkmark" />
                <span>Quản trị cộng đồng</span>
              </Link>
            )}
          </nav>
          <div className="cm-topic-nav">
            <h3>Chủ đề</h3>
            {overview?.topics.map((topic) => (
              <Link
                className={
                  searchParams.get("topic") === topic.id ? "active" : ""
                }
                key={topic.id}
                to={`/community?topic=${topic.id}`}
              >
                <span className="cm-topic-tile"><TopicColorIcon name={topic.name} /></span><span>{topic.name}<small>{topic.description}</small></span>
              </Link>
            ))}
          </div>
          <div className="cm-topic-nav cm-shortcuts"><h3>Lối tắt</h3>{dealers.slice(0,4).map(dealer => <Link key={dealer.id} data-tone="amber" to={`/agrilink/dai-ly/${dealer.id}`}><span className="cm-topic-tile"><ColorIcon name="building-store" /></span>{dealer.name}</Link>)}</div>
        </aside>
        <section className="cm-main">
          {view === "feed" && (
            <>
              <form
                className="cm-search"
                onSubmit={(e) => {
                  e.preventDefault();
                  submitSearch();
                }}
              >
                <IconSearch size={20} />
                <input
                  aria-label="Tìm trong cộng đồng"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm câu hỏi, cây trồng, khu vực…"
                />
                <button>Tìm kiếm</button>
              </form>
              {overview && !overview.viewer.suspended && (
                <><div className="cm-card cm-composer-desktop"><button className="cm-compose-prompt" onClick={() => openComposer()}><Avatar name={overview.viewer.displayName} /><span>Bạn muốn chia sẻ điều gì với cộng đồng?</span></button><div className="cm-compose-actions"><button type="button" onClick={() => openComposer({ openImages: true })}><IconPhoto size={19} />Ảnh/video</button><button type="button" onClick={() => openComposer({ kind: 'question' })}><IconHelpCircle size={19} />Hỏi đáp</button><button type="button" onClick={() => openComposer({ kind: 'market', topicId: overview.topics.find(topic => topic.name.toLocaleLowerCase('vi-VN') === 'giá nông sản')?.id })}><IconChartBar size={19} />Giá hôm nay</button></div></div><button className="cm-card cm-compose-prompt cm-mobile-composer" onClick={() => openComposer()}><Avatar name={overview.viewer.displayName} /><span>Bạn muốn chia sẻ điều gì với cộng đồng?</span><IconPhoto size={22} /></button></>
              )}
              <div className="cm-feed-filters"><PillGroup className="cm-feed-topics" activeKey={searchParams.get('topic') || ''}><Link className={!searchParams.get('topic') ? 'active' : ''} to="/community">Tất cả</Link>{overview?.topics.slice(0,4).map(topic => <Link key={topic.id} className={searchParams.get('topic') === topic.id ? 'active' : ''} to={`/community?topic=${topic.id}`}>{topic.name}</Link>)}</PillGroup><PillGroup className="cm-feed-sort" activeKey={feedSort}><button type="button" className={feedSort === 'new' ? 'active' : ''} onClick={() => setFeedSort('new')}>Mới nhất</button><button type="button" className={feedSort === 'popular' ? 'active' : ''} onClick={() => setFeedSort('popular')}>Nổi bật</button></PillGroup></div>
            </>
          )}
          {view === "settings" && overview ? (
            <CommunitySettings overview={overview} onSaved={refresh} />
          ) : view === "moderation" && overview ? (
            <CommunityModeration viewer={overview.viewer} />
          ) : view === "notifications" ? (
            <Notifications
              items={notifications.items}
              onRead={async (id) => {
                await communityApi.read(id);
                const item = notifications.items.find((x) => x.id === id);
                const target = item && notificationLink(item);
                if (target) navigate(target);
              }}
              markAll={async () => {
                await communityApi.read();
                refresh();
              }}
            />
          ) : view === "post" ? (
            loading ? (
              postList
            ) : post && overview ? (
              <>
                <div className="cm-breadcrumb">
                  <Link to="/community">Cộng đồng</Link>
                  <IconChevronRight size={14} />
                  Bài viết
                </div>
                <PostCard
                  post={post}
                  detail
                  userId={overview.viewer.id}
                  viewerName={overview.viewer.displayName}
                  topicNames={topicNames}
                  onAction={action}
                  onCommand={command}
                />
                <CommunityDiscussion
                  post={post}
                  viewer={overview.viewer}
                  refresh={refresh}
                  onReport={(id) => {
                    setReporting({ type: "comment", id });
                    setReason("");
                  }}
                />
              </>
            ) : (
              postList
            )
          ) : ["member", "business"].includes(view) ? (
            <>
              {profile && (
                <ProfileHeader
                  profile={profile}
                  business={view === "business"}
                  viewerId={overview?.viewer.id}
                  onBlock={async () => {
                    await communityApi.block(profile.id, true);
                    navigate("/community");
                  }}
                />
              )}
              <h2 className="cm-list-title">Bài viết gần đây</h2>
              {postList}
            </>
          ) : (
            <>
              {view !== "feed" && (
                <div className="cm-page-title">
                  <h2>
                    {view === "saved"
                      ? "Bài đã lưu"
                      : view === "following"
                        ? "Đang theo dõi"
                        : "Bài của tôi"}
                  </h2>
                  <p>
                    {view === "saved"
                      ? "Những nội dung bạn muốn quay lại đọc."
                      : view === "following"
                        ? "Các cuộc trò chuyện bạn đang quan tâm."
                        : "Quản lý bài đã đăng và bản nháp."}
                  </p>
                </div>
              )}
              {postList}
            </>
          )}
        </section>
        <aside className="cm-right">
          <section className="cm-card cm-side-card">
            <div className="cm-section-head">
              <h2>Hoạt động mới</h2>
              <Link to="/notifications">Xem tất cả</Link>
            </div>
            {notifications.items.filter((item) => postTarget(item)).slice(0, 4).map((item) => (
              <Link
                className={
                  !item.readAt ? "cm-notification unread" : "cm-notification"
                }
                key={item.id}
                to={postTarget(item)!}
                onClick={() => void communityApi.read(item.id)}
              >
                <span>
                  {item.kind === "moderation"
                    ? "Quản trị cộng đồng"
                    : item.actorName}
                </span>
                <small>
                  {notificationText(item)}{" "}
                  · {timeLabel(item.createdAt)}
                </small>
              </Link>
            ))}
            {!notifications.items.some((item) => postTarget(item)) && (
              <p className="cm-muted">
                Chưa có hoạt động mới
              </p>
            )}
          </section>
          <section className="cm-card cm-side-card">
            <div className="cm-section-head">
              <h2>Đại lý gần bạn</h2>
              <Link to={routes.agrilinkHome}>Xem tất cả</Link>
            </div>
            {dealers.slice(0,4).map((business) => (
              <Link
                className="cm-business-link"
                key={business.id}
                to={`/agrilink/dai-ly/${business.id}`}
              >
                <Avatar name={business.name} business imageUrl={business.logoUrl} />
                <div>
                  <strong>{business.name}{business.verified && <VerifiedBadge size={15} />}</strong>
                  <small>{business.region || "Thành viên AgriLink"}{business.ratings?.avgStars != null && ` · ${business.ratings.avgStars.toFixed(1)} sao`}</small>
                </div>
              </Link>
            ))}
          </section>
          <MarketPricesCard />
          <p className="cm-community-note">
            Cộng đồng là nơi trao đổi kinh nghiệm. Thông tin thị trường không
            thay thế báo giá hoặc thỏa thuận chính thức.
          </p>
        </aside>
      </div>
      {openPost && overview && (
        <CommunityPostModal
          post={openPost}
          viewer={overview.viewer}
          topicNames={topicNames}
          onClose={() => setOpenPost(null)}
          onAction={action}
          onCommand={command}
          onChanged={() => reloadOpenPost(openPost.id)}
          onReport={(id) => {
            setReporting({ type: "comment", id });
            setReason("");
          }}
        />
      )}
      {composer && overview && (
        <CommunityComposer
          overview={overview}
          post={composer === "new" ? undefined : composer}
          preset={composer === "new" ? composerPreset : undefined}
          onClose={() => { setComposer(null); setComposerPreset(undefined); }}
          onSaved={(saved) => {
            setOpenPost(null);
            setComposer(null);
            setComposerPreset(undefined);
            navigate(`/community/posts/${saved.id}`);
            refresh();
          }}
        />
      )}
      {reporting && (
        <Modal title="Báo cáo nội dung" onClose={() => setReporting(null)}>
          <form
            className="cm-modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await communityApi.report(reporting.type, reporting.id, reason);
                setReporting(null);
                setReason("");
                window.alert("Đã gửi báo cáo đến người quản trị cộng đồng.");
              } catch (err) {
                setError(communityError(err));
              }
            }}
          >
            <label>
              Điều gì khiến nội dung này không phù hợp?
              <textarea
                required
                minLength={5}
                maxLength={1000}
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <div className="cm-dialog-footer">
              <button
                type="button"
                className="cm-button secondary"
                onClick={() => setReporting(null)}
              >
                Hủy
              </button>
              <button className="cm-button primary">Gửi báo cáo</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function ProfileHeader({
  profile,
  business,
  viewerId,
  onBlock,
}: {
  profile: CommunityProfile;
  business: boolean;
  viewerId?: string;
  onBlock: () => Promise<void>;
}) {
  return (
    <section className="cm-card cm-profile-head">
      <Avatar name={profile.name} business={business} />
      <div>
        <span>
          {business
            ? "Đại lý AgriLink"
            : profile.role === "farmer"
              ? "Nông dân"
              : "Thành viên cộng đồng"}
        </span>
        <h2>
          {profile.name}
          {business && profile.verified && <VerifiedBadge size={20} />}
        </h2>
        <p>{profile.bio || "Thành viên chưa viết phần giới thiệu."}</p>
        <div className="cm-tags">
          {profile.region && <span>{profile.region}</span>}
          {profile.crops && <span>{profile.crops}</span>}
        </div>
      </div>
      {business && <Link className="cm-button primary" to={routes.agrilinkStorefront.replace(':id', profile.id)}>Xem gian hàng</Link>}
      {!business && profile.id !== viewerId && (
        <button className="cm-button secondary" onClick={() => void onBlock()}>
          Chặn tài khoản
        </button>
      )}
    </section>
  );
}
function Notifications({
  items,
  onRead,
  markAll,
}: {
  items: CommunityNotification[];
  onRead: (id: string) => Promise<void>;
  markAll: () => Promise<void>;
}) {
  return (
    <section className="cm-card cm-notification-page">
      <div className="cm-section-head">
        <div>
          <h2>Thông báo</h2>
          <p>Phản hồi và cập nhật dành cho bạn.</p>
        </div>
        <button className="cm-button secondary" onClick={() => void markAll()}>
          Đánh dấu đã đọc
        </button>
      </div>
      {items.length ? (
        items.map((item) => (
          <button
            className={
              !item.readAt
                ? "cm-notification-row unread"
                : "cm-notification-row"
            }
            key={item.id}
            onClick={() => void onRead(item.id)}
          >
            <span className="cm-notification-dot" />
            <div>
              <strong>
                {item.kind === "moderation"
                  ? "Quản trị cộng đồng"
                  : item.actorName}
              </strong>
              <p>{item.text ?? `${notificationText(item)}.`}</p>
              <small>{timeLabel(item.createdAt)}</small>
            </div>
            <IconChevronRight size={18} />
          </button>
        ))
      ) : (
        <EmptyState title="Chưa có thông báo">
          Các phản hồi mới sẽ xuất hiện tại đây.
        </EmptyState>
      )}
    </section>
  );
}
