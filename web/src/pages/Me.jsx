import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { get } from '../api.js';
import { useApp } from '../ctx.jsx';
import { ORDER_STATUS, ROLE_NAMES, shortTime } from '../format.js';
import { openLogin } from '../components/LoginModal.jsx';
import CharacterList from '../components/CharacterList.jsx';
import { Badge, Empty, ErrorBox, Pager, Spinner, StatusBadge, Tabs, confirm, downloadFile, toast, useBusy, useLoad } from '../ui.jsx';

const ICONS = [
  { to: '/orders', icon: '/origin/icon-order.png', label: '订单' },
  { to: '/favorites', icon: '/origin/icon-favorite.png', label: '收藏' },
  { to: '/prints', icon: '/origin/icon-print.png', label: '打印凭证' },
  { to: '/points', icon: '/origin/icon-redeem.png', label: '消费记录' },
  { to: '/tickets', icon: '/origin/icon-service.png', label: '客服' },
];

function MyWorks() {
  const nav = useNavigate();
  const [status, setStatus] = useState('works');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/orders', { status, page, size: 12 }), [status, page]);
  return (
    <div className="stack">
      <Tabs
        small
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
        items={[
          { value: 'works', label: '全部' },
          { value: 'making', label: '制作中' },
          { value: 'SUCCESS', label: '已完成' },
          { value: 'FAILED', label: '失败' },
        ]}
      />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.list.length ? (
        <Empty text="当前分类暂无作品" />
      ) : (
        <>
          <div className="works-grid">
            {data.list.map((o) => (
              <div key={o.id} className="work">
                <button style={{ padding: 0, border: 0, background: 'none', width: '100%', display: 'block' }} onClick={() => nav(`/orders/${o.id}`)}>
                  {o.status === 'SUCCESS' && o.resultKind === 'video' ? (
                    <video src={o.resultUrl} muted playsInline preload="metadata" />
                  ) : (
                    <img src={o.status === 'SUCCESS' ? o.resultUrl : o.templateCover} alt="" loading="lazy" style={o.status === 'SUCCESS' ? undefined : { opacity: 0.45 }} />
                  )}
                </button>
                <span className="status-tag">
                  <StatusBadge map={ORDER_STATUS} status={o.status} />
                </span>
                <div className="cap row-between">
                  <div className="grow">
                    <div className="ellipsis">{o.templateTitle}</div>
                    <div className="muted small">{['QUEUED', 'PROCESSING'].includes(o.status) ? `${o.progress}% · ${o.stage}` : shortTime(o.createdAt)}</div>
                  </div>
                  {o.status === 'SUCCESS' && (
                    <button className="btn btn-ghost btn-xs" onClick={() => downloadFile(o.resultUrl)}>
                      保存
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function MyTemplates() {
  const [adding, setAdding] = useState(false);
  return (
    <div className="stack">
      <button className="btn btn-ghost" onClick={() => setAdding(true)}>
        ＋ 上传人物模板
      </button>
      <CharacterList adding={adding} onAddingChange={setAdding} />
    </div>
  );
}

export default function Me() {
  const nav = useNavigate();
  const { user, merchantScene, logout } = useApp();
  const [tab, setTab] = useState('works');
  const [busy, run] = useBusy();

  const doLogout = () =>
    run(async () => {
      if (!(await confirm({ title: '退出登录', message: '确定退出当前账号吗？', okText: '确认退出' }))) return;
      await logout();
      toast('已退出登录');
    });
  const guard = (to) => (e) => {
    if (!user) {
      e.preventDefault();
      openLogin({ onSuccess: () => nav(to) });
    }
  };

  return (
    <div>
      <div className="me-hero">
        <img src="/origin/profile-hero.jpg" alt="" />
        <div className="profile">
          <div className="avatar">
            <img src="/origin/avatar-default.png" alt="" />
          </div>
          <div className="grow">
            {user ? (
              <>
                <div className="row">
                  <h2 style={{ fontSize: 19 }}>{user.nickname}</h2>
                  <Badge tone={user.role === 'visitor' ? 'mute' : 'gold'}>{ROLE_NAMES[user.role]}</Badge>
                </div>
                <p className="small muted">
                  账号 {user.username} · 用户 #{user.id}
                </p>
              </>
            ) : (
              <>
                <button className="link-btn" style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }} onClick={() => openLogin()}>
                  账号登录 ›
                </button>
                <p className="small muted">欢迎～影小沐新朋友</p>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="section stack" style={{ paddingTop: 4 }}>
        <div className="icon-row">
          {ICONS.map((i) => (
            <Link key={i.to} to={i.to} onClick={guard(i.to)}>
              <img src={i.icon} alt="" />
              <span>{i.label}</span>
            </Link>
          ))}
        </div>

        <Link className="banner-link" to="/orders" onClick={guard('/orders')}>
          <span>
            <b>按次体验 · 无需充值</b>
          </span>
          <span className="small muted">消费订单与退款记录 ›</span>
        </Link>

        {user && (user.role === 'merchant' || user.role === 'admin') && (
          <div className="menu">
            {user.role === 'admin' && (
              <Link to="/admin">
                <span className="mi-icon">⚙</span>
                <span>管理中心</span>
                <span className="muted small">全平台管理</span>
                <span className="mi-arrow">›</span>
              </Link>
            )}
            <Link to="/merchant">
              <span className="mi-icon">🏪</span>
              <span>商户工作台</span>
              <span className="muted small">{merchantScene ? merchantScene.name : '尚未绑定景区'}</span>
              <span className="mi-arrow">›</span>
            </Link>
          </div>
        )}

        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'works', label: '我的作品' },
            { value: 'templates', label: '我的模板' },
          ]}
        />
        {!user ? (
          <Empty text="登录后查看作品">
            <button className="btn btn-primary btn-sm" onClick={() => openLogin()}>
              登录
            </button>
          </Empty>
        ) : tab === 'works' ? (
          <MyWorks />
        ) : (
          <MyTemplates />
        )}
        <Link to="/orders" className="small" style={{ textAlign: 'center' }} onClick={guard('/orders')}>
          查看全部订单与制作详情 ›
        </Link>

        <div className="menu">
          <Link to="/agreement">
            <span className="mi-icon">📄</span>
            <span>用户协议与隐私政策</span>
            <span className="mi-arrow">›</span>
          </Link>
          {user && (
            <button className="menu-item" onClick={doLogout} disabled={busy}>
              <span className="mi-icon">⎋</span>
              <span className="bad">退出登录</span>
            </button>
          )}
        </div>
        <p className="small muted" style={{ textAlign: 'center' }}>
          当前均为模拟支付，未发生实际扣款。失败订单自动模拟退款。
        </p>
      </div>
    </div>
  );
}
