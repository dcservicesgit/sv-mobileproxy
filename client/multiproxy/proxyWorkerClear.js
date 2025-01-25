// proxyWorkerClear.js
const http = require("http");
const net = require("net");
const { PassThrough } = require("stream");

/**
 * Simple logger function for workers.
 * @param {string} type - The type of log (info, error, etc.).
 * @param {string} message - The log message.
 */
const logger = (type, message) => {
    console.log(`[Worker ${process.env.UNIQUE_ID}][${type.toUpperCase()}] ${message}`);
};

// Retrieve configuration from environment variables
const outboundIP = process.env.OUTBOUND_IP;
const uniqueid = process.env.UNIQUE_ID;
const blocklist = JSON.parse(process.env.BLOCKLIST || "[]");
const port = parseInt(process.env.PORT, 10);

let aggregatedUsage = {}; // Tracks data usage

// Error Handling
process.on('uncaughtException', (err) => {
    logger("error", `Uncaught Exception: ${err.stack || err}`);
    process.exit(1); // Exit to allow master to handle respawning if necessary
});

process.on('unhandledRejection', (reason, promise) => {
    logger("error", `Unhandled Rejection at: ${promise} reason: ${reason}`);
    process.exit(1); // Exit to allow master to handle respawning if necessary
});

/**
 * Increments usage statistics for a given domain and direction.
 * @param {string} domain - The domain being accessed.
 * @param {string} direction - 'upload' or 'download'.
 * @param {number} numBytes - The number of bytes transferred.
 */
function incrementUsage(domain, direction, numBytes) {
    if (!domain) return;
    if (!aggregatedUsage[domain]) {
        aggregatedUsage[domain] = { upload: 0, download: 0 };
    }
    aggregatedUsage[domain][direction] += numBytes;
}

// Periodically send usage updates to the master
setInterval(() => {
    if (Object.keys(aggregatedUsage).length > 0) {
        process.send({ type: "usageUpdate", data: aggregatedUsage });
        // Optionally, reset aggregatedUsage if needed
        aggregatedUsage = {};
    }
}, 1000);

// Create the HTTP proxy server
const server = http.createServer((clientReq, clientRes) => {
    const domain = clientReq.headers.host;

    if (blocklist.includes(domain.toLowerCase())) {
        clientRes.writeHead(403, { "Content-Type": "text/plain" });
        clientRes.end("Blocked by proxy");
        return;
    }

    const options = {
        hostname: domain.split(":")[0],
        port: domain.split(":")[1] || 80,
        method: clientReq.method,
        path: clientReq.url,
        headers: clientReq.headers,
        timeout: 10000,
        localAddress: outboundIP, // Bind to the specific outbound IP
    };

    const proxyReq = http.request(options, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);

        const resCounter = new PassThrough();
        resCounter.on("data", (chunk) => incrementUsage(domain, "download", chunk.length));
        proxyRes.pipe(resCounter).pipe(clientRes);
    });

    proxyReq.on("error", (err) => {
        logger("error", `Proxy request error: ${err.message}`);
        clientRes.writeHead(500);
        clientRes.end("Internal Server Error");
    });

    proxyReq.on("timeout", () => {
        logger("error", "Proxy request timeout");
        proxyReq.destroy();
        clientRes.writeHead(504);
        clientRes.end("Gateway Timeout");
    });

    const reqCounter = new PassThrough();
    reqCounter.on("data", (chunk) => incrementUsage(domain, "upload", chunk.length));
    clientReq.pipe(reqCounter).pipe(proxyReq);
});

// Handle HTTPS tunneling (CONNECT)
server.on("connect", (req, clientSocket, head) => {
    const [hostname, port] = req.url.split(":");

    if (blocklist.includes(hostname.toLowerCase())) {
        clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        clientSocket.end();
        return;
    }

    const targetSocket = net.connect({
        host: hostname,
        port: port || 443,
        localAddress: outboundIP, // Bind to the specific outbound IP
    });

    targetSocket.on("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        targetSocket.write(head);
        clientSocket.pipe(targetSocket).pipe(clientSocket);
        clientSocket.on("data", (chunk) => incrementUsage(hostname, "upload", chunk.length));
        targetSocket.on("data", (chunk) => incrementUsage(hostname, "download", chunk.length));
    });

    targetSocket.on("error", (err) => {
        logger("error", `Target connection error: ${err.message}`);
        clientSocket.end();
    });

    clientSocket.on("error", (err) => {
        logger("error", `Client connection error: ${err.message}`);
        targetSocket.end();
    });
});

// Handle terminate message from the master
process.on("message", (msg) => {
    if (msg.type === "terminate") {
        logger("info", "Terminating worker process");
        server.close(() => process.exit(0));
    }
});

// Start the server
server.listen(port, '0.0.0.0', () => {
    logger('info', `Proxy server listening on port ${port}`);
    process.send({ type: "initialized", port });
});
