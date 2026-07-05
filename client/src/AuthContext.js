//Auth state for the whole app. The session JWT lives in an httpOnly cookie,
//so the client can't read it directly — isAuthenticated is resolved by asking
//the backend (/auth/me) whether the cookie holds a valid token. Sessions last
//one day; the client schedules an automatic local logout at expiry.

import React, { createContext, useContext, useState, useEffect, useRef } from "react";

import { apiFetch, apiJson } from "./api";
import { socket } from "./SocketContext";

const AuthContext = createContext();

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true); //true until the first /auth/me check resolves.
  const expiryTimer = useRef(null);

  //Log out locally the moment the session expires (max setTimeout ~24.8 days,
  //so a 1-day session always fits in a single timer).
  const scheduleExpiry = (expiresAt) => {
    clearTimeout(expiryTimer.current);
    if (!expiresAt) return;
    const ms = expiresAt - Date.now();
    if (ms <= 0) {
      setUser(null);
      return;
    }
    expiryTimer.current = setTimeout(() => setUser(null), ms);
  };

  useEffect(() => {
    apiFetch("/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setUser(data ? data.user : null);
        if (data) scheduleExpiry(data.expiresAt);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    return () => clearTimeout(expiryTimer.current);
  }, []);

  //Exchanges the Google ID token for our session cookie.
  const loginWithGoogle = async (credential) => {
    const data = await apiJson("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
    setUser(data.user);
    scheduleExpiry(Date.now() + 24 * 60 * 60 * 1000);
    return data.user;
  };

  //Profile: change the display name used across the app.
  const updateName = async (name) => {
    const data = await apiJson("/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ name }),
    });
    setUser((prev) => ({ ...prev, name: data.user.name }));
    //Nudge the live socket to re-read the new name so chat, the calling
    //dialog, and captions reflect it without a reconnect.
    socket.emit("refreshIdentity");
    return data.user;
  };

  const logout = async () => {
    clearTimeout(expiryTimer.current);
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        loginWithGoogle,
        updateName,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const useAuth = () => useContext(AuthContext);

export { AuthProvider, useAuth };
