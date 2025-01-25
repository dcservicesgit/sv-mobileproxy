// aggProxyWorker.js
const http = require('http');
const net = require('net');
const { PassThrough } = require('stream');
const crypto = require('crypto');
const chalk = require('chalk');

// Initialize configurations from environment variables or process arguments
const uniqueid = process.env.UNIQUE_ID || `Worker-${process.pid}`;
const blocklist = process.env.BLOCKLIST ? JSON.parse(process.env.BLOCKLIST) : [];

// Send UNIQUE_ID to master process once the worker is ready
process.send({ type: 'ready', uniqueid });

// Global error handlers to prevent worker from crashing
process.on('uncaughtException', (err) => {
    console.error(`[${uniqueid}] Uncaught Exception: ${err.stack || err}`);
    // Optionally, you can exit or attempt to recover
    // process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`[${uniqueid}] Unhandled Rejection at:`, promise, 'reason:', reason);
    // Optionally, you can exit or attempt to recover
    // process.exit(1);
});

// Initialize usage tracking
const aggregatedUsage = {}; // e.g., { "example.com": { upload: 12345, download: 67890 } }

/**
 * Increments the usage statistics for a given domain and direction.
 * @param {string} domain - The domain name.
 * @param {string} direction - 'upload' or 'download'.
 * @param {number} numBytes - Number of bytes to increment.
 */
function incrementUsage(domain, direction, numBytes) {
    if (!domain) return;
    if (!aggregatedUsage[domain]) {
        aggregatedUsage[domain] = { upload: 0, download: 0 };
    }
    aggregatedUsage[domain][direction] += numBytes;
}

/**
 * Sends usage updates to the master process at regular intervals.
 */
function sendUsageUpdate() {
    if (Object.keys(aggregatedUsage).length > 0) {
        const update = { type: 'usageUpdate', data: aggregatedUsage };
        process.send(update);
        // Optionally reset the aggregation after sending
        // Object.keys(aggregatedUsage).forEach(domain => {
        //     aggregatedUsage[domain].upload = 0;
        //     aggregatedUsage[domain].download = 0;
        // });
    }
}

// Send usage updates every second.
setInterval(sendUsageUpdate, 1000);

/**
 * Port Pool and Connection Management
 * These will be managed per worker.
 */
let portPool = process.env.PORT_POOL ? JSON.parse(process.env.PORT_POOL) : [];
const activeConnections = new Map();
portPool.forEach(port => activeConnections.set(port, 0));

/**
 * Mapping table to track username/password to port assignments.
 * Structure: { 'username:password': { port: number, timeout: Timeout } }
 */
const credentialToPortMap = new Map();

/**
 * Selects an available proxy port not currently assigned to any credentials.
 * @param {boolean} bypass - If true, bypass the assignment limit.
 * @returns {number|null} - Selected proxy port or null if no ports are available.
 */
function selectAvailableProxyPort(bypass) {
    const assignedPorts = new Set();
    if (!bypass) {
        for (const { port } of credentialToPortMap.values()) {
            assignedPorts.add(port);
        }
    }

    const availablePorts = portPool.filter(port => !assignedPorts.has(port));
    console.log(`[${uniqueid}] Available ports for assignment: ${availablePorts.join(', ')}`);

    if (availablePorts.length === 0) return null;

    // Randomly select an available port
    const randomIndex = Math.floor(Math.random() * availablePorts.length);
    const selectedPort = availablePorts[randomIndex];
    console.log(`[${uniqueid}] Selected available port ${selectedPort} for new credentials.`);
    return selectedPort;
}

/**
 * Assigns a port to the given username/password pair.
 * @param {string} username - Username.
 * @param {string} password - Password.
 * @returns {number|null} - Assigned proxy port or null if no ports are available.
 */
function assignPortToCredentials(username, password) {
    const credentialKey = `${username}:${password}`;

    if (credentialToPortMap.has(credentialKey)) {
        // Credentials already have an assigned port
        const existingPort = credentialToPortMap.get(credentialKey).port;
        return existingPort;
    }

    let bypasslimit = false;
    if (username === 'system') {
        bypasslimit = true;
    }

    // Assign a new port
    const port = selectAvailableProxyPort(bypasslimit);
    if (!port) {
        console.warn(`[${uniqueid}] No available ports to assign for credentials ${credentialKey}`);
        return null;
    }

    // Set a timeout to release the mapping after 5 minutes (300,000 ms)
    const timeout = setTimeout(() => {
        releasePortFromCredentials(username, password);
    }, 5 * 60 * 1000); // 5 minutes

    if (bypasslimit) {
        console.log(`[${uniqueid}] Bypass limit for credentials ${credentialKey}. Assigned port ${port} without mapping.`);
        return port;
    }

    // Store the mapping
    credentialToPortMap.set(credentialKey, { port, timeout });
    console.log(`[${uniqueid}] Assigned port ${port} to credentials ${credentialKey} for 5 minutes`);

    return port;
}

