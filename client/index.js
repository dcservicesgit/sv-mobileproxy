

let MP = require('./multiproxy/multiproxy')
const fs = require('fs')

const logger = (type, message) => {
    console.log(`[${new Date().toISOString()}][${type.toUpperCase()}] ${message}`)
}


let init = async () => {
    logger(`info`, `SuperV MultiProxy`)
    logger(`info`, `Starting Reverse Proxy System`)


    let configuration = JSON.parse(fs.readFileSync(`config.json`))

    let proxyController = new MP(configuration)

    await proxyController.startSystem()
    logger(`info`, `Started Reverse Proxy System`)
}


init()