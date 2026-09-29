import { useState } from 'react';
import { get, put } from '../../api.js';
import { SERVICE_TYPES, yuan, yuanPlain } from '../../format.js';
import UsageTable from '../../components/UsageTable.jsx';
import PrintDesk from '../../components/PrintDesk.jsx';
import CodesPanel from '../../components/CodesPanel.jsx';
import { TicketTable, TicketThread } from '../Tickets.jsx';
import { ErrorBox, Header, Modal, Pager, Spinner, Stat, toast, useBusy, useLoad } from '../../ui.jsx';
import ScenesPanel from './Scenes.jsx';
import TemplatesPanel from './Templates.jsx';
import UsersPanel from './Users.jsx';
import { OrdersPanel, PurchasesPanel, WithdrawalsPanel } from './Finance.jsx';

const NAV = [
  ['overview', '平台总览'],
  ['scenes', '景区与商户'],
  ['withdrawals', '提现审核'],
  ['templates', '模板管理'],
  ['users', '账号权限'],
  ['orders', '消费流水'],
  ['purchases', '额度销售'],
  ['usage', '模板使用'],
  ['prints', '打印履约'],
  ['codes', '兑换码'],
  ['settings', '成本设置'],
  ['tickets', '客服工作台'],
  ['audit', '审计日志'],
];

