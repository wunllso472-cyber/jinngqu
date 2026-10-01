/** 现场服务设置表单的初始值 */
export const serviceSettingsForm = (scene) => ({
  merchantName: scene.merchantName || '',
  servicePhone: scene.servicePhone || '',
  serviceHours: scene.serviceHours || '',
  printEnabled: !!scene.printEnabled,
  pickupAddress: scene.pickupAddress || '',
});

/** 现场服务设置字段：商户名称、联系电话、服务时间、打印开关与取件地点（商户与管理员共用） */
export default function ServiceSettingsFields({ form, setForm }) {
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <div className="field">
        <label>商户名称</label>
        <input className="input" maxLength={40} value={form.merchantName} onChange={set('merchantName')} />
      </div>
      <div className="form-grid">
        <div className="field">
          <label>联系电话</label>
          <input className="input" maxLength={30} value={form.servicePhone} onChange={set('servicePhone')} />
        </div>
        <div className="field">
          <label>服务时间</label>
          <input className="input" maxLength={40} value={form.serviceHours} onChange={set('serviceHours')} placeholder="例如：每天 09:00–18:00" />
        </div>
      </div>
      <div className="divider" />
      <h3>打印服务</h3>
      <p className="small muted">只在现场具备打印与交付能力时开放申请。收到申请后，在打印履约中下载原图，完成实际打印再通知取件。</p>
      <div className="row-between">
        <span>开放打印申请</span>
        <label className="switch">
          <input type="checkbox" checked={form.printEnabled} onChange={(e) => setForm((f) => ({ ...f, printEnabled: e.target.checked }))} />
          <span />
        </label>
      </div>
      <div className="field">
        <label>取件地点（开放打印时必填）</label>
        <input className="input" maxLength={300} value={form.pickupAddress} onChange={set('pickupAddress')} placeholder="例如：金顶游客中心一楼服务台" />
      </div>
    </>
  );
}
