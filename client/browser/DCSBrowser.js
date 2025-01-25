const WebSocket = require("ws");
const treeKill = require("tree-kill");
const path = require("path");
const execa = require("execa");
const { execFile } = require("child_process");
const http = require("http");
const DCSPage = require("./DCSPage");
const fs = require("fs");
const net = require("net");
const crypto = require("crypto");
const chalk = require("chalk");

// Set the path to the Chrome executable
const chromePath = "./chrome-bin/chrome.exe";

function uploadFile(fileName, base64Data, apiKey, serverHost = '127.0.0.1', serverPort = 4545) {
    return new Promise((resolve, reject) => {
        // Create the POST data
        const postData = JSON.stringify({ apiKey, fileName, base64Data });

        const options = {
            hostname: serverHost, // Ensure this is just the hostname, no protocol
            port: serverPort,
            path: '/upload',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = http.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(true); // File uploaded successfully
                } else {
                    console.log(`Error uploading file. Status code: ${res.statusCode}, Response: ${responseBody}`)
                    reject(`Error uploading file. Status code: ${res.statusCode}, Response: ${responseBody}`);
                }
            });
        });

        req.on('error', (e) => reject(`Request error: ${e.message}`));
        req.write(postData);
        req.end();
    });
}


// Function to retrieve file (GET request)
function retrieveFile(fileName, apiKey, serverHost = '127.0.0.1', serverPort = 4545) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: serverHost, // Ensure this is just the hostname, no protocol
            port: serverPort,
            path: `/file/${fileName}`,
            method: 'GET',
            headers: {
                'x-api-key': apiKey, // Optional: Pass the API key in headers if needed
            },
        };

        const req = http.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const { base64Data } = JSON.parse(responseBody);
                        resolve(base64Data); // Resolve with the base64 file data
                    } catch (e) {
                        reject(`Error parsing response: ${e.message}`);
                    }
                } else {
                    reject(`Error retrieving file. Status code: ${res.statusCode}, Response: ${responseBody}`);
                }
            });
        });

        req.on('error', (e) => reject(`Request error: ${e.message}`));
        req.end();
    });
}




