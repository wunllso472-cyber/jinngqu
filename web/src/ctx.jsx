import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, getToken, onUnauthorized, post, setToken } from './api.js';

const AuthCtx = createContext(null);
const SCENE_KEY = 'sa:scene';

function readScene() {
  try {
    return Number(localStorage.getItem(SCENE_KEY)) || null;
  } catch {
    return null;
  }
}

export function AppProvider({ children }) {
  const [me, setMe] = useState(null); // { user, merchantScene }
  const [ready, setReady] = useState(!getToken());
  const [sceneId, setSceneIdState] = useState(readScene);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setReady(true);
      return null;
    }
    try {
      const data = await get('/auth/me');
      setMe(data);
      return data;
    } catch {
      setMe(null);
      return null;
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    return onUnauthorized(() => setMe(null));
  }, [refresh]);

  const login = useCallback(async (username, password, extra = {}) => {
    const data = await post('/auth/login', { username, password, ...extra });
    setToken(data.token);
    setMe({ user: data.user, merchantScene: data.merchantScene });
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } catch {
      /* 已失效的会话同样视为退出 */
    }
    setToken(null);
    setMe(null);
  }, []);

  const setSceneId = useCallback((id) => {
    setSceneIdState(id);
    try {
      if (id) localStorage.setItem(SCENE_KEY, String(id));
      else localStorage.removeItem(SCENE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ user: me?.user ?? null, merchantScene: me?.merchantScene ?? null, ready, login, logout, refresh, sceneId, setSceneId }),
    [me, ready, login, logout, refresh, sceneId, setSceneId],
  );
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export const useApp = () => useContext(AuthCtx);