/**
 * Releases the port assignment for the given username/password pair.
 * @param {string} username - Username.
 * @param {string} password - Password.
 */
function releasePortFromCredentials(username, password) {
    const credentialKey = `${username}:${password}`;
    const mapping = credentialToPortMap.get(credentialKey);

    if (mapping) {
        clearTimeout(mapping.timeout);
        credentialToPortMap.delete(credentialKey);
        console.log(`[${uniqueid}] Released port ${mapping.port} from credentials ${credentialKey}`);
    }
}

/**
 * Updates the portPool and resets activeConnections map.
 * @param {Array<number>} newPortPool - Updated array of proxy ports.
 */
function updatePortPool(newPortPool) {
    portPool = Array.isArray(newPortPool) ? newPortPool : [];
    activeConnections.clear();
    portPool.forEach(port => activeConnections.set(port, 0));
    console.log(`[${uniqueid}] portPool updated: ${portPool}`);
}

/**
 * Handles incoming HTTP requests by routing them to the assigned proxy port based on credentials.
 */
const server = http.createServer((clientReq, clientRes) => {
    // Extract Proxy-Authorization from headers
    const authHeader = clientReq.headers['proxy-authorization'];
    if (!authHeader || !authHeader.startsWith('Basic ')) {
        // Respond with 407 Proxy Authentication Required
        clientRes.write(
            "HTTP/1.1 407 Proxy Authentication Required\r\n" +
            "Proxy-Authenticate: Basic realm=\"Proxy\"\r\n" +
            "\r\n"
        );
        clientRes.writeHead(407, { 'Content-Type': 'text/plain' });
        clientRes.end('Proxy authentication required.');
        return;
    }

    // Decode Base64 credentials
    const base64Credentials = authHeader.slice(6).trim();
    let credentials;
    try {
        credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    } catch (err) {
        console.error(`[${uniqueid}] Error decoding credentials: ${err.message}`);
        clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
        return clientRes.end('Invalid Authorization header.');
    }

    const [username, password] = credentials.split(':');
    if (!username || !password) {
        console.error(`[${uniqueid}] Invalid credentials format.`);
        clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
        return clientRes.end('Invalid credentials format.');
    }

    // Assign or retrieve the port for these credentials
    const proxyPort = assignPortToCredentials(username, password);

    if (!proxyPort) {
        clientRes.writeHead(503, { 'Content-Type': 'text/plain' });
        return clientRes.end('No available proxy ports.');
    }

    // Increment the active connection count for the assigned proxy port
    incrementConnection(proxyPort);
    console.log(`[${uniqueid}] Assigned connection to proxy port ${proxyPort} for credentials ${username}:${password}`);

    // Forward the request to the selected local proxy server
    const options = {
        hostname: '127.0.0.1',
        port: proxyPort,
        path: clientReq.url,
        method: clientReq.method,
        headers: clientReq.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
        clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);

        // PassThrough stream to count download data
        const resCounter = new PassThrough();
        resCounter.on('data', (chunk) => {
            const domain = clientReq.headers.host || 'unknown';
            incrementUsage(domain, 'download', chunk.length);
        });

        proxyRes.pipe(resCounter).pipe(clientRes, { end: true });
    });

    // Attach error handler before piping
    proxyReq.on('error', (err) => {
        console.error(`[${uniqueid}][Proxy Port ${proxyPort}] Proxy request error: ${err.stack || err.message}`);
        if (!clientRes.headersSent) {
            clientRes.writeHead(500);
        }
        clientRes.end('Internal Server Error');
        // Decrement the active connection count on error
        decrementConnection(proxyPort);
    });

    // PassThrough stream to count upload data
    const reqCounter = new PassThrough();
    reqCounter.on('data', (chunk) => {
        const domain = clientReq.headers.host || 'unknown';
        incrementUsage(domain, 'upload', chunk.length);
    });

    clientReq.pipe(reqCounter).pipe(proxyReq, { end: true });

    // Handle timeout
    proxyReq.on('timeout', () => {
        console.error(`[${uniqueid}][Proxy Port ${proxyPort}] Proxy request timed out`);
        proxyReq.destroy();
        if (!clientRes.headersSent) {
            clientRes.writeHead(504);
        }
        clientRes.end('Gateway Timeout');
        // Decrement the active connection count on timeout
        decrementConnection(proxyPort);
    });

    // When the client response finishes, decrement the active connection count
    clientRes.on('finish', () => {
        decrementConnection(proxyPort);
        console.log(`[${uniqueid}] Connection to proxy port ${proxyPort} closed.`);
    });
});

/**
 * Handles HTTPS tunneling via CONNECT method by routing them to the assigned proxy port based on credentials.
 */
