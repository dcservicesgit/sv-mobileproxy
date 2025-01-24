// CallingCode.js
const path = require('path');
const { Worker } = require('worker_threads');

const logger = (type, message) => {
    console.log(`[${new Date().toISOString()}][${type.toUpperCase()}] ${message}`);
};

module.exports = {
    portPool: [], // Array of local proxy server ports without authentication
    proxyservers: {}, // Stores proxy server details indexed by unique ID
    totaldata: {}, // Stores aggregated data usage

    /**
     * Starts the Aggregator server.
     * @returns {Promise<number>} - Resolves with the aggregator's listening port.
     */
    StartAgg: async () => {
        logger('info', "Booting Aggregator server");
        const uniqueid = 'Agg';
        const blocklist = []; // Customize the blocklist as needed

        return new Promise((resolve, reject) => {
            const worker = new Worker(path.join(__dirname, "aggProxyWorker.js"), {
                workerData: {
                    portPool: module.exports.portPool, // Initial portPool
                    uniqueid,
                    blocklist,
                },
                // Optionally, you can set worker options here
            });

            // Listen for messages from the worker
            worker.on("message", (msg) => {
                if (msg.type === "usageUpdate") {
                    // Aggregate usage data
                    for (const domain in msg.data) {
                        if (!module.exports.totaldata[uniqueid]) {
                            module.exports.totaldata[uniqueid] = { upload: 0, download: 0 };
                        }
                        module.exports.totaldata[uniqueid].upload += msg.data[domain].upload || 0;
                        module.exports.totaldata[uniqueid].download += msg.data[domain].download || 0;
                    }
                    // Optionally, emit or log usage data here
                    //logger('info', `Aggregated Usage: ${JSON.stringify(module.exports.totaldata[uniqueid])}`);
                }
            });

            // Handle the 'exit' event
            worker.on("exit", (code) => {
                if (code !== 0) {
                    logger('error', `AGG Worker stopped with exit code: ${code}`);
                    reject(new Error(`Worker stopped with exit code ${code}`));
                } else {
                    logger('info', `AGG Worker exited successfully.`);
                }
            });

            // Handle errors from the worker
            worker.on("error", (err) => {
                logger('error', `AGG Worker thread error: ${err.message}`);
                reject(err);
            });

            // Handle successful startup
            worker.once("online", () => {
                logger('info', `AGG Worker thread is online.`);
            });

            // Handle custom messages (e.g., port assignment)
            // Since in the updated aggProxyWorker.js, the worker listens on port 8980 and doesn't send back port info,
            // you might want to adjust the worker to send confirmation messages if needed.

            // Store the worker instance for later communication
            module.exports.proxyservers[uniqueid] = {
                worker,
                port: 8980, // Assuming the aggregator listens on this port
            };

            // Resolve immediately since the worker listens on a fixed port
            resolve(8980);
        });
    },

    /**
     * Updates the portPool and notifies the worker.
     * @param {Array<number>} newPortPool - Updated array of proxy server ports.
     */
    updatePortPool: (newPortPool) => {
        module.exports.portPool = newPortPool;

        // Notify all running workers about the portPool update
        Object.values(module.exports.proxyservers).forEach(({ worker }) => {
            if (worker && worker.postMessage) {

                worker.postMessage({
                    type: 'updatePortPool',
                    portPool: newPortPool,
                });
                logger('info', `Sent portPool update to worker: ${newPortPool}`);
            }
        });
    },
};
