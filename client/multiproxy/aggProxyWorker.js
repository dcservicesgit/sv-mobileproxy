// proxyWorker.js
var worker_threads = require('worker_threads');
var cluster = require('cluster');
var os = require('os');
var http = require('http');
var net = require('net');
var URL = require('url').URL;
const { PassThrough } = require('stream');

var username, password, remoteProxyUrl, blocklist, auth, remoteProxy;

// This object will accumulate data usage per domain in each clustered (child) process.
var aggregatedUsage = {}; // e.g., { "example.com": { upload: 12345, download: 67890 } }

function incrementUsage(domain, direction, numBytes) {
    if (!domain) return;
    if (!aggregatedUsage[domain]) {
        aggregatedUsage[domain] = { upload: 0, download: 0 };
    }
    aggregatedUsage[domain][direction] += numBytes;
}

// Helper to send usage update to the parent process.
function sendUsageUpdate() {
    if (Object.keys(aggregatedUsage).length > 0) {
        const update = { type: 'usageUpdate', data: aggregatedUsage };
        // Send update using process.send (for cluster workers) if available,
        // otherwise, try worker_threads.parentPort.
        if (process.send) {
            process.send(update);
        } else if (worker_threads.parentPort) {
            worker_threads.parentPort.postMessage(update);
        }

        // console.dir(aggregatedUsage)
        // Reset the aggregation object after sending the update.
        //aggregatedUsage = {};
    }
}

// Send updates every second.
setInterval(sendUsageUpdate, 500);