server.on('connect', (req, clientSocket, head) => {
    // Log the start of the CONNECT handler
    console.log(`[${uniqueid}] Received CONNECT request for: ${chalk.blue(req.url)}`);

    // Extract Proxy-Authorization from headers
    const proxyAuthHeader = req.headers['proxy-authorization'];
    if (!proxyAuthHeader || !proxyAuthHeader.startsWith('Basic ')) {
        // Respond with 407 Proxy Authentication Required
        clientSocket.write(
            "HTTP/1.1 407 Proxy Authentication Required\r\n" +
            "Proxy-Authenticate: Basic realm=\"Proxy\"\r\n\r\n"
        );
        clientSocket.end('Proxy authentication required.');
        return;
    }

    // Decode Base64 credentials
    const base64Credentials = proxyAuthHeader.slice(6).trim();
    let credentials;
    try {
        credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    } catch (err) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.end('Invalid Proxy-Authorization header.');
        return;
    }

    const [username, password] = credentials.split(':');
    if (!username || !password) {
        clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        clientSocket.end('Invalid credentials format.');
        return;
    }

    // Assign or retrieve the port for these credentials
    const proxyPort = assignPortToCredentials(username, password);

    if (!proxyPort) {
        clientSocket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        return clientSocket.end('No available proxy ports.');
    }

    // Increment the active connection count for the assigned proxy port
    incrementConnection(proxyPort);

    const [destHostname, destPort] = req.url.split(':');

    // Check against the blocklist
    if (blocklist.map(domain => domain.toLowerCase()).includes(destHostname.toLowerCase())) {
        console.warn(`[${uniqueid}] Blocked CONNECT request for: ${destHostname}`);
        clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        clientSocket.end();
        // Decrement the active connection count for blocked requests
        decrementConnection(proxyPort);
        return;
    }

    // Establish a connection to the downstream proxy using net.connect
    const downstreamSocket = net.connect(proxyPort, '127.0.0.1', () => {
        // Send the CONNECT request to the downstream proxy
        downstreamSocket.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n\r\n`);
    });

    // Handle downstream proxy response
    downstreamSocket.once('data', (data) => {
        const response = data.toString();
        const [statusLine] = response.split('\r\n');
        const [httpVersion, statusCode, ...statusMessageParts] = statusLine.split(' ');
        const statusMessage = statusMessageParts.join(' ');

        if (statusCode === '200') {
            // Connection established
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            // Pipe the sockets
            downstreamSocket.pipe(clientSocket);
            clientSocket.pipe(downstreamSocket);

            // Data counting for CONNECT
            downstreamSocket.on('data', (chunk) => {
                const domain = destHostname || 'unknown';
                incrementUsage(domain, 'download', chunk.length);
            });

            clientSocket.on('data', (chunk) => {
                const domain = destHostname || 'unknown';
                incrementUsage(domain, 'upload', chunk.length);
            });
        } else {
            console.error(`[${uniqueid}][Proxy Port ${proxyPort}] CONNECT request failed with status code: ${statusCode}`);
            clientSocket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n\r\n`);
            clientSocket.end(`Connection failed with status code: ${statusCode}`);
            downstreamSocket.end();
            decrementConnection(proxyPort);
        }
    });

    // Handle errors on downstream socket
    downstreamSocket.on('error', (err) => {
        clientSocket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        clientSocket.end('Internal Server Error');
        decrementConnection(proxyPort);
    });

    // Handle client socket errors
    clientSocket.on('error', (err) => {
        downstreamSocket.end();
        decrementConnection(proxyPort);
    });

    // Handle downstream socket closure
    downstreamSocket.on('close', () => {
        decrementConnection(proxyPort);
    });

    // Handle client socket closure
    clientSocket.on('close', () => {
        decrementConnection(proxyPort);
    });
});

/**
 * Functions to manage active connections.
 */
function incrementConnection(port) {
    if (activeConnections.has(port)) {
        activeConnections.set(port, activeConnections.get(port) + 1);
    } else {
        activeConnections.set(port, 1);
    }
}

function decrementConnection(port) {
    if (activeConnections.has(port)) {
        const current = activeConnections.get(port);
        if (current > 0) {
            activeConnections.set(port, current - 1);
        }
    }
}

/**
 * Listens for messages from the master process to update the portPool.
 */
process.on('message', (msg) => {
    if (msg.type === 'updatePortPool') {
        if (Array.isArray(msg.portPool)) {
            updatePortPool(msg.portPool);
        } else {
            console.error(`[${uniqueid}] Invalid portPool received:`, msg.portPool);
        }
    }
    // Handle other message types as needed
});

// Start the server and listen on the specified port
const LISTEN_PORT = 8980; // All workers share this port via cluster
server.listen(LISTEN_PORT, () => {
    console.log(`[${uniqueid}] Started listening on port ${LISTEN_PORT}`);
});
