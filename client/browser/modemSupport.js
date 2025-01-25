const huawei = require('./huawei')
const logger = (type, message) => {
    console.log(`[${new Date().toISOString()}][${type.toUpperCase()}] ${message}`)
}

let common = {}
common.browser = require('./browser')

module.exports = {
    browsers: {},
    resetIP: async (uniqueid, ip) => {

    },
    reboot: async (uniqueid, ip) => {

        try {
            //Reboot the adaptor
            let ipparts = ip.split('.')
            let gwip = `${ipparts[0]}.${ipparts[1]}.${ipparts[2]}.1`
            logger('info', `${uniqueid} gw ip is ${gwip}`)

            if (gwip === '192.168.8.1') {
                logger('info', `${uniqueid} gw ip is as default, switching`)
                await huawei.switchIP(common, {
                    deviceip: gwip,
                    uniqueid
                })
                logger('info', `${uniqueid} gw ip is as default, switch complete`)
            }

            logger('info', `${uniqueid} gw now rebooting`)
            await huawei.rebootDevice(common, {
                deviceip: gwip,
                uniqueid
            })
        } catch (error) {
            logger('error', `${uniqueid} failed with ${error.message}`)
        }

    }
}