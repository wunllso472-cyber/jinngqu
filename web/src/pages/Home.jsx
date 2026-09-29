import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../api.js';
import { useApp } from '../ctx.jsx';
import { yuan } from '../format.js';
import { openLogin } from '../components/LoginModal.jsx';
import { Badge, Empty, ErrorBox, Spinner, Tabs, useLoad } from '../ui.jsx';

/** 全屏景区选择页 */
export function ScenePicker({ onPick, onClose }) {
  const nav = useNavigate();
  const { user } = useApp();
  const { data, error, loading, reload } = useLoad(() => get('/scenes'), []);
  return (
    <div className="picker">
      <div className="picker-inner">
        <video className="picker-bg" src="/origin/welcome-video.mp4" poster="/origin/welcome-poster.jpg" autoPlay muted loop playsInline />
        <div className="picker-content">
          {onClose && (
            <button className="icon-btn" style={{ position: 'absolute', top: 12, right: 12 }} onClick={onClose} aria-label="关闭">
              ✕
            </button>
          )}
          <div className="picker-eyebrow">YINGMU · DESTINATION</div>
          <h2 style={{ fontSize: 30, margin: '10px 0 6px' }}>这一站，去哪里？</h2>
          <p className="small muted" style={{ marginBottom: 24 }}>
            选择你要体验的景区。网页版暂不自动定位。
          </p>
          {loading && !data ? (
            <Spinner text="正在加载景区…" />
          ) : error ? (
            <ErrorBox error={error} onRetry={reload} />
          ) : (
            <div className="stack">
              {data.map((s) => {
                const open = s.status === 'ACTIVE' && s.services.some((x) => x.available);
                return (
                  <button key={s.id} className={`picker-scene ${open ? '' : 'off'}`} onClick={() => onPick(s.id)}>
                    <div>
                      <h3>{s.name}</h3>
                      <p className="small muted">{open ? '进入景区，发现你的新形象' : '服务暂停'}</p>
                    </div>
                    <span style={{ fontSize: 22 }}>↗</span>
                  </button>
                );
              })}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-ghost btn-block mt-lg"
            onClick={() => {
              if (user) nav('/me');
              else openLogin();
              onClose?.();
            }}
          >
            账号登录 / 管理入口
          </button>
          <p className="small muted" style={{ textAlign: 'center', marginTop: 12 }}>
            打卡 ¥0.90 · 照片 ¥1.90 · 视频 ¥9.90
            <br />
            按次使用，无需充值积分
          </p>
        </div>
      </div>
    </div>
  );
}

export function TemplateCard({ t, onClick, showLikes = false }) {
  return (
    <button className="tpl-card" onClick={onClick}>
      <div className="tpl-cover">
        {t.cover && <img src={t.cover} alt={t.title} loading="lazy" />}
        {t.featured && <Badge tone="gold">热门</Badge>}
      </div>
      <div className="tpl-meta">
        <div className="tpl-title ellipsis">{t.title}</div>
        <div className="tpl-sub">
          {showLikes ? (
            <>
              <span>♥ {t.likes}</span>
              <span className="gold">{yuan(t.price)} / 次</span>
            </>
          ) : (
            <span>
              已制作 {t.uses} 次 · <span className="gold">{yuan(t.price)} / 次</span>
            </span>
          )}
        </div>
        {showLikes && <div className="small muted">已制作 {t.uses} 次</div>}
      </div>
    </button>
  );
}

const QUICK = [
  { label: '景点打卡', icon: '/origin/icon-checkin.png', to: '/dress-up?type=CHECKIN' },
  { label: '换装拍照', icon: '/origin/icon-outfit-photo.png', to: '/dress-up?type=OUTFIT_PHOTO' },
  { label: '换装摄影', icon: '/origin/icon-outfit-video.png', to: '/dress-up?type=OUTFIT_VIDEO' },
  { label: '人物管理', icon: '/origin/icon-characters.png', to: '/characters' },
];

export function useSceneTemplates(sceneId, type) {
  const { user } = useApp();
  return useLoad(() => (sceneId ? get(`/scenes/${sceneId}/templates`, { type }) : Promise.resolve([])), [sceneId, type, user?.id]);
}

export default function Home() {
  const nav = useNavigate();
  const { sceneId, setSceneId } = useApp();
  const [picking, setPicking] = useState(false);
  const [cat, setCat] = useState('hot');
  const scene = useLoad(() => (sceneId ? get(`/scenes/${sceneId}`) : Promise.resolve(null)), [sceneId]);
  const list = useSceneTemplates(sceneId, undefined);

  if (!sceneId || picking) {
    return (
      <ScenePicker
        onPick={(id) => {
          setSceneId(id);
          setPicking(false);
        }}
        onClose={sceneId ? () => setPicking(false) : null}
      />
    );
  }
  if (scene.error?.status === 404) {
    setSceneId(null);
    return null;
  }

  const all = list.data || [];
  const shown =
    cat === 'hot'
      ? [...all].sort((a, b) => b.featured - a.featured || b.uses + b.likes - (a.uses + a.likes))
      : cat === 'image'
        ? all.filter((t) => t.serviceType !== 'OUTFIT_VIDEO')
        : all.filter((t) => t.serviceType === 'OUTFIT_VIDEO');

  return (
    <div>
      <div className="top-bar">
        <button className="scene-chip" onClick={() => setPicking(true)}>
          ⌖ {scene.data?.name || '选择景区'} ▾
        </button>
        <span className="brand gold">影小沐 AIGC</span>
      </div>
      <div className="section stack" style={{ paddingTop: 8 }}>
        {scene.data?.status === 'PAUSED' && <div className="notice notice-bad">该景区服务已暂停，暂不接单</div>}
        <div className="quick-grid">
          {QUICK.map((q) => (
            <button key={q.label} className="quick" onClick={() => nav(q.to)}>
              <img src={q.icon} alt="" />
              <span>{q.label}</span>
            </button>
          ))}
        </div>
        <Tabs
          value={cat}
          onChange={setCat}
          items={[
            { value: 'hot', label: '热门爆款' },
            { value: 'image', label: '图片' },
            { value: 'video', label: '视频' },
          ]}
        />
        {list.loading && !list.data ? (
          <Spinner text="正在加载模板…" />
        ) : list.error ? (
          <ErrorBox error={list.error} onRetry={list.reload} />
        ) : !shown.length ? (
          <Empty text="暂无已上架模板" />
        ) : (
          <>
            <div className="tpl-grid">
              {shown.map((t) => (
                <TemplateCard key={t.id} t={t} onClick={() => nav(`/template/${t.id}`)} />
              ))}
            </div>
            <p className="small muted" style={{ textAlign: 'center' }}>
              已展示全部模板
            </p>
          </>
        )}
        {scene.data && (scene.data.servicePhone || scene.data.serviceHours) && (
          <p className="small muted" style={{ textAlign: 'center' }}>
            {scene.data.merchantName && `服务方：${scene.data.merchantName} · `}
            {scene.data.serviceHours}
            {scene.data.servicePhone && ` · ${scene.data.servicePhone}`}
          </p>
        )}
      </div>
    </div>
  );
}
