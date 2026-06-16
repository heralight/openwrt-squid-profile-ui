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

const acl = fs.readFileSync(path.join(root, jsonFiles[1]), 'utf8');
if (!acl.includes('"/usr/libexec/squid-profiles": [ "exec" ]')) fail('ACL does not allow rpcd file.exec for helper');
if (!acl.includes('"file": [ "exec" ]')) fail('ACL does not allow ubus file.exec');
if (acl.includes('"command"')) fail('ACL still uses unsupported command key');

for (const file of jsFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  new Function(source.replace(/require\('([^']+)'\)/g, '({})'));
  if (!source.includes("'require fs'")) fail(`${file} does not use LuCI fs.exec`);
  if (!source.includes("fs.exec('/usr/libexec/squid-profiles'")) fail(`${file} does not execute the helper through rpcd file.exec`);
  if (source.includes("L.url('admin/services/squid-profiles/")) fail(`${file} still calls legacy Lua controller endpoints`);
  if (!source.includes("callAction('validate')")) fail(`${file} does not expose helper validation`);
  if (!source.includes("callAction('apply')")) fail(`${file} does not expose helper apply`);
  if (!source.includes('squid_profiles service')) fail(`${file} does not show the service enabled indicator`);
  if (!source.includes('/usr/libexec/squid-profiles validate')) fail(`${file} does not label the validation command`);
}

const main = fs.readFileSync(path.join(root, jsFiles[0]), 'utf8');
if (!main.includes('localStorage')) fail('main view does not persist filter/sort state');
if (!main.includes('form.MultiValue')) fail('main view does not use multi-profile assignment');
if (!main.includes('outside the networks covered by Squid')) fail('main view does not reject uncovered IP assignment');

const profiles = fs.readFileSync(path.join(root, jsFiles[1]), 'utf8');
if (!profiles.includes('raw_rules')) fail('profiles view does not expose raw rule editing');
if (!profiles.includes('edit_mode')) fail('profiles view does not expose an exclusive edit mode');
if (!profiles.includes("uci.set('squid_profiles', sectionId, 'raw_rules'")) fail('profiles view does not persist full text rules as raw_rules');
if (!profiles.includes("uci.unset('squid_profiles', sectionId, 'allow_domain')")) fail('profiles view does not keep full text mode exclusive from allow lists');
if (!profiles.includes('Domain is both allowed and denied')) fail('profiles view does not check allow/deny conflicts');
if (!profiles.includes('leading dot')) fail('profiles view does not explain Squid wildcard syntax');
if (!profiles.includes('.example.com')) fail('profiles view does not reference the canonical Squid wildcard syntax');

console.log('js static checks passed');
