/*
THIS IS THE CALL OPTIONS COMPONENT. The call options card has been implemented here. 
*/

import React, { useContext, useState } from 'react';
import { Button, TextField, Grid, Typography, Container, Paper } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import { Assignment, Phone, PhoneDisabled } from '@material-ui/icons';
import { SocketContext } from '../SocketContext';


const useStyles = makeStyles((theme) => ({
  root: {
    display: 'flex',
    flexDirection: 'column',
  },
  gridContainer: {
    width: '100%',
    [theme.breakpoints.down('xs')]: {
      flexDirection: 'column',
    },
  },
  container: {
    justifyContent: "center",
    width: '500px',
    padding: "0px",
    [theme.breakpoints.down('xs')]: {
      width: '80%',
    },
  },
  margin: {
    marginTop: 20,
  },
  padding: {
    padding: 20,
  },
  paper: {
    variant: "outlined",
    margin: '10px',
    marginTop: '-10px',
    padding: "10px",
    background: "#2e3b6f",
    '&:hover': {
      boxShadow: "rgba(0, 0, 0, 0.35) 0px 5px 15px",
    },
  },
  typo: {
    fontSize: "1.25rem",
    color: "rgba(255,255,255,0.9)",
    top: "0px",
    left: "2px",
    zIndex: 1,
    fontFamily: ['Segoe UI'],
    fontWeight: 500,
  },
  credits: {
    textAlign: "center",
    justifyContent: "center",
    fontFamily: ['Segoe UI'],
    fontWeight: 200,
    color: "rgba(255,255,255,0.9)",
  },
}));

const CallOptions = ({ children }) => {
  const { me, CallAccepted, name, setName, CallEnded, leaveCall, CallUser } = useContext(SocketContext);
  const [idToCall, setIdToCall] = useState('');
  const classes = useStyles();

  return (
    <Container className={classes.container}>
      <Paper className={classes.paper}>
        <form className={classes.root} noValidate autoComplete="off">
          <Grid container className={classes.gridContainer}>
            <Grid item xs={12} md={6} className={classes.padding}>
              <Typography marginTop="0px" className={classes.typo} gutterBottom variant="h6"> Start a Call </Typography>
              <TextField InputLabelProps={{ style: { color: 'rgba(255,255,255,0.7)' }, }}
                InputProps={{ style: { color: 'rgba(255,255,255,0.7)' }, }}
                variant="outlined"
                label="Your Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                fullWidth />
              <CopyToClipboard text={me} className={classes.margin}>
                <Button variant="contained" color="primary" fullWidth startIcon={<Assignment fontSize="large" />}>
                  Copy your ID
                </Button>
              </CopyToClipboard>
            </Grid>
            <Grid item xs={12} md={6} className={classes.padding}>
              <Typography className={classes.typo} gutterBottom variant="h6"> Recipient ID </Typography>
              <TextField InputLabelProps={{ style: { color: 'rgba(255,255,255,0.7)', }, }}
                InputProps={{ style: { color: 'rgba(255,255,255,0.7)' }, }}
                color="primary"
                variant="outlined"
                label="ID to Call"
                value={idToCall}
                onChange={(e) => setIdToCall(e.target.value)}
                fullWidth />
              {CallAccepted && !CallEnded ? (
                <Button variant="contained"
                  color="secondary"
                  startIcon={<PhoneDisabled fontSize="large" />}
                  fullWidth
                  onClick={leaveCall}
                  className={classes.margin}>
                  Hang Up
                </Button>
              ) : (
                <Button variant="contained"
                  color="primary"
                  startIcon={<Phone fontSize="large" />}
                  fullWidth
                  onClick={() => CallUser(idToCall)}
                  className={classes.margin}>
                  Call
                </Button>
              )}
            </Grid>
          </Grid>
        </form>
        {children}
      </Paper>
      <div className={classes.credits}>
        Created by - Tejas Bhale
      </div>
    </Container>
  );

};

export default CallOptions;
