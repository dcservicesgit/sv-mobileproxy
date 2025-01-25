// ProxyManager.js
const cluster = require("cluster");
const path = require("path");
const os = require("os");

const logger = (type, message) => {
    console.log(`[${new Date().toISOString()}][${type.toUpperCase()}] ${message}`);
};

// Maintain the original module.exports structure
module.exports = {
    totaldata: {},
    proxyservers: {},

    LocalProxystartServer: async (outboundIP, uniqueid, blocklist = []) => {
        if (cluster.isMaster) {
            logger('info', "Booting Proxy server using Cluster");

            return new Promise((resolve, reject) => {
                // Fork a new worker with environment variables
                const worker = cluster.fork({
                    OUTBOUND_IP: outboundIP,
                    UNIQUE_ID: uniqueid,
                    BLOCKLIST: JSON.stringify(blocklist),
                });

                // Handler for messages from the worker
                const messageHandler = (msg) => {
                    if (msg.type === "initialized") {
                        module.exports.proxyservers[uniqueid] = {
                            worker,
                            port: msg.port,
                        };

                        logger('success', `Worker process started ${uniqueid} on port ${msg.port}`);
                        resolve(msg.port);
                    } else if (msg.type === "usageUpdate") {
                        module.exports.totaldata[uniqueid] = 0;
                        module.exports.proxyreport = msg.data;
                        Object.keys(msg.data).forEach((domain) => {
                            module.exports.totaldata[uniqueid] += msg.data[domain].upload + msg.data[domain].download;
                        });
                    }
                };

                // Listen for messages from the worker
                worker.on("message", messageHandler);

                // Handle worker exit
                worker.on("exit", (code, signal) => {
                    logger('error', `Worker for ${uniqueid} exited with code ${code} and signal ${signal}`);
                    delete module.exports.proxyservers[uniqueid];
                });

                // Handle worker errors
                worker.on("error", (err) => {
                    logger('error', `Worker for ${uniqueid} encountered error: ${err.message}`);
                    delete module.exports.proxyservers[uniqueid];
                    reject(err);
                });
            });
        } else {
            // In worker process, do nothing. The worker script will handle itself.
            return;
        }
    },

    // Function to close a server and release its resources
    LocalProxycloseServer: (uniqueid) => {
        if (cluster.isMaster) {
            const serverData = module.exports.proxyservers[uniqueid];
            if (serverData) {
                logger('info', `Closing server with unique ID: ${uniqueid} on port ${serverData.port}`);
                serverData.worker.send({ type: "terminate" }); // Signal the worker to terminate

                return new Promise((resolve, reject) => {
                    serverData.worker.once("exit", () => {
                        delete module.exports.proxyservers[uniqueid]; // Cleanup
                        logger('info', `Server with unique ID: ${uniqueid} has been closed.`);
                        resolve();
                    });

                    // Optional: Timeout in case worker doesn't exit
                    setTimeout(() => {
                        logger('error', `Timeout while closing server with unique ID: ${uniqueid}`);
                        reject(new Error("Timeout while closing server."));
                    }, 5000);
                });
            } else {
                const errorMsg = `No server found with unique ID: ${uniqueid}`;
                logger('error', errorMsg);
                return Promise.reject(new Error(errorMsg));
            }
        } else {
            // In worker process, do nothing
            return;
        }
    },

    // Function to reconfigure a server with new parameters
    LocalProxyreconfigureServer: async (uniqueid, newConfig) => {
        if (cluster.isMaster) {
            logger("info", `[INFO] Reconfiguring server with unique ID: ${uniqueid}`);
            // Close the existing server
            await module.exports.LocalProxycloseServer(uniqueid);

            // Start a new server with the updated configuration
            const { outboundIP, blocklist } = newConfig;
            return module.exports.LocalProxystartServer(outboundIP, uniqueid, blocklist);
        } else {
            // In worker process, do nothing
            return;
        }
    },
};

// If the current process is a worker, run the worker script
if (!cluster.isMaster) {
    // Require the worker script
    require(path.join(__dirname, "proxyWorkerClear.js"));
}
