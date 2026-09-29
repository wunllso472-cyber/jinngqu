import { useNavigate } from 'react-router-dom';
import { get } from '../api.js';
import { yuan } from '../format.js';
import { Empty, ErrorBox, Header, Spinner, useLoad } from '../ui.jsx';

export default function Favorites() {
  const nav = useNavigate();
  const { data, error, loading, reload } = useLoad(() => get('/favorites'), []);
  return (
    <div>
      <Header title="我的收藏" />
      <div className="section">
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} onRetry={reload} />
        ) : !data.length ? (
          <Empty text="还没有收藏模板，去发现喜欢的风景吧" />
        ) : (
          <div className="tpl-grid">
            {data.map((t) => (
              <button key={t.id} className="tpl-card" onClick={() => nav(`/template/${t.id}`)}>
                <div className="tpl-cover">
                  <img src={t.cover} alt={t.title} loading="lazy" />
                </div>
                <div className="tpl-meta">
                  <div className="tpl-title ellipsis">{t.title}</div>
                  <div className="tpl-sub">
                    <span className="gold">{yuan(t.price)}</span>
                    <span>{t.serviceName}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
