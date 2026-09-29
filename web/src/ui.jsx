import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';

// ---------------- Toast ----------------
const toastListeners = new Set();
export function toast(message, tone = 'info') {
  const item = { id: Math.random(), message: String(message?.message ?? message), tone };
  toastListeners.forEach((fn) => fn(item));
}
export function ToastHost() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const fn = (item) => {
      setItems((l) => [...l.slice(-2), item]);
      setTimeout(() => setItems((l) => l.filter((x) => x.id !== item.id)), 2600);
    };
    toastListeners.add(fn);
    return () => toastListeners.delete(fn);
  }, []);
  return (
    <div className="toast-host" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---------------- Modal / Sheet ----------------
export function Modal({ open, onClose, title, children, footer, sheet = false, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={`overlay ${sheet ? 'overlay-sheet' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`dialog ${sheet ? 'sheet' : ''} ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        {title && (
          <div className="dialog-head">
            <h3>{title}</h3>
            {onClose && (
              <button className="icon-btn" onClick={onClose} aria-label="关闭">
                ✕
              </button>
            )}
          </div>
        )}
        <div className="dialog-body">{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// 命令式确认框：await confirm({ title, message })
const confirmListeners = new Set();
export function confirm(opts) {
  return new Promise((resolve) => confirmListeners.forEach((fn) => fn({ ...opts, resolve })));
}
export function ConfirmHost() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const fn = (s) => setState(s);
    confirmListeners.add(fn);
    return () => confirmListeners.delete(fn);
  }, []);
  const close = (v) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <Modal
      open={!!state}
      onClose={() => close(false)}
      title={state?.title || '请确认'}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => close(false)}>
            {state?.cancelText || '取消'}
          </button>
          <button className={`btn ${state?.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => close(true)}>
            {state?.okText || '确定'}
          </button>
        </>
      }
    >
      <p className="muted pre">{state?.message}</p>
    </Modal>
  );
}

// ---------------- 通用组件 ----------------
export function Header({ title, back = true, right }) {
  const nav = useNavigate();
  return (
    <header className="page-head">
      {back ? (
        <button className="icon-btn" onClick={() => (window.history.length > 1 ? nav(-1) : nav('/'))} aria-label="返回">
          ‹
        </button>
      ) : (
        <span className="icon-btn-placeholder" />
      )}
      <h1>{title}</h1>
      <div className="page-head-right">{right}</div>
    </header>
  );
}

export const Spinner = ({ text = '正在加载…' }) => (
  <div className="center-box">
    <span className="spinner" />
    <span className="muted">{text}</span>
  </div>
);

export const Empty = ({ text, children }) => (
  <div className="center-box empty">
    <div className="empty-icon">◌</div>
    <p className="muted">{text}</p>
    {children}
  </div>
);

export const ErrorBox = ({ error, onRetry }) => (
  <div className="center-box">
    <p className="muted">{error?.message || '加载失败'}</p>
    {onRetry && (
      <button className="btn btn-ghost btn-sm" onClick={onRetry}>
        重新加载
      </button>
    )}
  </div>
);

export const Badge = ({ tone = 'mute', children }) => <span className={`badge badge-${tone}`}>{children}</span>;

export const StatusBadge = ({ map, status }) => {
  const m = map[status] || { text: status, tone: 'mute' };
  return <Badge tone={m.tone}>{m.text}</Badge>;
};

export function Tabs({ items, value, onChange, small = false }) {
  return (
    <div className={`tabs ${small ? 'tabs-sm' : ''}`} role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} className={value === it.value ? 'active' : ''} onClick={() => onChange(it.value)}>
          {it.label}
          {it.count ? <span className="tab-count">{it.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, size, total, onChange }) {
  const pages = Math.max(1, Math.ceil((total || 0) / size));
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        上一页
      </button>
      <span className="muted">
        第 {page} / {pages} 页 · 共 {total} 条
      </span>
      <button className="btn btn-ghost btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>
        下一页
      </button>
    </div>
  );
}

/** 选择图片，带本地预览 */
export function ImagePick({ label, hint, file, onChange, accept = 'image/jpeg,image/png', existing, required, video = false }) {
  const ref = useRef(null);
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  const shown = url || existing;
  return (
    <div className="pick">
      <div className="pick-label">
        {label}
        {required && <span className="req">*</span>}
      </div>
      <button type="button" className={`pick-box ${shown ? 'has' : ''}`} onClick={() => ref.current?.click()}>
        {shown ? video ? <video src={shown} muted playsInline /> : <img src={shown} alt={label} /> : <span className="pick-plus">＋</span>}
      </button>
      {hint && <div className="hint">{hint}</div>}
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onChange(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** 简单的数据加载 hook */
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const my = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      if (my === seq.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (my === seq.current) setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { ...state, reload, setData: (data) => setState((s) => ({ ...s, data: typeof data === 'function' ? data(s.data) : data })) };
}

/** 按钮防重复点击 */
export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      return await fn();
    } catch (err) {
      toast(err, 'bad');
    } finally {
      setBusy(false);
    }
  }, [busy]);
  return [busy, run];
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export async function downloadFile(url, name) {
  const a = document.createElement('a');
  a.href = url + (url.includes('?') ? '&' : '?') + 'dl=1';
  a.download = name || '';
  document.body.appendChild(a);
  a.click();
  a.remove();
  toast('已发起下载');
}
