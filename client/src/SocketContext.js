//This file contains all the socket logic pertaining to the video calling feature.

import React, { createContext, useState, useRef, useEffect } from "react";
import Peer from "simple-peer";
import { io } from "socket.io-client";

const SocketContext = createContext();

const socket = io("https://ms-teams-clone-tejas.herokuapp.com/");

const ContextProvider = ({ children }) => {
  const [stream, setStream] = useState(); //useState for setting stream of a user.
  const [me, setMe] = useState("");
  const [call, setCall] = useState({});
  const [CallAccepted, setCallAccepted] = useState(false);
  const [CallEnded, setCallEnded] = useState(false);
  const [name, setName] = useState("");

  const myVideo = useRef(); //To Instantly populate video iFrame with source of the ref.
  const userVideo = useRef();
  const connectionRef = useRef();

  //Mounting component.
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true }) //Asks for webcam and microphone permission in the browser.
      .then((currentStream) => {
        setStream(currentStream); //Sets stream to current stream once permission is provided.

        myVideo.current.srcObject = currentStream; //Populates video iFrame with feed.
      });

    socket.on("me", (id) => setMe(id)); //We get the ID from the backend and set it using a use state.

    socket.on("CallUser", ({ from, name: callerName, signal }) => {
      setCall({ isReceivingCall: true, from, name: callerName, signal }); //
    });
  }, []);
  //useState has an empty dependancy array at the end to prevent it from always running.

  const AnswerCall = () => {
    setCallAccepted(true); //State set to true when call is answered.

    const peer = new Peer({ initiator: false, trickle: false, stream }); 
    //initiator is false since a call is only being answered and not initiated.

    peer.on("signal", (data) => {
      socket.emit("AnswerCall", { signal: data, to: call.from }); 
    }); 
    //sockets intertwined with peers to establish video connection by answering call.

    peer.on("stream", (currentStream) => {
      userVideo.current.srcObject = currentStream; //setting other users video.
    });

    peer.signal(call.signal);

    connectionRef.current = peer; //Current connection equals current peer inside the connection.
  };

  const CallUser = (id) => {
    const peer = new Peer({ initiator: true, trickle: false, stream }); //initiator true because call needs to be inititated.

    peer.on("signal", (data) => {
      socket.emit("CallUser", {
        userToCall: id,
        signalData: data,
        from: me,
        name,
      });
    });

    peer.on("stream", (currentStream) => {
      userVideo.current.srcObject = currentStream;
    });

    socket.on("CallAccepted", (signal) => {
      setCallAccepted(true);

      peer.signal(signal);
    });

    connectionRef.current = peer;
  };

  const leaveCall = () => {
    setCallEnded(true); //State set to true when call is ended.

    connectionRef.current.destroy(); //destroys the established connection.

    window.location.reload(); //reloads page and provides user with new ID.
  };

  return (
    <SocketContext.Provider //returns all of the context.
      value={{
        call,
        CallAccepted,
        myVideo,
        userVideo,
        stream,
        name,
        setName,
        CallEnded,
        me,
        CallUser,
        leaveCall,
        AnswerCall,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export { ContextProvider, SocketContext };
