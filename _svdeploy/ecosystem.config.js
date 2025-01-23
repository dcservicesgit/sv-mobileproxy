module.exports = {
  apps: [{
    name: "Deploy Server",
    script: "server.js",    // The entry file to run
    cwd: "/home/deploy/deploy", // The working directory where server.js resides
    // Optionally add environment variables and other settings:
    env: {
      NODE_ENV: "production"
    }
  }]
};