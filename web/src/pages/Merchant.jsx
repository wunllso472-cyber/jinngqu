import { useState } from 'react';
import { get, post, put } from '../api.js';
import { useApp } from '../ctx.jsx';
import { ORDER_STATUS, PURCHASE_STATUS, SERVICE_META, WITHDRAW_STATUS, shortTime, yuan, yuanPlain } from '../format.js';
import UsageTable from '../components/UsageTable.jsx';
import PrintDesk from '../components/PrintDesk.jsx';
import CodesPanel from '../components/CodesPanel.jsx';
import QuotaLogTable from '../components/QuotaLogTable.jsx';
import ServiceSettingsFields, { serviceSettingsForm } from '../components/ServiceSettingsFields.jsx';
import { TicketDesk } from './Tickets.jsx';
import { Badge, Empty, ErrorBox, Header, Modal, Pager, Spinner, Stat, StatusBadge, Tabs, confirm, toast, useBusy, useLoad } from '../ui.jsx';

const NAV = [
  ['quota', '经营与额度'],
  ['usage', '模板使用'],
  ['orders', '消费流水'],
  ['wallet', '收入与提现'],
  ['prints', '打印履约'],
  ['codes', '兑换码'],
  ['tickets', '客服工单'],
  ['settings', '服务设置'],
];

