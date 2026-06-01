'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const jsonFiles = [
  'openwrt-squid-profile-ui/files/usr/share/luci/menu.d/luci-app-squid-profiles.json',
  'openwrt-squid-profile-ui/files/usr/share/rpcd/acl.d/luci-app-squid-profiles.json'
];
const jsFiles = [
  'openwrt-squid-profile-ui/files/www/luci-static/resources/view/squid-profiles/main.js',
  'openwrt-squid-profile-ui/files/www/luci-static/resources/view/squid-profiles/profiles.js',
  'openwrt-squid-profile-ui/files/www/luci-static/resources/view/squid-profiles/networks.js'
];

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

for (const file of jsonFiles) {
  JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

for (const file of jsFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  new Function(source.replace(/require\('([^']+)'\)/g, '({})'));
}

const main = fs.readFileSync(path.join(root, jsFiles[0]), 'utf8');
if (!main.includes('localStorage')) fail('main view does not persist filter/sort state');
if (!main.includes('form.MultiValue')) fail('main view does not use multi-profile assignment');
if (!main.includes('outside the networks covered by Squid')) fail('main view does not reject uncovered IP assignment');

const profiles = fs.readFileSync(path.join(root, jsFiles[1]), 'utf8');
if (!profiles.includes('form.TextValue')) fail('profiles view does not expose full text editing');
if (!profiles.includes('Domain is both allowed and denied')) fail('profiles view does not check allow/deny conflicts');

console.log('js static checks passed');
