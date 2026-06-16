'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require fs';
'require ui';

function ipToInt(ip) {
    var p = String(ip || '').split('.').map(function(v) { return parseInt(v, 10); });
    if (p.length !== 4 || p.some(function(v) { return isNaN(v) || v < 0 || v > 255; }))
        return null;
    return (((p[0] << 24) >>> 0) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function intToIp(value) {
    return [
        (value >>> 24) & 255,
        (value >>> 16) & 255,
        (value >>> 8) & 255,
        value & 255
    ].join('.');
}

function normalizeCidr(cidr) {
    var bits = String(cidr || '').split('/');
    var ipInt = ipToInt(bits[0]);
    var prefix = parseInt(bits[1], 10);
    var mask;

    if (ipInt === null || isNaN(prefix) || prefix < 0 || prefix > 32)
        return '';

    mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return intToIp((ipInt & mask) >>> 0) + '/' + prefix;
}

function ipInCidr(ip, cidr) {
    var bits = String(cidr || '').split('/');
    var ipInt = ipToInt(ip);
    var netInt = ipToInt(bits[0]);
    var prefix = parseInt(bits[1], 10);
    if (ipInt === null || netInt === null || isNaN(prefix) || prefix < 0 || prefix > 32)
        return false;
    var mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (netInt & mask);
}

function listValue(value) {
    return Array.isArray(value) ? value : (value ? [ value ] : []);
}

function maskToPrefix(mask) {
    var bits = '';
    var parts = String(mask || '').split('.');
    if (parts.length !== 4)
        return null;
    for (var i = 0; i < parts.length; i++) {
        var n = parseInt(parts[i], 10);
        if (isNaN(n) || n < 0 || n > 255)
            return null;
        bits += ('00000000' + n.toString(2)).slice(-8);
    }
    if (!/^1*0*$/.test(bits))
        return null;
    return bits.replace(/0/g, '').length;
}

function interfaceCidr(section) {
    var ipaddr = listValue(section.ipaddr)[0] || '';
    var netmask = listValue(section.netmask)[0] || '';
    var prefix;
    if (!ipaddr)
        return '';
    if (ipaddr.indexOf('/') > 0)
        return ipaddr;
    prefix = maskToPrefix(netmask);
    return prefix === null ? '' : normalizeCidr(ipaddr + '/' + prefix);
}

function networkForIp(ip, networks) {
    var match = null;
    var bestPrefix = -1;
    for (var i = 0; i < networks.length; i++) {
        var prefix = parseInt(String(networks[i].cidr || '').split('/')[1], 10);
        if (!isNaN(prefix) && prefix > bestPrefix && ipInCidr(ip, networks[i].cidr)) {
            match = networks[i];
            bestPrefix = prefix;
        }
    }
    return match;
}

function execResult(res) {
    var stdout = res && res.stdout ? res.stdout : '';
    var stderr = res && res.stderr ? res.stderr : '';
    var output = stdout && stderr ? stdout + '\n' + stderr : (stdout || stderr);
    var code = res && typeof res.code === 'number' ? res.code : 1;

    return {
        success: code === 0,
        code: code,
        message: output,
        output: output
    };
}

function callAction(action) {
    return fs.exec('/usr/libexec/squid-profiles', [ action ]).then(execResult).catch(function(e) {
        var message = e && e.message ? e.message : String(e);
        return {
            success: false,
            code: 1,
            message: message,
            output: message
        };
    });
}

var callDHCPLeases = rpc.declare({
    object: 'luci-rpc',
    method: 'getDHCPLeases',
    expect: { '': {} }
});

function loadLeases() {
    return Promise.race([
        callDHCPLeases().catch(function() { return {}; }),
        new Promise(function(resolve) {
            window.setTimeout(function() { resolve({}); }, 1500);
        })
    ]);
}

function notifyResult(title, data, level) {
    ui.addNotification(null, E('div', {}, [
        E('p', {}, [ title ]),
        data && (data.output || data.message) ? E('pre', { 'style': 'white-space:pre-wrap' }, [ data.output || data.message ]) : ''
    ]), level || 'info');
}

function isServiceEnabled() {
    return String(uci.get('squid_profiles', 'core', 'enabled') || '1') === '1';
}

function serviceBadge() {
    var enabled = isServiceEnabled();
    return E('span', {
        'style': [
            'display:inline-block',
            'min-width:7em',
            'padding:0.25em 0.6em',
            'border-radius:4px',
            'font-weight:600',
            'background:' + (enabled ? '#d7f0dd' : '#f4d2d2'),
            'color:' + (enabled ? '#135b26' : '#7a1d1d')
        ].join(';')
    }, [ enabled ? _('Enabled') : _('Disabled') ]);
}

function addActionSection(map) {
    var actions = map.section(form.NamedSection, 'core', 'globals', _('Actions'));
    actions.addremove = false;

    var status = actions.option(form.DummyValue, '_service_enabled', _('squid_profiles service'));
    status.cfgvalue = function() {
        return serviceBadge();
    };

    var validate = actions.option(form.Button, '_validate', _('Validate'));
    validate.inputstyle = 'apply';
    validate.description = _('/usr/libexec/squid-profiles validate');
    validate.onclick = function() {
        return map.save().then(function() {
            return callAction('validate');
        }).then(function(data) {
            notifyResult(data.success ? _('Validation succeeded') : _('Validation failed'), data, data.success ? 'info' : 'error');
        });
    };

    var apply = actions.option(form.Button, '_apply_squid', _('Apply Squid'));
    apply.inputstyle = 'apply';
    apply.description = _('/usr/libexec/squid-profiles apply');
    apply.onclick = function() {
        return map.save().then(function() {
            return callAction('apply');
        }).then(function(data) {
            notifyResult(data.success ? _('Squid apply succeeded') : _('Squid apply failed'), data, data.success ? 'info' : 'error');
        });
    };
}

function profileSummary(values) {
    values = listValue(values);
    return values.length ? values.join(', ') : _('None');
}

function virtualDeviceSection(ip) {
    return 'lease_' + String(ip || '').replace(/[^A-Za-z0-9_]/g, '_');
}

function virtualNetworkSection(cidr, vlan) {
    return 'net_' + String((cidr || '') + '_' + (vlan || '')).replace(/[^A-Za-z0-9_]/g, '_');
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('squid_profiles'),
            uci.load('network').catch(function() { return null; }),
            loadLeases()
        ]);
    },

    render: function(data) {
        var leasesData = data[2] || {};
        var filterKey = 'squid_profiles_vlan_filter';
        var sortKey = 'squid_profiles_sort';
        var selectedVlan = window.localStorage.getItem(filterKey) || '';
        var selectedSort = window.localStorage.getItem(sortKey) || 'ip';
        var profiles = [];
        var profileNamesById = {};
        var networks = [];
        var networksByKey = {};
        var networksBySection = {};
        var hostsByIp = {};
        var hostsBySection = {};
        var deviceSectionsByIp = {};

        uci.sections('squid_profiles', 'profile', function(s) {
            var sectionId = s['.name'];
            var name = s.name || s['.name'];
            if (name)
                profiles.push(name);
            if (sectionId)
                profileNamesById[sectionId] = name || sectionId;
        });

        uci.sections('squid_profiles', 'network', function(s) {
            var cidr = normalizeCidr(s.cidr || s.subnet || '') || (s.cidr || s.subnet || '');
            var vlan = s.vlan || '';
            var profilesList = listValue(s.profile);
            var sectionId;
            var network;

            if (cidr && cidr !== s.cidr)
                cidr = normalizeCidr(cidr) || cidr;
            if (!cidr || !vlan)
                return;
            if (!profilesList.length && (s.source || 'custom') === 'system')
                return;
            sectionId = virtualNetworkSection(cidr, vlan);
            network = {
                section: sectionId,
                realSection: s['.name'],
                cidr: cidr,
                vlan: vlan,
                description: s.description || '',
                source: s.source || 'custom',
                profiles: profilesList.map(function(value) { return profileNamesById[value] || value; })
            };
            networksByKey[cidr + '|' + vlan] = network;
            networksBySection[sectionId] = network;
            networks.push(network);
        });

        uci.sections('network', 'interface', function(s) {
            var name = s['.name'] || '';
            var cidr = interfaceCidr(s);
            var vlan = name.toUpperCase();
            var key = cidr + '|' + vlan;
            var sectionId;

            if (!cidr || name === 'loopback')
                return;

            if (!networksByKey[key]) {
                sectionId = virtualNetworkSection(cidr, vlan);
                networksByKey[key] = {
                    section: sectionId,
                    realSection: null,
                    cidr: cidr,
                    vlan: vlan,
                    description: 'OpenWrt network ' + name,
                    source: 'system',
                    profiles: []
                };
                networksBySection[sectionId] = networksByKey[key];
                networks.push(networksByKey[key]);
            }
        });

        uci.sections('squid_profiles', 'vm', function(s) {
            var profilesList = listValue(s.profile);
            var ip = s.ip || s['.name'];
            var sectionId;
            var covered = networkForIp(ip, networks);

            if (!profilesList.length)
                return;
            if (!ip)
                return;
            sectionId = virtualDeviceSection(ip);
            deviceSectionsByIp[ip] = s['.name'];
            hostsByIp[ip] = {
                section: sectionId,
                realSection: s['.name'],
                ip: ip,
                name: s.name || '',
                vlan: s.vlan || (covered ? covered.vlan : ''),
                covered: !!covered,
                profiles: profilesList.map(function(value) { return profileNamesById[value] || value; })
            };
            hostsBySection[sectionId] = hostsByIp[ip];
        });

        try {
            var leases = Array.isArray(leasesData.dhcp_leases) ? leasesData.dhcp_leases : (Array.isArray(leasesData.leases) ? leasesData.leases : []);
            leases.forEach(function(lease) {
                var ip = lease.ipaddr || lease.ip || '';
                var sectionId;
                if (!ip)
                    return;
                var covered = networkForIp(ip, networks);
                var host = hostsByIp[ip];
                if (!host) {
                    sectionId = virtualDeviceSection(ip);
                    host = {
                        section: sectionId,
                        realSection: null,
                        ip: ip,
                        name: lease.hostname || lease.name || '',
                        vlan: covered ? covered.vlan : '',
                        covered: !!covered,
                        profiles: []
                    };
                    hostsByIp[ip] = host;
                    hostsBySection[sectionId] = host;
                }
                if (!host.name)
                    host.name = lease.hostname || lease.name || '';
                if (covered) {
                    host.vlan = covered.vlan;
                    host.covered = true;
                }
                if (host.realSection)
                    deviceSectionsByIp[ip] = host.realSection;
            });
        }
        catch (e) {}

        var hostList = Object.keys(hostsByIp).map(function(ip) { return hostsByIp[ip]; }).filter(function(host) {
            return !selectedVlan || host.vlan === selectedVlan;
        });

        hostList.sort(function(a, b) {
            if (selectedSort === 'vlan')
                return String(a.vlan).localeCompare(String(b.vlan)) || ((ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0));
            if (selectedSort === 'name')
                return String(a.name).localeCompare(String(b.name)) || ((ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0));
            return (ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0);
        });
        hostList.forEach(function(host) { hostsBySection[host.section] = host; });

        var m = new form.Map('squid_profiles', _('Squid Profiles - Devices'), 
        _('Map devices to profiles, then use the standard OpenWrt Save & Apply button to apply Squid changes.')
       );

        var filter = m.section(form.NamedSection, 'core', 'globals', _('Filters'));
        filter.addremove = false;
        var vf = filter.option(form.ListValue, '_vlan_filter', _('Filter by VLAN/LAN'));
        var seenVlan = {};
        vf.value('', _('All'));
        networks.forEach(function(n) {
            if (!seenVlan[n.vlan]) {
                vf.value(n.vlan, n.vlan + ' - ' + n.cidr);
                seenVlan[n.vlan] = true;
            }
        });
        vf.load = function() { return selectedVlan; };
        vf.write = function(sectionId, value) { window.localStorage.setItem(filterKey, value || ''); };
        var sf = filter.option(form.ListValue, '_sort', _('Sort by'));
        sf.value('ip', _('IP address'));
        sf.value('vlan', _('VLAN/LAN'));
        sf.value('name', _('Hostname'));
        sf.load = function() { return selectedSort; };
        sf.write = function(sectionId, value) { window.localStorage.setItem(sortKey, value || 'ip'); };

        var s = m.section(form.GridSection, 'vm', _('Devices'));
        s.anonymous = true;
        s.addremove = false;
        s.nodescriptions = true;
        s.sectiontitle = function(sectionId) {
            var host = hostsBySection[sectionId];
            if (!host)
                return sectionId;
            return host.ip + (host.name ? ' - ' + host.name : '');
        };
        s.cfgsections = function() {
            return hostList.map(function(host) {
                return host.section;
            }).filter(function(sectionId, idx, arr) {
                return sectionId && arr.indexOf(sectionId) === idx;
            });
        };
        s.renderRowActions = function(sectionId) {
            return this.super('renderRowActions', [ sectionId ]);
        };

        var ip = s.option(form.DummyValue, '_ip', _('IP address'));
        ip.cfgvalue = function(sectionId) { return (hostsBySection[sectionId] || {}).ip || ''; };
        var name = s.option(form.Value, 'name', _('Hostname'));
        name.readonly = true;
        var vlan = s.option(form.Value, 'vlan', _('VLAN/LAN'));
        vlan.readonly = true;
        var status = s.option(form.DummyValue, '_coverage', _('Coverage'));
        status.cfgvalue = function(sectionId) { return (hostsBySection[sectionId] || {}).covered ? _('Covered') : _('Outside covered networks'); };
        var profileView = s.option(form.DummyValue, '_profile_summary', _('Profiles'));
        profileView.cfgvalue = function(sectionId) { return profileSummary((hostsBySection[sectionId] || {}).profiles); };

        var assigned = s.option(form.MultiValue, 'profile', _('Profiles'));
        assigned.modalonly = false;
        assigned.editable = true;
        assigned.multiple = true;
        assigned.size = Math.min(Math.max(profiles.length, 3), 8);
        assigned.description = _('Select zero, one or several profiles for this device.');
        profiles.forEach(function(profile) { assigned.value(profile); });
        assigned.cfgvalue = function(sectionId) {
            var host = hostsBySection[sectionId];
            return host ? listValue(host.profiles) : [];
        };
        assigned.write = function(sectionId, value) {
            var host = hostsBySection[sectionId];
            var profilesList = listValue(value);
            var realSection;

            if (!host)
                throw new Error(_('Unable to resolve the mapping row for this device.'));

            if (!host.covered && profilesList.length)
                ui.addNotification(null, E('p', {}, [ _('IP address is outside the networks covered by Squid; validation or apply will reject this mapping until LAN/VLAN coverage is fixed.') ]), 'warning');

            host.profiles = profilesList;
            realSection = host.realSection || deviceSectionsByIp[host.ip] || null;

            if (!profilesList.length) {
                if (realSection)
                    uci.remove('squid_profiles', realSection);
                host.realSection = null;
                delete deviceSectionsByIp[host.ip];
                return;
            }

            if (!realSection) {
                realSection = uci.add('squid_profiles', 'vm');
                host.realSection = realSection;
                deviceSectionsByIp[host.ip] = realSection;
            }

            uci.set('squid_profiles', realSection, 'type', 'vm');
            uci.set('squid_profiles', realSection, 'ip', host.ip);
            uci.set('squid_profiles', realSection, 'name', host.name || '');
            uci.set('squid_profiles', realSection, 'vlan', host.vlan || '');
            uci.set('squid_profiles', realSection, 'profile', profilesList);
        };
        assigned.remove = function(sectionId) {
            var host = hostsBySection[sectionId];
            if (host && host.realSection)
                uci.remove('squid_profiles', host.realSection);
            if (host) {
                host.realSection = null;
                host.profiles = [];
                delete deviceSectionsByIp[host.ip];
            }
        };

        // var actions = m.section(form.NamedSection, 'core', 'globals', _('Actions'));
        // actions.addremove = false;
        // var validate = actions.option(form.Button, '_validate', _('Validate configuration'));
        // validate.inputstyle = 'apply';
        // validate.description = _('Run squid -k parse before saving anything.');
        // validate.onclick = function() {
        //     return m.save().then(function() { return callAction('parse'); }).then(function(data) {
        //         notifyResult(data.success ? _('Validation succeeded') : _('Validation failed'), data, data.success ? 'info' : 'error');
        //     });
        // };

        addActionSection(m);

        return m.render();
    }
});
