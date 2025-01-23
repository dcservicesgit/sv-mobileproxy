// MultiProxy.js

const si = require('systeminformation');

const chalk = require('chalk')

const proxyManager = require('./proxyManager')
const http = require('http');
const { execSync } = require('child_process');

class MultiProxy {
    constructor(config) {
        this.config = config
        this.adaptormap = {};
        this.adaptormapConnect = {};
        this.bindPort = 8980
    }

    async startSystem() {

        setInterval(() => {
            this.findNetworks()
            this.setupClearPorts()
            this.checkClearPortsIp()
        }, 3000)

        setInterval(() => {
            this.screen()
        }, 4000)

        this.findNetworks()
        this.screen()
    }

    async screen() {
        //console.clear()
        console.log(`SuperV MultiProxy Node: ${this.config.nodename}`)
        console.log(`Server http://localhost:${this.bindPort}`)
        console.log(``)
        console.log(`Configured Adaptors ${Object.keys(this.adaptormapConnect).length}`)
        Object.keys(this.adaptormapConnect).forEach((adaptor) => {
            console.log(`-->    Adaptor ${chalk.green(adaptor)} - ${this.adaptormap[adaptor].ip4} - ${this.adaptormapConnect[adaptor].myip}[${this.adaptormapConnect[adaptor].proxyclearport}] State: ${chalk.bgBlueBright(this.adaptormapConnect[adaptor].state)}`)
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
                            proxyclearport: null
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
                adaptorConnect.proxyclearport = await proxyManager.LocalProxystartServer(adaptor.ip4, iface)

                if (adaptorConnect.proxyclearport) {
                    adaptorConnect.state = 'configured'
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
                }
            }
        }
    }
}

module.exports = MultiProxy;