function SceneSelect({ scenes, value, onChange, allowAll = true }) {
  return (
    <select className="select" style={{ maxWidth: 240 }} value={value || ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowAll && <option value="">全部景区</option>}
      {scenes.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

function Overview({ sceneId }) {
  const { data, error, reload } = useLoad(() => get('/admin/overview', { sceneId }), [sceneId]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <div className="stack">
      <div className="stats">
        <Stat label="游客成功消费" value={yuan(data.orders.revenue)} tone="gold" sub={`${data.orders.success} 单`} />
        <Stat label="成功订单标准成本" value={yuan(data.orders.cost)} />
        <Stat label="平台模拟额度销售收入" value={yuan(data.quotaSales)} tone="ok" />
        <Stat label="失败退款" value={yuan(data.orders.refunded)} sub={`${data.orders.failed} 单`} />
        <Stat label="制作中" value={data.orders.processing} />
        <Stat label="待审核 / 待打款提现" value={data.withdrawals.pending} sub={`累计打款 ${yuan(data.withdrawals.paid)}`} />
        <Stat label="待处理工单" value={data.tickets} />
        {!sceneId && <Stat label="账号" value={data.users.visitor + data.users.merchant + data.users.admin} sub={`游客 ${data.users.visitor} · 商户 ${data.users.merchant} · 管理员 ${data.users.admin}`} />}
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>服务</th>
              <th className="num">成功</th>
              <th className="num">失败</th>
              <th className="num">游客消费</th>
              <th className="num">标准单价成本</th>
              <th className="num">标准成本合计</th>
              <th className="num">额度销售</th>
            </tr>
          </thead>
          <tbody>
            {data.byType.map((t) => (
              <tr key={t.type}>
                <td>{t.name}</td>
                <td className="num">{t.success}</td>
                <td className="num">{t.failed}</td>
                <td className="num gold">{yuan(t.revenue)}</td>
                <td className="num">{yuan(t.standardCost)}</td>
                <td className="num">{yuan(t.cost)}</td>
                <td className="num">
                  {yuan(t.quotaSales)} <span className="muted small">/ {t.quotaCount} 次</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted">
        成本按设置的标准单价在下单时快照核算，不代表模型供应商结算账单。AI 提供方：
        {Object.entries(data.runtime.providers)
          .map(([k, v]) => `${k}=${v}`)
          .join('，')}
        ；ffmpeg {data.runtime.ffmpeg ? '可用' : '不可用'}。
      </p>
    </div>
  );
}

function Settings() {
  const { data, error, reload } = useLoad(() => get('/admin/settings'), []);
  const [form, setForm] = useState(null);
  const [busy, run] = useBusy();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  const f = form || {
    costs: Object.fromEntries(SERVICE_TYPES.map((t) => [t, yuanPlain(data.costs[t])])),
    mockFailRate: String(data.mockFailRate),
    captchaEnabled: data.captchaEnabled,
  };
  const save = () =>
    run(async () => {
      await put('/admin/settings', f);
      toast('已保存', 'ok');
      setForm(null);
      reload();
    });
  const names = { CHECKIN: '打卡合拍', OUTFIT_PHOTO: 'AI换装照片', OUTFIT_VIDEO: 'AI换装视频' };
  return (
    <div className="card stack" style={{ maxWidth: 560 }}>
      <h3>标准成本（元 / 次）</h3>
      <p className="small muted">新订单下单时记录当时的标准成本，用于核算成功订单的成本；修改不影响历史订单。</p>
      {SERVICE_TYPES.map((t) => (
        <div className="field" key={t}>
          <label>{names[t]}</label>
          <input className="input" inputMode="decimal" value={f.costs[t]} onChange={(e) => setForm({ ...f, costs: { ...f.costs, [t]: e.target.value } })} />
        </div>
      ))}
      <div className="divider" />
      <h3>模拟 AI 失败率（%）</h3>
      <p className="small muted">仅对本地模拟生成生效，用于测试“制作失败自动退款并回补次数”。0 表示从不失败。</p>
      <input className="input" inputMode="numeric" value={f.mockFailRate} onChange={(e) => setForm({ ...f, mockFailRate: e.target.value.replace(/\D/g, '') })} />
      <div className="divider" />
      <div className="row-between">
        <div>
          <h3>登录 / 注册验证码</h3>
          <p className="small muted">开启后登录与注册需要输入图形验证码。</p>
        </div>
        <label className="switch">
          <input type="checkbox" checked={!!f.captchaEnabled} onChange={(e) => setForm({ ...f, captchaEnabled: e.target.checked })} />
          <span />
        </label>
      </div>
      <button className="btn btn-primary" onClick={save} disabled={busy}>
        保存设置
      </button>
    </div>
  );
}

function Audit() {
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(() => get('/admin/audit', { page }), [page]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <Spinner />;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作者</th>
              <th>操作</th>
              <th>对象</th>
              <th>详情</th>
            </tr>
          </thead>
          <tbody>
            {data.list.map((a) => (
              <tr key={a.id}>
                <td className="small">{a.created_at}</td>
                <td>{a.username || `#${a.actor_id}`}</td>
                <td>{a.action}</td>
                <td className="small">{a.target}</td>
                <td className="small muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
    </>
  );
}

function Tickets({ sceneId }) {
  const [openId, setOpenId] = useState(null);
  const [key, setKey] = useState(0);
  return (
    <>
      <TicketTable key={`${key}-${sceneId}`} scope="handle" sceneId={sceneId} onOpen={(t) => setOpenId(t.id)} />
      <Modal
        open={!!openId}
        wide
        title="处理工单"
        onClose={() => {
          setOpenId(null);
          setKey((k) => k + 1);
        }}
      >
        {openId && <TicketThread id={openId} />}
      </Modal>
    </>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('overview');
  const [sceneId, setSceneId] = useState(null);
  const scenes = useLoad(() => get('/admin/scenes'), []);
  const scoped = ['overview', 'withdrawals', 'orders', 'purchases', 'usage', 'tickets', 'templates', 'prints', 'codes'].includes(tab);
  const usageScene = sceneId || scenes.data?.[0]?.id;

  return (
    <div>
      <Header title="管理中心" />
      <div className="console">
        <nav className="console-nav">
          {NAV.map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              <span>{label}</span>
              {k === 'withdrawals' && scenes.data && scenes.data.reduce((n, s) => n + s.pendingWithdrawals, 0) > 0 && (
                <span className="tab-count">{scenes.data.reduce((n, s) => n + s.pendingWithdrawals, 0)}</span>
              )}
            </button>
          ))}
        </nav>
        <main className="console-main stack">
          {scoped && scenes.data && (
            <div className="row wrap">
              <span className="small muted">管理景区</span>
              <SceneSelect scenes={scenes.data} value={tab === 'usage' ? usageScene : sceneId} onChange={setSceneId} allowAll={tab !== 'usage'} />
            </div>
          )}
          {tab === 'overview' && <Overview sceneId={sceneId} />}
          {tab === 'scenes' && <ScenesPanel scenes={scenes} />}
          {tab === 'withdrawals' && <WithdrawalsPanel sceneId={sceneId} onChange={scenes.reload} />}
          {tab === 'templates' && scenes.data && <TemplatesPanel sceneId={sceneId} scenes={scenes.data} />}
          {tab === 'users' && <UsersPanel />}
          {tab === 'orders' && <OrdersPanel sceneId={sceneId} />}
          {tab === 'purchases' && <PurchasesPanel sceneId={sceneId} />}
          {tab === 'usage' && usageScene && <UsageTable key={usageScene} showCost load={(days) => get(`/admin/scenes/${usageScene}/template-usage`, { days })} />}
          {tab === 'prints' && <PrintDesk sceneId={sceneId} />}
          {tab === 'codes' && <CodesPanel sceneId={sceneId} />}
          {tab === 'settings' && <Settings />}
          {tab === 'tickets' && <Tickets sceneId={sceneId} />}
          {tab === 'audit' && <Audit />}
        </main>
      </div>
    </div>
  );
}
