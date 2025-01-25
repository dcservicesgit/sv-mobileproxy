//Stripped Down Lightweight browser system
const { promisify } = require("util");
const { execSync, exec } = require("child_process");
const { URL } = require("url");
const path = require("path");
const fs = require("fs");
const DCSBrowser = require("./DCSBrowser");
const chalk = require("chalk");

module.exports = {
    browsers: {},
    chromeversion: null,
    lastbrowserused: "alternative",
    browserState: "loading",
    remotecookies: false, //Disable remote cookies

    getChromeUserAgentFromFolders(veronly) {
        const applicationPath = './chrome-bin';

        try {
            const versionDirs = fs.readdirSync(applicationPath).filter((name) => {
                const fullPath = path.join(applicationPath, name);
                return fs.statSync(fullPath).isDirectory() && /^\d+\.\d+\.\d+\.\d+$/.test(name);
            });

            if (versionDirs.length === 0) {
                //throw new Error("No Chrome version directories found.");
                return "none";
            }

            const chromeVersion = versionDirs[0].split(".")[0] + ".0.0.0"; // Use the first found version directory

            if (veronly) {
                return parseInt(versionDirs[0].split(".")[0]);
            }

            // Construct the User-Agent string based on the version
            const userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;

            return userAgent;
        } catch (error) {
            console.error("Error reading Chrome version directory:", error);
            return null;
        }
    },

    closeBrowser: async (uniqueid) => {
        try {
            if (module.exports.browsers[uniqueid].running) {
                try {
                    await module.exports.browsers[uniqueid].browser.close();
                } catch (error) { }
            }

            await module.exports.killbrowser(uniqueid);
            clearInterval(module.exports.browsers[uniqueid].screenrecordint);
            delete module.exports.browsers[uniqueid];
        } catch (error) { }
    },

    browsersetup: async (uniqueid, safe, data) => {
        if (!module.exports.chromeua) {
            module.exports.chromeua = module.exports.getChromeUserAgentFromFolders();
            console.log("chome agent found:" + module.exports.chromeua);
        }

        if (module.exports.chromeua === null) {
            console.error("Error chome agent found:" + module.exports.chromeua);
            return;
        }

        let proxy = data.proxy;
        let datadir = "C:\\Windows\\Temp\\ohm__" + uniqueid;

        /*
        if (module.exports.browsers[uniqueid]) {
            if (module.exports.browsers[uniqueid].launching) {
                return false;
            }
        }
        */

        if (!module.exports.browsers[uniqueid]) {
            module.exports.browsers[uniqueid] = {};
        }

        if (proxy) {
            let newproxy = await module.exports.LocalProxyConverter(proxy)
            module.exports.browsers[uniqueid].proxy_original = proxy;
            module.exports.browsers[uniqueid].proxy = newproxy;
        }

        console.log("browsersetup>" + uniqueid);
        module.exports.browsers[uniqueid].browser = null;
        if (module.exports.browsers[uniqueid].browser) {
            //Verify that the browser can communicate

            try {
                await module.exports.browsers[uniqueid].page.evaluate("console.log(true)");
                console.log("using exsiting browser, no launch needed");
                return true;
            } catch (error) {
                console.log("existing browser launch fail.");
            }

            //await module.exports.browsers[uniqueid].browser.cleanTabs();
        }
        let proxy_uri;
        try {
            proxy_uri =
                module.exports.browsers[uniqueid].proxy.host + ":" + module.exports.browsers[uniqueid].proxy.port;
        } catch (error) {
            proxy_uri = null;
        }

        let alloptions = {
            userdir: datadir,
            proxy: proxy_uri,
            useragent: module.exports.chromeua,
        };


        console.log(chalk.green('Starting Job'))
        console.log('PROXY: ' + alloptions.proxy + JSON.stringify(proxy))
        console.log("browserboot>" + uniqueid);

        if (data) {
            if (data.ccRun === "ATRrun" || data.ccRun === "RPrun" || data.ccRun === "OCrun") {
                console.log("WS: Disabled");
                alloptions.disablewebsecurity = true;
            }
        }


        module.exports.browsers[uniqueid].browser = await DCSBrowser.launch(alloptions, uniqueid);


        //await module.exports.killbrowser(uniqueid);


        module.exports.browsers[uniqueid].page = null;
        module.exports.browsers[uniqueid].screenrecordkill = true;
        module.exports.browsers[uniqueid].screenrecordint = null;
        module.exports.browsers[uniqueid].running = true;
        module.exports.browsers[uniqueid].targets = []; //For popups.
        module.exports.browsers[uniqueid].pageproxyauth = false;

        /*
        if (data.browserpreload) {
            //Preload Mode
            module.exports.browsers[uniqueid].preloaded = true;
            return false;
        }
        */

        //module.exports.browsers[uniqueid].browser._close = module.exports.browsers[uniqueid].browser.close;
        //module.exports.browsers[uniqueid].browser.close = () => {};
        module.exports.browsers[uniqueid].launching = false;

        console.log("browserlaunch>" + uniqueid);
        return true;
    },
    //Starts stream module

    browsercap: async (page) => {
        try {
            // Capture the screenshot in binary format
            const screenshotBuffer = await page.screenshot({
                fullPage: false,
                encoding: "binary",
                type: "jpeg",
                quality: 20,
            });
            return screenshotBuffer;
        } catch (error) {
            return null;
        }
    },

    toggleStream: async (common, data) => {
        console.log("screenshare activated, browsers:" + Object.keys(module.exports.browsers).length);

        if (data.eguid_account) {
            Object.keys(module.exports.browsers).forEach((uniqueid) => {
                if (data.eguid_account.indexOf(uniqueid) > -1) {
                    module.exports.browsers[uniqueid].screenrecordkill = data.setting;
                }
            });
        } else {
            // Share all
            Object.keys(module.exports.browsers).forEach((uniqueid) => {
                module.exports.browsers[uniqueid].screenrecordkill = data.setting;
            });
        }
    },

    browserstream: async (common, uniqueid, streamname) => {
        module.exports.browsers[uniqueid].screenlimit = 0;
        module.exports.browsers[uniqueid].lastscreen = null;
        module.exports.browsers[uniqueid].capturing = false;

        if (module.exports.browsers[uniqueid].screenrecordint) {
            return true;
        }

        module.exports.browsers[uniqueid].screenrecordint = setInterval(async () => {
            if (module.exports.browsers[uniqueid].capturing) {
                return;
            }

            try {
                if (!module.exports.browsers[uniqueid].screenrecordkill) {
                    module.exports.browsers[uniqueid].capturing = true;
                    let screenshot = await module.exports.browsercap(module.exports.browsers[uniqueid].page);

                    if (module.exports.browsers[uniqueid].lastscreen !== screenshot) {
                        module.exports.browsers[uniqueid].lastscreen = screenshot;
                        await common.socket.sendvstream(screenshot, {
                            authtoken: common.token,
                            data: {
                                account_eguid: uniqueid,
                                account_name: streamname,
                            },
                        });
                    }
                    module.exports.browsers[uniqueid].capturing = false;

                    if (screenshot === null) {
                        module.exports.browsers[uniqueid].screenlimit++;

                        if (module.exports.browsers[uniqueid].screenlimit > 10) {
                            clearInterval(module.exports.browsers[uniqueid].screenrecordint);
                        }
                    }
                }
            } catch (error) { }
        }, 500);
    },
    browserstreamstop: async (common, uniqueid, streamname) => {
        setTimeout(() => {
            common.socket.sendmessage(
                {
                    Controller: "BotManager",
                    handle: "sendscreen",
                    data: {
                        primary: null,
                        account_eguid: uniqueid,
                        account_name: streamname,
                    },
                },
                common.token
            );
        }, 500);

        setTimeout(() => {
            common.socket.sendmessage(
                {
                    Controller: "BotManager",
                    handle: "sendscreen",
                    data: {
                        primary: null,
                        account_eguid: uniqueid,
                        account_name: streamname,
                    },
                },
                common.token
            );
        }, 1000);

        module.exports.browsers[uniqueid].screenrecordkill = true;
        clearInterval(module.exports.browsers[uniqueid].screenrecordint);
    },
    saveCookie: async (common, page, eguid_account) => {
        if (!module.exports.remotecookies) {
            return null
        }

        if (!page._context) {
            throw new Error("no page context");
        }
        console.log("saving cookie");

        eguid_account = eguid_account.replaceAll("_cookie", "");
        if (eguid_account) {

            const localStorageData = await page.evaluate(() => {
                let json = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    json[key] = localStorage.getItem(key);
                }
                return json;
            });
            /*
                       const sessionStorageData = await page.evaluate(() => {
                           let json = {};
                           for (let i = 0; i < sessionStorage.length; i++) {
                               const key = sessionStorage.key(i);
                               json[key] = sessionStorage.getItem(key);
                           }
                           return json;
                       });
                       */

            const cookies = await page.cookies();
            let result = await common.dcsxhr.dcs3(
                common.dcsxhr.dcsaf(
                    {
                        Controller: "BotManager",
                        handle: "setCookies",
                        data: {
                            eguid_account: eguid_account,
                            cookies: cookies,
                            lsd: localStorageData,
                            ssd: {},
                            pagecontext: page._context,
                        },
                    },
                    common.token
                )
            );

            if (result) {
                console.log("cookies saved to server.");
            }
        }
    },

    //load cookie function
    loadCookie: async (common, page, cookieid) => {

        if (!module.exports.remotecookies) {
            return null
        }

        if (!page._context) {
            throw new Error('Page context is not defined.');
        }

        cookieid = cookieid.replaceAll("_cookie", "");
        try {
            let result = await common.dcsxhr.dcs3(
                common.dcsxhr.dcsaf(
                    {
                        Controller: "BotManager",
                        handle: "getCookies",
                        data: {
                            eguid_account: cookieid,
                            pagecontext: page._context,
                        },
                    },
                    common.token
                )
            );

            let cookies = result.payload.cookies;

            if (!common.nocookie) {
                await page.setCookies(cookies);
            }



            return result.payload;
        } catch (error) {
            throw new Error('Error loading cookies' + error.message)
        }

        return {}
    },

    shutdownpage: async (uniqueid, cookieonly, common) => {
        try {
            let page = module.exports.browsers[uniqueid].page;
            if (page) {
                await module.exports.saveCookie(common, page, uniqueid);

                if (!cookieonly) {
                    //await page.close();
                }
            }

            if (!cookieonly) {
                //module.exports.browsers[uniqueid].page = null;
                module.exports.browsers[uniqueid].running = false;
            }
        } catch (error) { }
    },

    pagesetup: async (uniqueid, url, common) => {
        if (!module.exports.browsers[uniqueid]) {
            return false;
        }

        if (!module.exports.browsers[uniqueid].browser) {
            return false;
        }

        //console.log(module.exports.browsers[uniqueid].pages.length)
        await module.exports.browsers[uniqueid].browser.newPage();
        try {
            module.exports.browsers[uniqueid].page = await module.exports.browsers[uniqueid].browser.newPage();
        } catch (error) {
            return false;
        }

        let page = module.exports.browsers[uniqueid].page;

        await page.goto('about:blank', {
            waitUntil: ["domcontentloaded"],
        });

        //extendPage(page);
        page._context = url;

        // Load cookies
        try {
            let data = await module.exports.loadCookie(common, page, uniqueid);
            if (data) {
                // Set LocalStorage and SessionStorage
                await page.evaluate((data) => {
                    Object.keys(data.lsd).forEach((key) => {
                        localStorage.setItem(key, data.lsd[key]);
                    });
                }, data);
                /*
                await page.evaluate((data) => {
                    Object.keys(data.ssd).forEach((key) => {
                        sessionStorage.setItem(key, data.ssd[key]);
                    });
                }, data);
                */
            }
        } catch (error) {
            console.error(error);
        }

        let worked = await page.goto(url, {
            waitUntil: ["domcontentloaded"],
        });



        return worked;
    },
    randomWait: async (min, max) => {
        let random = Math.floor(Math.random() * (max * 1000 - min * 1000) + min * 1000);
        await new Promise((resolve) => setTimeout(resolve, random));
    },
    LocalProxyConverter: async (actualproxy, uniqueid) => {
        if (actualproxy) {
            let newproxy = Object.assign({}, actualproxy);
            if (actualproxy.host) {
                //Modify the host info
                if (actualproxy.host.startsWith("http")) {
                    let newport = await module.exports.LocalProxystartServer(
                        actualproxy.username,
                        actualproxy.password,
                        actualproxy.host + ":" + actualproxy.port,
                        uniqueid
                    );

                    try {
                        let existingport = module.exports.proxyservers[uniqueid].address().port;

                        return {
                            host: "http://localhost",
                            port: existingport,
                            username: "lpc",
                            password: "lpc",
                            lpc: true,
                            host_original: actualproxy.host + ":" + actualproxy.port,
                        };
                    } catch (error) {
                        throw new Error(error);
                    }
                }
            }

            return newproxy;
        } else {
            return actualproxy;
        }
    },
    LocalProxystartServer: async (username, password, remoteProxyUrl, uniqueid) => {
        console.log("booting server");
        const http = require("http");
        const net = require("net");
        const url = require("url");
        const createProxyServer = async (username, password, remoteProxyUrl) => {
            const auth = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
            const remoteProxy = new URL(remoteProxyUrl);

            const https2 = require("https");

            const fetchJSON = async (url) => {
                return new Promise((resolve, reject) => {
                    https2
                        .get(url, (res) => {
                            let data = "";

                            // A chunk of data has been received.
                            res.on("data", (chunk) => {
                                data += chunk;
                            });

                            // The whole response has been received. Parse the result.
                            res.on("end", () => {
                                try {
                                    const parsedData = JSON.parse(data);
                                    resolve(parsedData);
                                } catch (e) {
                                    reject(e);
                                }
                            });
                        })
                        .on("error", (err) => {
                            reject(err);
                        });
                });
            };

            let fullBlockList = [];
            console.log("fetching blocklist");
            let BlockList = await fetchJSON("https://engine-cluster.ohmbot.tech/api/proxyblocklist");

            if (BlockList) {
                fullBlockList = BlockList.blockDomains;
            }

            console.log("fetching blocklist OK");
            //console.dir(fullBlockList);

            const server = http.createServer((clientReq, clientRes) => {
                let urlObject = new URL(clientReq.url);

                options = {
                    hostname: urlObject.hostname, // This works for both IP addresses and domain names
                    port: urlObject.port || (urlObject.protocol === "https:" ? 443 : 80),
                    path: urlObject.pathname + urlObject.search, // Ensure the full path is included
                    method: clientReq.method,
                    headers: {
                        ...clientReq.headers,
                        "Proxy-Authorization": auth,
                    },
                };

                //console.log(`Forwarding HTTP request for ${clientReq.url} to remote proxy: ${remoteProxy.href}`);

                const proxyReq = http.request(options, (proxyRes) => {
                    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                    proxyRes.pipe(clientRes, { end: true });
                });

                clientReq.pipe(proxyReq, { end: true });

                proxyReq.on("error", (err) => {
                    console.error("Error with proxy request:", err.message);
                    clientRes.writeHead(500);
                    clientRes.end("Internal server error");
                });
            });

            server.on("connect", (req, cltSocket, head) => {
                const { port, hostname } = new URL(`http://${req.url}`);

                for (let index = 0; index < fullBlockList.length; index++) {
                    const blockdomain = fullBlockList[index];
                    if (hostname.toLocaleLowerCase().includes(blockdomain)) {
                        //console.log(`Blocked CONNECT for ${hostname}:${port}`);
                        cltSocket.end();
                        return;
                        break;
                    }
                }
                //console.log(`Received CONNECT for ${hostname}:${port}`);

                const proxySocket = net.connect(remoteProxy.port, remoteProxy.hostname, () => {
                    // Issue a CONNECT request to the destination through the remote proxy
                    const connectRequest =
                        `CONNECT ${hostname}:${port || 443} HTTP/1.1\r\n` +
                        `Host: ${hostname}:${port || 443}\r\n` +
                        `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}\r\n` +
                        `\r\n`;

                    //console.dir(connectRequest);
                    proxySocket.write(connectRequest);

                    proxySocket.once("data", (buffer) => {
                        // Once connection is established, start data relay
                        cltSocket.write(buffer);
                        cltSocket.pipe(proxySocket);
                        proxySocket.pipe(cltSocket);
                    });
                });

                proxySocket.on("data", (chunk) => {
                    //console.log("Proxy Socket Data:", chunk.toString());
                });

                cltSocket.on("data", (chunk) => {
                    //console.log("Client Socket Data:", chunk.toString());
                });

                proxySocket.on("error", (err) => {
                    console.error("Proxy Socket Error:", err.message);
                    cltSocket.end(`HTTP/1.1 500 ${err.message}\r\n`);
                });

                cltSocket.on("error", (err) => {
                    console.error("Client Socket Error:", err.message);
                });

                cltSocket.on("close", () => {
                    //console.log("Client socket closed");
                    proxySocket.end();
                });

                proxySocket.on("close", () => {
                    //console.log("Proxy socket closed");
                    cltSocket.end();
                });
            });

            return server;
        };

        if (!module.exports.proxyservers) {
            module.exports.proxyservers = {};
        }

        try {
            await new Promise(async (resolve, reject) => {
                let porttarget = 0;
                try {
                    porttarget = module.exports.proxyservers[uniqueid].address().port;
                    module.exports.proxyservers[uniqueid].close();
                } catch (error) {
                    porttarget = 0;
                }

                porttarget = 0;

                const server = await createProxyServer(username, password, remoteProxyUrl);
                server.listen(porttarget, () => {
                    const port = server.address().port;
                    console.log(`Server started on port ${port}`);
                    module.exports.proxyservers[uniqueid] = server; // Store the server instance
                    resolve(port);
                });

                server.on("error", (err) => {
                    console.error(`Server error: ${err.message}`);
                    reject(err);
                });
            });
        } catch (err) {
            // Handle any errors that occurred during server startup
            console.error(`Failed to start server: ${err.message}`);
            // Optional: Perform any cleanup if necessary
        }
    },
    // Function to close a server and release its port
    LocalProxycloseServer: (uniqueid) => {
        if (proxyservers[uniqueid]) {
            proxyservers[uniqueid].close(() => {
                console.log(`Server on port ${port} closed`);
                delete proxyservers[uniqueid]; // Remove the server instance from the tracker
            });
        } else {
            console.log(`No server is running on port ${port}`);
        }
    },
};
