import { useEffect, useRef, useState } from 'react';
import { api, get, post } from '../../api.js';
import { SERVICE_META, SERVICE_TYPES, yuan, yuanPlain } from '../../format.js';
import { Badge, Empty, ErrorBox, ImagePick, Modal, Spinner, Tabs, confirm, toast, useBusy, useLoad } from '../../ui.jsx';

const STATUS = { ON: ['已上架', 'ok'], OFF: ['已下架', 'mute'], ARCHIVED: ['已归档', 'bad'] };

/** 在背景图上点击设置人物脚底中心，并预览人物高度框 */
function AnchorEditor({ src, width, height, anchorX, anchorY, personHeight, onChange }) {
  const imgRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: width || 0, h: height || 0 });
  useEffect(() => setNatural({ w: width || 0, h: height || 0 }), [width, height]);
  const measure = () => {
    const el = imgRef.current;
    if (!el) return;
    setBox({ w: el.clientWidth, h: el.clientHeight });
    if (!width) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
  };
  const scale = natural.w ? box.w / natural.w : 0;
  const click = (e) => {
    const rect = imgRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / scale);
    const y = Math.round((e.clientY - rect.top) / scale);
    onChange({ anchorX: x, anchorY: y, personHeight: personHeight || Math.round(natural.h * 0.55) });
  };
  const ph = (personHeight || 0) * scale;
  const pw = ph * 0.42;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="anchor-stage" onClick={click}>
        <img ref={imgRef} src={src} alt="背景" onLoad={measure} />
        {scale > 0 && anchorX != null && anchorY != null && (
          <>
            {ph > 0 && <div className="anchor-box" style={{ left: anchorX * scale - pw / 2, top: anchorY * scale - ph, width: pw, height: ph }} />}
            <div className="anchor-dot" style={{ left: anchorX * scale, top: anchorY * scale }} />
          </>
        )}
      </div>
      <p className="small muted">
        点击图片设置人物脚底中心（原点为左上角）。画布 {natural.w}×{natural.h}
      </p>
    </div>
  );
}

