import { useNavigate } from 'react-router-dom';
import { post } from '../api.js';
import { useApp } from '../ctx.jsx';
import { openLogin } from '../components/LoginModal.jsx';
import { Empty, ErrorBox, Spinner, toast, useBusy } from '../ui.jsx';
import { useSceneTemplates } from './Home.jsx';

export default function Discover() {
  const nav = useNavigate();
  const { sceneId, user } = useApp();
  const list = useSceneTemplates(sceneId, undefined);
  const [busy, run] = useBusy();

  const toggle = (t, kind) =>
    run(async () => {
      if (!user) return openLogin();
      const r = await post(`/templates/${t.id}/${kind}`);
      list.setData((l) => l.map((x) => (x.id === t.id ? { ...x, likes: r.likes, favorites: r.favorites, [kind === 'like' ? 'liked' : 'favorited']: r.active } : x)));
      toast(kind === 'like' ? (r.active ? '已点赞' : '已取消点赞') : r.active ? '已收藏' : '已取消收藏');
    });

  return (
    <div className="section">
      <h2 style={{ fontSize: 22, margin: '8px 0 14px' }}>发现</h2>
      {!sceneId ? (
        <Empty text="请先在首页选择景区" />
      ) : list.loading && !list.data ? (
        <Spinner />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : !list.data.length ? (
        <Empty text="暂无已上架模板" />
      ) : (
        <div className="feed">
          {list.data.map((t) => (
            <div key={t.id} className="feed-card">
              <button className="feed-media" style={{ padding: 0, border: 0, width: '100%', display: 'block' }} onClick={() => nav(`/template/${t.id}`)}>
                {t.sampleVideo ? <video src={t.sampleVideo} poster={t.cover} muted loop playsInline autoPlay preload="metadata" /> : <img src={t.cover} alt={t.title} loading="lazy" />}
              </button>
              <div className="feed-meta">
                <div className="grow">
                  <div style={{ fontWeight: 650 }} className="ellipsis">
                    {t.title}
                  </div>
                  <div className="small muted">
                    {t.serviceName} · 已制作 {t.uses} 次
                  </div>
                </div>
                <div className="feed-actions">
                  <button className={`pill-btn ${t.liked ? 'on' : ''}`} onClick={() => toggle(t, 'like')} disabled={busy} aria-label="点赞">
                    {t.liked ? '♥' : '♡'} {t.likes}
                  </button>
                  <button className={`pill-btn ${t.favorited ? 'on' : ''}`} onClick={() => toggle(t, 'favorite')} disabled={busy} aria-label="收藏">
                    {t.favorited ? '★' : '☆'} {t.favorites}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
