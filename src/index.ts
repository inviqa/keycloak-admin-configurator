import glob from "fast-glob";
import fs from "fs";
import KcAdmin from "keycloak-admin";
import url from "url";
import vm from "vm";
import waitPort from "wait-port";
require("axios-debug-log"); // used so DEBUG=axios will show request/response

import dsl from "./dsl";

const settings = {
  baseUrl: process.env.KEYCLOAK_INTERNAL_URL,
};

const auth = {
  username: process.env.KEYCLOAK_USER || "",
  password: process.env.KEYCLOAK_PASSWORD || "",
  grantType: "password",
  clientId: "admin-cli",
};

function keycloakHealthcheck(targetUrl) {
  const urlParams = url.parse(targetUrl);
  return waitPort({
    host: urlParams.hostname || undefined,
    port: parseInt(urlParams.port || "80", 10),
    timeout: 60000,
  });
}

(async (settings, auth) => {
  // Wait for Keycloak to be up and running
  await keycloakHealthcheck(settings.baseUrl);

  const adminClient = new KcAdmin(settings); // eslint-disable-line new-cap

  await adminClient.auth(auth);

  const files = await glob(["./realms/**/*.js"]);

  // A sandbox context that exposes special DSL
  const sandbox = vm.createContext({
    console,
    env: process.env,
    ...dsl(adminClient),
  });
  let script;

  // eslint-disable-next-line no-restricted-syntax
  for (const filename of files) {
    // Import script through VM rather than attach via a module
    script = new vm.Script(fs.readFileSync(filename, "utf-8"), { filename });

    // Load each file in the sandbox context, waiting for it's last statement to resolve.
    // Currently fully synchronous, due to dependency on order of files, but could
    // be more asynchronous with further work on stepping through directories.
    // eslint-disable-next-line no-await-in-loop
    await script.runInContext(sandbox, {
      displayErrors: true,
    });
  }
})(settings, auth);
