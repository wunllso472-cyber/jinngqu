import { useState } from 'react';
import { api } from '../api.js';
import { ImagePick, Modal, toast, useBusy } from '../ui.jsx';

const MAX = 10 * 1024 * 1024;

/** 新建人物模板：身体照必传，人脸照可选 */
export default function CharacterForm({ open, onClose, onCreated }) {
  const [body, setBody] = useState(null);
  const [face, setFace] = useState(null);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, run] = useBusy();

  const pick = (setter) => (f) => {
    if (!/image\/(jpeg|png)/.test(f.type)) return toast('仅支持 JPG、JPEG、PNG', 'bad');
    if (f.size > MAX) return toast('单张照片不能超过10MB', 'bad');
    setter(f);
  };

  const submit = () =>
    run(async () => {
      if (!body) return toast('身体照片为必传项，人脸照片可选', 'bad');
      if (!consent) return toast('请先确认素材授权说明', 'bad');
      const fd = new FormData();
      fd.append('body', body);
      if (face) fd.append('face', face);
      fd.append('name', name);
      fd.append('consent', 'true');
      const c = await api('/characters', { method: 'POST', body: fd });
      toast('人物模板已保存', 'ok');
      setBody(null);
      setFace(null);
      setName('');
      setConsent(false);
      onCreated?.(c);
    });

  return (
    <Modal
      open={open}
      onClose={onClose}
      sheet
      title="上传人物照片"
      footer={
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          {busy ? '正在上传…' : '保存人物模板'}
        </button>
      }
    >
      <div className="stack">
        <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <ImagePick label="身体照片" required file={body} onChange={pick(setBody)} hint="单人、全身、光线充足" />
          <ImagePick label="人脸照片（可选）" file={face} onChange={pick(setFace)} hint="正脸、无遮挡" />
        </div>
        <div className="field">
          <label>名称</label>
          <input className="input" maxLength={20} placeholder="例如：我自己" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>每张照片不超过 10MB，仅支持 JPG、JPEG、PNG</li>
          <li>人物模板提供长相、发型和整套服装，可在“我的人物”中删除</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>我确认上传的是本人照片，或已取得照片中人物的授权；不上传他人隐私或违法内容。</span>
        </label>
      </div>
    </Modal>
  );
}
