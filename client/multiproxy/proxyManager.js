const { promisify } = require("util");
const path = require("path");
const { Worker } = require("worker_threads");

module.exports = {
    totaldata: 0,
    proxyservers: {},

    LocalProxystartServer: async (outboundIP, uniqueid) => {
        console.info("[INFO] Booting server");

        let blocklist = []; // You can customize the blocklist as needed

        return new Promise((resolve, reject) => {
            const worker = new Worker(path.join(__dirname, "proxyWorkerClear.js"), {
                workerData: {
                    outboundIP,
                    uniqueid,
                    blocklist,
                },
            });

            worker.once("message", (msg) => {
                if (msg.error) {
                    reject(new Error(msg.error));
                } else {
                    module.exports.proxyservers[uniqueid] = {
                        worker,
                        port: msg.port,
                    };
                    resolve(msg.port);
                }
            });

            // Handle usage updates from the worker
            worker.on("message", (msg) => {
                if (msg.type === "usageUpdate") {
                    module.exports.totaldata = 0;
                    module.exports.proxyreport = msg.data;
                    Object.keys(msg.data).forEach((domain) => {
                        module.exports.totaldata += msg.data[domain].upload + msg.data[domain].download;
                    });
                }
            });

            worker.once("error", (err) => {
                console.error("[ERROR] Worker thread error:", err.message);
                reject(err);
            });

            worker.once("exit", (code) => {
                if (code !== 0) {
                    console.error(`[ERROR] Worker stopped with exit code ${code}`);
                }
            });
        });
    },

    // Function to close a server and release its resources
    LocalProxycloseServer: (uniqueid) => {
        const serverData = module.exports.proxyservers[uniqueid];
        if (serverData) {
            console.log(`[INFO] Closing server with unique ID: ${uniqueid} on port ${serverData.port}`);
            serverData.worker.postMessage({ type: "terminate" }); // Signal the worker to terminate
            serverData.worker.once("exit", () => {
                delete module.exports.proxyservers[uniqueid]; // Cleanup
                console.log(`[INFO] Server with unique ID: ${uniqueid} has been closed.`);
            });
        } else {
            console.log(`[WARN] No server found with unique ID: ${uniqueid}`);
        }
    },

    // Function to reconfigure a server with new parameters
    LocalProxyreconfigureServer: async (uniqueid, newConfig) => {
        console.info(`[INFO] Reconfiguring server with unique ID: ${uniqueid}`);
        // Close the existing server
        module.exports.LocalProxycloseServer(uniqueid);

        // Start a new server with the updated configuration
        const { outboundIP } = newConfig;
        return module.exports.LocalProxystartServer(outboundIP, uniqueid);
    },
};
