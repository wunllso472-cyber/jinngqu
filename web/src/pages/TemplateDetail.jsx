import { useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { useApp } from '../ctx.jsx';
import { SERVICE_META, yuan } from '../format.js';
import { Badge, ErrorBox, Header, Spinner, toast, useBusy, useLoad } from '../ui.jsx';
import { openLogin } from '../components/LoginModal.jsx';

export default function TemplateDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user } = useApp();
  const { data: t, error, reload, setData } = useLoad(() => get(`/templates/${id}`), [id, user?.id]);
  const [busy, run] = useBusy();

  if (error) return (<><Header title="模板详情" /><ErrorBox error={error} onRetry={reload} /></>);
  if (!t) return (<><Header title="模板详情" /><Spinner /></>);

  const svc = t.scene.services.find((s) => s.type === t.serviceType);
  const needLogin = () => openLogin();
  const toggle = (kind) =>
    run(async () => {
      if (!user) return needLogin();
      const r = await post(`/templates/${t.id}/${kind}`);
      setData((d) => ({ ...d, likes: r.likes, favorites: r.favorites, [kind === 'like' ? 'liked' : 'favorited']: r.active }));
      toast(kind === 'like' ? (r.active ? '已点赞' : '已取消点赞') : r.active ? '已收藏' : '已取消收藏');
    });

  return (
    <div>
      <Header title={SERVICE_META[t.serviceType].name} />
      <div className="detail-cover">
        {t.sampleVideo ? <video src={t.sampleVideo} poster={t.cover} controls playsInline /> : t.cover && <img src={t.cover} alt={t.title} />}
      </div>
      <div className="section stack">
        <div>
          <div className="row-between">
            <h2 style={{ fontSize: 20 }}>{t.title}</h2>
            {t.featured && <Badge tone="gold">优先推荐</Badge>}
          </div>
          <p className="muted small mt">
            {t.scene.name} · {t.uses} 次真实制作 · {t.likes} 点赞 · {t.favorites} 收藏
          </p>
        </div>
        {t.tags.length > 0 && (
          <div className="tags">
            {t.tags.map((x) => (
              <span className="tag" key={x}>
                #{x}
              </span>
            ))}
          </div>
        )}
        {t.intro && <p className="pre">{t.intro}</p>}
        <div className="card card-tight">
          <div className="kv">
            <span>制作价格</span>
            <span className="gold">{yuan(t.price)} / 次</span>
            <span>支付方式</span>
            <span>模拟支付 · 无实际扣款</span>
            <span>失败处理</span>
            <span>自动模拟退款</span>
          </div>
        </div>
        {t.serviceType === 'OUTFIT_PHOTO' && (
          <p className="small muted">白模场景提供背景、构图和人物动作，人物模板提供长相、发型和整套服装。{t.hasBaseImage ? '' : '本模板未配置白模，需要你自行上传。'}</p>
        )}
        <p className="small muted">按次模拟支付：合拍 ¥0.90 / 照片 ¥1.90 / 视频 ¥9.90。</p>
        {svc && !svc.available && <div className="notice notice-bad">{svc.reason}</div>}
      </div>
      <div className="action-bar">
        <button className={`pill-btn ${t.liked ? 'on' : ''}`} onClick={() => toggle('like')} disabled={busy}>
          {t.liked ? '♥' : '♡'} {t.likes}
        </button>
        <button className={`pill-btn ${t.favorited ? 'on' : ''}`} onClick={() => toggle('favorite')} disabled={busy}>
          {t.favorited ? '★' : '☆'} 收藏
        </button>
        <button className="btn btn-primary grow" disabled={!svc?.available} onClick={() => (user ? nav(`/create/${t.id}`) : needLogin())}>
          {svc?.available ? `使用此模板制作 · ${yuan(t.price)}` : '服务暂停'}
        </button>
      </div>
    </div>
  );
}
