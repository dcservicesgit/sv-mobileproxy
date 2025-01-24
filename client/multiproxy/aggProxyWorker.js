// aggProxyWorker.js
const http = require('http');
const net = require('net');
const { PassThrough } = require('stream');
const { parentPort, workerData } = require('worker_threads');
const crypto = require('crypto');

// Initialize configurations from workerData
let portPool = Array.isArray(workerData.portPool) ? workerData.portPool : [];
const uniqueid = workerData.uniqueid || 'Agg';
const blocklist = Array.isArray(workerData.blocklist) ? workerData.blocklist : [];

// Add at the top of your aggProxyWorker.js
process.on('uncaughtException', (err) => {
    console.error(`[Worker ${uniqueid}] Uncaught Exception: ${err.stack || err}`);
    // Decide whether to exit or attempt recovery
    // process.exit(1); // Optional: Exit the process
});

process.on('unhandledRejection', (reason, promise) => {
    console.error(`[Worker ${uniqueid}] Unhandled Rejection at:`, promise, 'reason:', reason);
    // Decide whether to exit or attempt recovery
    // process.exit(1); // Optional: Exit the process
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
 * Sends usage updates to the parent process at regular intervals.
 */
function sendUsageUpdate() {
    if (Object.keys(aggregatedUsage).length > 0) {
        const update = { type: 'usageUpdate', data: aggregatedUsage };
        parentPort.postMessage(update);
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
 * Mapping table to track active connections per proxy port.
 * Structure: { proxyPort: activeConnectionCount }
 */
const activeConnections = new Map();
portPool.forEach(port => activeConnections.set(port, 0));

/**
 * Mapping table to track username/password to port assignments.
 * Structure: { 'username:password': { port: number, timeout: Timeout } }
 */
const credentialToPortMap = new Map();

/**
 * Selects an available proxy port not currently assigned to any credentials.
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
    if (availablePorts.length === 0) return null;

    // Randomly select an available port
    const randomIndex = Math.floor(Math.random() * availablePorts.length);
    return availablePorts[randomIndex];
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
        return credentialToPortMap.get(credentialKey).port;
    }

    let bypasslimit = false
    if (username === 'system') {
        bypasslimit = true
    }

    // Assign a new port
    const port = selectAvailableProxyPort(bypasslimit);
    if (!port) return null;

    // Set a timeout to release the mapping after 5 minutes (300,000 ms)
    const timeout = setTimeout(() => {
        releasePortFromCredentials(username, password);
    }, 5 * 60 * 1000); // 5 minutes

    if (bypasslimit) {
        return port
    }
    // Store the mapping
    credentialToPortMap.set(credentialKey, { port, timeout });
    console.log(`[Worker ${uniqueid}] Assigned port ${port} to credentials ${credentialKey} for 5 minutes`);

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
        console.log(`[Worker ${uniqueid}] Released port ${mapping.port} from credentials ${credentialKey}`);
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
    console.log(`[Worker ${uniqueid}] portPool updated: ${portPool}`);
}

/**
 * Handles incoming HTTP requests by routing them to the assigned proxy port based on credentials.
 */
const server = http.createServer((clientReq, clientRes) => {
    // Extract authentication from headers
    try {
        const authHeader = clientReq.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            clientRes.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Proxy"' });
            return clientRes.end('Authentication required.');
        }

        // Decode Base64 credentials
        const base64Credentials = authHeader.slice(6).trim();
        let credentials;
        try {
            credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
        } catch (err) {
            clientRes.writeHead(400, { 'Content-Type': 'text/plain' });
            return clientRes.end('Invalid Authorization header.');
        }

        const [username, password] = credentials.split(':');
        if (!username || !password) {
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
        console.log(`[Worker ${uniqueid}] Assigned connection to proxy port ${proxyPort} for credentials ${username}:${password}`);

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

        // PassThrough stream to count upload data
        const reqCounter = new PassThrough();
        reqCounter.on('data', (chunk) => {
            const domain = clientReq.headers.host || 'unknown';
            incrementUsage(domain, 'upload', chunk.length);
        });

        clientReq.pipe(reqCounter).pipe(proxyReq, { end: true });

        proxyReq.on('error', (err) => {
            console.error(`[Worker ${uniqueid}][Proxy Port ${proxyPort}] Proxy request error: ${err.message}`);
            if (!clientRes.headersSent) {
                clientRes.writeHead(500);
            }
            clientRes.end('Internal Server Error');
            // Decrement the active connection count on error
            decrementConnection(proxyPort);
        });

        proxyReq.on('timeout', () => {
            console.error(`[Worker ${uniqueid}][Proxy Port ${proxyPort}] Proxy request timed out`);
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
            console.log(`[Worker ${uniqueid}][Proxy Port ${proxyPort}] Connection closed`);
        });
    } catch (error) {
        console.log(`${error.message}`)
    }

});

/**
 * Handles HTTPS tunneling via CONNECT method by routing them to the assigned proxy port based on credentials.
 */
server.on('connect', (req, clientSocket, head) => {
    try {
        // Extract authentication from headers
        const authHeader = req.headers['authorization'];
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            clientSocket.write("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"Proxy\"\r\n\r\n");
            clientSocket.end('Authentication required.');
            return;
        }

        // Decode Base64 credentials
        const base64Credentials = authHeader.slice(6).trim();
        let credentials;
        try {
            credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
        } catch (err) {
            clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
            clientSocket.end('Invalid Authorization header.');
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
        console.log(`[Worker ${uniqueid}] Assigned CONNECT to proxy port ${proxyPort} for credentials ${username}:${password}`);

        const [destHostname, destPort] = req.url.split(':');

        // Check against the blocklist
        if (blocklist.map(domain => domain.toLowerCase()).includes(destHostname.toLowerCase())) {
            console.warn(`[Worker ${uniqueid}] Blocked CONNECT request for: ${destHostname}`);
            clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            clientSocket.end();
            // Decrement the active connection count for blocked requests
            decrementConnection(proxyPort);
            return;
        }

        const proxySocket = net.connect(proxyPort, '127.0.0.1', () => {
            clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            // Pipe initial data
            if (head && head.length) proxySocket.write(head);
            // Pipe data between client and proxy
            clientSocket.pipe(proxySocket);
            proxySocket.pipe(clientSocket);
        });

        // Data counting for CONNECT
        proxySocket.on('data', (chunk) => {
            const domain = destHostname || 'unknown';
            incrementUsage(domain, 'download', chunk.length);
        });

        clientSocket.on('data', (chunk) => {
            const domain = destHostname || 'unknown';
            incrementUsage(domain, 'upload', chunk.length);
        });

        proxySocket.on('error', (err) => {
            console.error(`[Worker ${uniqueid}][Proxy Port ${proxyPort}] Proxy socket error: ${err.message}`);
            clientSocket.end();
            // Decrement the active connection count on error
            decrementConnection(proxyPort);
        });

        clientSocket.on('error', (err) => {
            console.error(`[Worker ${uniqueid}][Proxy Port ${proxyPort}] Client socket error: ${err.message}`);
            proxySocket.end();
            // Decrement the active connection count on error
            decrementConnection(proxyPort);
        });

        // When the connection is closed, decrement the active connection count
        proxySocket.on('close', () => {
            decrementConnection(proxyPort);
            console.log(`[Worker ${uniqueid}][Proxy Port ${proxyPort}] CONNECT connection closed`);
        });

        clientSocket.on('close', () => {
            decrementConnection(proxyPort);
            console.log(`[Worker ${uniqueid}][Proxy Port ${proxyPort}] Client connection closed`);
        });

    } catch (error) {
        console.log(`${error.message}`)
    }
});

/**
 * Listens for messages from the main thread to update the portPool.
 */
parentPort.on('message', (msg) => {
    if (msg.type === 'updatePortPool') {
        if (Array.isArray(msg.portPool)) {
            updatePortPool(msg.portPool);
        } else {
            console.error(`[Worker ${uniqueid}] Invalid portPool received:`, msg.portPool);
        }
    }
    // Handle other message types as needed
});

// Start the server and listen on the specified port
const LISTEN_PORT = 8980; // You can adjust this as needed
server.listen(LISTEN_PORT, () => {
    console.log(`[Worker ${uniqueid}] Started listening on port ${LISTEN_PORT}`);
});

/**
 * Mapping table to track active connections per proxy port.
 * (Already defined above)
 */

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
