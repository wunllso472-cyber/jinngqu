import { useState } from 'react';
import { post, put } from '../../api.js';
import { SERVICE_META, yuan, yuanPlain } from '../../format.js';
import QuotaLogTable from '../../components/QuotaLogTable.jsx';
import ServiceSettingsFields, { serviceSettingsForm } from '../../components/ServiceSettingsFields.jsx';
import { Badge, ErrorBox, ImagePick, Modal, Spinner, confirm, toast, useBusy } from '../../ui.jsx';

function ServiceRow({ scene, s, onSaved, buyCount }) {
  const [edit, setEdit] = useState(false);
  const [vp, setVp] = useState('');
  const [mp, setMp] = useState('');
  const startEdit = () => {
    setVp(yuanPlain(s.visitorPrice));
    setMp(yuanPlain(s.merchantPrice));
    setEdit(true);
  };
  const [adj, setAdj] = useState('');
  const [busy, run] = useBusy();
  const toggle = () =>
    run(async () => {
      onSaved(await put(`/admin/scenes/${scene.id}/services/${s.type}`, { enabled: !s.enabled }));
      toast(!s.enabled ? '服务已启用' : '服务已停用');
    });
  const save = () =>
    run(async () => {
      onSaved(await put(`/admin/scenes/${scene.id}/services/${s.type}`, { visitorPrice: vp, merchantPrice: mp }));
      toast('价格已更新', 'ok');
      setEdit(false);
    });
  const buy = () =>
    run(async () => {
      if (!(await confirm({ title: '购买景区使用额度', message: `为「${scene.name}」购买 ${s.name} ${buyCount} 次，模拟支付 ${yuan(s.merchantPrice * buyCount)}，记在景区商户名下。` }))) return;
      onSaved(await post(`/admin/scenes/${scene.id}/purchase`, { serviceType: s.type, count: buyCount }));
      toast(`已购买 ${buyCount} 次 · 模拟支付成功`, 'ok');
    });
  const adjust = () =>
    run(async () => {
      const delta = Number(adj);
      if (!Number.isInteger(delta) || !delta) return toast('请输入非零整数，负数为扣减', 'bad');
      onSaved(await post(`/admin/scenes/${scene.id}/quota`, { serviceType: s.type, delta, note: '管理员调整' }));
      toast('额度已调整（已写入审计日志）', 'ok');
      setAdj('');
    });
  return (
    <div className="list-item stack" style={{ gap: 8 }}>
      <div className="row-between">
        <span style={{ fontWeight: 650 }}>
          {SERVICE_META[s.type].icon} {s.name}
        </span>
        <label className="switch" title={s.enabled ? '停用' : '启用'}>
          <input type="checkbox" checked={s.enabled} onChange={toggle} disabled={busy} />
          <span />
        </label>
      </div>
      <div className="small muted">
        剩余 <b className="gold">{s.quota}</b> 次 · 用户价 {yuan(s.visitorPrice)} · 商户价 {yuan(s.merchantPrice)} · 成本 {yuan(s.standardCost)} ·{' '}
        {s.available ? <span className="ok">可接单</span> : <span className="bad">{s.reason}</span>}
      </div>
      {edit ? (
        <div className="row wrap">
          <input className="input" style={{ width: 110 }} value={vp} onChange={(e) => setVp(e.target.value)} aria-label="游客价" placeholder="游客价" />
          <input className="input" style={{ width: 110 }} value={mp} onChange={(e) => setMp(e.target.value)} aria-label="商户价" placeholder="商户价" />
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            保存
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setEdit(false)}>
            取消
          </button>
        </div>
      ) : (
        <div className="row wrap">
          {scene.merchant && (
            <button className="btn btn-primary btn-xs" onClick={buy} disabled={busy || !buyCount}>
              购买 {buyCount} 次 · {yuan(s.merchantPrice * buyCount)}
            </button>
          )}
          <button className="btn btn-ghost btn-xs" onClick={startEdit}>
            修改价格
          </button>
          <input className="input" style={{ width: 100, minHeight: 28, height: 28, padding: '0 8px' }} value={adj} onChange={(e) => setAdj(e.target.value)} placeholder="±次数" aria-label="调整次数" />
          <button className="btn btn-ghost btn-xs" onClick={adjust} disabled={busy}>
            调整额度
          </button>
        </div>
      )}
    </div>
  );
}

