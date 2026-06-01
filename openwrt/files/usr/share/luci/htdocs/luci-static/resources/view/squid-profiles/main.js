/*
 * Squid profiles – main device assignment page
 *
 * This view renders a table of all known hosts (virtual machines) on the
 * network and allows the administrator to assign one or more Squid
 * profiles to each IP address. Hostname and VLAN information are
 * gathered automatically from the LuCI network host hints API and the
 * configured networks in the squid_profiles UCI file.  Any IP which is
 * outside of a defined subnet will be displayed but cannot be assigned
 * to a profile.  Changes made here are validated with `squid -k parse`
 * before being committed and a reconfigure is triggered on success.
 */

'use strict';

// Import LuCI modules
var view    = require('view');
var form    = require('form');
var uci     = require('uci');
var network = require('network');
var request = require('request');
var ui      = require('ui');
var dom     = require('dom');

/* Helper: Convert an IPv4 address into a 32‑bit integer. */
function ipToInt(ip) {
    var parts = ip.split('.').map(function(p) { return parseInt(p, 10); });
    return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/* Helper: Check if an IP is within a CIDR subnet. */
function ipInSubnet(ip, subnet) {
    if (!subnet)
        return false;
    var idx = subnet.indexOf('/');
    if (idx < 0)
        return false;
    var net = subnet.substring(0, idx);
    var prefix = parseInt(subnet.substring(idx + 1), 10);
    if (isNaN(prefix))
        return false;
    var ipInt   = ipToInt(ip);
    var netInt  = ipToInt(net);
    var mask    = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    return (ipInt & mask) === (netInt & mask);
}

/* Helper: Determine the VLAN ID for a given IP based on configured networks. */
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
        // Load UCI config and network host hints in parallel
        return Promise.all([
            uci.load('squid_profiles'),
            uci.load('network'),
            network.getHostHints()
        ]);
    },

    render: function(data) {
        var hostHints = data[2] || {};
        var self = this;

        // Build list of profiles
        var profileNames = [];
        uci.sections('squid_profiles', 'profile', function(section) {
            profileNames.push(section['.name']);
        });

        // Build list of network definitions
        var networks = [];
        uci.sections('squid_profiles', 'network', function(section) {
            networks.push({
                subnet: section.subnet,
                vlan: section.vlan
            });
        });

        // Prepare VM information map keyed by IP
        var vms = {};
        // Existing VM sections from UCI
        uci.sections('squid_profiles', 'vm', function(section) {
            var ip = section['.name'];
            vms[ip] = {
                ip: ip,
                name: section.name || '',
                vlan: section.vlan || getVlanForIP(ip, networks),
                profiles: Array.isArray(section.profile) ? section.profile : (section.profile ? [ section.profile ] : [])
            };
        });
        // Host hints (from DHCP, ARP, neighbor discovery)
        try {
            var hints = hostHints && hostHints.getAllHints ? hostHints.getAllHints() : hostHints;
            for (var mac in hints) {
                var hint = hints[mac];
                // Each hint may have one or more IPv4 addresses; only use IPv4
                (hint.ipv4 || []).forEach(function(ip) {
                    // If already present, update name if missing
                    if (vms[ip]) {
                        if (!vms[ip].name && hint.name)
                            vms[ip].name = hint.name;
                        return;
                    }
                    var vlan = getVlanForIP(ip, networks);
                    vms[ip] = {
                        ip: ip,
                        name: hint.name || '',
                        vlan: vlan,
                        profiles: []
                    };
                });
            }
        }
        catch (e) {
            // ignore host hint errors
        }

        // Convert vms map to array and sort by IP for stable ordering
        var vmList = Object.keys(vms).sort(function(a, b) {
            var ai = ipToInt(a);
            var bi = ipToInt(b);
            return ai < bi ? -1 : ai > bi ? 1 : 0;
        }).map(function(ip) { return vms[ip]; });

        // VLAN filter state stored in localStorage
        var filterKey = 'squid_profiles_vlan_filter';
        var selectedVlan = window.localStorage.getItem(filterKey) || '';

        // Create the form map
        var m = new form.Map('squid_profiles', _('Squid Profiles - Devices'), _('Assign Squid profiles to virtual machines by IP address.  Use the VLAN filter to limit the view to a specific network.  Only IPs falling within configured subnets can be assigned.  Changes are validated before being applied.'));

        // Insert VLAN filter above the table
        var filterContainer = E('div', { 'class': 'cbi-value' }, [
            E('label', { 'class': 'cbi-value-title', 'for': 'vlan_filter' }, [ _('Filter by VLAN') ]),
            E('div', { 'class': 'cbi-value-field' }, [
                (function() {
                    var select = E('select', { 'id': 'vlan_filter' }, [
                        E('option', { 'value': '' }, _('All'))
                    ].concat(networks.map(function(n) {
                        return E('option', { 'value': n.vlan, 'selected': n.vlan === selectedVlan }, [ n.vlan ]);
                    })));
                    select.addEventListener('change', function() {
                        selectedVlan = select.value;
                        // Persist selection
                        window.localStorage.setItem(filterKey, selectedVlan);
                        // Re-render form
                        self.render();
                    });
                    return select;
                })()
            ])
        ]);

        // Append filter container to map description area
        m.description = [ m.description, filterContainer ];

        // Create GridSection for VM assignments
        var s = m.section(form.GridSection, 'vm', _('Device Assignments'));
        s.nodescriptions = true;
        s.addremove = false;
        s.anonymous = true;

        // Filter out VMs based on current VLAN filter; override default row list
        s.load = function() {
            // Synchronize UCI sections with discovered hosts before rendering
            var promises = [];
            vmList.forEach(function(vm) {
                // Skip IPs outside of any defined subnet; they remain read‑only
                var covered = (vm.vlan && vm.vlan !== '');
                // Create or update UCI section for covered hosts
                if (covered) {
                    // Ensure vm section exists
                    var sec = null;
                    uci.sections('squid_profiles', 'vm', function(s) {
                        if (s['.name'] === vm.ip)
                            sec = s;
                    });
                    if (!sec) {
                        // Create new section with name equal to IP
                        uci.set('squid_profiles', vm.ip, 'type', 'vm');
                        uci.set('squid_profiles', vm.ip, 'vlan', vm.vlan);
                        if (vm.name)
                            uci.set('squid_profiles', vm.ip, 'name', vm.name);
                        if (vm.profiles.length)
                            uci.set('squid_profiles', vm.ip, 'profile', vm.profiles);
                    }
                    else {
                        // Update name and vlan if missing
                        if (!sec.name && vm.name)
                            uci.set('squid_profiles', vm.ip, 'name', vm.name);
                        if (!sec.vlan && vm.vlan)
                            uci.set('squid_profiles', vm.ip, 'vlan', vm.vlan);
                    }
                }
            });
            return Promise.resolve();
        };

        // Override list of displayed sections to account for VLAN filter and discovered hosts
        s.cfgsections = function() {
            var list = [];
            vmList.forEach(function(vm) {
                if (selectedVlan && vm.vlan !== selectedVlan)
                    return;
                list.push(vm.ip);
            });
            return list;
        };

        // Column: IP address (read‑only)
        var ipOpt = s.option(form.Value, '.name', _('IP Address'));
        ipOpt.editable = false;
        ipOpt.width = '20%';

        // Column: Hostname (read‑only)
        var nameOpt = s.option(form.Value, 'name', _('Hostname'));
        nameOpt.editable = false;
        nameOpt.width = '25%';

        // Column: VLAN (read‑only)
        var vlanOpt = s.option(form.Value, 'vlan', _('VLAN'));
        vlanOpt.editable = false;
        vlanOpt.width = '10%';

        // Column: Assigned profiles (multi‑select)
        var profOpt = s.option(form.MultiValue, 'profile', _('Profiles'));
        profOpt.multiple = true;
        profOpt.size = 5;
        profOpt.allow_duplicates = true;
        profOpt.modalonly = false;
        profileNames.forEach(function(p) {
            profOpt.value(p);
        });
        // Only allow editing when IP is covered by a network; else disable field
        profOpt.editable = true;
        profOpt.depends = function(section_id) {
            var vm = vms[section_id];
            return (vm && vm.vlan && vm.vlan !== '');
        };

        // Hook to enforce network coverage before saving assignment
        profOpt.write = function(section_id, value) {
            var vm = vms[section_id];
            if (!vm || !vm.vlan || vm.vlan === '') {
                // Do not write assignments for uncovered IPs
                return;
            }
            // Ensure list type
            if (!Array.isArray(value))
                value = value ? [ value ] : [];
            // Write list of profiles into UCI
            uci.set('squid_profiles', section_id, 'profile', value);
        };

        // Footer buttons: Validate and Apply
        s.renderMore = function() {
            var btns = E('div', { 'class': 'cbi-section-actions' }, [
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
            return btns;
        };

        // Define validate and apply helpers on view instance
        this._validateConfig = function(showToast) {
            // Save changes to UCI but do not commit yet
            return uci.save().then(function() {
                return request.get('/cgi-bin/luci/admin/services/squid-profiles/parse', {
                    timeout: 10000
                }).then(function(res) {
                    var status = res && res.status;
                    var data = (res || {}).json || {};
                    if (status === 200 && data.success) {
                        if (showToast)
                            ui.addNotification(null, E('p', {}, _('Squid configuration validated successfully.')), 'info');
                        return true;
                    }
                    var msg = data.message || _('Unknown error');
                    ui.addNotification(null, E('p', {}, [_('Validation failed: '), msg]), 'error');
                    return false;
                }).catch(function(err) {
                    ui.addNotification(null, E('p', {}, _('Validation request failed.')), 'error');
                    return false;
                });
            });
        };

        this._applyConfig = function() {
            var self = this;
            // First validate
            return self._validateConfig(false).then(function(ok) {
                if (!ok)
                    return;
                // Commit UCI changes
                return uci.save().then(function() {
                    return uci.commit('squid_profiles');
                }).then(function() {
                    // Reload Squid configuration
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