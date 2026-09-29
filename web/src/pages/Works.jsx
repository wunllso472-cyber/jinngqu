import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get } from '../api.js';
import { useApp } from '../ctx.jsx';
import { SERVICE_META } from '../format.js';
import { Empty, ErrorBox, Pager, Spinner, Tabs, useLoad } from '../ui.jsx';

export default function Works() {
  const { user, ready } = useApp();
  const nav = useNavigate();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => (user ? get('/works', { type, page }) : Promise.resolve(null)), [user?.id, type, page]);

  return (
    <div className="section">
      <h2 style={{ fontSize: 22, margin: '12px 0 14px' }}>我的作品</h2>
      {!ready ? (
        <Spinner />
      ) : !user ? (
        <Empty text="登录后查看作品">
          <button className="btn btn-primary" onClick={() => nav('/me', { state: { from: '/works' } })}>
            去登录
          </button>
        </Empty>
      ) : (
        <>
          <Tabs
            value={type}
            onChange={(v) => {
              setType(v);
              setPage(1);
            }}
            items={[{ value: '', label: '全部' }, ...Object.entries(SERVICE_META).map(([k, m]) => ({ value: k, label: m.short }))]}
          />
          {data?.processing > 0 && (
            <button className="notice mt" style={{ width: '100%', textAlign: 'left' }} onClick={() => nav('/orders')}>
              有 {data.processing} 个作品正在制作中，点击查看进度 ›
            </button>
          )}
          <div className="mt">
            {loading && !data ? (
              <Spinner />
            ) : error ? (
              <ErrorBox error={error} onRetry={reload} />
            ) : !data.list.length ? (
              <Empty text="当前分类暂无作品">
                <button className="btn btn-ghost btn-sm" onClick={() => nav('/')}>
                  去首页挑一个模板
                </button>
              </Empty>
            ) : (
              <>
                <div className="works-grid">
                  {data.list.map((w) => (
                    <button key={w.id} className="work" onClick={() => nav(`/orders/${w.id}`)}>
                      {w.resultKind === 'video' ? <video src={w.resultUrl} muted playsInline preload="metadata" /> : <img src={w.resultUrl} alt="" loading="lazy" />}
                      {w.resultKind === 'video' && <span className="play badge badge-mute">▶ 视频</span>}
                      <div className="cap">
                        <div className="ellipsis">{w.templateTitle}</div>
                        <div className="muted small">{w.finishedAt?.slice(0, 16)}</div>
                      </div>
                    </button>
                  ))}
                </div>
                <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