/** 现场服务设置：联系电话、服务时间、打印开关与取件地点 */
function ServiceSettings({ scene, onSaved }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(null);
  const [busy, run] = useBusy();
  const start = () => {
    setF(serviceSettingsForm(scene));
    setOpen(true);
  };
  const save = () =>
    run(async () => {
      if (f.printEnabled && !f.pickupAddress.trim()) return toast('开放打印申请时必须填写取件地点', 'bad');
      onSaved(await put(`/admin/scenes/${scene.id}/service`, f));
      toast('已保存', 'ok');
      setOpen(false);
    });
  return (
    <>
      <div className="list-item row-between wrap">
        <div className="small">
          <b>现场服务设置</b>
          <div className="muted">
            {scene.servicePhone || '未设置电话'} · {scene.serviceHours || '未设置服务时间'} · 打印{scene.printEnabled ? `已开放（${scene.pickupAddress}）` : '未开放'}
          </div>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={start}>
          编辑
        </button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`现场服务设置 · ${scene.name}`}
        footer={
          <button className="btn btn-primary" onClick={save} disabled={busy}>
            保存设置
          </button>
        }
      >
        {f && (
          <div className="stack">
            <ServiceSettingsFields form={f} setForm={setF} />
          </div>
        )}
      </Modal>
    </>
  );
}

