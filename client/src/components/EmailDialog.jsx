/*
THIS IS THE EMAIL DIALOG BOX COMPONENT. 
ALL OF THE CODE FROM CLICKING THE BUTTON TO SENDING AN EMAIL HAS BEEN INCLUDED IN THIS FILE.

SWEETALERT2 has been used for firing successful and error alerts. 
EmailJS has been used for sending Emails.
*/


import React, { useContext, useState } from 'react';
import Button from '@material-ui/core/Button';
import TextField from '@material-ui/core/TextField';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogContentText from '@material-ui/core/DialogContentText';
import DialogTitle from '@material-ui/core/DialogTitle';
import EmailIcon from '@material-ui/icons/Email';
import { makeStyles } from '@material-ui/core/styles';
import Slide from '@material-ui/core/Slide';
import { SocketContext } from '../SocketContext';
import Swal from 'sweetalert2'
import * as emailjs from "emailjs-com";

//Provides sliding effect for the alert dialog box.
const Transition = React.forwardRef(function Transition(props, ref) {
    return <Slide direction="up" ref={ref} {...props} />;
});

const useStyles = makeStyles((theme) => ({
    root: {
        display: 'inline-flex',
        position: 'inherit',
        flexDirection: 'column',
        marginTop: -5,
        left: "50% !important",
        alignItems: "flex-start !important",
        justifyContent: "center",
        fontFamily: ['Segoe UI'],
        fontWeight: 500,
        paddingLeft: 20,
        [theme.breakpoints.down('xs')]: {
            flexDirection: 'column',
        },

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
        padding: "10px",
        background: "#2e3b6f",
        '&:hover': {
            boxShadow: "rgba(0, 0, 0, 0.35) 0px 5px 15px",
        },
    },
    typo: {
        fontSize: "1.25rem",
        top: "0px",
        left: "2px",
        zIndex: 1,
        fontFamily: ['Segoe UI'],
        fontWeight: 500,
    },
}));


const EmailDialog = ({ children }) => {
    const [open, setOpen] = useState(false);
    const [Emailvalue, setEmailValue] = useState("");
    const [IDvalue, setIDValue] = useState("");
    const { name } = useContext(SocketContext);
    const classes = useStyles();

    const handleEmailChange = e => {
        setEmailValue(e.target.value);
    };

    const handleIDChange = e => {
        setIDValue(e.target.value);
    };

    const handleClickOpen = () => {
        setOpen(true);
    };

    const handleClose = () => {
        setOpen(false);
    };


    const handleSubmit = (event) => {
        event.preventDefault();

        var data = {
            to_email: Emailvalue,
            from_name: name,
            id: IDvalue,
        };

        emailjs.send('service_4pjoz2e', 'template_9ns1die', data, 'user_vOygeRxHiVbevGHdYl7tf') //EmailJS service credentials 
            .then((result) => {
                console.log(result.text);
                Swal.fire(
                    'Successful!',
                    'An email was sent to the recipient email ID!',
                    'success'
                )
            }, (error) => {
                console.log(error.text);
                Swal.fire(
                    'Error!',
                    'Aw snap! An error occurred!',
                    'error'
                )
            });

        handleClose();
    }

    return (
        <div className={classes.root}>
            <Button variant="contained" startIcon={<EmailIcon fontSize="large" />} color="primary" fullWidth onClick={handleClickOpen}>
                Send ID by Email
            </Button>
            <Dialog open={open} onClose={handleClose} TransitionComponent={Transition} aria-labelledby="form-dialog-title">
                <DialogTitle className={classes.typo} id="form-dialog-title"> Email your ID </DialogTitle>
                <DialogContent className={classes.typo}>
                    <DialogContentText>
                        Hey {name}, copy your ID and send it to the recipient by Email!
                    </DialogContentText>
                    <TextField                          //TextField for ID
                        margin="dense"
                        label="Your ID"
                        value={IDvalue}
                        onChange={handleIDChange}
                        variant="outlined"
                        fullWidth
                        required
                    />
                    <TextField                         //TextField for Email 
                        margin="dense"
                        label="Email Address"
                        type="email"
                        value={Emailvalue}
                        onChange={handleEmailChange}
                        variant="outlined"
                        fullWidth
                        required
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleSubmit} color="primary">
                        Send Email
                    </Button>
                    <Button onClick={handleClose} color="primary">
                        Cancel
                    </Button>
                </DialogActions>
            </Dialog>
            {children}
        </div>
    );
};

export default EmailDialog;