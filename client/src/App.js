//App shell: routing + auth providers. The call screen itself lives in pages/Room.

import React, { useEffect } from "react";
import { BrowserRouter, Switch, Route, Redirect, useHistory } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";

import { AuthProvider, useAuth } from "./AuthContext";
import ProtectedRoute from "./ProtectedRoute";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Room from "./pages/Room";
import History from "./pages/History";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

//The flow is UI-driven: direct URL entry is only honored for designed entry
//points — the landing page, login, home, and shared room links. Any other
//address typed into the bar (e.g. /history) is bounced to the flow's start.
//In-app (SPA) navigation is unaffected: this checks only the cold-load path.
const COLD_ENTRY_ALLOWED = /^\/(?:$|login\/?$|home\/?$|room\/[^/]+\/?$)/;
const coldLoadPath = window.location.pathname;
let entryChecked = false;

const EntryGuard = () => {
  const history = useHistory();
  const { isAuthenticated, loading } = useAuth();

  useEffect(() => {
    if (loading || entryChecked) return;
    entryChecked = true;
    if (!COLD_ENTRY_ALLOWED.test(coldLoadPath)) {
      history.replace(isAuthenticated ? "/home" : "/");
    }
  }, [loading, isAuthenticated, history]);

  return null;
};

const App = () => {
  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <AuthProvider>
        <BrowserRouter>
          <EntryGuard />
          <Switch>
            <Route exact path="/">
              <Landing />
            </Route>
            <Route path="/login">
              <Login />
            </Route>
            <ProtectedRoute path="/home">
              <Home />
            </ProtectedRoute>
            <ProtectedRoute path="/room/:roomId">
              <Room />
            </ProtectedRoute>
            <ProtectedRoute path="/history">
              <History />
            </ProtectedRoute>
            {/* Unknown paths never render a blank screen. */}
            <Route path="*">
              <Redirect to="/" />
            </Route>
          </Switch>
        </BrowserRouter>
      </AuthProvider>
    </GoogleOAuthProvider>
  );
};

export default App;
