const { workerData, parentPort } = require("worker_threads");
const http = require("http");
const net = require("net");
const { PassThrough } = require("stream");

let { outboundIP, uniqueid, blocklist } = workerData;
let aggregatedUsage = {}; // Tracks data usage

function incrementUsage(domain, direction, numBytes) {
    if (!domain) return;
    if (!aggregatedUsage[domain]) {
        aggregatedUsage[domain] = { upload: 0, download: 0 };
    }
    aggregatedUsage[domain][direction] += numBytes;
}

// Periodically send usage updates to the parent
setInterval(() => {
    if (Object.keys(aggregatedUsage).length > 0) {
        parentPort.postMessage({ type: "usageUpdate", data: aggregatedUsage });
        aggregatedUsage = {}; // Reset after sending
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
        console.error(`[ERROR] Proxy request error: ${err.message}`);
        clientRes.writeHead(500);
        clientRes.end("Internal Server Error");
    });

    proxyReq.on("timeout", () => {
        console.error("[ERROR] Proxy request timeout");
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
    });

    targetSocket.on("error", (err) => {
        console.error(`[ERROR] Target connection error: ${err.message}`);
        clientSocket.end();
    });

    clientSocket.on("error", (err) => {
        console.error(`[ERROR] Client connection error: ${err.message}`);
        targetSocket.end();
    });
});

// Handle terminate message
parentPort.on("message", (msg) => {
    if (msg.type === "terminate") {
        console.info("[INFO] Terminating worker process");
        server.close(() => process.exit(0));
    }
});

// Start the server
server.listen(0, () => {
    const port = server.address().port;
    console.info(`[INFO] Worker ${uniqueid} started on port ${port}`);
    parentPort.postMessage({ port });
});
