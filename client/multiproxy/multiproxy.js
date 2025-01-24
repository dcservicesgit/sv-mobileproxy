// MultiProxy.js

const si = require('systeminformation');

const chalk = require('chalk')
const Aggregator = require('./aggregator')
const proxyManager = require('./proxyManager')
const http = require('http');
const crypto = require('crypto');
const { execSync } = require('child_process');

const logger = (type, message) => {
    console.log(`[${new Date().toISOString()}][${type.toUpperCase()}] ${message}`)
}

class MultiProxy {
    constructor(config) {
        this.config = config
        this.adaptormap = {};
        this.adaptormapConnect = {};
        this.bindPort = 8980
        this.screenOn = false
    }

    async startSystem() {

        setInterval(() => {
            this.findNetworks()
            this.setupClearPorts()
        }, 3000)

        setInterval(() => {
            this.checkClearPortsIp()
        }, 15000)

        setInterval(() => {
            this.screen()
        }, 5000)

        this.findNetworks()
        this.screen()

        await Aggregator.StartAgg()

        setInterval(() => {
            let ports = []
            Object.keys(this.adaptormapConnect).forEach((adapterkey) => {
                let adaptor = this.adaptormapConnect[adapterkey]
                if (adaptor.proxyclearport) {
                    ports.push(adaptor.proxyclearport)
                }
            })

            if (ports.length > 0) {
                if (JSON.stringify(Aggregator.portPool) !== JSON.stringify(ports)) {
                    Aggregator.updatePortPool(ports)
                }
            }

        }, 2000)


        setInterval(async () => {
            // Generate random username and password
            const username = 'system'; // 16-character hex username
            const password = crypto.randomBytes(12).toString('hex'); // 24-character hex password

            console.log(`Generated credentials: ${username}:${password}`);

            // Check the proxy endpoint with the generated credentials
            let successAgg = await this.checkProxyEndpoint(8980, username, password);

            if (!successAgg) {
                console.error('Proxy endpoint check failed. Taking corrective action...');
                // Add your failure handling logic here

                Aggregator.portPool = []
            }
        }, 10000);
    }

    async screen() {
        if (!this.screenOn) {
            return
        }
        console.clear()
        console.log(`SuperV MultiProxy Node: ${this.config.nodename}`)
        console.log(`Aggregator ` + chalk.cyan(`http://localhost:${this.bindPort}`))
        if (Aggregator.totaldata['Agg']) {
            console.log(`Aggregator System ${chalk.yellow(parseFloat((Aggregator.totaldata['Agg'].upload + Aggregator.totaldata['Agg'].download) / 1024 / 1024).toFixed(2))} MB`)

        }
        console.log(``)
        console.log(`Configured Adaptors ${Object.keys(this.adaptormapConnect).length}`)
        Object.keys(this.adaptormapConnect).forEach((adaptor) => {
            console.log(`Adaptor ${chalk.yellow(parseFloat(proxyManager.totaldata[adaptor] / 1024 / 1024).toFixed(2))} MB --> ${chalk.green(adaptor)} - ${this.adaptormap[adaptor].ip4} - ${this.adaptormapConnect[adaptor].myip}[${this.adaptormapConnect[adaptor].proxyclearport}] State: ${chalk.bgBlueBright(this.adaptormapConnect[adaptor].state)}`)
        })
        console.log(``)
        Object.keys(this.adaptormap).forEach((adaptor) => {
            if (!this.adaptormapConnect[adaptor]) {
                console.log(`!    Available Adaptor ${chalk.yellow(adaptor)} - ${this.adaptormap[adaptor].ip4}`)
            }

        })
        console.log(``)
    }

    /**
     * Finds all network adapters with IPv4 addresses.
     */
    async findNetworks() {
        try {
            // Retrieve all network interfaces
            const networkInterfaces = await si.networkInterfaces();

            // Filter interfaces that have a non-empty ip4 address and are not internal (optional)
            const adaptorsWithIps = networkInterfaces.filter((iface) => {
                return iface.ip4 && iface.ip4 !== '' && !iface.internal;
            });

            // Populate adaptormap with relevant details
            adaptorsWithIps.forEach((iface) => {
                this.adaptormap[iface.iface] = {
                    ip4: iface.ip4,
                    mac: iface.mac,
                    type: iface.type,
                };

                if (this.config.wans.includes(iface.iface)) {
                    if (!this.adaptormapConnect[iface.iface]) {
                        this.adaptormapConnect[iface.iface] = {
                            state: 'setup',
                            myip: 'unknownip',
                            proxyclearport: null,
                            errors: 0
                        }
                    }
                }
            });

            // Display the filtered adapters
            //console.dir(adaptorsWithIps, { depth: null, colors: true });

            // Display the populated adaptormap
            //console.log('Network adapters ${' );
        } catch (error) {
            console.error('Error finding networks:', error);
        }
    }
    async setupClearPorts() {
        let clearconnections = Object.keys(this.adaptormapConnect)

        for (let index = 0; index < clearconnections.length; index++) {
            const iface = clearconnections[index];
            let adaptor = this.adaptormap[iface]
            let adaptorConnect = this.adaptormapConnect[iface]

            if (adaptorConnect.state === 'setup') {
                adaptorConnect.state = 'Setting up...'
                logger('info', chalk.yellow(`Started Setup on ${iface} ${adaptor.ip4}`))
                let tempport = await proxyManager.LocalProxystartServer(adaptor.ip4, iface)

                if (tempport) {
                    adaptorConnect.proxyclearport = tempport
                    adaptorConnect.state = 'configured'
                    logger('success', chalk.green(`Setup Success on ${iface} ${adaptor.ip4}`))
                }
            }
        }
    }

