/*
THIS IS THE ALERT DIALOG BOX COMPONENT. 
THE NOTIFICATION ALERT FIRED WHEN A CALLER CALLS A RECIPIENT IS IMPLEMENTED HERE. 
*/

import React, { useContext } from 'react';
import { SocketContext } from '../SocketContext';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import DialogTitle from '@material-ui/core/DialogTitle';
import { useTheme } from '@material-ui/core/styles';
import Slide from '@material-ui/core/Slide';

//Provides sliding effect for the alert dialog box.
const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

const AlertDialog = () => {
    const { AnswerCall, call, CallAccepted } = useContext(SocketContext);
    const theme = useTheme();
    const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));

    //Socket.IO connection IDs can't be reused since they are created during the client-server handshake.
    //Thus on rejecting the call, the window gets reloaded and thus becomes recapable of providing a new ID.
    const handleClose = () => {
        window.location.reload();
    };

    return (
        //Only triggers the dialog box when Call is being received and call has not been accepted yet.
        <div>
            {call.isReceivingCall && !CallAccepted && (
                <div>
                    <Dialog
                        fullScreen={fullScreen}
                        open={true}
                        TransitionComponent={Transition}
                        keepMounted
                        onClose={handleClose}
                        aria-labelledby="alert-dialog-slide-title"
                        aria-describedby="alert-dialog-slide-description"
                    >
                        <DialogTitle id="alert-dialog-slide-title">{"Alert"}</DialogTitle>
                        <DialogContent>
                            <DialogContentText id="alert-dialog-slide-description">
                                {call.name} is calling
                            </DialogContentText>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={AnswerCall} color="primary" variant="contained">
                                Answer
                            </Button>
                            <Button onClick={handleClose} color="primary" variant="contained">
                                Reject
                            </Button>
                        </DialogActions>
                    </Dialog>
                </div>
            )}
        </div>
    );
};

export default AlertDialog;
