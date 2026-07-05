/*
THIS IS THE VIDEO GRID COMPONENT. 
The layout of the video player which displays the video stream and the mic and video buttons is implemented here. 
*/

import React, { useContext } from 'react';
import { Grid, Typography, Paper, makeStyles } from '@material-ui/core';
import IconButton from '@material-ui/core/IconButton';
import MicIcon from '@material-ui/icons/Mic';
import MicOffIcon from '@material-ui/icons/MicOff';
import VideocamIcon from '@material-ui/icons/Videocam';
import VideocamOffIcon from '@material-ui/icons/VideocamOff';

import { SocketContext } from '../SocketContext';

const useStyles = makeStyles((theme) => ({
    video_my: {
        position: "relative",
        borderRadius: "10px",
        boxShadow: "10px 10px 20px 5px rgba(0,0,0,0.15)",
        margin: '10px',
        width: "460px",
        [theme.breakpoints.down('xs')]: {
            width: '300px',
        },
        WebkitTransform: 'scaleX(-1)',                  //Flips my video feed to display a mirror image like conventional video chat apps.
        transform: 'scaleX(-1)',
    },
    video_user: {                                      //The video feed from the other participant is displayed as it is. (not a mirror image)
        borderRadius: "10px",
        boxShadow: "10px 10px 20px 5px rgba(0,0,0,0.15)",
        margin: '10px',
        width: "460px",
        [theme.breakpoints.down('xs')]: {
            width: '300px',
        },
    },
    gridContainer: {
        position: "relative !important",
        justifyContent: 'center !important',
        [theme.breakpoints.down('xs')]: {
            flexDirection: 'column',
        },
    },
    paper: {
        margin: '10px',
        padding: "10px",
        background: "rgba(95,90,90,0)",
    },
    typo: {
        padding: "20px 15px",
        fontSize: "1.15rem",
        lineHeight: "1px",
        color: "rgba(255,255,255,0.9)",
        zIndex: 1,
        position: "absolute !important",
        display: "flex !important",
        alignItems: "flex-start",
        fontFamily: ['Segoe UI'],
        fontWeight: 500,
    },
    root: {
        '& > *': {
            margin: theme.spacing(1),
        },
        zIndex: 1,
        position: "absolute !important",
        display: "flex !important",
        alignItems: "flex-start !important",
        top: "80%",
        left: "73%",
    },
    button: {
        background: "rgba(255,255,255,0.5)",
        '&:hover': {
            background: "rgba(255,255,255,0.4)",
        },
    },
}));

//Toggle function to toggle states of the mic and video buttons from on to off and vice versa.
function useToggle(initialValue = false) {
    const [value, setValue] = React.useState(initialValue);
    const toggle = React.useCallback(() => {
        setValue(v => !v);
    }, []);
    return [value, toggle];
}

const VideoGrid = () => {
    const { name, CallAccepted, myVideo, userVideo, CallEnded, stream, call } = useContext(SocketContext);

    const classes = useStyles();

    const [clicked_mic, setClicked_mic] = useToggle();
    const [clicked_vid, setClicked_vid] = useToggle();

    const MuteAudio = () => {
        //if (stream) {
        stream.getAudioTracks()[0].enabled = false;
        //}
    };

    const MuteVideo = () => {
        //if (stream) {
        stream.getVideoTracks()[0].enabled = false;
        //}
    };

    const UnmuteAudio = () => {
        //if (stream) {
        stream.getAudioTracks()[0].enabled = true;
        //}
    };

    const UnmuteVideo = () => {
        //if (stream) {
        stream.getVideoTracks()[0].enabled = true;
        //}
    };


    return (
        <Grid container className={classes.gridContainer}>

            {stream && (
                <Paper className={classes.paper}>
                    <Grid position="relative" item xs={12} md={6} className={classes.gridContainer}>
                        <Typography variant="h5" className={classes.typo}>{name || 'Name'}</Typography>
                        <video playsInline muted ref={myVideo} autoPlay className={classes.video_my} />
                        <div className={classes.root}>
                            <IconButton onClick={setClicked_mic} id="mic" aria-label="Mic" color="primary" className={classes.button}>
                                {clicked_mic ? <MicOffIcon color="secondary" onClick={UnmuteAudio} /> : <MicIcon onClick={MuteAudio} />}
                            </IconButton>
                            <IconButton onClick={setClicked_vid} id="vid" aria-label="Video-Feed" color="primary" className={classes.button}>
                                {clicked_vid ? <VideocamOffIcon color="secondary" onClick={UnmuteVideo} /> : <VideocamIcon onClick={MuteVideo} />}
                            </IconButton>
                        </div>
                    </Grid>
                </Paper>
            )}

            {CallAccepted && !CallEnded && (           //When a call is accepted and has not ended, display the second grid of the recipient.
                <Paper className={classes.paper}>
                    <Grid item xs={12} md={6}>
                        <Typography variant="h5" className={classes.typo}>{call.name || 'Name'}</Typography>
                        <video playsInline ref={userVideo} autoPlay className={classes.video_user} />
                    </Grid>
                </Paper>
            )}

        </Grid>
    );
};

export default VideoGrid;
