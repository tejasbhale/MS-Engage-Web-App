//This file contains all the socket logic pertaining to the video calling feature.

import React, { createContext, useState, useRef, useEffect } from "react";
import Peer from "simple-peer";
import { io } from "socket.io-client";

const SocketContext = createContext();

//withCredentials sends the httpOnly session cookie on the handshake, so the
//server can verify who this socket belongs to (names are stamped server-side).
const socket = io(process.env.REACT_APP_API_URL || "http://localhost:5001", {
  withCredentials: true,
});

//Dev-only hook so tests can drive socket events from the page.
if (process.env.NODE_ENV === "development") window.__ctSocket = socket;

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
        //Start muted: mic and camera are OFF by default. The track is still
        //acquired (WebRTC needs it) but disabled until the user turns it on
        //from the call controls — enabling a track needs no renegotiation.
        currentStream.getTracks().forEach((track) => (track.enabled = false));

        setStream(currentStream); //Sets stream to current stream once permission is provided.

        myVideo.current.srcObject = currentStream; //Populates video iFrame with feed.
      });

    socket.on("me", (id) => setMe(id)); //We get the ID from the backend and set it using a use state.

    //The socket connects when the app bundle loads, which can be well before
    //this provider mounts (it is scoped to the room route) — so the "me"
    //event may already have fired. Read the ID directly and track reconnects.
    if (socket.connected) setMe(socket.id);
    socket.on("connect", () => setMe(socket.id));

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

    socket.on("CallAccepted", ({ signal, name: hostName }) => {
      setCallAccepted(true);

      //The joiner never received a CallUser event, so this is how it learns
      //the name of the host it just connected to (shown on the remote tile).
      if (hostName) setCall((c) => ({ ...c, name: hostName }));

      peer.signal(signal);
    });

    connectionRef.current = peer;
  };

  const endCall = () => {
    //Ends the call in place (no navigation) so the room can show the
    //post-call summary screen: destroys the peer and releases the camera.
    setCallEnded(true);
    if (connectionRef.current) connectionRef.current.destroy();
    if (stream) stream.getTracks().forEach((track) => track.stop());
  };

  const leaveCall = () => {
    setCallEnded(true); //State set to true when call is ended.

    connectionRef.current.destroy(); //destroys the established connection.

    //Full navigation (not SPA route) so the socket reconnects with a fresh ID
    //and the camera is released, then lands on the authenticated home screen.
    window.location.href = "/home";
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
        endCall,
        AnswerCall,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export { ContextProvider, SocketContext, socket };
