// MultiProxy.js

const si = require('systeminformation');

const chalk = require('chalk')

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
        }, 10000)

        setInterval(() => {
            this.screen()
        }, 1000)

        this.findNetworks()
        this.screen()
    }

    async screen() {
        console.clear()
        console.log(`SuperV MultiProxy Node: ${this.config.nodename}`)
        console.log(`Server http://localhost:${this.bindPort}`)
        console.log(``)
        console.log(`Configured Adaptors ${Object.keys(this.adaptormapConnect).length}`)
        Object.keys(this.adaptormapConnect).forEach((adaptor) => {
            console.log(`-->    Adaptor ${chalk.green(adaptor)} - ${this.adaptormap[adaptor].ip4} - ${this.adaptormapConnect[adaptor].myip}`)
        })
        console.log(``)
        Object.keys(this.adaptormap).forEach((adaptor) => {
            console.log(`!    Available Adaptor ${chalk.yellow(adaptor)} - ${this.adaptormap[adaptor].ip4}`)
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
                            myip: 'unknown',
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
}

module.exports = MultiProxy;
