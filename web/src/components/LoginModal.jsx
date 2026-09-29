import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { get, post } from '../api.js';
import { useApp } from '../ctx.jsx';
import { Modal, toast, useBusy } from '../ui.jsx';

const listeners = new Set();
/** 打开统一登录弹窗（游客 / 商户 / 管理员共用） */
export function openLogin(opts = {}) {
  listeners.forEach((fn) => fn(opts));
}

export default function LoginModal() {
  const { login } = useApp();
  const [state, setState] = useState(null); // { onSuccess, expired }
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '', confirm: '', code: '' });
  const [agree, setAgree] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [busy, run] = useBusy();

  const loadCaptcha = useCallback(async () => {
    try {
      setCaptcha(await get('/auth/captcha'));
    } catch {
      setCaptcha({ enabled: false });
    }
  }, []);

  useEffect(() => {
    const fn = (opts) => {
      setState(opts);
      setMode('login');
      setAgree(false); // 每次打开默认不勾选
      setForm((f) => ({ ...f, password: '', confirm: '', code: '' }));
      loadCaptcha();
    };
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, [loadCaptcha]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const close = () => setState(null);

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (!form.username || !form.password) return toast('请输入账号和密码', 'bad');
      if (captcha?.enabled && !form.code) return toast('请输入验证码', 'bad');
      if (!agree) return toast('请阅读并同意用户协议与隐私政策', 'bad');
      const extra = captcha?.enabled ? { uuid: captcha.uuid, code: form.code } : {};
      try {
        if (mode === 'register') {
          if (form.password !== form.confirm) return toast('两次密码不一致', 'bad');
          await post('/auth/register', { username: form.username.trim(), password: form.password, confirm: form.confirm, agree: true, ...extra });
          toast('注册成功，请使用新账号登录', 'ok');
          setMode('login');
          setForm((f) => ({ ...f, password: '', confirm: '', code: '' }));
          loadCaptcha();
          return;
        }
        const data = await login(form.username.trim(), form.password, extra);
        toast(`欢迎回来，${data.user.nickname}`, 'ok');
        const cb = state?.onSuccess;
        close();
        cb?.(data);
      } catch (err) {
        if (captcha?.enabled) loadCaptcha();
        throw err;
      }
    });
  };

  return (
    <Modal open={!!state} onClose={close} sheet title={mode === 'login' ? '账号登录' : '创建游客账号'}>
      <form className="stack" onSubmit={submit}>
        <p className="small muted">{mode === 'login' ? '游客、商户、管理员统一从这里登录' : '账号须为2–20位字母、数字或下划线；密码须为8–20位并包含字母和数字'}</p>
        {state?.expired && <div className="notice">登录已过期，请重新登录</div>}
        <div className="field">
          <label htmlFor="login-u">账号</label>
          <input id="login-u" className="input" autoComplete="username" value={form.username} onChange={set('username')} placeholder="请输入账号" />
        </div>
        <div className="field">
          <label htmlFor="login-p">密码</label>
          <input id="login-p" className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} placeholder="请输入密码" />
        </div>
        {mode === 'register' && (
          <div className="field">
            <label htmlFor="login-c">确认密码</label>
            <input id="login-c" className="input" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} placeholder="请再次输入密码" />
          </div>
        )}
        {captcha?.enabled && (
          <div className="field">
            <label htmlFor="login-code">验证码</label>
            <div className="row">
              <input id="login-code" className="input grow" value={form.code} onChange={set('code')} placeholder="请输入验证码" autoComplete="off" />
              <button type="button" className="captcha-btn" onClick={loadCaptcha} title="刷新验证码">
                <img src={captcha.img} alt="验证码" />
              </button>
            </div>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            我已阅读并同意{' '}
            <Link to="/agreement" onClick={close}>
              《用户服务协议》及《隐私政策》
            </Link>
          </span>
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? '正在连接…' : mode === 'login' ? '登录' : '注册'}
        </button>
        <button
          type="button"
          className="link-btn small"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            loadCaptcha();
          }}
        >
          {mode === 'login' ? '没有账号？注册游客账号' : '已有账号，返回登录'}
        </button>
      </form>
    </Modal>
  );
}
