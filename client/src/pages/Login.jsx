//Dedicated auth page. Unauthenticated visits to protected routes land here.

import React from "react";
import { useHistory, useLocation, Redirect } from "react-router-dom";
import { GoogleLogin } from "@react-oauth/google";
import { Typography, Container, Paper, makeStyles } from "@material-ui/core";

import { useAuth } from "../AuthContext";

const useStyles = makeStyles((theme) => ({
  card: {
    marginTop: theme.spacing(14),
    padding: theme.spacing(6),
    textAlign: "center",
  },
  title: {
    fontFamily: ["Segoe UI"],
    fontWeight: 700,
    color: "#2e3b6f",
    marginBottom: theme.spacing(3),
  },
  button: {
    display: "flex",
    justifyContent: "center",
  },
}));

const Login = () => {
  const classes = useStyles();
  const history = useHistory();
  const location = useLocation();
  const { loginWithGoogle, isAuthenticated } = useAuth();

  //Where to go after sign-in (defaults to /home).
  const from = (location.state && location.state.from) || "/home";

  if (isAuthenticated) {
    return <Redirect to={from} />;
  }

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      await loginWithGoogle(credentialResponse.credential);
      history.push(from);
    } catch (err) {
      console.error(err);
      alert("Sign-in failed. Please try again.");
    }
  };

  return (
    <Container maxWidth="xs">
      <Paper className={classes.card} elevation={3}>
        <Typography variant="h4" className={classes.title}>
          Sign in
        </Typography>
        <Typography variant="body1" color="textSecondary" gutterBottom>
          Use your Google account to join or start a meeting.
        </Typography>
        <div className={classes.button}>
          <GoogleLogin
            onSuccess={handleGoogleSuccess}
            onError={() => alert("Google sign-in failed. Please try again.")}
          />
        </div>
      </Paper>
    </Container>
  );
};

export default Login;
