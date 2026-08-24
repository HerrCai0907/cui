import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WEB_PORT = 5173;
const DEFAULT_API_PORT = 3000;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_STORE_PATH =
  process.env.CUI_STORE_PATH ?? resolve(PROJECT_ROOT, "prod/data/sessions.json");
const DEFAULT_LOG_DIR = process.env.CUI_LOG_DIR ?? resolve(PROJECT_ROOT, "prod/logs");

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
const apiCommand = [
  `PORT=${options.apiPort}`,
  `CUI_STORE_PATH=${shellQuote(resolveProjectPath(options.storePath))}`,
  `CUI_LOG_DIR=${shellQuote(resolveProjectPath(options.logDir))}`,
  "npm run start -w @cui/api",
].join(" ");

runAttached("npx", ["concurrently", "-n", "web,api", "-c", "blue,green", webCommand, apiCommand]);

function parseArgs(args) {
  const parsed = {
    apiPort: DEFAULT_API_PORT,
    help: false,
    logDir: DEFAULT_LOG_DIR,
    port: DEFAULT_WEB_PORT,
    storePath: DEFAULT_STORE_PATH,
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

    if (arg === "--store-path") {
      parsed.storePath = readPathValue(args, (index += 1), arg);
      continue;
    }

    if (arg.startsWith("--store-path=")) {
      parsed.storePath = parsePath(arg.slice("--store-path=".length), "--store-path");
      continue;
    }

    if (arg === "--log-dir") {
      parsed.logDir = readPathValue(args, (index += 1), arg);
      continue;
    }

    if (arg.startsWith("--log-dir=")) {
      parsed.logDir = parsePath(arg.slice("--log-dir=".length), "--log-dir");
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

function readPathValue(args, index, flag) {
  const value = args[index];

  if (!value) {
    fail(`Missing value for ${flag}`);
  }

  return parsePath(value, flag);
}

function parsePort(value, flag) {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    fail(`Invalid ${flag} value: ${value}`);
  }

  return port;
}

function parsePath(value, flag) {
  if (!value.trim()) {
    fail(`Invalid ${flag} value: ${value}`);
  }

  return value;
}

function resolveProjectPath(value) {
  return resolve(PROJECT_ROOT, value);
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
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
      --store-path <path>
                          API session store path. Default: ${DEFAULT_STORE_PATH}
      --log-dir <path>   API log directory. Default: ${DEFAULT_LOG_DIR}
  -h, --help             Show this help message
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
