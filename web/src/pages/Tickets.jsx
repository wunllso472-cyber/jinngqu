import { useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { get, post } from '../api.js';
import { useApp } from '../ctx.jsx';
import { ROLE_NAMES, TICKET_STATUS } from '../format.js';
import { Empty, ErrorBox, Header, Pager, Spinner, StatusBadge, Tabs, confirm, toast, useBusy, useLoad } from '../ui.jsx';

/** 工单列表，scope=mine（游客）或 handle（商户/管理员处理） */
export function TicketTable({ scope = 'mine', sceneId, onOpen }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/tickets', { scope, status, page, sceneId }), [scope, status, page, sceneId]);
  return (
    <div>
      <div className="row-between">
        <Tabs
          small
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          items={[{ value: '', label: '全部' }, ...Object.entries(TICKET_STATUS).map(([k, v]) => ({ value: k, label: v.text }))]}
        />
        <button className="btn btn-ghost btn-xs" onClick={reload}>
          刷新
        </button>
      </div>
      <div className="list mt">
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data.list.length ? (
          <Empty text="暂无工单" />
        ) : (
          data.list.map((t) => (
            <button key={t.id} className="list-item" style={{ textAlign: 'left' }} onClick={() => onOpen(t)}>
              <div className="row-between">
                <span className="ellipsis" style={{ fontWeight: 600 }}>
                  工单 #{t.id} · {t.title}
                </span>
                <StatusBadge map={TICKET_STATUS} status={t.status} />
              </div>
              <div className="small muted ellipsis mt" style={{ marginTop: 4 }}>
                {t.lastMessage}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {scope === 'handle' && `${t.user?.nickname || t.user?.username} · `}
                {t.scene?.name || '平台'}
                {t.order && ` · 订单 ${t.order.orderNo}`} · {t.handler === 'merchant' ? '商户处理' : '平台客服'} · {t.updatedAt.slice(5, 16)}
              </div>
            </button>
          ))
        )}
      </div>
      {data && <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />}
    </div>
  );
}

export function TicketList() {
  const nav = useNavigate();
  return (
    <div>
      <Header
        title="客服与反馈"
        right={
          <button className="btn btn-primary btn-xs" onClick={() => nav('/tickets/new')}>
            ＋ 提交
          </button>
        }
      />
      <div className="section">
        <TicketTable scope="mine" onOpen={(t) => nav(`/tickets/${t.id}`)} />
      </div>
    </div>
  );
}

export function TicketNew() {
  const nav = useNavigate();
  const loc = useLocation();
  const { sceneId } = useApp();
  const orderId = loc.state?.orderId;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [busy, run] = useBusy();
  const submit = () =>
    run(async () => {
      if (!title.trim() || !content.trim()) return toast('请填写问题标题和内容', 'bad');
      const t = await post('/tickets', { title, content, orderId, sceneId });
      toast('工单已提交', 'ok');
      nav(`/tickets/${t.id}`, { replace: true });
    });
  return (
    <div>
      <Header title="提交工单" />
      <div className="section stack">
        <div className="notice">{orderId ? `关联订单 ${loc.state.orderNo}，将交由订单所属景区商户处理。` : '提交至平台客服，由管理员处理。'}</div>
        <div className="field">
          <label>问题标题</label>
          <input className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：作品下载失败" />
        </div>
        <div className="field">
          <label>详细描述</label>
          <textarea className="textarea" maxLength={2000} rows={6} value={content} onChange={(e) => setContent(e.target.value)} placeholder="描述问题、发生时间及需要的帮助" />
        </div>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          提交工单
        </button>
      </div>
    </div>
  );
}

/** 工单对话，游客与处理人共用 */
export function TicketThread({ id }) {
  const { data: t, error, reload } = useLoad(() => get(`/tickets/${id}`), [id]);
  const [text, setText] = useState('');
  const [busy, run] = useBusy();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!t) return <Spinner />;

  const send = () =>
    run(async () => {
      if (!text.trim()) return;
      await post(`/tickets/${id}/messages`, { content: text });
      setText('');
      await reload();
    });
  const close = () =>
    run(async () => {
      if (!(await confirm({ title: '关闭工单', message: '确认当前问题已处理，关闭工单？' }))) return;
      await post(`/tickets/${id}/close`);
      await reload();
    });
  const reopen = () =>
    run(async () => {
      await post(`/tickets/${id}/reopen`);
      await reload();
    });

  return (
    <div className="stack">
      <div className="card card-tight">
        <div className="row-between">
          <h3>{t.title}</h3>
          <StatusBadge map={TICKET_STATUS} status={t.status} />
        </div>
        <p className="small muted mt" style={{ marginTop: 4 }}>
          工单 #{t.id} · {t.scene?.name || '平台'}
          {t.order && ` · 关联订单 ${t.order.orderNo}`} · {t.handler === 'merchant' ? '由景区商户处理' : '由平台客服处理'}
        </p>
      </div>
      <div className="chat">
        {t.messages.map((m) => (
          <div key={m.id} className={`msg ${m.mine ? 'mine' : ''}`}>
            {m.content}
            <div className="msg-meta">
              {m.senderRole === 'visitor' ? '游客留言' : `${ROLE_NAMES[m.senderRole]}回复`} · {m.createdAt.slice(5, 16)}
            </div>
          </div>
        ))}
      </div>
      {t.status === 'CLOSED' ? (
        <button className="btn btn-ghost" onClick={reopen} disabled={busy}>
          重新打开工单
        </button>
      ) : (
        <>
          <textarea className="textarea" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="输入回复，最多2000字" />
          <div className="row">
            <button className="btn btn-ghost" onClick={close} disabled={busy}>
              关闭工单
            </button>
            <button className="btn btn-primary grow" onClick={send} disabled={busy || !text.trim()}>
              发送回复
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function TicketDetail() {
  const { id } = useParams();
  return (
    <div>
      <Header title="工单详情" />
      <div className="section">
        <TicketThread id={id} />
      </div>
    </div>
  );
}
