module.exports = {
    boot: async (common) => {
        await module.exports.MODEMstartProcess(common)
    },

    MODEMstartProcess: async (common) => {
        console.log('Boot process initiated');

        const args = process.argv.slice(2); // Get command-line arguments starting from the 3rd argument

        if (args.includes('resetall')) {
            console.log('Resetting all settings');
            await module.exports.resetAll(common, data);
            return;
        }

        if (args.includes('ip')) {
            const ipIndex = args.indexOf('ip') + 1;
            if (ipIndex > 0 && args[ipIndex]) {
                data.deviceip = args[ipIndex];
                console.log(`Using IP from command-line: ${data.deviceip}`);
            } else {
                console.error('No IP address provided after "ip" argument.');
                return;
            }
            console.log('Switching IP address');
            await module.exports.switchIP(common, data);
            return;
        }

        console.log('Default action: reboot');
        data.deviceip = '192.168.8.1'; // Default IP if no arguments are provided
        await module.exports.rebootDevice(common, data);
    },

    rebootDevice: async (common, data) => {
        let uniqueid = data.uniqueid
        try {
            let progress = await common.browser.browsersetup(uniqueid, false, data, common);

            if (!progress) {
                return false;
            }

            const startTime = Date.now();
            let pageworked = await common.browser.pagesetup(uniqueid, `http://${data.deviceip}`, common);
            const endTime = Date.now();
            const firstLoadTime = endTime - startTime;
            console.log(`page took ${firstLoadTime}ms to load`);

            if (!pageworked) {
                return false;
            }
            let page = common.browser.browsers[uniqueid].page;
            let cursor = common.browser.browsers[uniqueid].cursor;
            let browser = common.browser.browsers[uniqueid].browser;

            await page.setDefaultNavigationTimeout(10000);
            await page.setDefaultTimeout(5000);

            let output = await module.exports.login(page, 'admin', 'admin')

            if (output === 'cancelop') {
                await common.browser.shutdownpage(uniqueid, false, common);
                await browser.close()
                return
            }


            await page.goto(`http://${data.deviceip}/html/reboot.html`)
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await page.waitForSelector('#reboot_apply_button')
            await page.click('#reboot_apply_button')
            await page.waitForSelector('#pop_confirm')
            await page.click('#pop_confirm')
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await common.browser.shutdownpage(uniqueid, false, common);
        } catch (error) {
            console.error(error)
        }
        try {
            await common.browser.browsers[uniqueid].browser.close()
        } catch (error) {

        }

    },

    login: async (page, username, password) => {
        await new Promise((resolve) => setTimeout(resolve, 2000));

        //Detect if it needs setup procedure
        let logging = await page.evaluate(() => {
            let text = document.querySelector('#logout_span').textContent
            return text.includes('In') || text.includes('Out')
        })

        let setupnew
        if (logging) {

            try {
                await page.waitForSelector('#initial_configuration_tips')
                await page.type('#username', 'admin');
                await page.type('#password', 'admin');
                await page.click('#pop_login');
                await new Promise((resolve) => setTimeout(resolve, 3000));
                setupnew = true
            } catch (error) {

            }


            try {
                await page.waitForSelector('#step1_next')
                setupnew = true
            } catch (error) {

            }


            if (setupnew) {
                console.log('wizard started detected setting up..')
                await page.waitForSelector('#step1_next')
                await page.click('#step1_next');

                await page.waitForSelector('#manual_update')
                await page.click('#manual_update');

                await page.waitForSelector('#step2_next')
                await page.click('#step2_next');

                await page.waitForSelector('#current_password')
                await page.type('#current_password', 'admin');

                await page.type('#new_password', password);
                await page.type('#confirm_password', password);

                await page.click('#step_finish');

                console.log('waiting for device to complete setup.')
                await new Promise((resolve) => setTimeout(resolve, 20000));

            }

            let loggedOut = await page.evaluate(() => {
                let text = document.querySelector('#logout_span').textContent
                return text.includes('In')
            })
            if (loggedOut) {
                await page.waitForSelector('#logout_span')
                await page.click('#logout_span')
                await page.waitForSelector('#username');
                await page.type('#username', username);
                await page.type('#password', password);
                await page.click('#pop_login');
                try {
                    await page.waitForSelector('#psw_Cancel')
                    await page.click('#psw_Cancel')
                } catch (e) {
                    console.log('no popup')
                }
            }
        }

        try {
            let ipaddr = await page.url()
            if (ipaddr.includes('192.168.8.1')) {
                console.log('ip seems default. switching')

                await module.exports.disableWiFi(common, {}, page).catch((err) => {
                    console.log(err.message)
                })

                await module.exports.switchIP(common, {}, page).catch((err) => {
                    console.log(err.message)
                })

                return 'cancelop'

            }

        } catch (error) {
            console.log(error)
        }
    },

    disableWiFi: async (common, data, page = null) => {
        if (!page) {
            let uniqueid = 'huawei'
            let progress = await common.browser.browsersetup(uniqueid, false, data, common);
            console.log(progress)

            if (!progress) {
                return false;
            }

            const startTime = Date.now();
            let pageworked = await common.browser.pagesetup(uniqueid, "http://192.168.8.1/html/home.html", common);
            const endTime = Date.now();
            const firstLoadTime = endTime - startTime;
            console.log(`page took ${firstLoadTime}ms to load`);

            if (!pageworked) {
                return false;
            }
            let page = common.browser.browsers[uniqueid].page;
            let cursor = common.browser.browsers[uniqueid].cursor;
            let browser = common.browser.browsers[uniqueid].browser;

            await page.setDefaultNavigationTimeout(10000);
            await page.setDefaultTimeout(5000);
            await module.exports.login(page, 'admin', 'admin')
        }

        await page.goto('http://192.168.8.1/html/wlanbasicsettings.html')
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await page.waitForSelector('#wlan_turn_off')
        await page.click('#wlan_turn_off')
        await page.click('#apply_button')

        await new Promise((resolve) => setTimeout(resolve, 500));

        if (!page) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await common.browser.shutdownpage(uniqueid, false, common);
            await browser.close()
        }

    },

    switchIP: async (common, data, page = null) => {
        const { execSync } = require('child_process')

        if (!page) {
            let uniqueid = data.uniqueid
            let progress = await common.browser.browsersetup(uniqueid, false, data, common);
            console.log(progress)

            if (!progress) {
                return false;
            }

            const startTime = Date.now();
            let pageworked = await common.browser.pagesetup(uniqueid, "http://192.168.8.1/html/home.html", common);
            const endTime = Date.now();
            const firstLoadTime = endTime - startTime;
            console.log(`page took ${firstLoadTime}ms to load`);

            if (!pageworked) {
                return false;
            }
            let page = common.browser.browsers[uniqueid].page;
            let cursor = common.browser.browsers[uniqueid].cursor;
            let browser = common.browser.browsers[uniqueid].browser;

            await page.setDefaultNavigationTimeout(10000);
            await page.setDefaultTimeout(5000);
            await module.exports.login(page, 'admin', 'admin')
        }


        await page.goto('http://192.168.8.1/html/dhcp.html')
        await new Promise((resolve) => setTimeout(resolve, 5000));

        await page.waitForSelector('#input_dhcp_ipaddr_third')
        let validIP
        let list = []
        for (let i = 0; i < 100; i++) {
            let num
            num = Math.floor(Math.random() * (130 - 30 + 1) + 30);
            while (list.includes(num)) {
                num = Math.floor(Math.random() * (130 - 30 + 1) + 30);
            }
            let ip = `192.168.${num}.1`
            console.log(ip)
            try {
                execSync(`ping ${ip} -n 1`)
                list.push(num)
                console.log(list)
            } catch (e) {
                validIP = num
                break;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 5000));
        console.log('double checking...')
        try {
            execSync(`ping ${`192.168.${validIP}.1`} -n 1`)
            return false
        } catch (e) {
        }
        console.log(validIP)
        await page.evaluate(() => document.querySelector('#input_dhcp_ipaddr_third').value = '')
        await page.type('#input_dhcp_ipaddr_third', String(validIP))
        await new Promise((resolve) => setTimeout(resolve, 500));
        await page.click('#apply')
        await page.waitForSelector('#pop_confirm')
        await page.click('#pop_confirm')

        await new Promise((resolve) => setTimeout(resolve, 5000));

        if (!page) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await common.browser.shutdownpage(uniqueid, false, common);
            await browser.close()
        }

        try {
            if (!page) {
                await common.browser.browsers[uniqueid].browser.close()
            }
        } catch (error) {

        }

    }
}