//This file integrates all the components into a web-app.

import React from "react";
import { makeStyles } from "@material-ui/core/styles";
import { ThemeProvider } from "@material-ui/styles";
import { createMuiTheme } from "@material-ui/core/styles";

import AlertDialog from "./components/AlertDialog";
import EmailDialog from "./components/EmailDialog";
import ChatDrawer from "./components/ChatDrawer";
import VideoGrid from "./components/VideoGrid";
import CallOptions from "./components/CallOptions";

const theme_appbar = createMuiTheme({
  //Setting the theme of the appbars.
  palette: {
    primary: {
      light: "#757ce8",
      main: "#2e3b6f",
      dark: "#002884",
      contrastText: "#fff",
    },
    secondary: {
      light: "#ff7961",
      main: "#f44336",
      dark: "#ba000d",
      contrastText: "#000",
    },
  },
});

const useStyles = makeStyles((theme) => ({
  root: {
    flexGrow: 1,
  },
  menuButton: {
    marginRight: theme.spacing(2),
  },
  title: {
    fontFamily: ["Segoe UI"],
    fontWeight: 500,
    flexGrow: 1,
  },
  toolbar: {
    minHeight: "10",
  },
}));

const App = () => {
  const classes = useStyles();

  return (
    <div className={classes.root}>
      <ThemeProvider theme={theme_appbar}>
        <div>
          <ChatDrawer />
        </div>
      </ThemeProvider>
      <VideoGrid />
      <CallOptions>
        <AlertDialog />
        <EmailDialog />
      </CallOptions>
    </div>
  );
};

export default App;
