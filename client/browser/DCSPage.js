const chalk = require("chalk");
const WebSocket = require("ws");
const ImageProcessor = {};

class DCSPage {
    constructor(ws, sessionId = null) {
        if (!ws) {
            throw new Error("No WebSocket instance");
        }
        this.ws = ws;
        this.sessionId = sessionId;
        this.cdpSession = null;
        this.frame = null;
        this.keyboard = {
            press: async (key) => {
                //await this.driver.actions().sendKeys(Key[key.toUpperCase()]).perform();
            },
            down: async (key) => {
                //await this.driver.actions().keyDown(Key[key.toUpperCase()]).perform();
            },
            up: async (key) => {
                //await this.driver.actions().keyUp(Key[key.toUpperCase()]).perform();
            },
            type: async (text) => {
                //await this.driver.actions().sendKeys(text).perform();
            },
        };
        this.windowHandle = null;
        this.commandId = 10000; // Initialize command ID
        this.viewportchanged = false;
        this.imageTolerance = 80;
        this.pixelTolerance = 3;
        this.useworker = true;
        this.debug = false

        this.debuglog = (message) => {
            console.log('SYSDEBUG || ' + chalk.blueBright(message))
        }



        if (this.debug) {
            this.debuglog('DCSPage Constructed: SESSIONID: ' + sessionId)
        }

        this.contextIdMap = {};
        this.ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (message.method === 'Runtime.executionContextCreated') {
                const { context } = message.params;
                if (context.auxData && context.auxData.frameId) {
                    this.contextIdMap[context.auxData.frameId] = context.id;
                }
            }
        });
    }

    async hideSecurityWarning() {
        const script = `
            const hideWarningBanner = () => {
                const warningBanner = document.querySelector('#insecure-content');
                if (warningBanner) {
                    warningBanner.style.display = 'none';
                }
            };
    
            // Hide the banner immediately if it exists
            hideWarningBanner();
    
            // Hide the banner whenever a new element is added to the DOM
            new MutationObserver(hideWarningBanner).observe(document.body, { childList: true, subtree: true });
        `;

        try {
            await this.sendCommand("Runtime.evaluate", {
                expression: script,
                awaitPromise: true,
            });
            console.log("Security warning banner hidden.");
        } catch (error) {
            console.error("Failed to hide security warning banner:", error.message);
        }
    }

    async textSearchClick(searchText) {
        console.log("text Searching...");
        let elementCoordinates = await this.evaluate((searchText) => {
            let deepestElement = null;
            let maxDepth = -1;

            // Function to traverse the DOM and find the deepest element containing the specified text
            function traverse(node, depth) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    for (let i = 0; i < node.childNodes.length; i++) {
                        traverse(node.childNodes[i], depth + 1);
                    }

                    if (node.textContent.includes(searchText)) {
                        if (depth > maxDepth) {
                            deepestElement = node;
                            maxDepth = depth;
                        }
                    }
                }
            }

            traverse(document.body, 0);

            if (deepestElement) {
                const rect = deepestElement.getBoundingClientRect();
                return {
                    x: rect.left + rect.width / 2 + window.scrollX,
                    y: rect.top + rect.height / 2 + window.scrollY,
                    html: deepestElement.outerHTML,
                };
            }
            return null;
        }, searchText);

        if (elementCoordinates) {
            console.log("text Found, clicking...", elementCoordinates);
            await this.clickXY(elementCoordinates.x, elementCoordinates.y);
        }
    }

    async imageSearchXY(pngraw) {
        try {
            //Get screenshot of browser now
            let browserscreenshot = await this.screenshot({
                fullPage: false,
                encoding: "binary",
                type: "png",
                quality: 100,
            });

            //Use image processor to find image on page

            //Return XY

            let startTime = new Date().getTime();

            let process = new ImageProcessor(
                browserscreenshot,
                this.imageTolerance,
                this.pixelTolerance,
                this.useworker
            );

            let coords = await process.imagesearch(pngraw);

            console.dir(coords);

            console.log("job completed in " + parseFloat((new Date().getTime() - startTime) / 1000).toFixed(2) + " s");

            return coords;
        } catch (error) {
            console.log(error);
        }
    }

    randomDelay(min, max) {
        if (this.debug) {
            this.debuglog('randomDelay waiting..')
        }
        return new Promise((resolve) => setTimeout(resolve, Math.random() * (max - min) + min));
    }

    async setPageScaleFactor(scaleFactor) {
        console.log(`Setting page scale factor to ${scaleFactor}`);
        await this.sendCommand("Emulation.setPageScaleFactor", { pageScaleFactor: scaleFactor });
    }

    async setDeviceMetricsOverride(width, height, deviceScaleFactor) {
        console.log(`Setting device metrics: width=${width}, height=${height}, deviceScaleFactor=${deviceScaleFactor}`);
        await this.sendCommand("Emulation.setDeviceMetricsOverride", {
            width: width,
            height: height,
            deviceScaleFactor: deviceScaleFactor,
            mobile: false,
        });
    }

    getBrowserWindowDetails(screenWidth, screenHeight) {
        const minBrowserWidth = 1920 * 0.75;
        const minBrowserHeight = 1080 * 0.75;

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

    async createSession(targetId) {
        try {
            console.log("creating session with " + targetId);
            const { sessionId } = await this.sendCommand("Target.attachToTarget", { targetId, flatten: true }, false);
            this.sessionId = sessionId;
            console.log("Session created with sessionId:", sessionId);
        } catch (error) {
            console.error("Failed to create session:", error.message);
        }
    }

    async enableDomains() {
        try {
            await this.sendCommand("Page.enable");
            await this.sendCommand("Network.enable");
            await this.sendCommand("Runtime.enable");
            //console.log("Enabled Page, Network, and Runtime domains.");
        } catch (error) {
            console.error("Failed to enable domains:", error.message);
        }
    }

    async newTab() {
        console.log("new tab launched ");
        await this.sendCommand("Target.createTarget", { url: "about:blank" });
    }

    async goto(url) {
        await this.verifyHandle();
        await this.switchToTab();
        this.viewportchanged = true;

        if (!this.viewportchanged) {
            let windowFake = this.getBrowserWindowDetails(1920, 1080);
            await this.setDeviceMetricsOverride(windowFake.size.width, windowFake.size.height, 1);
            this.viewportchanged = true;
            console.log("viewport updated");
        }

        this.debuglog('navigating to ' + url);

        const GLOBAL_TIMEOUT = 45000; // 45 seconds

        try {
            await this.enableDomains(); // Enable domains before navigation

            // Timeout wrapper for Page.navigate
            const navigateResult = await Promise.race([
                this.sendCommand("Page.navigate", { url }), // Command to navigate
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Navigation timeout exceeded 15 seconds")), GLOBAL_TIMEOUT)
                )
            ]);

            if (navigateResult.errorText) {
                console.error(`Navigation to ${url} failed: ${navigateResult.errorText}`);
                return;
            }

            // Handle page load event with timeout
            const pageLoadComplete = new Promise((resolve, reject) => {
                const listener = (data) => {
                    const message = JSON.parse(data);
                    if (message.method === "Page.loadEventFired") {
                        this.ws.off("message", listener);
                        resolve();
                    }
                };

                this.ws.on("message", listener);

                // Add a timeout for load event
                setTimeout(() => {
                    this.ws.off("message", listener);
                    reject(new Error("Page load event timed out after 45 seconds"));
                }, GLOBAL_TIMEOUT);
            });

            await pageLoadComplete;
            console.log("Navigation to " + url + " complete");
            return true
        } catch (error) {
            this.debuglog(`Error: Failed to navigate to ${url}: ${error.message}`);

            // Abort navigation if timeout or error occurs
            try {
                await this.sendCommand("Page.stopLoading"); // Attempt to stop loading the page
                console.log("Navigation aborted successfully.");
            } catch (abortError) {
                console.error("Failed to abort navigation:", abortError.message);
            }

            throw new Error(`Error: Failed to navigate to ${url}: ${error.message}`)

            return false
        }
    }


    async evaluate(fn, ...args) {
        await this.verifyHandle();
        await this.switchToTab();



        const fnString = fn.toString();
        const argsString = JSON.stringify(args);

        console.log('evaluating function...' + chalk.redBright(fnString))

        const expression = `(${fnString}).apply(null, ${argsString})`;

        const params = {
            expression,
            awaitPromise: true,
            returnByValue: true,
        };

        if (this.frame) {
            const contextId = this.contextIdMap[this.frameId];
            if (!contextId) {
                throw new Error(`Execution context not found for frame ID: ${this.frameId}`);
            }
            params.contextId = contextId;
        }

        const result = await this.sendCommand('Runtime.evaluate', params);

        if (result.exceptionDetails) {
            throw new Error(JSON.stringify(result.exceptionDetails));
        }

        return result.result.value;
    }


    async screenshot(options = {}) {
        const { data } = await this.sendCommand("Page.captureScreenshot", options);
        return Buffer.from(data, "base64");
    }

    async close() {
        await this.sendCommand("Page.close");
    }

    async url() {
        await this.verifyHandle(); // Ensure the session is valid and domains are enabled
        try {
            const {
                result: { value },
            } = await this.sendCommand("Runtime.evaluate", {
                expression: "window.location.href",
                returnByValue: true,
            });
            return value;
        } catch (error) {
            console.error(`Failed to get current URL: ${error.message}`);
            throw error;
        }
    }

    async waitForSelector(selector, timeout = 5000) {
        await this.verifyHandle();
        await this.switchToTab();

        const start = Date.now();
        const pollInterval = 100;
        while (Date.now() - start < timeout) {
            const result = await this.evaluate(
                (sel) => document.querySelector(sel) !== null,
                selector
            );
            if (result) {
                return;
            }
            await this.randomDelay(pollInterval, pollInterval);
        }
        throw new Error(`Timeout waiting for selector: ${selector}`);
    }


    // Helper function to resolve nested iframes
    async resolveNestedFrame(frameId, selector) {
        // Attempt to locate the element within the first-level iframe

        if (this.debug) {
            this.debuglog(`resolveNestedFrame ${selector} in ${frameId}`)
        }

        const { nodeId } = await this.sendCommand("DOM.getFrameOwner", {
            frameId: frameId,
        });

        if (!nodeId) {
            throw new Error(`Frame with ID "${frameId}" not found.`);
        }

        // Attempt to find the element directly within this iframe
        const { nodeId: elementNodeId } = await this.sendCommand("DOM.querySelector", {
            selector,
            nodeId,
        });

        if (elementNodeId) {
            if (this.debug) {
                this.debuglog(`resolveNestedFrame resolved ElementNodeId ${elementNodeId}`)
            }
            return elementNodeId; // Element found in the first-level iframe
        }

        // If the element was not found in the first-level iframe, start investigating nested frames
        const { frameTree } = await this.sendCommand("Page.getFrameTree");

        // Define a recursive helper function to traverse nested frames
        const findElementInNestedFrames = async (frames) => {
            for (const frame of frames) {
                const nestedNodeId = await this.sendCommand("DOM.getFrameOwner", {
                    frameId: frame.frame.id,
                });

                if (!nestedNodeId) continue;

                const { nodeId: nestedElementNodeId } = await this.sendCommand("DOM.querySelector", {
                    selector,
                    nodeId: nestedNodeId,
                });

                if (nestedElementNodeId) {
                    return nestedElementNodeId; // Element found in a nested iframe
                }

                // Recursively search within child frames
                if (frame.childFrames && frame.childFrames.length > 0) {
                    const result = await findElementInNestedFrames(frame.childFrames);
                    if (result) {
                        if (this.debug) {
                            this.debuglog(`resolveNestedFrame findElementInNestedFrames resolved ${result}`)
                        }
                        return result;
                    }
                }
            }

            return null;
        };

        // Start searching in the nested frames of the first-level frame
        const firstLevelFrame = frameTree.childFrames.find((frame) => frame.frame.id === frameId);

        if (firstLevelFrame && firstLevelFrame.childFrames && firstLevelFrame.childFrames.length > 0) {
            return await findElementInNestedFrames(firstLevelFrame.childFrames);
        }

        return null; // Element not found in any frames
    }

    async click(selector) {
        await this.verifyHandle();
        await this.switchToTab();

        const contextId = this.frame ? this.contextIdMap[this.frameId] : undefined;
        if (this.frame && !contextId) {
            throw new Error(`Execution context not found for frame ID: ${this.frameId}`);
        }

        // Evaluate in the correct context to find the element and get its objectId
        const evalResult = await this.sendCommand('Runtime.evaluate', {
            expression: `document.querySelector(${JSON.stringify(selector)})`,
            contextId: contextId, // Use the correct execution context
            returnByValue: false,
            objectGroup: 'element',
        });

        if (!evalResult || !evalResult.result || !evalResult.result.objectId) {
            throw new Error(`Element not found for selector: ${selector}`);
        }

        const objectId = evalResult.result.objectId;

        // Get the box model of the element to compute its absolute position
        const boxModelResult = await this.sendCommand('DOM.getBoxModel', {
            objectId: objectId,
        });

        if (!boxModelResult || !boxModelResult.model) {
            throw new Error('Could not get box model of the element');
        }

        // Compute the center of the element using the box model
        const model = boxModelResult.model;
        const contentQuad = model.content;
        let x = (contentQuad[0] + contentQuad[4]) / 2;
        let y = (contentQuad[1] + contentQuad[5]) / 2;

        // Calculate element size
        const elementWidth = Math.abs(contentQuad[0] - contentQuad[4]);
        const elementHeight = Math.abs(contentQuad[1] - contentQuad[5]);

        // Determine maximum offset (half of element size minus a small margin)
        const maxOffsetX = Math.max(Math.min(5, elementWidth / 2 - 1), 0);
        const maxOffsetY = Math.max(Math.min(5, elementHeight / 2 - 1), 0);

        // Randomize x and y within the element's boundaries
        const randomOffsetX = () => (Math.random() - 0.5) * 2 * maxOffsetX;
        const randomOffsetY = () => (Math.random() - 0.5) * 2 * maxOffsetY;
        x += randomOffsetX();
        y += randomOffsetY();

        // Dispatch the mouse events at the randomized coordinates
        await this.sendCommand('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button: 'left',
            clickCount: 1,
        });
        await this.randomDelay(5, 15);
        await this.sendCommand('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button: 'left',
            clickCount: 1,
        });

        if (this.debug) {
            this.debuglog(`Clicking ${selector} at (${x.toFixed(2)}, ${y.toFixed(2)})`);
        }
    }


    async clickXY(x, y) {
        if (this.debug) {
            /* javascript-obfuscator:disable */
            await this.evaluate(
                (x, y) => {
                    const crosshair = document.createElement("div");
                    crosshair.id = "crosshair";
                    crosshair.style.position = "fixed";
                    crosshair.style.left = `${x - 10}px`; // Adjust the position to center the crosshair
                    crosshair.style.top = `${y - 10}px`; // Adjust the position to center the crosshair
                    crosshair.style.width = "20px";
                    crosshair.style.height = "20px";
                    crosshair.style.border = "2px solid red";
                    crosshair.style.borderRadius = "50%";
                    crosshair.style.zIndex = "10000"; // Ensure it's on top of other elements
                    crosshair.style.pointerEvents = "none"; // Make sure it doesn't block clicks

                    document.body.appendChild(crosshair);

                    // Remove the crosshair after a short delay
                    setTimeout(() => {
                        document.body.removeChild(crosshair);
                    }, 2000); // Adjust the delay as needed
                },
                x,
                y
            );
            /* javascript-obfuscator:enable */
        }

        const mouseEventParams = {
            type: "mousePressed",
            x: x, // X coordinate for the top-left part of the screen
            y: y, // Y coordinate for the top-left part of the screen
            button: "left",
            clickCount: 1,
        };

        // Send mousePressed event
        await this.sendCommand("Input.dispatchMouseEvent", mouseEventParams);

        // Adjust the type for mouseReleased event
        mouseEventParams.type = "mouseReleased";

        // Send mouseReleased event
        await this.sendCommand("Input.dispatchMouseEvent", mouseEventParams);
    }

    async sendTab() {
        let tabKeyEventParams = {
            type: "keyDown",
            text: "\u0009", // Tab character
            unmodifiedText: "\u0009",
            key: "Tab",
            code: "Tab",
            windowsVirtualKeyCode: 9, // VK_TAB
            nativeVirtualKeyCode: 9, // VK_TAB
            macCharCode: 9, // VK_TAB
            isKeypad: false,
            modifiers: 0, // No modifiers
        };

        await this.sendCommand("Input.dispatchKeyEvent", tabKeyEventParams);

        // Adjust the type for keyUp event
        tabKeyEventParams.type = "keyUp";

        // Send keyUp event for Tab
        await this.sendCommand("Input.dispatchKeyEvent", tabKeyEventParams);
    }

    async sendEnter() {
        let returnKeyEventParams = {
            type: "keyDown",
            text: "\r", // Carriage return character
            unmodifiedText: "\r",
            key: "Enter",
            code: "Enter",
            windowsVirtualKeyCode: 13, // VK_RETURN
            nativeVirtualKeyCode: 13, // VK_RETURN
            macCharCode: 13, // VK_RETURN
            isKeypad: false,
            modifiers: 0, // No modifiers
        };

        // Send keyDown event for Return (Enter)
        await this.sendCommand("Input.dispatchKeyEvent", returnKeyEventParams);

        // Adjust the type for keyUp event
        returnKeyEventParams.type = "keyUp";

        // Send keyUp event for Return (Enter)
        await this.sendCommand("Input.dispatchKeyEvent", returnKeyEventParams);
    }

    async clickXPath(selector) {
        await this.verifyHandle();
        await this.switchToTab();

        await this.waitForXPath(selector); // You may need to implement this function to wait for the XPath selector
        await this.evaluate((sel) => {
            const element = document.evaluate(
                sel,
                document,
                null,
                XPathResult.FIRST_ORDERED_NODE_TYPE,
                null
            ).singleNodeValue;
            if (element) {
                element.click();
            } else {
                throw new Error(`Element not found for XPath: ${sel}`);
            }
        }, selector);
    }

    async waitForXPath(xpath, timeout = 30000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const element = await this.evaluate((sel) => {
                return (
                    document.evaluate(sel, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
                        .singleNodeValue !== null
                );
            }, xpath);
            if (element) {
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error(`Timeout waiting for XPath: ${xpath}`);
    }

    async _type(selector, text) {
        await this.type(selector, text);
    }

    async typeDirect(text) {
        const specialKeys = {
            ".": { key: ".", code: "Period", keyCode: 190 },
            ",": { key: ",", code: "Comma", keyCode: 188 },
            "!": { key: "!", code: "Digit1", keyCode: 49, modifiers: 8 }, // Shift + 1
            "@": { key: "@", code: "Digit2", keyCode: 50, modifiers: 8 }, // Shift + 2
            "#": { key: "#", code: "Digit3", keyCode: 51, modifiers: 8 }, // Shift + 3
            $: { key: "$", code: "Digit4", keyCode: 52, modifiers: 8 }, // Shift + 4
            "%": { key: "%", code: "Digit5", keyCode: 53, modifiers: 8 }, // Shift + 5
            "^": { key: "^", code: "Digit6", keyCode: 54, modifiers: 8 }, // Shift + 6
            "&": { key: "&", code: "Digit7", keyCode: 55, modifiers: 8 }, // Shift + 7
            "*": { key: "*", code: "Digit8", keyCode: 56, modifiers: 8 }, // Shift + 8
            "(": { key: "(", code: "Digit9", keyCode: 57, modifiers: 8 }, // Shift + 9
            ")": { key: ")", code: "Digit0", keyCode: 48, modifiers: 8 }, // Shift + 0
            "-": { key: "-", code: "Minus", keyCode: 189 },
            _: { key: "_", code: "Minus", keyCode: 189, modifiers: 8 }, // Shift + -
            "=": { key: "=", code: "Equal", keyCode: 187 },
            "+": { key: "+", code: "Equal", keyCode: 187, modifiers: 8 }, // Shift + =
            "[": { key: "[", code: "BracketLeft", keyCode: 219 },
            "]": { key: "]", code: "BracketRight", keyCode: 221 },
            "{": { key: "{", code: "BracketLeft", keyCode: 219, modifiers: 8 }, // Shift + [
            "}": { key: "}", code: "BracketRight", keyCode: 221, modifiers: 8 }, // Shift + ]
            "\\": { key: "\\", code: "Backslash", keyCode: 220 },
            "|": { key: "|", code: "Backslash", keyCode: 220, modifiers: 8 }, // Shift + \
            ";": { key: ";", code: "Semicolon", keyCode: 186 },
            ":": { key: ":", code: "Semicolon", keyCode: 186, modifiers: 8 }, // Shift + ;
            "'": { key: "'", code: "Quote", keyCode: 222 },
            '"': { key: '"', code: "Quote", keyCode: 222, modifiers: 8 }, // Shift + '
            "<": { key: "<", code: "Comma", keyCode: 188, modifiers: 8 }, // Shift + ,
            ">": { key: ">", code: "Period", keyCode: 190, modifiers: 8 }, // Shift + .
            "/": { key: "/", code: "Slash", keyCode: 191 },
            "?": { key: "?", code: "Slash", keyCode: 191, modifiers: 8 }, // Shift + /
            "`": { key: "`", code: "Backquote", keyCode: 192 },
            "~": { key: "~", code: "Backquote", keyCode: 192, modifiers: 8 }, // Shift + `
        };

        // Emulate key presses
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            await this.randomDelay(140, 240); // Add random delay between characters

            if (i < text.length - 1 && text[i] !== " ") {
                await this.sendCommand("Input.insertText", { text: char });
            } else {
                // For the last character, use dispatchKeyEvent
                let key,
                    code,
                    keyCode,
                    modifiers = 0;

                if (specialKeys[char]) {
                    key = specialKeys[char].key;
                    code = specialKeys[char].code;
                    keyCode = specialKeys[char].keyCode;
                    modifiers = specialKeys[char].modifiers || 0;
                } else if (char >= "a" && char <= "z") {
                    key = char;
                    code = `Key${char.toUpperCase()}`;
                    keyCode = char.charCodeAt(0);
                } else if (char >= "A" && char <= "Z") {
                    key = char;
                    code = `Key${char}`;
                    keyCode = char.charCodeAt(0);
                    modifiers = 8; // Shift
                } else if (char >= "0" && char <= "9") {
                    key = char;
                    code = `Digit${char}`;
                    keyCode = char.charCodeAt(0);
                }

                const keyEventParams = {
                    type: "keyDown",
                    text: char,
                    unmodifiedText: char,
                    key: key,
                    code: code,
                    windowsVirtualKeyCode: keyCode,
                    nativeVirtualKeyCode: keyCode,
                    macCharCode: keyCode,
                    isKeypad: false,
                    modifiers: modifiers,
                };

                await this.sendCommand("Input.dispatchKeyEvent", keyEventParams);

                keyEventParams.type = "keyUp";

                await this.randomDelay(10, 30); // Slight delay before keyUp
                await this.sendCommand("Input.dispatchKeyEvent", keyEventParams);
            }
        }
    }

    async type(selector, text) {
        await this.verifyHandle();
        await this.switchToTab();
        await this.waitForSelector(selector);

        // Obtain the execution context ID for the frame
        const contextId = this.frame ? this.contextIdMap[this.frameId] : undefined;
        if (this.frame && !contextId) {
            throw new Error(`Execution context not found for frame ID: ${this.frameId}`);
        }

        // Focus the element within the correct execution context
        await this.evaluate(
            (sel) => {
                const elem = document.querySelector(sel);
                if (elem) {
                    elem.focus();
                    // Optionally, move the cursor to the end of the input
                    if (elem.setSelectionRange && elem.value) {
                        const length = elem.value.length;
                        elem.setSelectionRange(length, length);
                    }
                } else {
                    throw new Error(`Element not found for selector: ${sel}`);
                }
            },
            selector
        );

        // Define special keys and their corresponding key codes and modifiers
        const specialKeys = {
            '.': { key: '.', code: 'Period', keyCode: 190 },
            ',': { key: ',', code: 'Comma', keyCode: 188 },
            '!': { key: '!', code: 'Digit1', keyCode: 49, modifiers: 8 },
            '@': { key: '@', code: 'Digit2', keyCode: 50, modifiers: 8 },
            '#': { key: '#', code: 'Digit3', keyCode: 51, modifiers: 8 },
            $: { key: '$', code: 'Digit4', keyCode: 52, modifiers: 8 },
            '%': { key: '%', code: 'Digit5', keyCode: 53, modifiers: 8 },
            '^': { key: '^', code: 'Digit6', keyCode: 54, modifiers: 8 },
            '&': { key: '&', code: 'Digit7', keyCode: 55, modifiers: 8 },
            '*': { key: '*', code: 'Digit8', keyCode: 56, modifiers: 8 },
            '(': { key: '(', code: 'Digit9', keyCode: 57, modifiers: 8 },
            ')': { key: ')', code: 'Digit0', keyCode: 48, modifiers: 8 },
            '-': { key: '-', code: 'Minus', keyCode: 189 },
            '_': { key: '_', code: 'Minus', keyCode: 189, modifiers: 8 },
            '=': { key: '=', code: 'Equal', keyCode: 187 },
            '+': { key: '+', code: 'Equal', keyCode: 187, modifiers: 8 },
            '[': { key: '[', code: 'BracketLeft', keyCode: 219 },
            ']': { key: ']', code: 'BracketRight', keyCode: 221 },
            '{': { key: '{', code: 'BracketLeft', keyCode: 219, modifiers: 8 },
            '}': { key: '}', code: 'BracketRight', keyCode: 221, modifiers: 8 },
            '\\': { key: '\\', code: 'Backslash', keyCode: 220 },
            '|': { key: '|', code: 'Backslash', keyCode: 220, modifiers: 8 },
            ';': { key: ';', code: 'Semicolon', keyCode: 186 },
            ':': { key: ':', code: 'Semicolon', keyCode: 186, modifiers: 8 },
            "'": { key: "'", code: 'Quote', keyCode: 222 },
            '"': { key: '"', code: 'Quote', keyCode: 222, modifiers: 8 },
            '<': { key: '<', code: 'Comma', keyCode: 188, modifiers: 8 },
            '>': { key: '>', code: 'Period', keyCode: 190, modifiers: 8 },
            '/': { key: '/', code: 'Slash', keyCode: 191 },
            '?': { key: '?', code: 'Slash', keyCode: 191, modifiers: 8 },
            '`': { key: '`', code: 'Backquote', keyCode: 192 },
            '~': { key: '~', code: 'Backquote', keyCode: 192, modifiers: 8 },
            ' ': { key: ' ', code: 'Space', keyCode: 32 },
            '\n': { key: 'Enter', code: 'Enter', keyCode: 13 },
            '\t': { key: 'Tab', code: 'Tab', keyCode: 9 },
        };

        // Emulate key presses
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            await this.randomDelay(140, 240); // Random delay between characters

            let keyEventParams = {
                type: 'keyDown',
                text: char,
                unmodifiedText: char,
                isKeypad: false,
                modifiers: 0,
            };

            // Handle special keys and modifiers
            if (specialKeys[char]) {
                const keyInfo = specialKeys[char];
                keyEventParams = {
                    ...keyEventParams,
                    key: keyInfo.key,
                    code: keyInfo.code,
                    windowsVirtualKeyCode: keyInfo.keyCode,
                    nativeVirtualKeyCode: keyInfo.keyCode,
                    macCharCode: keyInfo.keyCode,
                    modifiers: keyInfo.modifiers || 0,
                };
            } else if (char >= 'a' && char <= 'z') {
                keyEventParams = {
                    ...keyEventParams,
                    key: char,
                    code: `Key${char.toUpperCase()}`,
                    windowsVirtualKeyCode: char.toUpperCase().charCodeAt(0),
                    nativeVirtualKeyCode: char.toUpperCase().charCodeAt(0),
                    macCharCode: char.charCodeAt(0),
                };
            } else if (char >= 'A' && char <= 'Z') {
                keyEventParams = {
                    ...keyEventParams,
                    key: char,
                    code: `Key${char}`,
                    windowsVirtualKeyCode: char.charCodeAt(0),
                    nativeVirtualKeyCode: char.charCodeAt(0),
                    macCharCode: char.charCodeAt(0),
                    modifiers: 8, // Shift
                };
            } else if (char >= '0' && char <= '9') {
                keyEventParams = {
                    ...keyEventParams,
                    key: char,
                    code: `Digit${char}`,
                    windowsVirtualKeyCode: char.charCodeAt(0),
                    nativeVirtualKeyCode: char.charCodeAt(0),
                    macCharCode: char.charCodeAt(0),
                };
            } else {
                // Fallback for any other character
                keyEventParams = {
                    ...keyEventParams,
                    key: char,
                    code: '',
                    windowsVirtualKeyCode: char.charCodeAt(0),
                    nativeVirtualKeyCode: char.charCodeAt(0),
                    macCharCode: char.charCodeAt(0),
                };
            }

            // Send keyDown event
            await this.sendCommand('Input.dispatchKeyEvent', keyEventParams);

            // Slight delay before keyUp
            await this.randomDelay(10, 30);

            // Send keyUp event
            keyEventParams.type = 'keyUp';
            await this.sendCommand('Input.dispatchKeyEvent', keyEventParams);
        }
    }


    async setCookies(cookies) {
        // Set the cookies
        try {
            console.log("cookies found >> setting..." + cookies.length);
            for (const cookie of cookies) {
                await this.sendCommand("Network.setCookie", cookie);
                //console.log("Set cookie:", cookie);
            }
        } catch (error) { }
    }

    async setCookie(cookie) {
        console.log("setCookie");
        if (Object.keys(cookie).length === 0) {
            return;
        }
        console.log("cookies found >> setting...");
        await this.sendCommand("Network.setCookie", cookie);
    }

    async getCookie(name) {
        console.log("getCookie" + name);
        const cookies = await this.sendCommand("Network.getCookies");
        console.dir(cookies);
        return cookies.cookies.find((cookie) => cookie.name === name);
    }

    async deleteCookie(cookie) {
        try {
            await this.sendCommand("Network.deleteCookies", cookie);
        } catch (error) {
            console.dir(error);
        }
    }

    async cookies() {
        console.log("allCookies");
        const cookies = await this.sendCommand("Network.getCookies");
        return cookies.cookies;
    }

    async handlePopup() {
        console.log('handlepopup called!');
        await this.verifyHandle(); // Ensure the session is valid and domains are enabled

        // Fetch the current list of targets
        const targets = await this.sendCommand('Target.getTargets', {});
        const pageTargets = targets.targetInfos.filter((target) => target.type === 'page');

        // Assume the last page target is the new popup (latest created page)
        const popupTarget = pageTargets[0];

        if (!popupTarget) {
            throw new Error('No popup target found');
        }

        console.log('Popup target is', popupTarget);

        // Attach to the popup target
        const { sessionId } = await this.sendCommand(
            'Target.attachToTarget',
            { targetId: popupTarget.targetId, flatten: true },
            false
        );

        // Create a new instance of DCSPage with the popup session
        const newInstance = new DCSPage(this.ws, sessionId);

        // Enable necessary domains in the new session
        await newInstance.enableDomains();

        // Wait for the page to be fully loaded in the popup
        const pageLoadPromise = new Promise((resolve, reject) => {
            const listener = (data) => {
                const message = JSON.parse(data);
                if (message.sessionId === sessionId && message.method === 'Page.loadEventFired') {
                    this.ws.off('message', listener);
                    resolve();
                }
            };

            this.ws.on('message', listener);

            // Timeout to avoid waiting indefinitely
            setTimeout(() => {
                this.ws.off('message', listener);
                reject(new Error('Timeout waiting for popup page load'));
            }, 30000); // 30 seconds timeout
        });

        // Ensure the Page domain is enabled in the popup session
        await newInstance.sendCommand('Page.enable');

        // Wait for the page load event
        await pageLoadPromise;

        console.log('Switched to popup with sessionId:', sessionId);

        return newInstance;
    }







    async verifyHandle() {
        if (!this.sessionId) {
            throw new Error("No valid session found. Please create a session first.");
        }

        // Ensure that the necessary domains are enabled
        try {
            await this.enableDomains();
        } catch (error) {
            console.error("Failed to enable domains:", error.message);
            throw error;
        }
    }

    async switchToTab() {
        await this.verifyHandle(); // Ensure the session is valid and domains are enabled
        return;

        if (!this.windowHandle) {
            // Store the original window handle before switching to iframe
            const targets = await this.sendCommand("Target.getTargets", {});
            const targetInfo = targets.targetInfos.find((target) => target.type === "page" && target.attached);
            if (targetInfo) {
                this.windowHandle = targetInfo.targetId;
                console.log(chalk.yellow(`Original window handle stored: ${this.windowHandle}`));
            }
        }

        if (this.windowHandle) {
            if (this.frame) {
                try {
                    console.dir({
                        frame: this.frame,
                        wh: this.windowHandle,
                        obid: this.frameObjectId,
                    });

                    if (this.frameObjectId) {
                        await this.sendCommand("DOM.focus", { objectId: this.frameObjectId });
                        console.log(chalk.yellow(`Switched to frame with handle ${this.frameObjectId}`));
                    } else {
                        throw new Error(`Failed to resolve nodeId for frame with handle ${this.windowHandle}`);
                    }
                } catch (error) {
                    console.error(
                        chalk.red(`Failed to switch to frame with handle ${this.windowHandle}: ${error.message}`)
                    );
                }
            } else {
                try {
                    await this.sendCommand("Target.activateTarget", { targetId: this.windowHandle });
                    console.log(chalk.yellow(`Switched to window with handle ${this.windowHandle}`));
                } catch (error) {
                    console.error(
                        chalk.red(`Failed to switch to window with handle ${this.windowHandle}: ${error.message}`)
                    );
                }
            }
        } else {
            console.error(chalk.red("No window handle is set."));
        }
    }

    // Updated $() method
    async $(selector) {
        await this.verifyHandle(); // Ensure the context/handle is verified

        try {
            // Evaluate the selector to get the element's objectId
            const {
                result: { objectId },
            } = await this.sendCommand('Runtime.evaluate', {
                expression: `document.querySelector('${selector}')`,
                returnByValue: false,
                awaitPromise: true,
            });

            if (!objectId) {
                throw new Error(`Element not found for selector: ${selector}`);
            }

            // Get the node information, including the frameId
            const { node } = await this.sendCommand('DOM.describeNode', {
                objectId,
            });

            if (!node.frameId) {
                throw new Error('Frame ID not found for the selected element.');
            }

            // Return an object that mimics Puppeteer's element handle
            return {
                // Expose the objectId for further operations if needed
                objectId,

                // Implement contentFrame() method to return a DCSPage instance for the iframe
                contentFrame: async () => {
                    const frameContextId = this.contextIdMap[node.frameId];

                    if (!frameContextId) {
                        throw new Error(`Execution context not found for frame ID: ${node.frameId}`);
                    }

                    // Create a new DCSPage instance for the iframe
                    const framePage = Object.create(this);
                    framePage.frame = true;
                    framePage.frameId = node.frameId;
                    framePage.contextId = frameContextId;

                    return framePage;
                },
            };
        } catch (error) {
            console.error(`$ Failed to find element ${selector}: ${error}`);
            throw error; // Throw error if finding element fails
        }
    }


    async getFrameId(objectId) {
        const { node } = await this.sendCommand("DOM.describeNode", { objectId });
        if (node && node.frameId) {
            return node.frameId;
        }
        throw new Error(`No frameId found for objectId: ${objectId}`);
    }

    async reload() {
        await this.sendCommand("Page.reload");
    }

    async setRequestInterception(urlPatterns, callback) {
        console.log("Setting up request interception...");
        await this.sendCommand("Network.enable");
        await this.sendCommand("Fetch.enable", {
            patterns: urlPatterns.map((pattern) => ({ urlPattern: pattern })),
        });

        this.ws.on("message", async (data) => {
            const message = JSON.parse(data);
            if (message.method === "Fetch.requestPaused") {
                const { requestId, request } = message.params;
                const shouldBlock = urlPatterns.some((pattern) => request.url.includes(pattern));
                if (shouldBlock) {
                    console.log(`Blocking request: ${request.url}`);
                    await this.sendCommand("Fetch.failRequest", { requestId, errorReason: "Aborted" });
                    if (callback) callback();
                } else {
                    await this.sendCommand("Fetch.continueRequest", { requestId });
                }
            }
        });

        console.log("Request interception handler set.");
    }

    // Placeholder methods
    async setViewport() { }
    async setDefaultNavigationTimeout() { }
    async setDefaultTimeout() { }
}

module.exports = DCSPage;
