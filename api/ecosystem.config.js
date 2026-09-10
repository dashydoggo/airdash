export default {
  apps: [
    {
      name: "airdash-api",
      script: "src/server.js",
      cwd: "/opt/dashy-database/projects/airdash/api",
      env: {
        NODE_ENV: "production",
        PORT: "3006",
      },
    },
  ],
}