if (cluster.isMaster) {
    // In the master branch, read configuration from the worker thread’s data.
    var workerData = worker_threads.workerData;
    username = workerData.username;
    password = workerData.password;
    remoteProxyUrl = workerData.remoteProxyUrl;
    blocklist = workerData.blocklist; // expected to be an array of lower-case domains
    auth = "Basic " + Buffer.from(username + ":" + password).toString("base64");
    remoteProxy = new URL(remoteProxyUrl);

    // Create a temporary server to acquire an ephemeral port.
    var tempServer = http.createServer();
    tempServer.listen(0, function () {
        var port = tempServer.address().port;
        tempServer.close(function () {
            // Fork a worker for each CPU core.
            var numCPUs = 4;
            for (var i = 0; i < numCPUs; i++) {
                cluster.fork({
                    PORT: port,
                    USERNAME: username,
                    PASSWORD: password,
                    REMOTE_PROXY_URL: remoteProxyUrl,
                    BLOCKLIST: JSON.stringify(blocklist)
                });
            }
            // Notify the parent thread (the Worker that loaded this file) of the port.
            worker_threads.parentPort.postMessage({ port: port });
        });
    });

    // Forward usage updates from cluster children to the parent (worker thread)
    cluster.on('message', (worker, msg) => {
        if (msg && msg.type === 'usageUpdate') {
            // Forward the usage update up to the worker thread's parent.
            if (worker_threads.parentPort) {
                worker_threads.parentPort.postMessage(msg);
            }
        }
    });

    cluster.on('exit', function (worker, code, signal) {
        console.error("[ERROR] Cluster worker " + worker.process.pid + " died with exit code " + code);
    });
} else {
    // In each clustered worker process, read configuration from environment variables.
    username = process.env.USERNAME;
    password = process.env.PASSWORD;
    remoteProxyUrl = process.env.REMOTE_PROXY_URL;
    blocklist = JSON.parse(process.env.BLOCKLIST || '[]');
    auth = "Basic " + Buffer.from(username + ":" + password).toString("base64");
    remoteProxy = new URL(remoteProxyUrl);

    // Create a keep-alive agent for outgoing HTTP requests.
    var proxyAgent = new http.Agent({
        keepAlive: true,
        maxSockets: 100
    });

    // Create the HTTP server that handles regular HTTP proxying.
    var server = http.createServer(function (clientReq, clientRes) {
        // For HTTP requests, determine the destination domain.
        // (Typically provided in the Host header.)
        var domain = clientReq.headers.host;

        // Make a shallow copy of the request headers, remove any existing auth info,
        // and then add our Proxy-Authorization header.
        var headers = Object.assign({}, clientReq.headers);
        delete headers.authorization;
        delete headers.Authorization;
        headers["Proxy-Authorization"] = auth;

        var options = {
            hostname: remoteProxy.hostname,
            port: remoteProxy.port || 80,
            method: clientReq.method,
            path: clientReq.url,
            headers: headers,
            agent: proxyAgent,
            timeout: 10000
        };

        var proxyReq = http.request(options, function (proxyRes) {
            clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);

            // Create PassThrough streams so we can count the data going downstream.
            var resCounter = new PassThrough();
            resCounter.on('data', function (chunk) {
                incrementUsage(domain, 'download', chunk.length);
            });
            // Pipe the response from the remote proxy through our counter and then to the client.
            proxyRes.pipe(resCounter).pipe(clientRes, { end: true });
        });

        proxyReq.on('error', function (err) {
            console.error("[ERROR] Proxy request error: " + err.message);
            if (!clientRes.headersSent) { clientRes.writeHead(500); }
            clientRes.end("Internal Server Error");
        });

        proxyReq.on('timeout', function () {
            console.error("[ERROR] Proxy request timed out");
            proxyReq.destroy();
            if (!clientRes.headersSent) { clientRes.writeHead(504); }
            clientRes.end("Gateway Timeout");
        });

        // For the upstream (client → proxy) data, use a PassThrough counter.
        var reqCounter = new PassThrough();
        reqCounter.on('data', function (chunk) {
            incrementUsage(domain, 'upload', chunk.length);
        });
        clientReq.pipe(reqCounter).pipe(proxyReq, { end: true });
    });

    // Handle HTTPS tunneling via CONNECT.
    server.on('connect', function (req, clientSocket, head) {
        var parts = req.url.split(":");
        var destHostname = parts[0];
        var destPort = parseInt(parts[1], 10) || 443;

        if (blocklist.indexOf(destHostname.toLowerCase()) !== -1) {
            console.warn("[WARN] Blocked CONNECT request for: " + destHostname);
            clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            clientSocket.end();
            return;
        }

        var proxySocket = net.connect(remoteProxy.port || 80, remoteProxy.hostname, function () {
            var connectReq = "CONNECT " + destHostname + ":" + destPort + " HTTP/1.1\r\n" +
                "Host: " + destHostname + ":" + destPort + "\r\n" +
                "Proxy-Authorization: " + auth + "\r\n" +
                "\r\n";
            proxySocket.write(connectReq);
        });

        proxySocket.setTimeout(10000, function () {
            //console.error("[ERROR] Proxy socket timeout");
            proxySocket.destroy();
            clientSocket.end("HTTP/1.1 504 Gateway Timeout\r\n\r\n");
        });

        proxySocket.once("data", function (chunk) {
            var response = chunk.toString();
            if (response.indexOf("200") === -1) {
                console.error("[ERROR] Remote proxy CONNECT failed: " + response);
                clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
                clientSocket.end();
                proxySocket.end();
                return;
            }
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (head && head.length) { proxySocket.write(head); }

            // Instead of directly piping between sockets, we insert PassThrough streams
            // to count data:
            var clientToProxy = new PassThrough();
            var proxyToClient = new PassThrough();

            clientToProxy.on('data', function (chunk) {
                // Data from client (upload) going to the destination.
                incrementUsage(destHostname, 'upload', chunk.length);
            });
            proxyToClient.on('data', function (chunk) {
                // Data from destination (download) going to the client.
                incrementUsage(destHostname, 'download', chunk.length);
            });

            // Pipe the data between the two sockets via our counter streams.
            clientSocket.pipe(clientToProxy).pipe(proxySocket);
            proxySocket.pipe(proxyToClient).pipe(clientSocket);
        });

        proxySocket.on("error", function (err) {
            console.error("[ERROR] Proxy socket error: " + err.message);
            clientSocket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
            clientSocket.end();
        });

        clientSocket.on("error", function (err) {
            console.error("[ERROR] Client socket error: " + err.message);
            proxySocket.end();
        });

        clientSocket.on("close", function () { proxySocket.end(); });
        proxySocket.on("close", function () { clientSocket.end(); });
    });

    server.on("error", function (err) {
        console.error("[ERROR] Server error: " + err.message);
    });

    // Each clustered worker listens on the shared port.
    server.listen(process.env.PORT, function () {
        console.info("[INFO] Proxy process " + process.pid + " started listening on port " + process.env.PORT);
    });
}