// ---------------- 额度 ----------------
function QuotaPanel({ ov, reloadOv }) {
  const [count, setCount] = useState('10');
  const [pending, setPending] = useState(null); // 待支付的购买单
  const [busy, run] = useBusy();
  const [page, setPage] = useState(1);
  const purchases = useLoad(() => get('/merchant/purchases', { page, size: 8 }), [page]);

  // 按“每次购买数量”直接下单，随后弹出模拟支付
  const quickBuy = (s) =>
    run(async () => {
      const n = Number(count);
      if (!Number.isInteger(n) || n < 1 || n > 10000) return toast('购买次数须为 1–10000 的整数', 'bad');
      setPending(await post('/merchant/purchases', { serviceType: s.type, count: n }));
    });
  const pay = (p) =>
    run(async () => {
      await post(`/merchant/purchases/${p.id}/pay`);
      toast(`模拟支付成功，已增加 ${p.count} 次`, 'ok');
      setPending(null);
      reloadOv();
      purchases.reload();
    });
  const cancel = (p) =>
    run(async () => {
      await post(`/merchant/purchases/${p.id}/cancel`);
      setPending(null);
      purchases.reload();
    });

  const svcList = ov.scene.services;
  return (
    <div className="stack">
      <div className="row-between wrap">
        <div>
          <h2 style={{ fontSize: 20 }}>{ov.scene.name}</h2>
          <p className="small muted">
            景区状态：{ov.scene.status === 'ACTIVE' ? <span className="ok">营业中</span> : <span className="bad">已暂停，所有服务停止接单</span>} · 上架模板 {ov.templates} 个
          </p>
        </div>
      </div>
      <div className="stats">
        <Stat label="成功制作" value={ov.wallet.successCount} sub={`今日 ${ov.today.count} 次`} />
        <Stat label="模拟消费金额" value={yuan(ov.wallet.income)} tone="gold" sub={`今日 ${yuan(ov.today.amount)}`} />
        <Stat label="模拟退款" value={yuan(ov.wallet.refunded)} sub={`${ov.wallet.refundedCount} 单`} />
        <Stat label="模拟可提现" value={yuan(ov.wallet.available)} tone="ok" />
        <Stat label="制作中 · 待结算" value={yuan(ov.wallet.pending)} sub={`${ov.wallet.pendingCount} 单`} />
      </div>
      <p className="small muted">模拟交易环境 · 实际收款 ¥0.00。景区商户：{ov.scene.merchant?.username}</p>
      <div className="row-between mt wrap">
        <h3>景区服务额度</h3>
        <div className="row">
          <span className="small muted">每次购买数量</span>
          <input className="input" style={{ width: 90, minHeight: 32, height: 32 }} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
      <p className="small muted" style={{ marginTop: -6 }}>
        额度绑定景区，不跨景区使用。游客付款时扣 1 次，制作失败自动退回；次数耗尽后该服务自动停止接单。
      </p>
      <div className="grid-3">
        {svcList.map((s) => (
          <div key={s.type} className="card quota-card">
            <div className="row-between">
              <span style={{ fontWeight: 650 }}>
                {SERVICE_META[s.type].icon} {s.name}
              </span>
              {!s.enabled ? <Badge tone="mute">已停用</Badge> : s.quota <= 0 ? <Badge tone="bad">额度耗尽</Badge> : s.lowQuota ? <Badge tone="warn">不足5次</Badge> : <Badge tone="ok">服务可用</Badge>}
            </div>
            <div>
              <span className="quota-num">{s.quota}</span> <span className="muted small">次可用</span>
            </div>
            <div className="small muted">
              游客价 {yuan(s.visitorPrice)} / 次 · 商户价 {yuan(s.merchantPrice)} / 次
            </div>
            {s.quota <= 0 && s.enabled && <div className="small bad">额度耗尽，服务已自动停止</div>}
            <button className="btn btn-primary btn-sm" onClick={() => quickBuy(s)} disabled={busy || !Number(count)}>
              购买 {Number(count) || 0} 次 · {yuan(s.merchantPrice * (Number(count) || 0))}
            </button>
          </div>
        ))}
      </div>

      <h3 className="mt">景区额度购买流水</h3>
      {purchases.loading && !purchases.data ? (
        <Spinner />
      ) : purchases.error ? (
        <ErrorBox error={purchases.error} onRetry={purchases.reload} />
      ) : !purchases.data.list.length ? (
        <p className="small muted">尚未购买额度</p>
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>单号</th>
                  <th>服务</th>
                  <th className="num">次数</th>
                  <th className="num">金额</th>
                  <th>状态</th>
                  <th>时间</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {purchases.data.list.map((p) => (
                  <tr key={p.id}>
                    <td className="small">{p.purchaseNo}</td>
                    <td>{p.serviceName}</td>
                    <td className="num">{p.count}</td>
                    <td className="num">{yuan(p.amount)}</td>
                    <td>
                      <StatusBadge map={PURCHASE_STATUS} status={p.status} />
                    </td>
                    <td className="small">{shortTime(p.createdAt)}</td>
                    <td>
                      {p.status === 'PENDING' && (
                        <button className="btn btn-primary btn-xs" onClick={() => setPending(p)}>
                          去支付
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={purchases.data.page} size={purchases.data.size} total={purchases.data.total} onChange={setPage} />
        </>
      )}

      <h3 className="mt">次数变动明细</h3>
      <QuotaLogTable path="/merchant/quota-logs" version={ov.scene.services.map((s) => s.quota).join()} />

      <Modal
        open={!!pending}
        sheet
        onClose={() => setPending(null)}
        title="模拟支付"
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => cancel(pending)} disabled={busy}>
              取消订单
            </button>
            <button className="btn btn-primary" onClick={() => pay(pending)} disabled={busy}>
              确认模拟支付
            </button>
          </>
        }
      >
        {pending && (
          <div className="stack">
            <div className="pay-amount">{yuan(pending.amount)}</div>
            <div className="kv">
              <span>单号</span>
              <span className="small">{pending.purchaseNo}</span>
              <span>服务</span>
              <span>{pending.serviceName}</span>
              <span>次数</span>
              <span>{pending.count} 次</span>
            </div>
            <p className="notice">模拟交易环境 · 无实际扣款</p>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------- 消费流水 ----------------
function OrdersPanel() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/merchant/orders', { status, page }), [status, page]);
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
          { value: '', label: '全部' },
          { value: 'SUCCESS', label: '成功' },
          { value: 'PROCESSING', label: '制作中' },
          { value: 'FAILED', label: '失败退款' },
        ]}
      />
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.list.length ? (
        <Empty text="本景区暂无消费记录" />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>游客</th>
                  <th>服务 / 模板</th>
                  <th className="num">金额</th>
                  <th>状态</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {data.list.map((o) => (
                  <tr key={o.id}>
                    <td className="small">{o.orderNo}</td>
                    <td>用户 #{o.user?.id}</td>
                    <td>
                      {o.serviceName} · {o.templateTitle}
                    </td>
                    <td className="num">
                      {yuan(o.amount)}
                      {o.refundAmount > 0 && <div className="small bad">退款 {yuan(o.refundAmount)}</div>}
                    </td>
                    <td>
                      <StatusBadge map={ORDER_STATUS} status={o.status} />
                    </td>
                    <td className="small">{shortTime(o.paidAt || o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} size={data.size} total={data.total} onChange={setPage} />
        </>
      )}
    </div>
  );
}

// ---------------- 收入与提现 ----------------
function WalletPanel({ reloadOv }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useLoad(() => get('/merchant/wallet', { page }), [page]);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, run] = useBusy();
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const w = data.wallet;

  const apply = () =>
    run(async () => {
      if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) return toast('请输入大于0的金额，最多两位小数', 'bad');
      await post('/merchant/withdrawals', { amount, note });
      toast('提现申请已提交，等待管理员审核', 'ok');
      setOpen(false);
      setAmount('');
      setNote('');
      reload();
      reloadOv();
    });
  const cancel = (x) =>
    run(async () => {
      if (!(await confirm({ title: '撤销申请', message: `撤销提现申请 ${yuan(x.amount)}？冻结金额将释放回可提现余额。` }))) return;
      await post(`/merchant/withdrawals/${x.id}/cancel`);
      toast('已撤销');
      reload();
      reloadOv();
    });

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="模拟可提现" value={yuan(w.available)} tone="ok" />
        <Stat label="申请冻结" value={yuan(w.frozen)} />
        <Stat label="累计模拟提现" value={yuan(w.withdrawn)} />
        <Stat label="游客成功消费" value={yuan(w.income)} tone="gold" sub={`${w.successCount} 单`} />
        <Stat label="制作中 · 待结算" value={yuan(w.pending)} sub={`${w.pendingCount} 单`} />
        <Stat label="额度购买支出" value={yuan(w.quotaSpend)} />
      </div>
      <p className="notice">游客成功制作的付款归景区商户；购买服务额度是独立支出，不从收入中重复扣除。当前全部为模拟金额，真实可提现 ¥0.00。</p>
      <button className="btn btn-primary" onClick={() => setOpen(true)} disabled={w.available <= 0}>
        申请模拟提现
      </button>

      <h3 className="mt">提现记录</h3>
      {!data.withdrawals.list.length ? (
        <p className="small muted">暂无提现记录</p>
      ) : (
        <div className="list">
          {data.withdrawals.list.map((x) => (
            <div key={x.id} className="list-item">
              <div className="row-between">
                <span style={{ fontWeight: 650 }}>
                  提现 #{x.id} · {yuan(x.amount)}
                </span>
                <StatusBadge map={WITHDRAW_STATUS} status={x.status} />
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {x.withdrawalNo} · 申请于 {shortTime(x.createdAt)}
                {x.paidAt && ` · 打款于 ${shortTime(x.paidAt)}`}
              </div>
              {x.note && <div className="small muted">申请备注：{x.note}</div>}
              {x.reviewNote && <div className="small">审核备注：{x.reviewNote}</div>}
              {x.status === 'REQUESTED' && (
                <button className="btn btn-ghost btn-xs mt" onClick={() => cancel(x)} disabled={busy}>
                  撤销申请
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <Pager page={data.withdrawals.page} size={data.withdrawals.size} total={data.withdrawals.total} onChange={setPage} />

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="申请模拟提现"
        footer={
          <button className="btn btn-primary" onClick={apply} disabled={busy}>
            提交申请
          </button>
        }
      >
        <div className="stack">
          <p className="small muted">可提现余额 {yuan(w.available)}，提交后金额将被冻结，待管理员审核并模拟打款。</p>
          <div className="field">
            <label>提现金额（元）</label>
            <div className="row">
              <input className="input grow" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="例如 10.00" />
              <button className="btn btn-ghost btn-sm" onClick={() => setAmount(yuanPlain(w.available))}>
                全部
              </button>
            </div>
          </div>
          <div className="field">
            <label>申请备注</label>
            <input className="input" maxLength={100} value={note} onChange={(e) => setNote(e.target.value)} placeholder="选填，无需填写真实银行账户" />
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ---------------- 服务设置 ----------------
function SettingsPanel({ ov, reloadOv }) {
  const [form, setForm] = useState(() => serviceSettingsForm(ov.scene));
  const [busy, run] = useBusy();
  const save = () =>
    run(async () => {
      if (form.printEnabled && !form.pickupAddress.trim()) return toast('开放打印申请时必须填写取件地点', 'bad');
      await put('/merchant/settings', { ...form, expectMerchantId: ov.scene.merchant?.id });
      toast('已保存', 'ok');
      reloadOv();
    });
  return (
    <div className="card stack" style={{ maxWidth: 520 }}>
      <h3>现场服务设置</h3>
      <p className="small muted">以下信息展示在景区首页底部，方便游客联系。</p>
      <ServiceSettingsFields form={form} setForm={setForm} />
      <button className="btn btn-primary" onClick={save} disabled={busy}>
        保存设置
      </button>
    </div>
  );
}

export default function Merchant() {
  const { refresh } = useApp();
  const [tab, setTab] = useState('quota');
  const ov = useLoad(() => get('/merchant/overview'), []);

  if (ov.error) return (<><Header title="商户管理" /><ErrorBox error={ov.error} onRetry={ov.reload} /></>);
  if (!ov.data) return (<><Header title="商户管理" /><Spinner /></>);
  if (!ov.data.bound) {
    return (
      <>
        <Header title="商户管理" />
        <Empty text="尚未绑定景区，请联系管理员">
          <button className="btn btn-ghost btn-sm" onClick={() => (refresh(), ov.reload())}>
            刷新状态
          </button>
        </Empty>
      </>
    );
  }

  return (
    <div>
      <Header title={`商户管理 · ${ov.data.scene.name}`} />
      <div className="console">
        <nav className="console-nav">
          {NAV.map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </nav>
        <main className="console-main">
          {tab === 'quota' && <QuotaPanel ov={ov.data} reloadOv={ov.reload} />}
          {tab === 'usage' && <UsageTable load={(days) => get('/merchant/template-usage', { days })} />}
          {tab === 'orders' && <OrdersPanel />}
          {tab === 'wallet' && <WalletPanel reloadOv={ov.reload} />}
          {tab === 'prints' && <PrintDesk />}
          {tab === 'codes' && <CodesPanel />}
          {tab === 'tickets' && <TicketDesk />}
          {tab === 'settings' && <SettingsPanel ov={ov.data} reloadOv={ov.reload} />}
        </main>
      </div>
    </div>
  );
}