class DCSBrowser {
    constructor() {
        this.options = {};
        this.browser = null;
        this.ws = null;
        this.globalCache = {};
        this.currentCacheSize = 0;
        this.CACHE_DURATION = 60000; // Cache duration in milliseconds
        this.MAX_CACHE_SIZE = 100000000; // Max cache size in bytes
        this.targetId = null;
        this.debugPort = null;
        this.userdir = null;
        this.remotedatadirendpoint = "test";
        this.commandId = 0;
        this.remoteuserdir_server = null

        this.scriptinjection = `
        try {
            Object.defineProperty(navigator, "webdriver", {
                get: () => undefined,
                configurable: false,
            });
        } catch (e) {
            //console.error('Error setting navigator.webdriver:', e);
        }
        
        try {
            Object.defineProperty(navigator, "languages", {
                get: () => ["en-US", "en"],
                configurable: false,
            });
        } catch (e) {
            //console.error('Error setting navigator.languages:', e);
        }
        
        try {
            (function () {
                try {
                    const originalNow = performance.now;
                    performance.now = function () {
                        return originalNow.call(performance) + Math.random();
                    };
                } catch (e) {
                    //console.error('Error overriding performance.now:', e);
                }
        
                try {
                    const originalSetTimeout = window.setTimeout;
                    window.setTimeout = function (callback, delay) {
                        return originalSetTimeout(callback, delay + Math.floor(Math.random() * 10));
                    };
                } catch (e) {
                    //console.error('Error overriding window.setTimeout:', e);
                }
        
                try {
                    const originalSetInterval = window.setInterval;
                    window.setInterval = function (callback, delay) {
                        return originalSetInterval(callback, delay + Math.floor(Math.random() * 10));
                    };
                } catch (e) {
                    //console.error('Error overriding window.setInterval:', e);
                }
            })();
        } catch (e) {
            //console.error('Error in performance and timing overrides:', e);
        }
        
        try {
            Object.defineProperty(navigator, "hardwareConcurrency", {
                get: () => 8,
                configurable: false,
            });
        } catch (e) {
            //console.error('Error setting navigator.hardwareConcurrency:', e);
        }
        
        try {
            Object.defineProperty(navigator, "deviceMemory", {
                get: () => 8,
                configurable: false,
            });
        } catch (e) {
            //console.error('Error setting navigator.deviceMemory:', e);
        }
        
        try {
            Object.defineProperty(navigator, "maxTouchPoints", {
                get: () => 1,
                configurable: false,
            });
        } catch (e) {
            //console.error('Error setting navigator.maxTouchPoints:', e);
        }
        /*
        try {
            Object.defineProperty(window, "chrome", {
                get: () => ({}),
                configurable: false,
            });
        } catch (e) {
            //console.error('Error setting window.chrome:', e);
        }
        */
        /*
        try {
            // Mocking CSS detection
            const originalQuerySelector = Document.prototype.querySelector;
            Document.prototype.querySelector = function (selectors) {
                try {
                    if (selectors.includes(":hover") || selectors.includes(":active")) {
                        return null;
                    }
                } catch (e) {
                    //console.error('Error in Document.prototype.querySelector:', e);
                }
                return originalQuerySelector.apply(this, arguments);
            };
        } catch (e) {
            //console.error('Error mocking CSS detection:', e);
        }
        */
        
        try {
            // Mocking permissions
            const originalQuery = navigator.permissions.query;
            navigator.permissions.query = (parameters) =>
                parameters.name === "notifications"
                    ? Promise.resolve({ state: Notification.permission })
                    : originalQuery(parameters);
        } catch (e) {
            //console.error('Error mocking navigator.permissions.query:', e);
        }
        
        /*
        (function () {
            // Define a function to override WebGL methods and properties
            function overrideWebGL() {
                const blankFunction = function () {};
        
                // Override WebGLRenderingContext methods
                const webGLMethods = [
                    "getParameter",
                    "getExtension",
                    "getSupportedExtensions",
                    "getContextAttributes",
                    "isContextLost",
                    "getBufferParameter",
                    "getFramebufferAttachmentParameter",
                    "getProgramParameter",
                    "getRenderbufferParameter",
                    "getShaderParameter",
                    "getShaderPrecisionFormat",
                    "getTexParameter",
                    "getUniform",
                    "getUniformLocation",
                    "getVertexAttrib",
                ];
                webGLMethods.forEach((method) => {
                    if (WebGLRenderingContext.prototype.hasOwnProperty(method)) {
                        Object.defineProperty(WebGLRenderingContext.prototype, method, {
                            value: blankFunction,
                            writable: false,
                            configurable: false,
                        });
                    }
                });
        
                // Override WebGL properties
                const webGLProperties = ["UNMASKED_VENDOR_WEBGL", "UNMASKED_RENDERER_WEBGL"];
                webGLProperties.forEach((property) => {
                    if (WebGLRenderingContext.prototype.hasOwnProperty(property)) {
                        Object.defineProperty(WebGLRenderingContext.prototype, property, {
                            value: null,
                            writable: false,
                            configurable: false,
                        });
                    }
                });
        
                // Override WebGL2RenderingContext methods (if applicable)
                if (typeof WebGL2RenderingContext !== "undefined") {
                    webGLMethods.forEach((method) => {
                        if (WebGL2RenderingContext.prototype.hasOwnProperty(method)) {
                            Object.defineProperty(WebGL2RenderingContext.prototype, method, {
                                value: blankFunction,
                                writable: false,
                                configurable: false,
                            });
                        }
                    });
        
                    webGLProperties.forEach((property) => {
                        if (WebGL2RenderingContext.prototype.hasOwnProperty(property)) {
                            Object.defineProperty(WebGL2RenderingContext.prototype, property, {
                                value: null,
                                writable: false,
                                configurable: false,
                            });
                        }
                    });
                }
            }
        
            // Execute the function to override WebGL
            overrideWebGL();
        })();
        */`;

    }

    // Inject script into all frames
    async injectScriptIntoAllFrames() {
        const frameTree = await this.sendCommand("Page.getFrameTree", {});
        const frames = frameTree.frameTree.childFrames || [];
        await this.evaluateScriptInFrame(frameTree.frameTree.frame.id); // Main frame
        for (const frame of frames) {
            await this.evaluateScriptInFrame(frame.frame.id);
        }
    }

    async sendCommand(method, params = {}, useSession = true) {
        return new Promise((resolve, reject) => {
            this.commandId++; // Increment command ID for each new command
            const id = this.commandId;
            const message =
                useSession && this.sessionId
                    ? { id, method, params, sessionId: this.sessionId }
                    : { id, method, params };
            const messageString = JSON.stringify(message);

            this.ws.send(messageString, (err) => {
                if (err) {
                    return reject(err);
                }

                const listener = (data) => {
                    const response = JSON.parse(data);
                    if (response.id === id) {
                        this.ws.off("message", listener);
                        if (response.result) {
                            resolve(response.result);
                        } else {
                            console.dir(response.error);
                            reject(response.error);
                        }
                    }
                };

                this.ws.on("message", listener);
            });
        });
    }

