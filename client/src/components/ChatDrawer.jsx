/*
THIS IS THE CHAT DRAWER COMPONENT. The Chat functionality and UI has been implemented here. 
*/

import React, { useContext, useState, useEffect, useRef } from 'react';
import io from "socket.io-client"
import clsx from 'clsx';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import Drawer from '@material-ui/core/Drawer';
import AppBar from '@material-ui/core/AppBar';
import Toolbar from '@material-ui/core/Toolbar';
import CssBaseline from '@material-ui/core/CssBaseline';
import Divider from '@material-ui/core/Divider';
import IconButton from '@material-ui/core/IconButton';
import ChevronLeftIcon from '@material-ui/icons/ChevronLeft';
import ChevronRightIcon from '@material-ui/icons/ChevronRight';
import { SocketContext } from '../SocketContext';
import ScrollToBottom from 'react-scroll-to-bottom';            //Enables auto scroll to bottom as the chat expands. 
import ReactEmoji from 'react-emoji';                          // Enables text to emoji functinality on compatible text. (eg- ":)" )
import { Button, TextField, Typography } from '@material-ui/core';
import "./scrollbar.css";

const drawerWidth = 275;

const useStyles = makeStyles((theme) => ({
    root: {
        display: 'flex',
        flexGrow: 1,
    },
    appBar: {       //Persistent drawer implementation
        transition: theme.transitions.create(['margin', 'width'], {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
        }),
    },
    appBarShift: {
        width: `calc(100% - ${drawerWidth}px)`,
        transition: theme.transitions.create(['margin', 'width'], {
            easing: theme.transitions.easing.easeOut,
            duration: theme.transitions.duration.enteringScreen,
        }),
        marginRight: drawerWidth,
    },
    hide: {
        display: 'none',
    },
    drawer: {
        position: "relative",
        width: drawerWidth,
        flexShrink: 0,
    },
    drawerPaper: {
        width: drawerWidth,
    },
    drawerHeader: {
        display: 'flex',
        alignItems: 'center',
        padding: theme.spacing(0, 1),
        // necessary for content to be below app bar
        ...theme.mixins.toolbar,
        justifyContent: 'flex-end',
    },
    content: {
        flexGrow: 1,
        padding: theme.spacing(3),
        transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
        }),
        marginRight: -drawerWidth,
    },
    contentShift: {
        transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.easeOut,
            duration: theme.transitions.duration.enteringScreen,
        }),
        marginRight: 0,
    },
    menuButton: {
        marginRight: theme.spacing(2),
    },
    title: {
        fontFamily: ["Segoe UI"],
        fontWeight: 500,
        flexGrow: 1,
        paddingLeft: "5px",
    },
    toolbar: {
        minHeight: "10",
    },
    textfield: {
        position: "absolute",
        bottom: "0px",
    },
    h3: {
        color: "#2e3b6f",
        background: "#F3F3F3",
        borderRadius: "20px",
        padding: "5px 20px",
        display: "inline - block",
        maxWidth: "95%",
        justifyContent: "flex-start",
    },
    span: {
        color: "rgba(0,0,0,1)",
    },
    messages: {
        padding: "5px 0px",
        overflow: "hidden",
        wordWrap: "break-word",
        flex: "auto",
    },
    container: {
        maxHeight: "75vh",
    },
    chatstyle: {
        position: "absolute",
        top: "6px",
    },
    divider: {
        height: "2px",
        marginTop: "-16px",
    },
    iconbut: {
        marginTop: "-5px",
    },
}));

const ChatDrawer = () => {
    const classes = useStyles();
    const theme = useTheme();
    const [open, setOpen] = React.useState(false);
    const { name } = useContext(SocketContext);
    const [state_msg, setState_msg] = useState("");
    const [state_name, setState_name] = useState(name);
    const [chat, setChat] = useState([])
    const socketRef = useRef()

    useEffect(
        () => {
            socketRef.current = io.connect("https://ms-teams-clone-tejas.herokuapp.com/")
            socketRef.current.on("message", ({ name, message }) => {
                setChat([...chat, { name, message }])
            })
            return () => socketRef.current.disconnect()
        },
        [chat]
    )


    const onMessageSubmit = (e) => {
        const name = state_name;
        const message = state_msg;
        socketRef.current.emit("message", { name, message })
        e.preventDefault()
        setState_msg("");
        setState_name(name);
    }

    const renderChat = () => {                                   //renders the chat -> message sending and receiving functionality. 
        return chat.map(({ name, message }, index) => (
            <ScrollToBottom className={classes.messages}>
                <div key={index}>
                    <h3 className={classes.h3}>
                        {name} <br /> <span className={classes.span}>{ReactEmoji.emojify(message)}</span>
                    </h3>
                </div>
            </ScrollToBottom>
        ))
    }


    const handleDrawerOpen = () => {
        setOpen(true);
    };

    const handleDrawerClose = () => {
        setOpen(false);
    };

    const onTextChange_msg = (e) => {
        setState_msg(e.target.value)                    //Sets the message target value on change in input box value.
        setState_name(name);                            //Sets the name target value to the name typed in the OPTIONS.jsx input box.
    }

    return (
        <div className={classes.root}>
            <CssBaseline />
            <AppBar
                color="primary" position="fixed"
                className={clsx(classes.appBar, {
                    [classes.appBarShift]: open,
                })}
            >
                <Toolbar variant="dense">
                    <Typography variant="h5" noWrap className={classes.title}>
                        Microsoft Teams Clone
                    </Typography>
                    <Button
                        color="inherit"
                        aria-label="open drawer"
                        edge="end"
                        onClick={handleDrawerOpen}
                        className={clsx(open && classes.hide)}
                    >
                        CHAT
                    </Button>
                </Toolbar>
            </AppBar>
            <main
                className={clsx(classes.content, {
                    [classes.contentShift]: open,
                })}
            >
            </main>
            <Drawer
                className={classes.drawer}
                variant="persistent"
                anchor="right"
                open={open}
                classes={{
                    paper: classes.drawerPaper,
                }}
            >
                <div className={classes.drawerHeader}>
                    <IconButton className={classes.iconbut} color="primary" size="small" onClick={handleDrawerClose}>
                        {theme.direction === 'rtl' ? <ChevronLeftIcon /> : <ChevronRightIcon />}
                    </IconButton>
                </div>
                <div className={classes.chatstyle}>
                    <Typography noWrap className={classes.title} variant="h4"> Chat </Typography>
                </div>
                <Divider className={classes.divider} />
                <br />
                <form>
                    <TextField
                        className={classes.textfield}
                        id="filled-multiline-flexible"
                        label="Type message and hit enter to send"
                        multiline
                        rowsMax={3}                               //maxRows set to 3 to not let the input box overflow
                        color="primary"
                        variant="filled"
                        style={{ zIndex: 5 }}
                        onChange={(e) => onTextChange_msg(e)}
                        value={state_msg}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                onMessageSubmit(e);
                            }
                        }}
                        fullWidth
                    />
                </form>
                <ScrollToBottom className={classes.container}>
                    {renderChat()}
                </ScrollToBottom>
            </Drawer>
        </div>
    );
}

export default ChatDrawer;