    async checkClearPortsIp() {
        const clearConnections = Object.keys(this.adaptormapConnect);

        for (let index = 0; index < clearConnections.length; index++) {
            const iface = clearConnections[index];
            const adaptor = this.adaptormap[iface];
            const adaptorConnect = this.adaptormapConnect[iface];

            if (adaptorConnect.state === 'configured') {
                const proxyPort = adaptorConnect.proxyclearport;
                const proxyHost = 'localhost'; // Assuming proxy is running on localhost

                // Define the target URL
                const targetUrl = 'http://httpbin.org/ip';

                // Promisify the HTTP request
                const getIpViaProxy = () => {
                    return new Promise((resolve, reject) => {
                        const options = {
                            host: proxyHost,
                            port: proxyPort,
                            method: 'GET',
                            path: targetUrl, // Full URL for proxy request
                            headers: {
                                Host: 'httpbin.org', // Set Host header for the target server
                            },
                            // Optionally, you can set a timeout
                            timeout: 5000, // in milliseconds
                        };

                        const req = http.request(options, (res) => {
                            let data = '';

                            res.on('data', (chunk) => {
                                data += chunk;
                            });

                            res.on('end', () => {
                                if (res.statusCode === 200) {
                                    try {
                                        const json = JSON.parse(data);
                                        resolve(json.origin); // 'origin' contains the IP
                                    } catch (err) {
                                        reject(new Error('Failed to parse JSON response'));
                                    }
                                } else {
                                    reject(new Error(`HTTP Status Code: ${res.statusCode}`));
                                }
                            });
                        });

                        req.on('error', (err) => {
                            reject(err);
                        });

                        req.on('timeout', () => {
                            req.destroy();
                            reject(new Error('Request timed out'));
                        });

                        req.end();
                    });
                };

                try {
                    const ip = await getIpViaProxy();
                    adaptorConnect.myip = ip
                    // You can store or process the IP as needed
                } catch (error) {
                    console.error(`Failed to get IP for interface ${iface} via proxy ${proxyHost}:${proxyPort}:`, error.message);

                    this.adaptormapConnect[iface].errors++

                    if (this.adaptormapConnect[iface].errors > 5) {
                        await proxyManager.LocalProxyreconfigureServer(iface, this.adaptormap[iface].ip4)
                    }
                }
            }
        }
    }



    async checkProxyEndpoint(port, username, password) {

        const proxyPort = port;
        const proxyHost = 'localhost'; // Assuming proxy is running on localhost

        // Define the target URL
        const targetUrl = 'http://httpbin.org/ip';

        // Promisify the HTTP request
        const getIpViaProxy = () => {
            return new Promise((resolve, reject) => {
                const options = {
                    host: proxyHost,
                    port: proxyPort,
                    method: 'GET',
                    path: targetUrl, // Full URL for proxy request
                    headers: {
                        Host: 'httpbin.org', // Set Host header for the target server
                        "Proxy-Authorization": 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
                    },
                    // Optionally, you can set a timeout
                    timeout: 5000, // in milliseconds
                };

                const req = http.request(options, (res) => {
                    let data = '';

                    res.on('data', (chunk) => {
                        data += chunk;
                    });

                    res.on('end', () => {
                        if (res.statusCode === 200) {
                            try {
                                const json = JSON.parse(data);
                                resolve(json.origin); // 'origin' contains the IP
                            } catch (err) {
                                reject(new Error('Failed to parse JSON response'));
                            }
                        } else {
                            reject(new Error(`HTTP Status Code: ${res.statusCode}`));
                        }
                    });
                });

                req.on('error', (err) => {
                    reject(err);
                });

                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('Request timed out'));
                });

                req.end();
            });
        };

        try {
            logger('info', chalk.green(`proxy ${proxyPort} Testing`))
            const ip = await getIpViaProxy();
            logger('success', chalk.green(`proxy ${proxyPort} Success`))

            return ip
            // You can store or process the IP as needed
        } catch (error) {
            logger('error', chalk.red(`proxy ${proxyPort} Fail ${error.code} ${error.message}`))

            return false
        }

    }
}

module.exports = MultiProxy;