    async startlistener() {
        if (!this.listeneract) {
            this.listeneract = true;
            this.ws.on("message", async (data) => {
                const message = JSON.parse(data);

                if (message.method === "Page.frameAttached") {
                    /*
                    console.log(chalk.red("frame detected."));
                    const frameId = message.params.frameId;
                    await sendCommand("Runtime.evaluate", {
                        expression: scriptinjection,
                        contextId: frameId,
                    });
                    */
                }
            });
        }
    }

    async UploadDataDir() {
        //Gets localdatadir and uploads it to an endpoint
        //let localdir = `C:\\Windows\\Temp\\ohm__${uniqueid}`;

        let localdir = this.userdir;
        console.log(chalk.yellowBright("cleaning up data dir..."));

        try {
            fs.rmdirSync(this.userdir + '\\BrowserMetrics\\', { recursive: true });
        } catch (error) { }


        try {
            fs.rmdirSync(this.userdir + '\\Default\\Cache\\', { recursive: true });
        } catch (error) { }

        try {
            fs.rmdirSync(this.userdir + '\\Default\\History\\', { recursive: true });
        } catch (error) { }

        try {
            fs.rmdirSync(this.userdir + '\\Default\\Cookies\\', { recursive: true });
        } catch (error) { }

        try {
            fs.rmdirSync(this.userdir + '\\Default\\Favicons\\', { recursive: true });
        } catch (error) { }

        try {
            fs.rmdirSync(this.userdir + '\\Default\\Current Session\\', { recursive: true });
        } catch (error) { }

        try {
            fs.rmdirSync(this.userdir + '\\Default\\Current Tabs\\', { recursive: true });
        } catch (error) { }

        try {
            fs.rmdirSync(this.userdir + '\\Default\\Last Session\\', { recursive: true });
        } catch (error) { }

        try {
            fs.rmdirSync(this.userdir + '\\Default\\Last Tabs\\', { recursive: true });
        } catch (error) { }

        console.log(chalk.yellowBright("backing up data dir -> local"));
        const { execFileSync } = require("child_process");

        try {
            fs.rmSync(localdir + ".zip");
        } catch (error) { }

        //Compress the folder
        // PowerShell command to compress the folder
        const psCommand = `
        $sourceDir = "${localdir}\\"
        $zipFilePath = "${localdir}.zip"
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::CreateFromDirectory($sourceDir, $zipFilePath)
        Write-Output "Folder compressed to ZIP file successfully."
        `;

        try {
            // Execute the PowerShell command
            const result = execFileSync("powershell.exe", ["-NoProfile", "-Command", psCommand], { encoding: "utf-8" });
            console.log(result);
        } catch (error) {
            console.error("Error compressing folder:", error.message);
            return false
        }

        //Upload the data to the server?

        let serveruploaded = false

        if (this.launchoptions.remoteuserdir_server) {
            console.log(chalk.yellowBright("user dir uploading to server..."));
            let fileBuffer = Buffer.from(fs.readFileSync(`${localdir}.zip`)).toString('base64')
            serveruploaded = await uploadFile(`${localdir}.zip`, fileBuffer, 'ohm3', this.launchoptions.remoteuserdir_server)
            console.log(chalk.yellowBright("user dir uploading to server... Complete"));
        }



        try {
            if (serveruploaded) {
                console.log(chalk.yellowBright("user dir being removed from local"));
                fs.rmSync(localdir + ".zip");
            }
        } catch (error) { }

        return true

        //Upload the folder.
    }

