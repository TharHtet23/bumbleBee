import express from "express";
import dotenv from "dotenv";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";
import http from 'http';
import { Server } from 'socket.io';
import { EventEmitter } from 'events';
import connectToMongoDB from "./config/connectMongoDb.js";

const eventEmitter = new EventEmitter();

dotenv.config();

import authRoute from "./routes/auth.route.js";
import schoolRoute from "./routes/school.route.js";
import classRoute from "./routes/class.route.js";
import userRoute from "./routes/user.route.js";
import postRoute from "./routes/post.route.js";
import studentRoute from "./routes/student.route.js";
import requestRoute from "./routes/request.route.js";
import testRoute from "./routes/test.route.js";
import leaveRequestRoute from "./routes/leaveRequest.route.js";
import leaveRequestTypeRoute from "./routes/leaveRequestType.route.js";
import imageRoute from "./routes/image.route.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware to attach Socket.IO instance to request
// app.use((req, res, next) => {
//     req.io = io; // Attach the Socket.IO instance to the request
//     next();
// });

// CORS configuration
app.use(cors({
    origin: "*", // Adjust this to your frontend URL for production
    credentials: true,
    
}));

// // Define allowed origins for testing
// const allowedOrigins = ['http://localhost:3000']; // Add your testing frontend URL here

// // CORS configuration
// app.use(cors({
//     origin: (origin, callback) => {
//         if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
//             callback(null, true); // Allow the request
//         } else {
//             callback(new Error('Not allowed by CORS')); // Reject the request
//         }
//     },
//     credentials: true
// }));

// middlewares
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
    "/uploads/post_images",
    express.static(path.join(__dirname, "uploads/post_images"))
);
app.use(
    "/uploads/profile_pictures",
    express.static(path.join(__dirname, "uploads/profile_pictures"))
);

// auth api
app.use("/api/auth", authRoute);

// auth school
app.use("/api/school", schoolRoute);
app.use("/api/class", classRoute);

// auth user
app.use("/api/user", userRoute);

// auth posts
app.use("/api/posts", postRoute);

//student
app.use("/api/student", studentRoute);

// request
app.use("/api/request", requestRoute);

app.use("/api/test/", testRoute);

//this is for the leave request for the guardians to make for their children
app.use("/api/leaveRequest", leaveRequestRoute);

//this is to create the leave request type like sick leave, annual leave, etc 
app.use("/api/leaveRequestType", leaveRequestTypeRoute);

//image
app.use("/api/image", imageRoute);

app.use("*", (req, res) => {
    res.status(404).json({ con: false, msg: "Invalid route" });
});

// Error handling middleware
app.use((err, req, res, next) => {
    err.status = err.status || 505;
    res.status(err.status).json({ con: false, msg: err.message });
});

// SSE endpoint
app.get('/api/progress', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Send progress updates
    const sendProgress = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // Listen for progress events
    eventEmitter.on('progress', sendProgress);

    // Clean up when the connection is closed
    req.on('close', () => {
        eventEmitter.removeListener('progress', sendProgress);
        res.end();
    });
});

// Start the server
server.listen(3000, () => {
    connectToMongoDB();
    console.log('Server is running on port 3000');
});

// Serve the HTML file for testing
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html')); // Adjust the path if necessary
});

// Serve the HTML file for posting
app.get('/posting', (req, res) => {
    res.sendFile(path.join(__dirname, 'posting.html')); // Adjust the path if necessary
});

// Add this line at the end of your server.js file
export { eventEmitter };
