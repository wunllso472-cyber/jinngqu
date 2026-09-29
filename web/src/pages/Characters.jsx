import { useState } from 'react';
import { del, get } from '../api.js';
import CharacterForm from '../components/CharacterForm.jsx';
import { Empty, ErrorBox, Header, Spinner, confirm, toast, useBusy, useLoad } from '../ui.jsx';

export default function Characters() {
  const { data, error, loading, reload, setData } = useLoad(() => get('/characters'), []);
  const [adding, setAdding] = useState(false);
  const [busy, run] = useBusy();

  const remove = (c) =>
    run(async () => {
      if (!(await confirm({ title: '删除人物模板', message: '删除后，已上传的身体和人脸照片也会被清理。确定删除吗？', danger: true, okText: '删除' }))) return;
      await del(`/characters/${c.id}`);
      setData((l) => l.filter((x) => x.id !== c.id));
      toast('已删除');
    });

  return (
    <div>
      <Header
        title="我的人物"
        right={
          <button className="btn btn-primary btn-xs" onClick={() => setAdding(true)}>
            ＋ 上传
          </button>
        }
      />
      <div className="section">
        <p className="small muted" style={{ marginBottom: 12 }}>
          人物模板用于合拍与换装，照片仅你本人可见（通过带有效期的签名链接访问）。
        </p>
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data.length ? (
          <Empty text="还没有人物模板">
            <button className="btn btn-primary btn-sm" onClick={() => setAdding(true)}>
              上传人物照片
            </button>
          </Empty>
        ) : (
          <div className="works-grid">
            {data.map((c) => (
              <div key={c.id} className="work">
                <img src={c.bodyImage} alt={c.name} />
                <div className="cap row-between">
                  <div className="grow">
                    <div className="ellipsis">{c.name}</div>
                    <div className="muted small">{c.faceImage ? '身体照 + 人脸照' : '身体照'}</div>
                  </div>
                  <button className="btn btn-danger btn-xs" onClick={() => remove(c)} disabled={busy}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <CharacterForm
        open={adding}
        onClose={() => setAdding(false)}
        onCreated={(c) => {
          setAdding(false);
          setData((l) => [c, ...(l || [])]);
        }}
      />
    </div>
  );
}