    async RestoreDataDir() {
        const { execFileSync } = require("child_process");
        // Restores the localdatadir from a zip file
        let localdir = this.userdir;
        let zipFilePath = localdir + ".zip";

        let fileExists = false;

        //Try server side request

        if (!fileExists && this.launchoptions.remoteuserdir_server) {
            try {
                console.log(chalk.bgYellowBright("user dir downloading..."));
                let base64 = await retrieveFile(`${localdir}.zip`, 'ohm3', this.launchoptions.remoteuserdir_server)
                fs.writeFileSync(`${localdir}.zip`, Buffer.from(base64, 'base64'))
                console.log(chalk.bgYellowBright("user dir downloaded"));
                fileExists = true
            } catch (error) {
                console.log("Error downloading remote udir file:", error);
            }
        }


        try {
            if (!fileExists) {
                fileExists = fs.existsSync(zipFilePath);
            }

        } catch (error) {
            console.error("Error checking if zip file exists locally:", error.message);
        }


        if (fileExists) {
            console.log(chalk.yellowBright("restoring data dir -> local"));

            try {
                fs.rmdirSync(this.userdir,{recursive:true});
            } catch (error) { }
    

            // PowerShell command to unzip the folder
            const psCommand = `
            $zipFilePath = "${zipFilePath}"
            $extractToPath = "${localdir}"
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($zipFilePath, $extractToPath)
            Write-Output "Folder extracted from ZIP file successfully."
            `;

            try {
                // Execute the PowerShell command
                const result = execFileSync("powershell.exe", ["-NoProfile", "-Command", psCommand], {
                    encoding: "utf-8",
                });
                console.log(result);
                return true
            } catch (error) {
                console.error("Error extracting folder:", error.message);
            }
        } else {
            console.log(chalk.redBright("No backup ZIP file found to restore."));
        }
    }

    async getAllTabs() {
        return new Promise((resolve, reject) => {
            if (!this.debugPort) {
                throw new Error("Debug port not found!");
            }

            http.get(`http://127.0.0.1:${this.debugPort}/json`, (res) => {
                let data = "";

                res.on("data", (chunk) => {
                    data += chunk;
                });

                res.on("end", () => {
                    try {
                        const response = JSON.parse(data);
                        resolve(response);
                    } catch (error) {
                        reject(error);
                    }
                });
            }).on("error", (err) => {
                reject(err);
            });
        });
    }

    async newPage() {
        // Placeholder for creating a new page
        console.log("creating new page on targetID: " + this.targetId);
        let newPage = new DCSPage(this.ws);
        await newPage.createSession(this.targetId);
        //Evasions

        await newPage.sendCommand("Page.addScriptToEvaluateOnNewDocument", {
            source: this.scriptinjection,
        });

        //Evasions
        await newPage.goto("about:blank");

        await this.startlistener();

        console.log("creating new page complete");
        return newPage;
    }

    async close() {
        if (this.ws) {
            await this.sendCommand("Browser.close", {}, false);

            this.ws.close();
            await this.killChromeProcessWithArg(this.userdir);
            console.log("Browser closed");
        }
    }

    async closeAndCheckpoint() {
        if (this.ws) {
            await this.sendCommand("Browser.close", {}, false);

            this.ws.close();
            await this.killChromeProcessWithArg(this.userdir);
            console.log("Browser closed");

            try {
                await this.UploadDataDir();
            } catch (error) {
                console.error(`error with upload ${error}`)
            }

            try {
                fs.rmdirSync(this.userdir, { recursive: true });
            } catch (error) { }
        }
    }

    async cleanTabs() {
        // Placeholder for cleaning up tabs if necessary
        console.log("Cleaning tabs - to be implemented");
    }

    async getProcessesWithCmd() {
        const platform = process.platform;
        if (platform === "win32") {
            const { stdout } = await execa("wmic", ["process", "get", "ProcessId,CommandLine"]);
            return stdout
                .split("\n")
                .slice(1)
                .map((line) => {
                    const match = line.trim().match(/(.*)\s+(\d+)$/);
                    return match ? { cmd: match[1].trim(), pid: parseInt(match[2], 10) } : null;
                })
                .filter(Boolean);
        } else {
            const { stdout } = await execa("ps", ["-eo", "pid,command"]);
            return stdout
                .split("\n")
                .slice(1)
                .map((line) => {
                    const match = line.trim().match(/^(\d+)\s+(.*)$/);
                    return match ? { pid: parseInt(match[1], 10), cmd: match[2].trim() } : null;
                })
                .filter(Boolean);
        }
    }

    async killChromeProcessWithArg(arg) {
        try {
            const processes = await this.getProcessesWithCmd();
            let chromeProcesses = [];
            processes.forEach((item) => {
                if (item.cmd.includes(arg) && item.cmd.includes("chrome")) {
                    chromeProcesses.push(item);
                }
            });

            for (let killindex = 0; killindex < chromeProcesses.length; killindex++) {
                const chromeProcess = chromeProcesses[killindex];
                if (chromeProcess) {
                    console.log(`Killing process with PID: ${chromeProcess.pid}`);
                    treeKill(chromeProcess.pid, "SIGKILL", (err) => {
                        if (err) {
                            console.error(`Error killing process: ${err}`);
                        } else {
                            console.log(`Process with PID ${chromeProcess.pid} killed successfully`);
                        }
                    });
                } else {
                    console.log("No Chrome process found with the specified argument");
                }
            }

            if (chromeProcesses.length > 0) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        } catch (err) {
            console.error(`Error: ${err}`);
        }
    }

