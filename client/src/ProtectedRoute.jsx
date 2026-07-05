//Route wrapper that gates its children behind the auth check.

import React from "react";
import { Route, Redirect } from "react-router-dom";
import { CircularProgress } from "@material-ui/core";

import { useAuth } from "./AuthContext";

const ProtectedRoute = ({ children, ...rest }) => {
  const { isAuthenticated, loading } = useAuth();

  return (
    <Route
      {...rest}
      render={({ location }) => {
        if (loading) {
          //Session check still in flight — don't redirect prematurely.
          return (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "20vh" }}>
              <CircularProgress />
            </div>
          );
        }
        return isAuthenticated ? (
          children
        ) : (
          //Remember where the user was headed so Login can send them back.
          <Redirect to={{ pathname: "/login", state: { from: location.pathname } }} />
        );
      }}
    />
  );
};

export default ProtectedRoute;