function SceneCard({ scene, onChanged }) {
  const [bindId, setBindId] = useState('');
  const [buyCount, setBuyCount] = useState('10');
  const [showLogs, setShowLogs] = useState(false);
  const [busy, run] = useBusy();
  const update = () => onChanged();

  const toggleScene = () =>
    run(async () => {
      const pause = scene.status === 'ACTIVE';
      if (!(await confirm({ title: pause ? '暂停整个景区' : '恢复整个景区', message: pause ? '暂停后该景区所有服务停止接单，已支付的订单继续制作。' : '恢复后游客可以继续下单。', danger: pause }))) return;
      update(await post(`/admin/scenes/${scene.id}/status`, { status: pause ? 'PAUSED' : 'ACTIVE' }));
      toast(pause ? '景区已暂停' : '景区已恢复');
    });
  const bind = () =>
    run(async () => {
      if (!bindId) return toast('请输入商户用户 ID', 'bad');
      update(await post(`/admin/scenes/${scene.id}/bind`, { merchantUserId: Number(bindId) }));
      toast('商户绑定已更新', 'ok');
      setBindId('');
    });
  const unbind = () =>
    run(async () => {
      if (!(await confirm({ title: '解除商户绑定', message: '必须先结清收入和进行中任务。解除后景区将暂停，历史收入归属不变，景区额度保留。', danger: true, okText: '结清后解除' }))) return;
      update(await post(`/admin/scenes/${scene.id}/unbind`));
      toast('已解除绑定，景区已暂停');
    });

  return (
    <div className="card stack">
      <div className="row-between wrap">
        <div className="row">
          {scene.cover && <img src={scene.cover} alt="" style={{ width: 64, height: 44, objectFit: 'cover', borderRadius: 8 }} />}
          <div>
            <h3>
              {scene.name} <span className="muted small">#{scene.id}</span>
            </h3>
            <div className="small muted">{scene.city}</div>
          </div>
        </div>
        <div className="row">
          {scene.status === 'ACTIVE' ? <Badge tone="ok">营业中</Badge> : <Badge tone="bad">已暂停</Badge>}
          <button className={`btn btn-xs ${scene.status === 'ACTIVE' ? 'btn-danger' : 'btn-ok'}`} onClick={toggleScene} disabled={busy}>
            {scene.status === 'ACTIVE' ? '暂停景区' : '恢复景区'}
          </button>
        </div>
      </div>

      <div className="list-item">
        <div className="row-between wrap">
          <div>
            <div style={{ fontWeight: 650 }}>景区商户</div>
            {scene.merchant ? (
              <div className="small muted">
                {scene.merchant.nickname}（{scene.merchant.username} · 用户 #{scene.merchant.id}）
                {scene.wallet && ` · 可提现 ${yuan(scene.wallet.available)} · 冻结 ${yuan(scene.wallet.frozen)} · 制作中 ${scene.wallet.pendingCount} 单`}
              </div>
            ) : (
              <div className="small bad">尚未绑定，停止接单</div>
            )}
          </div>
          {scene.merchant ? (
            <button className="btn btn-danger btn-xs" onClick={unbind} disabled={busy}>
              解除商户绑定
            </button>
          ) : (
            <div className="row">
              <input className="input" style={{ width: 130, minHeight: 32, height: 32 }} inputMode="numeric" placeholder="商户用户 ID" value={bindId} onChange={(e) => setBindId(e.target.value.replace(/\D/g, ''))} />
              <button className="btn btn-primary btn-xs" onClick={bind} disabled={busy}>
                绑定本景区
              </button>
            </div>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          一景区一商户、一商户一景区。更换商户须先结清原商户收入并解除绑定；订单收入归属不随换绑改变，景区额度保留。
        </p>
      </div>

      <div className="row wrap">
        <span style={{ fontWeight: 650 }}>景区服务额度</span>
        <span className="small muted">每次购买数量</span>
        <input className="input" style={{ width: 90, minHeight: 30, height: 30 }} inputMode="numeric" value={buyCount} onChange={(e) => setBuyCount(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div className="grid-3">
        {scene.services.map((s) => (
          <ServiceRow key={s.type} scene={scene} s={s} onSaved={update} buyCount={Math.min(10000, Number(buyCount) || 0)} />
        ))}
      </div>
      <ServiceSettings scene={scene} onSaved={update} />
      <button className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowLogs((v) => !v)}>
        {showLogs ? '收起额度流水' : '查看额度流水 ›'}
      </button>
      {showLogs && <QuotaLogTable path={`/admin/scenes/${scene.id}/quota-logs`} size={8} version={scene.services.map((s) => s.quota).join()} />}
    </div>
  );
}

function SceneForm({ open, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', subtitle: '', city: '', sort: '0' });
  const [cover, setCover] = useState(null);
  const [busy, run] = useBusy();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () =>
    run(async () => {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (cover) fd.append('cover', cover);
      await post('/admin/scenes', fd);
      toast('景区已创建（默认暂停，绑定商户后可恢复）', 'ok');
      onSaved();
    });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建景区"
      footer={
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          创建
        </button>
      }
    >
      <div className="stack">
        <div className="field">
          <label>景区名称 *</label>
          <input className="input" value={form.name} onChange={set('name')} />
        </div>
        <div className="field">
          <label>一句话介绍</label>
          <input className="input" value={form.subtitle} onChange={set('subtitle')} />
        </div>
        <div className="form-grid">
          <div className="field">
            <label>城市</label>
            <input className="input" value={form.city} onChange={set('city')} />
          </div>
          <div className="field">
            <label>排序（越大越靠前）</label>
            <input className="input" value={form.sort} onChange={set('sort')} />
          </div>
        </div>
        <div style={{ maxWidth: 200 }}>
          <ImagePick label="封面" file={cover} onChange={setCover} />
        </div>
      </div>
    </Modal>
  );
}

export default function ScenesPanel({ scenes }) {
  const [creating, setCreating] = useState(false);
  if (scenes.error) return <ErrorBox error={scenes.error} onRetry={scenes.reload} />;
  if (!scenes.data) return <Spinner />;
  return (
    <div className="stack">
      <div className="row-between">
        <h2 style={{ fontSize: 18 }}>景区与商户权限</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}>
          ＋ 新建景区
        </button>
      </div>
      {scenes.data.map((s) => (
        <SceneCard key={s.id} scene={s} onChanged={scenes.reload} />
      ))}
      <SceneForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          scenes.reload();
        }}
      />
    </div>
  );
}