    getBrowserWindowDetails(screenWidth, screenHeight) {
        const minBrowserWidth = 1920;
        const minBrowserHeight = 1080;

        const widthMultiplier = Math.random() * 0.8 + 1;
        const heightMultiplier = Math.random() * 0.8 + 1;

        let newScreenWidth = Math.floor(screenWidth * widthMultiplier);
        let newScreenHeight = Math.floor(screenHeight * heightMultiplier);

        if (screenWidth < newScreenWidth) {
            newScreenWidth = screenWidth;
        }

        if (screenHeight < newScreenHeight) {
            newScreenHeight = screenHeight;
        }

        const maxBrowserWidth = Math.min(newScreenWidth, Math.floor((newScreenHeight * 16) / 9));
        const browserWidth = Math.floor(Math.random() * (maxBrowserWidth - minBrowserWidth) + minBrowserWidth);

        const browserHeight = Math.floor((browserWidth * 9) / 16);

        const positionX = Math.floor(Math.random() * (screenWidth - browserWidth));
        const positionY = Math.floor(Math.random() * (screenHeight - browserHeight));

        const randomWidthPixels = Math.floor(Math.random() * 41) - 20;
        const randomHeightPixels = Math.floor(Math.random() * 41) - 20;

        const fakeData = {
            position: {
                x: parseInt(positionX),
                y: parseInt(positionY),
            },
            size: {
                width: parseInt(browserWidth + randomWidthPixels),
                height: parseInt(browserHeight + randomHeightPixels),
            },
            monitor: {
                width: screenWidth,
                height: screenHeight,
            },
        };

        return fakeData;
    }

    async LocalPortSessionMgr(guid) {
        // Function to hash the GUID and map it to a port within the specified range
        const MIN_PORT = 8000;
        const MAX_PORT = 18000;
        function guidToPort(guid, minPort = MIN_PORT, maxPort = MAX_PORT) {
            const hash = crypto.createHash("sha256").update(guid).digest("hex");
            const hashInt = parseInt(hash.slice(0, 8), 16);
            const port = minPort + (hashInt % (maxPort - minPort + 1));
            return port;
        }

        // Function to check if a port is available
        function isPortAvailable(port) {
            return new Promise((resolve, reject) => {
                const server = net.createServer();

                server.once("error", (err) => {
                    if (err.code === "EADDRINUSE") {
                        resolve(false); // Port is in use
                    } else {
                        reject(err); // Other error
                    }
                });

                server.once("listening", () => {
                    server.close();
                    resolve(true); // Port is available
                });

                server.listen(port);
            });
        }

        try {
            const port = guidToPort(guid, MIN_PORT, MAX_PORT);

            const available = await isPortAvailable(port);
            if (!available) {
                throw new Error(`Port ${port} is not available`);
            }

            return port;
        } catch (err) {
            console.error(err);
            throw err;
        }
    }

