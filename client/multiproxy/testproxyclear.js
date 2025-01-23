const server = require('./proxyManager');

server.LocalProxystartServer('192.168.0.255', 'uniqueID1')
    .then((port) => console.log(`Server started on port ${port}`))
    .catch((err) => console.error(err));
