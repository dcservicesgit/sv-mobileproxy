// CallingCode.js
const cluster = require('cluster');
const os = require('os');
const path = require('path');

const logger = (type, message) => {
    console.log(`[${new Date().toISOString()}][${type.toUpperCase()}] ${message}`);
};

module.exports = {
    portPool: [], // Array of local proxy server ports without authentication
    proxyservers: {}, // Stores proxy server details indexed by unique ID
    totaldata: {}, // Stores aggregated data usage

    /**
     * Starts the Aggregator server with clustering.
     * @returns {Promise<Array<number>>} - Resolves with the aggregator's listening port(s).
     */
    StartAgg: async () => {
        return new Promise((resolve, reject) => {
            // Ensure that the cluster master code runs only when this script is executed directly
            // and not when it's required/imported by worker processes.
            if (cluster.isMaster) {
                logger('info', "Booting Aggregator server with clustering");
                const numWorkers = os.cpus().length || 4; // Default to 4 if os.cpus() is undefined
                const uniqueidBase = 'Agg';
                const blocklist = []; // Customize the blocklist as needed

                // Initialize portPool and other shared resources
                const portPool = module.exports.portPool;
                const aggregatedData = module.exports.totaldata;

                if (!Array.isArray(portPool) || portPool.length === 0) {
                    logger('error', "Port pool is empty.");
                    //return reject(new Error("Port pool is empty."));
                }

                // Setup cluster to use the worker script aggProxyWorker.js
                cluster.setupMaster({
                    exec: path.join(__dirname, 'aggProxyWorker.js'), // Path to worker script
                    env: {
                        PORT_POOL: JSON.stringify(portPool),
                        BLOCKLIST: JSON.stringify(blocklist),
                    }
                });

                // Fork workers
                for (let i = 0; i < numWorkers; i++) {
                    const uniqueId = `${uniqueidBase}-${i + 1}`;
                    const workerEnv = {
                        UNIQUE_ID: uniqueId,
                        PORT_POOL: JSON.stringify(portPool),
                        BLOCKLIST: JSON.stringify(blocklist),
                    };

                    const worker = cluster.fork(workerEnv);

                    // Listen for messages from the worker
                    worker.on('message', (msg) => {
                        if (msg.type === 'ready') {
                            const uniqueid = msg.uniqueid;
                            // Initialize aggregated data for this worker
                            aggregatedData[uniqueid] = { upload: 0, download: 0 };
                            // Store worker details
                            module.exports.proxyservers[uniqueid] = {
                                worker,
                                port: 8980, // All workers listen on the same port
                            };
                            logger('info', `Worker ${uniqueid} is ready and listening on port 8980.`);
                        }

                        if (msg.type === 'usageUpdate') {
                            const workerUniqueID = msg.uniqueid;
                            for (const domain in msg.data) {
                                if (!aggregatedData[workerUniqueID]) {
                                    aggregatedData[workerUniqueID] = { upload: 0, download: 0 };
                                }
                                aggregatedData[workerUniqueID].upload += msg.data[domain].upload || 0;
                                aggregatedData[workerUniqueID].download += msg.data[domain].download || 0;
                            }
                            // Optionally, emit or log usage data here
                            // logger('info', `Aggregated Usage for ${workerUniqueID}: ${JSON.stringify(aggregatedData[workerUniqueID])}`);
                        }
                    });

                    // Handle worker exit
                    worker.on('exit', (code, signal) => {
                        const uniqueid = worker.process.env.UNIQUE_ID;
                        logger('error', `Worker ${uniqueid} (PID: ${worker.process.pid}) died with code: ${code} and signal: ${signal}`);
                        logger('info', `Spawning a new worker to replace the dead one.`);
                        // Remove old worker from proxyservers and aggregatedData
                        delete module.exports.proxyservers[uniqueid];
                        delete aggregatedData[uniqueid];

                        // Fork a new worker with the same unique ID
                        const newWorker = cluster.fork(workerEnv);

                        // The new worker will send a 'ready' message upon initialization
                        newWorker.on('message', (msg) => {
                            if (msg.type === 'ready') {
                                const uniqueid = msg.uniqueid;
                                // Initialize aggregated data for this worker
                                aggregatedData[uniqueid] = { upload: 0, download: 0 };
                                // Store worker details
                                module.exports.proxyservers[uniqueid] = {
                                    worker: newWorker,
                                    port: 8980,
                                };
                                logger('info', `Worker ${uniqueid} is ready and listening on port 8980.`);
                            }

                            if (msg.type === 'usageUpdate') {
                                const workerUniqueID = msg.uniqueid;
                                for (const domain in msg.data) {
                                    if (!aggregatedData[workerUniqueID]) {
                                        aggregatedData[workerUniqueID] = { upload: 0, download: 0 };
                                    }
                                    aggregatedData[workerUniqueID].upload += msg.data[domain].upload || 0;
                                    aggregatedData[workerUniqueID].download += msg.data[domain].download || 0;
                                }
                                // Optionally, emit or log usage data here
                            }
                        });
                    });
                }

                // Optional: Resolve once all workers are ready
                // For simplicity, resolve immediately since workers will report their readiness
                logger('info', `Aggregator is listening on port(s): 8980`);
                resolve([8980]); // Array of listening ports for consistency
            } else {
                // Worker processes do not execute any additional code here
                // They run aggProxyWorker.js as their entry point
            }
        });
    },

    /**
     * Updates the portPool and notifies all workers.
     * @param {Array<number>} newPortPool - Updated array of proxy server ports.
     */
    updatePortPool: (newPortPool) => {
        if (!Array.isArray(newPortPool) || newPortPool.length === 0) {
            logger('error', "Invalid portPool provided.");
            return;
        }

        module.exports.portPool = newPortPool;

        // Notify all running workers about the portPool update
        Object.values(module.exports.proxyservers).forEach(({ worker }) => {
            if (worker && worker.send) {
                worker.send({
                    type: 'updatePortPool',
                    portPool: newPortPool,
                });
                logger('info', `Sent portPool update to worker: ${newPortPool}`);
            }
        });
    },
};