    static async launch(launchoptions, uniqueid) {
        if (!uniqueid) {
            throw new Error("failed to get uniqueid");
        }

        if (!launchoptions.userdir) {
            throw new Error("failed to get userdir");
        }

        let browser = new DCSBrowser();

        return new Promise(async (resolve, reject) => {
            await browser.killChromeProcessWithArg(launchoptions.userdir);
            browser.userdir = launchoptions.userdir;
            browser.launchoptions = launchoptions
            let chromeArgs = [
                "--test-type",
                `--user-data-dir=${launchoptions.userdir}`,
                //`--user-agent=${launchoptions.useragent}`,
                "--disable-blink-features=AutomationControlled",
                "--force-dark-mode",
                "--disable-infobars",
                "--disable-popup-blocking",
                "--disable-notifications",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-session-crashed-bubble",
                "--disable-sync",
                "--disable-client-side-phishing-detection",
                "--disable-component-update",
                "--disable-default-apps",
                "--disable-breakpad",
                "--disable-features=IsolateOrigins,site-per-process,PrivacySandboxSettings2,PrivacySandboxAdsAPIs,TranslateUI,enable-webrtc-hide-local-ips-with-mdns,OptimizationGuideModelDownloading,OptimizationHintsFetching",
                "--disable-crash-reporter",
                "--no-crash-upload",
                "--deny-permission-prompts",
                "--autoplay-policy=no-user-gesture-required",
                "--disable-prompt-on-repost",
                "--disable-search-geolocation-disclosure",
                "--password-store=basic",
                "--use-mock-keychain",
                "--force-color-profile=srgb",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
                "--disable-background-timer-throttling",
                "--disable-ipc-flooding-protection",
                "--disable-hang-monitor",
                "--disable-background-networking",
                "--metrics-recording-only",
                "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                "--webrtc-ip-handling-policy=default_public_interface_only",
                "--disable-gpu",
                "--disable-gpu-shader-disk-cache"
                //
                /*
                 */
            ];

            try {
                await browser.RestoreDataDir();
            } catch (error) {
                console.dir(error);
            }

            let newport = await browser.LocalPortSessionMgr(uniqueid);

            //console.log(newport);
            //Set debugging port
            chromeArgs.unshift("--remote-debugging-port=" + newport);

            if (launchoptions.proxy) {
                chromeArgs.unshift("--proxy-server=" + launchoptions.proxy);
            }

            if (launchoptions.disablewebsecurity) {
                chromeArgs.unshift("--disable-web-security");
                chromeArgs.unshift("--disable-site-isolation-trials");
                chromeArgs.unshift("--no-sandbox");
            }

            if (launchoptions.extension) {
                //Load an extension
                chromeArgs.push("--load-extension=" + launchoptions.extension + "");
                console.log("loading extenson >> " + "--load-extension=" + launchoptions.extension);
            }

            browser.debugPort = newport;

            const screenWidth = 1920; // or retrieve from system settings
            const screenHeight = 1080; // or retrieve from system settings
            const browserWindowDetails = browser.getBrowserWindowDetails(screenWidth, screenHeight);

            chromeArgs.push(`--window-size=${browserWindowDetails.size.width},${browserWindowDetails.size.height}`);
            console.log(`--window-size=${browserWindowDetails.size.width},${browserWindowDetails.size.height}`);
            //chromeArgs.push(`--window-position=${browserWindowDetails.position.x},${browserWindowDetails.position.y}`);
            console.log("launching browser");
            const child = execFile(chromePath, chromeArgs, (error) => {
                if (error) {
                    console.error("Failed to launch Chrome:", error);
                }
            });

            await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for Chrome to start

            let wsUrl;
            try {
                wsUrl = await browser.waitForWebSocketDebuggerUrl();
            } catch (error) {
                reject(error);
            }

            browser.ws = new WebSocket(wsUrl);

            browser.ws.on("open", async () => {
                console.log("Connected to Chrome DevTools Successfully");

                browser.targetId = wsUrl.split("/").pop();

                resolve(browser);
            });

            browser.ws.on("message", (data) => {
                let response = JSON.parse(Buffer.from(data).toString());
                if (response) {
                    if (response.result) {
                        //console.log("Received message:", response);
                    }
                }
            });

            return browser
        });
    }

    async getWebSocketDebuggerUrl() {
        return new Promise((resolve, reject) => {
            if (!this.debugPort) {
                throw new Error("Debug port not found!");
            }

            http.get(`http://127.0.0.1:${this.debugPort}/json`, (res) => {
                let data = "";

                res.on("data", (chunk) => {
                    data += chunk;
                });

                res.on("end", () => {
                    try {
                        const response = JSON.parse(data);
                        let pageinit;
                        response.forEach((item) => {
                            if (item.type === "page") {
                                pageinit = item;
                            }
                        });
                        const wsUrl = pageinit.webSocketDebuggerUrl;

                        console.log(wsUrl);
                        resolve(wsUrl);
                    } catch (error) {
                        reject(error);
                    }
                });
            }).on("error", (err) => {
                reject(err);
            });
        });
    }

    async waitForWebSocketDebuggerUrl(retries = 10, delay = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                const wsUrl = await this.getWebSocketDebuggerUrl();
                return wsUrl;
            } catch (error) {
                console.error(`Attempt ${i + 1} to get WebSocket debugger URL failed: ${error.message}`);
                if (i < retries - 1) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                    delay *= 1.5; // Increase delay for the next attempt
                } else {
                    throw new Error("Exceeded maximum retries to get WebSocket debugger URL");
                }
            }
        }
    }

    async bootbrowser() { }
}

module.exports = DCSBrowser;
