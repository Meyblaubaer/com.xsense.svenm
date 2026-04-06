#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const cliHome =
  process.env.HOMEY_CLI_HOME ||
  '/Applications/ServBay/package/node/current/lib/node_modules/homey';

const localUrl = process.env.HOMEY_LOCAL_URL || process.argv[2];
if (!localUrl) {
  console.error('Missing Homey local URL.');
  console.error('Usage: HOMEY_LOCAL_URL=http://IP:PORT node scripts/homey-install-local.cjs');
  process.exit(1);
}

const settingsPath =
  process.env.HOMEY_SETTINGS ||
  path.join(process.env.HOME, '.athom-cli', 'settings.json');

let settings;
try {
  settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
} catch (err) {
  console.error(`Failed to read settings at ${settingsPath}: ${err.message}`);
  process.exit(1);
}

const homeyId = settings?.activeHomey?.id;
const homeyName = settings?.activeHomey?.name || 'Homey';
const tokenKey = homeyId ? `homey-${homeyId}` : null;
const token = tokenKey ? settings?.homeyApi?.[tokenKey]?.token : null;

if (!homeyId || !token) {
  console.error('Missing active Homey or local token in ~/.athom-cli/settings.json.');
  console.error('Run: homey login && homey select');
  process.exit(1);
}

const AppFactory = require(path.join(cliHome, 'lib', 'AppFactory.js'));
const App = require(path.join(cliHome, 'lib', 'App.js'));
const HomeyCompose = require(path.join(cliHome, 'lib', 'HomeyCompose.js'));
const fse = require(path.join(cliHome, 'node_modules', 'fs-extra'));
const HomeyAPIV3Local = require(path.join(cliHome, 'node_modules', 'homey-api'))
  .HomeyAPIV3Local;

async function preprocessVerbose(app, { skipDeps }) {
  if (App.hasHomeyCompose({ appPath: app.path }) === false) {
    App.getManifest({ appPath: app.path });
  }

  console.log('[1/4] Preprocess step: HomeyCompose.build start...');
  if (App.hasHomeyCompose({ appPath: app.path })) {
    const usesModules = App.usesModules({ appPath: app.path });
    await HomeyCompose.build({ appPath: app.path, usesModules });
  }
  console.log('[1/4] Preprocess step: HomeyCompose.build done.');

  console.log('[1/4] Preprocess step: remove .homeybuild start...');
  await fse.remove(app._homeyBuildPath).catch(async (err) => {
    if (err.code === 'ENOTEMPTY') {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return fse.remove(app._homeyBuildPath);
    }
    throw err;
  });
  console.log('[1/4] Preprocess step: remove .homeybuild done.');

  console.log('[1/4] Preprocess step: copy app source start...');
  await app._copyAppSourceFiles();
  console.log('[1/4] Preprocess step: copy app source done.');

  const copyAllNodeModules = process.env.HOMEY_COPY_NODE_MODULES === '1';
  if (skipDeps) {
    console.log('[1/4] Preprocess step: skip production dependencies.');
  } else {
    if (copyAllNodeModules) {
      console.log('[1/4] Preprocess step: copy full node_modules start...');
      const src = path.join(app.path, 'node_modules');
      const dest = path.join(app._homeyBuildPath, 'node_modules');
      await fse.ensureDir(dest);
      await fse.copy(src, dest, { dereference: true });
      // Overwrite homey module with CLI-provided version for compatibility.
      const homeyModulePath = path.join(cliHome, 'assets', 'homey');
      await fse.ensureDir(path.join(dest, 'homey'));
      await fse.emptyDir(path.join(dest, 'homey'));
      await fse.copy(homeyModulePath, path.join(dest, 'homey'));
      console.log('[1/4] Preprocess step: copy full node_modules done.');
    } else {
      console.log('[1/4] Preprocess step: copy production dependencies start...');
      await app._copyAppProductionDependencies();
      console.log('[1/4] Preprocess step: copy production dependencies done.');
    }
  }

  if (App.usesTypeScript({ appPath: app.path })) {
    console.log('[1/4] Preprocess step: TypeScript compile start...');
    await App.transpileToTypescript({ appPath: app.path });
    console.log('[1/4] Preprocess step: TypeScript compile done.');
  }

  const appJsonPath = path.join(app.path, 'app.json');
  try {
    const appJsonDataRaw = await fs.promises.readFile(appJsonPath, 'utf-8');
    const appJsonData = JSON.parse(appJsonDataRaw);
    if (appJsonData.esm === true) {
      const packageJsonPath = path.join(app.path, 'package.json');
      try {
        const packageJsonDataRaw = await fs.promises.readFile(packageJsonPath, 'utf-8');
        const packageJsonData = JSON.parse(packageJsonDataRaw);
        packageJsonData.type = 'module';
        await fs.promises.writeFile(
          path.join(app._homeyBuildPath, 'package.json'),
          JSON.stringify(packageJsonData, null, 2),
        );
      } catch (err) {
        console.error('Error reading the file', err);
      }
    }
  } catch (err) {
    console.error('Error reading the file', err);
  }

  const gitIgnorePath = path.join(app.path, '.gitignore');
  if (await fse.pathExists(gitIgnorePath)) {
    const gitIgnore = await fse.readFile(gitIgnorePath, 'utf8');
    if (!gitIgnore.includes('.homeybuild')) {
      await fse.writeFile(gitIgnorePath, `${gitIgnore}\n\n# Added by Homey CLI\n/.homeybuild/`);
    }
  }
}

async function main() {
  const app = AppFactory.getAppInstance(process.cwd());

  const homey = new HomeyAPIV3Local({
    properties: {
      id: homeyId,
      softwareVersion: '0.0.0',
      localUrl,
    },
    strategy: [],
    baseUrl: localUrl,
    token,
  });

  homey.name = homeyName;
  homey.model = 'shs';

  console.log('[1/4] Preprocess start...');
  const skipDeps = process.env.HOMEY_SKIP_DEPS === '1';
  const copyAllNodeModules = process.env.HOMEY_COPY_NODE_MODULES === '1';
  const verbosePreprocess =
    process.env.HOMEY_PREPROCESS_VERBOSE === '1' || copyAllNodeModules;
  if (skipDeps) {
    console.log('[1/4] Preprocess: skipping production dependency copy');
  }
  if (verbosePreprocess) {
    await preprocessVerbose(app, { skipDeps });
  } else {
    await app.preprocess({ copyAppProductionDependencies: !skipDeps });
  }
  console.log('[1/4] Preprocess done.');

  console.log('[2/4] Validate start...');
  await app.validate({ level: 'publish' });
  console.log('[2/4] Validate done.');

  console.log('[3/4] Pack start...');
  const appStream = await app._getPackStream({
    appPath: app._homeyBuildPath,
  });
  const env = await app._getEnv();
  console.log('[3/4] Pack done. Uploading...');

  await homey.devkit.runApp({
    app: appStream,
    env,
    debug: false,
    clean: true,
  });
  console.log('[4/4] Install done.');
}

main().catch((err) => {
  console.error(err?.stack || err);
  process.exit(1);
});
