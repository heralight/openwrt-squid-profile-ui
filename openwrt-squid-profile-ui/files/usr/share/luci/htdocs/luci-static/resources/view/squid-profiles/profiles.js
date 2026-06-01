/*
 * Squid profiles – profile management page
 *
 * This view provides editing facilities for individual Squid profiles.  A
 * profile consists of a descriptive comment and lists of allowed and
 * denied domains.  Machines (IP addresses) can be associated with one
 * or more profiles from this page.  When assigning machines, only
 * addresses within configured networks are permitted.  Changes are
 * validated with `squid -k parse` before being committed and Squid
 * reconfigured.
 */

'use strict';

var view    = require('view');
var form    = require('form');
var uci     = require('uci');
var network = require('network');
var request = require('request');
var ui      = require('ui');

/* Helper: Convert IPv4 to integer (same as in main.js) */
function ipToInt(ip) {
    var parts = ip.split('.').map(function(p) { return parseInt(p, 10); });
    return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/* Helper: Check if IP is within subnet */
function ipInSubnet(ip, subnet) {
    if (!subnet || subnet.indexOf('/') < 0)
        return false;
    var p = subnet.split('/');
    var net = p[0];
    var prefix = parseInt(p[1], 10);
    var ipInt  = ipToInt(ip);
    var netInt = ipToInt(net);
    var mask   = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    return (ipInt & mask) === (netInt & mask);
}

/* Helper: Determine VLAN for IP given network list */
function getVlanForIP(ip, networks) {
    for (var i = 0; i < networks.length; i++) {
        var n = networks[i];
        if (ipInSubnet(ip, n.subnet))
            return n.vlan || '';
    }
    return '';
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('squid_profiles'),
            uci.load('network'),
            network.getHostHints()
        ]);
    },

    render: function(data) {
        var hostHints = data[2] || {};
        var self = this;

        // Gather network definitions
        var networks = [];
        uci.sections('squid_profiles', 'network', function(section) {
            networks.push({
                subnet: section.subnet,
                vlan: section.vlan
            });
        });

        // Gather VM sections
        var vmMap = {};
        uci.sections('squid_profiles', 'vm', function(section) {
            var ip = section['.name'];
            var profiles = Array.isArray(section.profile) ? section.profile : (section.profile ? [ section.profile ] : []);
            vmMap[ip] = {
                ip: ip,
                name: section.name || '',
                vlan: section.vlan || getVlanForIP(ip, networks),
                profiles: profiles
            };
        });

        // Merge in host hints to populate names for unknown hosts
        try {
            var hints = hostHints && hostHints.getAllHints ? hostHints.getAllHints() : hostHints;
            for (var mac in hints) {
                var hint = hints[mac];
                (hint.ipv4 || []).forEach(function(ip) {
                    if (!vmMap[ip]) {
                        vmMap[ip] = {
                            ip: ip,
                            name: hint.name || '',
                            vlan: getVlanForIP(ip, networks),
                            profiles: []
                        };
                    }
                    else if (!vmMap[ip].name && hint.name) {
                        vmMap[ip].name = hint.name;
                    }
                });
            }
        } catch (e) {
            // ignore
        }

        // Build list of selectable IPs (only those within networks)
        var ipOptions = [];
        Object.keys(vmMap).forEach(function(ip) {
            var vm = vmMap[ip];
            // Only include IPs covered by a network
            if (vm.vlan && vm.vlan !== '') {
                ipOptions.push({
                    ip: ip,
                    label: ip + (vm.name ? ' (' + vm.name + ')' : '')
                });
            }
        });
        // Sort options by IP
        ipOptions.sort(function(a, b) {
            return ipToInt(a.ip) - ipToInt(b.ip);
        });

        var m = new form.Map('squid_profiles', _('Squid Profiles - Profiles'), _('Create and manage Squid profiles.  Each profile can allow or deny specific domains and be assigned to multiple machines.'));

        var s = m.section(form.TypedSection, 'profile', _('Profiles'));
        s.anonymous = false;
        s.addremove = true;
        s.nodescriptions = true;

        // Description/comment
        var cmt = s.option(form.Value, 'comment', _('Description'));
        cmt.placeholder = _('Short description');

        // Allowed domains
        var allow = s.option(form.DynamicList, 'allow_domain', _('Allowed domains'));
        allow.datatype = 'host';

        // Denied domains
        var deny = s.option(form.DynamicList, 'deny_domain', _('Denied domains'));
        deny.datatype = 'host';

        // Assigned machines (multi‑select); uses dummy uci option name so we can override load/write
        var ipOpt = s.option(form.MultiValue, 'assigned_ips', _('Assigned machines'));
        ipOpt.multiple = true;
        ipOpt.allow_duplicates = false;
        ipOpt.modalonly = false;
        ipOpt.size = 8;
        // Populate selectable values
        ipOptions.forEach(function(item) {
            ipOpt.value(item.ip, item.label);
        });

        // Load: return list of IPs currently assigned to this profile
        ipOpt.load = function(section_id) {
            var ips = [];
            Object.keys(vmMap).forEach(function(ip) {
                var vm = vmMap[ip];
                if (Array.isArray(vm.profiles) && vm.profiles.indexOf(section_id) >= 0)
                    ips.push(ip);
                else if (typeof vm.profiles === 'string' && vm.profiles === section_id)
                    ips.push(ip);
            });
            return ips;
        };

        // Write: update vmMap and UCI vm sections when assignments change
        ipOpt.write = function(section_id, value) {
            // value can be string or array
            var selected = Array.isArray(value) ? value.slice() : (value ? [ value ] : []);
            // Build a set for quick lookup
            var selSet = {};
            selected.forEach(function(ip) { selSet[ip] = true; });
            // Iterate through all known IPs
            Object.keys(vmMap).forEach(function(ip) {
                var vm = vmMap[ip];
                var profiles = Array.isArray(vm.profiles) ? vm.profiles.slice() : (vm.profiles ? [ vm.profiles ] : []);
                var idx = profiles.indexOf(section_id);
                var shouldHave = !!selSet[ip];
                if (shouldHave && idx < 0) {
                    profiles.push(section_id);
                }
                else if (!shouldHave && idx >= 0) {
                    profiles.splice(idx, 1);
                }
                // Ensure UCI section exists for covered IPs
                if (vm.vlan && vm.vlan !== '') {
                    uci.set('squid_profiles', ip, 'type', 'vm');
                    uci.set('squid_profiles', ip, 'vlan', vm.vlan);
                    if (vm.name)
                        uci.set('squid_profiles', ip, 'name', vm.name);
                    // Save updated profile list
                    uci.set('squid_profiles', ip, 'profile', profiles);
                    // Update map in memory
                    vm.profiles = profiles;
                }
            });
        };

        // Per‑profile action buttons: validate and apply this profile
        s.renderMore = function(section_id) {
            var selfSection = this;
            // Buttons container
            return E('div', { 'class': 'cbi-section-actions' }, [
                E('button', {
                    'class': 'cbi-button cbi-button-apply',
                    'click': function(ev) {
                        ev.preventDefault();
                        return self._validateConfig(true);
                    }
                }, [ _('Validate') ]),
                E('button', {
                    'class': 'cbi-button cbi-button-save',
                    'click': function(ev) {
                        ev.preventDefault();
                        return self._applyConfig();
                    }
                }, [ _('Apply') ])
            ]);
        };

        // Define global validate/apply on view
        this._validateConfig = function(showToast) {
            return uci.save().then(function() {
                return request.get('/cgi-bin/luci/admin/services/squid-profiles/parse', { timeout: 10000 });
            }).then(function(res) {
                var data = (res || {}).json || {};
                if (data.success) {
                    if (showToast)
                        ui.addNotification(null, E('p', {}, _('Squid configuration validated successfully.')), 'info');
                    return true;
                }
                ui.addNotification(null, E('p', {}, [_('Validation failed: '), data.message || _('Unknown error')]), 'error');
                return false;
            }).catch(function(err) {
                ui.addNotification(null, E('p', {}, _('Validation request failed.')), 'error');
                return false;
            });
        };

        this._applyConfig = function() {
            var self = this;
            return self._validateConfig(false).then(function(ok) {
                if (!ok)
                    return;
                return uci.save().then(function() {
                    return uci.commit('squid_profiles');
                }).then(function() {
                    return request.get('/cgi-bin/luci/admin/services/squid-profiles/reload', { timeout: 15000 });
                }).then(function(res) {
                    var data = (res || {}).json || {};
                    if (data.success) {
                        ui.addNotification(null, E('p', {}, _('Changes applied and Squid reloaded successfully.')), 'info');
                    }
                    else {
                        ui.addNotification(null, E('p', {}, [_('Failed to reload Squid: '), data.message || _('Unknown error')]), 'error');
                    }
                }).catch(function(err) {
                    ui.addNotification(null, E('p', {}, _('Failed to apply changes.')), 'error');
                });
            });
        };

        return m.render();
    }
});