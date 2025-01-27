// server.js

const path = require('path');
const fs = require('fs-extra');
const fastify = require('fastify')({ logger: true });
const fastifyMultipart = require('fastify-multipart');

// Load configuration
const configPath = path.join(__dirname, 'config.json');
let config = { allowedKeys: [] };

try {
    const configData = fs.readFileSync(configPath, 'utf-8');
    config = JSON.parse(configData);
} catch (err) {
    fastify.log.error('Error reading config.json:', err);
    process.exit(1);
}

// Register multipart plugin
fastify.register(fastifyMultipart, {
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB
    }
});

// Route to verify application key
fastify.post('/verify', async (request, reply) => {
    const { appKey } = request.body;

    if (!appKey) {
        return reply.status(400).send({ success: false, message: 'appKey is required.' });
    }

    if (config.allowedKeys.includes(appKey)) {
        return reply.send({ success: true, message: 'Application key is valid.' });
    } else {
        return reply.status(403).send({ success: false, message: 'Invalid application key.' });
    }
});

// Route to upload logs and adapter information
fastify.post('/upload', async (request, reply) => {
    const parts = await request.parts();
    let appKey = null;
    let host = null;
    let logFile;
    let adapterFile;

    for await (const part of parts) {
        if (part.type === 'field') {
            if (part.fieldname === 'appKey') {
                appKey = part.value;
            }
            if (part.fieldname === 'host') {
                host = part.value;
            }
        }

        if (part.type === 'file') {
            if (part.fieldname === 'log') {
                logFile = part;
            }
            if (part.fieldname === 'adapter') {
                adapterFile = part;
            }
        }
    }

    // Validate appKey and host
    if (!appKey || !host) {
        return reply.status(400).send({ success: false, message: 'appKey and host are required.' });
    }

    if (!config.allowedKeys.includes(appKey)) {
        return reply.status(403).send({ success: false, message: 'Invalid application key.' });
    }

    // Define directory path
    const dirPath = path.join(__dirname, 'data', appKey, host);

    try {
        await fs.ensureDir(dirPath);

        // Save log file
        if (logFile) {
            const logPath = path.join(dirPath, 'log.txt');
            const logStream = fs.createWriteStream(logPath);
            await logFile.file.pipe(logStream);
        }

        // Save adapter information as JSON
        if (adapterFile) {
            const adapterData = await adapterFile.toBuffer();
            const adapterPath = path.join(dirPath, 'adapter.json');
            await fs.writeFile(adapterPath, adapterData);
        }

        return reply.send({ success: true, message: 'Files uploaded successfully.' });
    } catch (err) {
        fastify.log.error('Error saving files:', err);
        return reply.status(500).send({ success: false, message: 'Internal Server Error.' });
    }
});

// Start the server
const start = async () => {
    try {
        await fastify.listen({ port: 3000 });
        fastify.log.info(`Server is running at http://localhost:3000`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
