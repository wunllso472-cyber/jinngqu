import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, get, post } from '../api.js';
import { SERVICE_META, yuan } from '../format.js';
import CharacterForm from '../components/CharacterForm.jsx';
import { ErrorBox, Header, ImagePick, Modal, Spinner, toast, useBusy, useLoad } from '../ui.jsx';

export default function Create() {
  const { templateId } = useParams();
  const nav = useNavigate();
  const tpl = useLoad(() => get(`/templates/${templateId}`), [templateId]);
  const chars = useLoad(() => get('/characters'), []);
  const [charId, setCharId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [ownBase, setOwnBase] = useState(null);
  const [useOwnBase, setUseOwnBase] = useState(false);
  const [consent, setConsent] = useState(false);
  const [order, setOrder] = useState(null);
  const [busy, run] = useBusy();

  if (tpl.error) return (<><Header title="制作" /><ErrorBox error={tpl.error} onRetry={tpl.reload} /></>);
  if (!tpl.data || !chars.data) return (<><Header title="制作" /><Spinner /></>);
  const t = tpl.data;
  const svc = t.scene.services.find((s) => s.type === t.serviceType);
  const selected = charId ?? chars.data[0]?.id ?? null;
  const needBase = t.serviceType === 'OUTFIT_PHOTO' && (!t.hasBaseImage || useOwnBase);

  const submit = () =>
    run(async () => {
      if (!selected) return toast('请先上传或选择人物模板', 'bad');
      if (needBase && !ownBase) return toast('请上传白模场景图', 'bad');
      if (!consent) return toast('请先确认本人素材授权说明', 'bad');
      let baseUploadId;
      if (needBase) {
        const fd = new FormData();
        fd.append('file', ownBase);
        baseUploadId = (await api('/uploads/base', { method: 'POST', body: fd })).id;
      }
      const o = await post('/orders', { templateId: t.id, characterId: selected, baseUploadId, consent: true });
      setOrder(o);
    });

  const pay = () =>
    run(async () => {
      await post(`/orders/${order.id}/pay`);
      toast('模拟支付成功，开始制作', 'ok');
      nav(`/orders/${order.id}`, { replace: true });
    });

  const cancelPay = () =>
    run(async () => {
      await post(`/orders/${order.id}/cancel`);
      setOrder(null);
      toast('已取消模拟支付');
    });

  return (
    <div>
      <Header title={`制作 · ${SERVICE_META[t.serviceType].name}`} />
      <div className="section stack">
        <div className="card card-tight row">
          <img className="thumb" src={t.cover} alt="" />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{t.title}</div>
            <div className="small muted">
              {t.scene.name} · <span className="gold">{yuan(t.price)} / 次</span>
            </div>
          </div>
        </div>

        {t.serviceType === 'OUTFIT_PHOTO' && (
          <div className="card">
            <div className="section-title" style={{ margin: 0 }}>
              <span>① 白模场景图</span>
              {t.hasBaseImage && (
                <label className="check" style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={useOwnBase} onChange={(e) => setUseOwnBase(e.target.checked)} />
                  自己上传
                </label>
              )}
            </div>
            <p className="small muted" style={{ margin: '4px 0 10px' }}>
              提供背景、构图和人物动作
            </p>
            {needBase ? (
              <div style={{ maxWidth: 180 }}>
                <ImagePick label="上传白模原图" required file={ownBase} onChange={setOwnBase} />
              </div>
            ) : (
              <img src={t.baseImage} alt="白模场景" style={{ maxWidth: 180, borderRadius: 10 }} />
            )}
          </div>
        )}

        <div className="card">
          <div className="section-title" style={{ margin: 0 }}>
            <span>{t.serviceType === 'OUTFIT_PHOTO' ? '② 人物模板' : '选择人物'}</span>
            <button className="link-btn small" onClick={() => nav('/characters')}>
              管理 ›
            </button>
          </div>
          <p className="small muted" style={{ margin: '4px 0 10px' }}>
            提供人物长相、发型和整套服装
          </p>
          <div className="char-row">
            <button className="char-item" onClick={() => setAdding(true)}>
              <div className="char-add">＋</div>
              <div className="nm muted">上传人物</div>
            </button>
            {chars.data.map((c) => (
              <button key={c.id} className={`char-item ${selected === c.id ? 'active' : ''}`} onClick={() => setCharId(c.id)}>
                <img src={c.bodyImage} alt={c.name} />
                <div className="nm ellipsis">{c.name}</div>
              </button>
            ))}
          </div>
          {!chars.data.length && <p className="small warn mt">还没有人物模板，请先上传人物照片</p>}
        </div>

        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>
            我确认素材为本人所有或已获授权，知悉作品由 AI 自动生成、细节可能存在偏差，并会在传播时保留 AI 生成标识。
            <a href="/agreement" onClick={(e) => (e.preventDefault(), nav('/agreement'))}>
              《用户协议与隐私政策》
            </a>
          </span>
        </label>

        {svc && !svc.available && <div className="notice notice-bad">{svc.reason}</div>}
        <p className="small muted">每次制作 {yuan(t.price)} · 模拟支付，失败自动退回。可离开页面，在“我的作品”中查看结果。</p>
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy || !svc?.available}>
          确认价格并下单 · {yuan(t.price)}
        </button>
      </div>

      <CharacterForm
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(c) => {
          setAdding(false);
          chars.setData((l) => [c, ...(l || [])]);
          setCharId(c.id);
        }}
      />

      <Modal
        open={!!order}
        sheet
        onClose={cancelPay}
        title="模拟支付"
        footer={
          <>
            <button className="btn btn-ghost" onClick={cancelPay} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" onClick={pay} disabled={busy}>
              确认模拟支付
            </button>
          </>
        }
      >
        {order && (
          <div className="stack">
            <div className="pay-amount">{yuan(order.amount)}</div>
            <div className="kv">
              <span>订单号</span>
              <span className="small">{order.orderNo}</span>
              <span>服务</span>
              <span>{order.serviceName}</span>
              <span>模板</span>
              <span>{order.templateTitle}</span>
            </div>
            <p className="notice">模拟交易环境 · 不会发生真实扣款。制作失败将自动模拟退款并回补景区次数。</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
