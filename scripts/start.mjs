import { spawn } from "node:child_process";

const DEFAULT_WEB_PORT = 5173;
const DEFAULT_API_PORT = 3000;

const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (!Number.isInteger(options.port) || options.port <= 0) {
  fail(`Invalid --port value: ${options.port}`);
}

if (!Number.isInteger(options.apiPort) || options.apiPort <= 0) {
  fail(`Invalid --api-port value: ${options.apiPort}`);
}

const webCommand = [
  `CUI_API_PORT=${options.apiPort} npm run preview -w @cui/web --`,
  `--port ${options.port}`,
  "--strictPort",
].join(" ");
const apiCommand = `PORT=${options.apiPort} npm run start -w @cui/api`;

runAttached("npx", ["concurrently", "-n", "web,api", "-c", "blue,green", webCommand, apiCommand]);

function parseArgs(args) {
  const parsed = {
    apiPort: DEFAULT_API_PORT,
    help: false,
    port: DEFAULT_WEB_PORT,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    if (arg === "--port" || arg === "-p") {
      parsed.port = readPortValue(args, (index += 1), arg);
      continue;
    }

    if (arg.startsWith("--port=")) {
      parsed.port = parsePort(arg.slice("--port=".length), "--port");
      continue;
    }

    if (arg === "--api-port") {
      parsed.apiPort = readPortValue(args, (index += 1), arg);
      continue;
    }

    if (arg.startsWith("--api-port=")) {
      parsed.apiPort = parsePort(arg.slice("--api-port=".length), "--api-port");
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function readPortValue(args, index, flag) {
  const value = args[index];

  if (!value) {
    fail(`Missing value for ${flag}`);
  }

  return parsePort(value, flag);
}

function parsePort(value, flag) {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(`Invalid ${flag} value: ${value}`);
  }

  return port;
}

function runAttached(command, args) {
  const child = spawn(command, args, {
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function printHelp() {
  console.log(`Usage: npm run start -- [options]

Options:
  -p, --port <port>      Web app port. Default: ${DEFAULT_WEB_PORT}
      --api-port <port>  API server port. Default: ${DEFAULT_API_PORT}
  -h, --help             Show this help message
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
