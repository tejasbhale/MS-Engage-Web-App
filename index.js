const app = require("express")();
const server = require("http").createServer(app);
const cors = require("cors");

const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Server running");
});

io.on("connection", (socket) => {
  //callback function providing socket for real time data transmission

  socket.emit("me", socket.id); //Emits my ID as soon as the connection is opened.

  socket.on("disconnect", () => {
    //Socket Handler for disconnecting call
    socket.broadcast.emit("CallEnded");
  });

  socket.on("CallUser", ({ userToCall, signalData, from, name }) => {
    //Socket Handler for Calling user
    io.to(userToCall).emit("CallUser", { signal: signalData, from, name });
  });

  socket.on("message", ({ name, message }) => {
    //Socket Handler for chat functionality
    io.emit("message", { name, message });
  });

  socket.on("AnswerCall", (data) => {
    //Socket Handler for Answering the call
    io.to(data.to).emit("CallAccepted", data.signal);
  });
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