function TemplateForm({ tpl, scenes, defaultSceneId, onClose, onSaved }) {
  const isNew = !tpl.id;
  const [f, setF] = useState({
    sceneId: tpl.sceneId || defaultSceneId || scenes[0]?.id,
    serviceType: tpl.serviceType || 'CHECKIN',
    title: tpl.title || '',
    intro: tpl.intro || '',
    tags: tpl.tagsRaw || '',
    price: tpl.customPrice != null ? yuanPlain(tpl.customPrice) : '',
    sort: String(tpl.sort ?? 0),
    featured: !!tpl.featured,
    anchorX: tpl.anchorX ?? null,
    anchorY: tpl.anchorY ?? null,
    personHeight: tpl.personHeight ?? null,
    code: tpl.code || '',
    ownerId: tpl.ownerId ? String(tpl.ownerId) : '',
    videoPipeline: tpl.videoPipeline || 'LOOP',
    canvasWidth: tpl.bgWidth ? String(tpl.bgWidth) : '',
    canvasHeight: tpl.bgHeight ? String(tpl.bgHeight) : '',
    backgroundFrom: '',
  });
  // 同景区中已配置高清背景的模板，可直接复用其背景
  const bgSources = useLoad(() => get('/admin/templates', { sceneId: tpl.sceneId || defaultSceneId || scenes[0]?.id }), []);
  const [files, setFiles] = useState({});
  const [bgPreview, setBgPreview] = useState(null);
  const [busy, run] = useBusy();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setFile = (k) => (file) => setFiles((x) => ({ ...x, [k]: file }));

  useEffect(() => {
    if (!files.background) return setBgPreview(null);
    const u = URL.createObjectURL(files.background);
    setBgPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [files.background]);

  const needsBg = f.serviceType === 'CHECKIN' || f.serviceType === 'OUTFIT_VIDEO';
  const bgSrc = bgPreview || tpl.background;

  const save = (publish) =>
    run(async () => {
      if (!f.title.trim()) return toast('请填写模板名称', 'bad');
      const fd = new FormData();
      if (isNew) {
        fd.append('sceneId', f.sceneId);
        fd.append('serviceType', f.serviceType);
      }
      for (const k of ['title', 'intro', 'tags', 'price', 'sort']) fd.append(k, f[k]);
      fd.append('featured', f.featured ? '1' : '0');
      for (const k of ['anchorX', 'anchorY', 'personHeight']) fd.append(k, f[k] == null ? '' : String(f[k]));
      for (const k of ['code', 'videoPipeline', 'canvasWidth', 'canvasHeight', 'backgroundFrom']) if (f[k]) fd.append(k, f[k]);
      if (f.ownerId && !tpl.ownerId) fd.append('ownerId', f.ownerId);
      if (publish != null) fd.append('status', publish ? 'ON' : 'OFF');
      Object.entries(files).forEach(([k, file]) => file && fd.append(k, file));
      const saved = await api(isNew ? '/admin/templates' : `/admin/templates/${tpl.id}`, { method: isNew ? 'POST' : 'PUT', body: fd });
      toast('模板已保存', 'ok');
      onSaved(saved);
    });

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={isNew ? '新建模板' : `编辑模板 #${tpl.id}`}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => save(isNew ? false : null)} disabled={busy}>
            {isNew ? '保存为下架' : '保存'}
          </button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>
            保存并上架
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="form-grid">
          <div className="field">
            <label>景区</label>
            <select className="select" value={f.sceneId} onChange={set('sceneId')} disabled={!isNew}>
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>业务类型 *</label>
            <select className="select" value={f.serviceType} onChange={set('serviceType')} disabled={!isNew}>
              {SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SERVICE_META[t].name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label>模板名称 *</label>
          <input className="input" maxLength={40} value={f.title} onChange={set('title')} placeholder="例如：金殿合拍 · 祈福" />
        </div>
        <div className="field">
          <label>模板介绍</label>
          <textarea className="textarea" maxLength={500} value={f.intro} onChange={set('intro')} placeholder="向游客介绍拍摄场景和效果" />
        </div>
        <div className="form-grid">
          <div className="field">
            <label>标签</label>
            <input className="input" value={f.tags} onChange={set('tags')} placeholder="例如：祈福 · 古风 · 亲子" />
          </div>
          <div className="field">
            <label>按次价格（元，留空使用景区统一价）</label>
            <input className="input" inputMode="decimal" value={f.price} onChange={set('price')} placeholder="例如 1.90" />
          </div>
          <div className="field">
            <label>排序值（越大越靠前）</label>
            <input className="input" value={f.sort} onChange={set('sort')} />
          </div>
          <label className="check" style={{ alignSelf: 'end', paddingBottom: 12 }}>
            <input type="checkbox" checked={f.featured} onChange={(e) => setF((x) => ({ ...x, featured: e.target.checked }))} />
            优先推荐
          </label>
          <div className="field">
            <label>模板编码（小写字母、数字、短横线）</label>
            <input className="input" value={f.code} onChange={set('code')} placeholder="例如 golden-palace-group-photo" />
          </div>
          <div className="field">
            <label>归属商户用户 ID</label>
            <input className="input" inputMode="numeric" value={f.ownerId} onChange={set('ownerId')} disabled={!!tpl.ownerId} placeholder="必须是商户或管理员账号" />
            <span className="hint">归属创建后固定，历史统计不会随意转移。</span>
          </div>
          {f.serviceType === 'OUTFIT_VIDEO' && (
            <div className="field">
              <label>视频管线</label>
              <select className="select" value={f.videoPipeline} onChange={set('videoPipeline')}>
                <option value="LOOP">固定动作 · 多景循环（如七景 7 秒）</option>
                <option value="MULTI_SHOT">原片多镜头 · 保留原音轨（如实景旅拍）</option>
              </select>
            </div>
          )}
        </div>

        <div className="grid-3">
          <ImagePick label="展示封面" required file={files.cover} existing={tpl.cover} onChange={setFile('cover')} hint="仅用于展示" />
          {needsBg && <ImagePick label="高清合成背景" required={f.serviceType === 'CHECKIN'} file={files.background} existing={tpl.background} onChange={setFile('background')} hint="实际合成使用" />}
          {f.serviceType === 'OUTFIT_PHOTO' && <ImagePick label="白模场景图" file={files.baseImage} existing={tpl.baseImage} onChange={setFile('baseImage')} hint="未配置时游客需自行上传" />}
          {f.serviceType === 'OUTFIT_VIDEO' && (
            <ImagePick label="效果预览视频（可选）" video accept="video/mp4,video/webm,video/quicktime" file={files.sampleVideo} existing={tpl.sampleVideo} onChange={setFile('sampleVideo')} />
          )}
        </div>
        <p className="small muted">上传的模板素材对游客公开，请勿上传用户私密照片。单图 ≤ 12MB，≤ 2000 万像素。</p>
        {needsBg && (
          <div className="form-grid">
            <div className="field">
              <label>使用已有背景</label>
              <select className="select" value={f.backgroundFrom} onChange={set('backgroundFrom')}>
                <option value="">不使用（上传新背景）</option>
                {(bgSources.data || [])
                  .filter((x) => x.id !== tpl.id && x.background)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      #{x.id} {x.title}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label>画布宽 × 高（像素）</label>
              <div className="row">
                <input className="input" inputMode="numeric" value={f.canvasWidth} onChange={set('canvasWidth')} placeholder="941" />
                <input className="input" inputMode="numeric" value={f.canvasHeight} onChange={set('canvasHeight')} placeholder="1672" />
              </div>
            </div>
          </div>
        )}

        {needsBg && bgSrc && (
          <div className="card">
            <h3 style={{ marginBottom: 8 }}>高清合成背景与人物位置</h3>
            <div className="form-grid" style={{ marginBottom: 10 }}>
              <div className="field">
                <label>脚底中心 X / Y</label>
                <div className="row">
                  <input className="input" value={f.anchorX ?? ''} onChange={(e) => setF((x) => ({ ...x, anchorX: e.target.value === '' ? null : Number(e.target.value) || 0 }))} />
                  <input className="input" value={f.anchorY ?? ''} onChange={(e) => setF((x) => ({ ...x, anchorY: e.target.value === '' ? null : Number(e.target.value) || 0 }))} />
                </div>
              </div>
              <div className="field">
                <label>人物高度（像素）</label>
                <input className="input" value={f.personHeight ?? ''} onChange={(e) => setF((x) => ({ ...x, personHeight: e.target.value === '' ? null : Number(e.target.value) || 0 }))} />
              </div>
            </div>
            <AnchorEditor
              src={bgSrc}
              width={bgPreview ? 0 : tpl.bgWidth}
              height={bgPreview ? 0 : tpl.bgHeight}
              anchorX={f.anchorX}
              anchorY={f.anchorY}
              personHeight={f.personHeight}
              onChange={(v) => setF((x) => ({ ...x, ...v }))}
            />
          </div>
        )}
        <p className="small muted">真实点赞、收藏和使用次数由系统统计，不能手工修改。</p>
      </div>
    </Modal>
  );
}

export default function TemplatesPanel({ sceneId, scenes }) {
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, run] = useBusy();
  const { data, error, loading, reload } = useLoad(() => get('/admin/templates', { sceneId, type, status, q: query }), [sceneId, type, status, query]);

  const changeStatus = (t, next) =>
    run(async () => {
      if (next === 'ARCHIVED' && !(await confirm({ title: '归档模板', message: '归档后不再展示，历史制作与统计保留。确定归档？', danger: true }))) return;
      await post(`/admin/templates/${t.id}/status`, { status: next });
      toast({ ON: '已上架', OFF: '已下架', ARCHIVED: '已归档' }[next]);
      reload();
    });

  return (
    <div className="stack">
      <div className="row-between wrap">
        <h2 style={{ fontSize: 18 }}>全局模板管理</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
          ＋ 新建模板
        </button>
      </div>
      <div className="row wrap">
        <Tabs small value={type} onChange={setType} items={[{ value: '', label: '全部类型' }, ...SERVICE_TYPES.map((t) => ({ value: t, label: SERVICE_META[t].name }))]} />
      </div>
      <div className="row wrap">
        <Tabs
          small
          value={status}
          onChange={setStatus}
          items={[
            { value: '', label: '上架+下架' },
            { value: 'ON', label: '已上架' },
            { value: 'OFF', label: '已下架' },
            { value: 'ARCHIVED', label: '已归档' },
          ]}
        />
        <input className="input" style={{ maxWidth: 220, minHeight: 34, height: 34 }} placeholder="搜索模板名称" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQuery(q.trim())} />
      </div>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.length ? (
        <Empty text="尚无模板" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>模板</th>
                <th>景区</th>
                <th>类型</th>
                <th className="num">价格</th>
                <th className="num">成功</th>
                <th className="num">赞/藏</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="row">
                      <img className="thumb" src={t.cover} alt="" style={{ width: 36, height: 48 }} />
                      <div>
                        <div>{t.title}</div>
                        <div className="small muted">
                          #{t.id} · 排序 {t.sort}
                          {t.featured && ' · 推荐'}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{t.sceneName}</td>
                  <td>{t.serviceName}</td>
                  <td className="num">
                    {yuan(t.price)}
                    {t.customPrice == null && <div className="small muted">统一价</div>}
                  </td>
                  <td className="num">{t.uses}</td>
                  <td className="num">
                    {t.likes}/{t.favorites}
                  </td>
                  <td>
                    <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn btn-ghost btn-xs" onClick={() => setEditing(t)}>
                        编辑
                      </button>
                      {t.status === 'ON' && (
                        <button className="btn btn-ghost btn-xs" onClick={() => changeStatus(t, 'OFF')} disabled={busy}>
                          下架
                        </button>
                      )}
                      {t.status === 'OFF' && (
                        <button className="btn btn-ok btn-xs" onClick={() => changeStatus(t, 'ON')} disabled={busy}>
                          上架
                        </button>
                      )}
                      {t.status !== 'ARCHIVED' ? (
                        <button className="btn btn-danger btn-xs" onClick={() => changeStatus(t, 'ARCHIVED')} disabled={busy}>
                          归档
                        </button>
                      ) : (
                        <button className="btn btn-ghost btn-xs" onClick={() => changeStatus(t, 'OFF')} disabled={busy}>
                          恢复
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <TemplateForm
          tpl={editing}
          scenes={scenes}
          defaultSceneId={sceneId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
