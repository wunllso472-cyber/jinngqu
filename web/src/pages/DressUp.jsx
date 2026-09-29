import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../ctx.jsx';
import { SERVICE_TYPES } from '../format.js';
import { Empty, ErrorBox, Spinner, Tabs } from '../ui.jsx';
import { TemplateCard, useSceneTemplates } from './Home.jsx';

const LABELS = { CHECKIN: '景点打卡', OUTFIT_PHOTO: 'AI换装图片', OUTFIT_VIDEO: 'AI换装视频' };

export default function DressUp() {
  const nav = useNavigate();
  const { sceneId } = useApp();
  const [params, setParams] = useSearchParams();
  const type = SERVICE_TYPES.includes(params.get('type')) ? params.get('type') : 'CHECKIN';
  const list = useSceneTemplates(sceneId, type);

  return (
    <div className="section stack">
      <h2 style={{ fontSize: 22, marginTop: 8 }}>换装</h2>
      <Tabs value={type} onChange={(v) => setParams({ type: v }, { replace: true })} items={SERVICE_TYPES.map((t) => ({ value: t, label: LABELS[t] }))} />
      {!sceneId ? (
        <Empty text="请先在首页选择景区">
          <button className="btn btn-primary btn-sm" onClick={() => nav('/')}>
            去选择
          </button>
        </Empty>
      ) : list.loading && !list.data ? (
        <Spinner text="正在加载模板…" />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : !list.data.length ? (
        <Empty text="暂无已上架模板" />
      ) : (
        <>
          <div className="tpl-grid">
            {list.data.map((t) => (
              <TemplateCard key={t.id} t={t} showLikes onClick={() => nav(`/template/${t.id}`)} />
            ))}
          </div>
          <p className="small muted" style={{ textAlign: 'center' }}>
            已展示全部模板
          </p>
        </>
      )}
    </div>
  );
}
