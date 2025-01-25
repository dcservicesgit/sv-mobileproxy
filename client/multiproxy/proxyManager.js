// ProxyManager.js
const cluster = require('cluster');
const path = require('path');
const os = require('os');
const net = require('net');

const logger = (type, message) => {
    console.log(`[${new Date().toISOString()}][${type.toUpperCase()}] ${message}`);
};

// Default number of workers per proxy server
const DEFAULT_WORKER_COUNT = os.cpus().length; // Utilize all available CPU cores

module.exports = {
    totaldata: {},
    proxyservers: {},

    /**
     * Starts a new proxy server with multiple workers.
     * @param {string} outboundIP - The outbound IP address for the proxy.
     * @param {string} uniqueid - A unique identifier for the proxy server.
     * @param {Array<string>} blocklist - An array of domains to block.
     * @param {number} workerCount - Number of workers to spawn (optional).
     * @param {number} port - The port number for the proxy server (optional).
     * @returns {Promise<number>} - Resolves with the port number the proxy server is running on.
     */
    LocalProxystartServer: async (outboundIP, uniqueid, blocklist = [], workerCount = DEFAULT_WORKER_COUNT, port = null) => {
        if (cluster.isMaster) {
            logger('info', `Booting Proxy server '${uniqueid}' using Cluster`);

            // Assign a port if not provided
            if (!port) {
                port = await findAvailablePort(8000, 9000);
                if (!port) {
                    throw new Error('No available ports found for the proxy server.');
                }
            }

            module.exports.proxyservers[uniqueid] = {
                port,
                workers: [],
            };

            return new Promise((resolve, reject) => {
                // Set the worker script
                cluster.setupMaster({
                    exec: path.join(__dirname, 'proxyWorkerClear.js'),
                    args: [], // Add any arguments if necessary
                });

                // Fork the specified number of workers
                for (let i = 0; i < workerCount; i++) {
                    const worker = cluster.fork({
                        OUTBOUND_IP: outboundIP,
                        UNIQUE_ID: uniqueid,
                        BLOCKLIST: JSON.stringify(blocklist),
                        PORT: port,
                    });

                    // Listen for messages from the worker
                    worker.on('message', (msg) => {
                        if (msg.type === 'initialized') {
                            logger('success', `Worker ${worker.process.pid} initialized for '${uniqueid}' on port ${port}`);
                        } else if (msg.type === 'usageUpdate') {
                            if (!module.exports.totaldata[uniqueid]) {
                                module.exports.totaldata[uniqueid] = 0;
                            }
                            Object.keys(msg.data).forEach((domain) => {
                                module.exports.totaldata[uniqueid] += msg.data[domain].upload + msg.data[domain].download;
                            });
                            // Optionally, handle or emit proxy report here
                        }
                    });

                    // Handle worker exit
                    worker.on('exit', (code, signal) => {
                        logger('error', `Worker ${worker.process.pid} for '${uniqueid}' exited with code ${code} and signal ${signal}`);
                        // Remove the worker from the list
                        module.exports.proxyservers[uniqueid].workers = module.exports.proxyservers[uniqueid].workers.filter(w => w.id !== worker.id);
                        // Respawn the worker
                        const respawnedWorker = cluster.fork({
                            OUTBOUND_IP: outboundIP,
                            UNIQUE_ID: uniqueid,
                            BLOCKLIST: JSON.stringify(blocklist),
                            PORT: port,
                        });
                        module.exports.proxyservers[uniqueid].workers.push(respawnedWorker);
                        logger('info', `Respawned Worker ${respawnedWorker.process.pid} for '${uniqueid}'`);
                    });

                    // Handle worker errors
                    worker.on('error', (err) => {
                        logger('error', `Worker ${worker.process.pid} for '${uniqueid}' encountered error: ${err.message}`);
                        // Remove the worker from the list
                        module.exports.proxyservers[uniqueid].workers = module.exports.proxyservers[uniqueid].workers.filter(w => w.id !== worker.id);
                        reject(err);
                    });

                    // Add worker to the list
                    module.exports.proxyservers[uniqueid].workers.push(worker);
                }

                resolve(port);
            });
        } else {
            // In worker process, do nothing. The worker script handles itself.
            return;
        }
    },

    /**
     * Closes an existing proxy server and all its workers.
     * @param {string} uniqueid - The unique identifier of the proxy server to close.
     * @returns {Promise<void>}
     */
    LocalProxycloseServer: async (uniqueid) => {
        if (cluster.isMaster) {
            const serverData = module.exports.proxyservers[uniqueid];
            if (serverData) {
                logger('info', `Closing server '${uniqueid}' on port ${serverData.port}`);
                const workers = serverData.workers.slice(); // Clone the array to prevent modification during iteration

                return Promise.all(workers.map(worker => {
                    return new Promise((resolve, reject) => {
                        worker.send({ type: 'terminate' });

                        worker.once('exit', () => {
                            logger('info', `Worker ${worker.process.pid} for '${uniqueid}' has been closed.`);
                            resolve();
                        });

                        // Optional: Timeout in case worker doesn't exit
                        setTimeout(() => {
                            logger('error', `Timeout while closing Worker ${worker.process.pid} for '${uniqueid}'`);
                            reject(new Error("Timeout while closing worker."));
                        }, 5000);
                    });
                })).then(() => {
                    delete module.exports.proxyservers[uniqueid];
                    logger('info', `Server '${uniqueid}' has been fully closed.`);
                }).catch(err => {
                    logger('error', `Error while closing server '${uniqueid}': ${err.message}`);
                });
            } else {
                const errorMsg = `No server found with unique ID: '${uniqueid}'`;
                logger('error', errorMsg);
                throw new Error(errorMsg);
            }
        } else {
            // In worker process, do nothing
            return;
        }
    },

    /**
     * Reconfigures an existing proxy server with new parameters.
     * @param {string} uniqueid - The unique identifier of the proxy server to reconfigure.
     * @param {Object} newConfig - The new configuration parameters.
     * @param {string} newConfig.outboundIP - The new outbound IP address.
     * @param {Array<string>} newConfig.blocklist - The new blocklist.
     * @param {number} newConfig.workerCount - Number of workers to spawn (optional).
     * @param {number} newConfig.port - The new port number for the proxy server (optional).
     * @returns {Promise<number>} - Resolves with the new port number.
     */
    LocalProxyreconfigureServer: async (uniqueid, newConfig) => {
        if (cluster.isMaster) {
            logger("info", `Reconfiguring server '${uniqueid}'`);

            // Close the existing server
            await module.exports.LocalProxycloseServer(uniqueid);

            // Start a new server with the updated configuration
            const { outboundIP, blocklist, workerCount, port } = newConfig;
            return module.exports.LocalProxystartServer(outboundIP, uniqueid, blocklist, workerCount, port);
        } else {
            // In worker process, do nothing
            return;
        }
    },
};

// Handle worker exits and optionally respawn if necessary
if (cluster.isMaster) {
    cluster.on('exit', (worker, code, signal) => {
        logger('error', `Worker process ${worker.process.pid} died with code ${code} and signal ${signal}`);
        // Optionally, implement worker respawning logic here
    });
}

/**
 * Finds an available port within the specified range.
 * @param {number} startPort - The starting port number.
 * @param {number} endPort - The ending port number.
 * @returns {Promise<number|null>} - Resolves with an available port or null if none found.
 */
const findAvailablePort = (startPort, endPort) => {
    return new Promise((resolve) => {
        const tryPort = (port) => {
            if (port > endPort) {
                resolve(null);
                return;
            }

            const server = net.createServer()
                .once('error', () => {
                    tryPort(port + 1);
                })
                .once('listening', () => {
                    server.close();
                    resolve(port);
                })
                .listen(port, '0.0.0.0');
        };

        tryPort(startPort);
    });
};
