import { del, get } from '../api.js';
import CharacterForm from './CharacterForm.jsx';
import { Empty, ErrorBox, Spinner, confirm, toast, useBusy, useLoad } from '../ui.jsx';

/** 人物模板列表：加载、删除与上传弹窗；上传按钮由外部放置，通过 adding 控制 */
export default function CharacterList({ adding, onAddingChange, emptyAction = false }) {
  const { data, error, loading, reload, setData } = useLoad(() => get('/characters'), []);
  const [busy, run] = useBusy();

  const remove = (c) =>
    run(async () => {
      if (!(await confirm({ title: '删除人物模板', message: '删除后，已上传的身体和人脸照片也会被清理。确定删除吗？', danger: true, okText: '删除' }))) return;
      await del(`/characters/${c.id}`);
      setData((l) => l.filter((x) => x.id !== c.id));
      toast('已删除');
    });

  return (
    <>
      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : !data.length ? (
        <Empty text="还没有人物模板">
          {emptyAction && (
            <button className="btn btn-primary btn-sm" onClick={() => onAddingChange(true)}>
              上传人物照片
            </button>
          )}
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
      <CharacterForm
        open={adding}
        onClose={() => onAddingChange(false)}
        onCreated={(c) => {
          onAddingChange(false);
          setData((l) => [c, ...(l || [])]);
        }}
      />
    </>
  );
}
