'use strict';
'require view';
'require form';
'require rpc';
'require uci';
'require request';
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

function responseJson(res) {
    if (res && typeof res.json === 'function')
        return res.json();
    return (res || {}).json || {};
}

function callAction(action) {
    return request.get(L.url('admin/services/squid-profiles/' + action), { timeout: 30000 }).then(responseJson);
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
        data && data.output ? E('pre', { 'style': 'white-space:pre-wrap' }, [ data.output ]) : ''
    ]), level || 'info');
}

function profileSummary(values) {
    values = listValue(values);
    return values.length ? values.join(', ') : _('None');
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
            if (cidr && cidr !== s.cidr)
                uci.set('squid_profiles', s['.name'], 'cidr', cidr);
            if (!cidr || !vlan)
                return;
            networksByKey[cidr + '|' + vlan] = s['.name'];
            networks.push({
                section: s['.name'],
                cidr: cidr,
                vlan: vlan,
                description: s.description || '',
                source: s.source || 'custom',
                profiles: listValue(s.profile).map(function(value) { return profileNamesById[value] || value; })
            });
        });

        uci.sections('network', 'interface', function(s) {
            var name = s['.name'] || '';
            var cidr = interfaceCidr(s);
            var vlan = name.toUpperCase();
            var key = cidr + '|' + vlan;

            if (!cidr || name === 'loopback')
                return;

            if (!networksByKey[key]) {
                networks.push({
                    section: '',
                    cidr: cidr,
                    vlan: vlan,
                    description: 'OpenWrt network ' + name,
                    source: 'system',
                    profiles: []
                });
            }
        });

        uci.sections('squid_profiles', 'vm', function(s) {
            var ip = s.ip || s['.name'];
            var covered = networkForIp(ip, networks);
            if (!ip)
                return;
            deviceSectionsByIp[ip] = s['.name'];
            hostsByIp[ip] = {
                section: s['.name'],
                ip: ip,
                name: s.name || '',
                vlan: s.vlan || (covered ? covered.vlan : ''),
                covered: !!covered,
                profiles: listValue(s.profile).map(function(value) { return profileNamesById[value] || value; })
            };
        });

        try {
            var leases = Array.isArray(leasesData.dhcp_leases) ? leasesData.dhcp_leases : (Array.isArray(leasesData.leases) ? leasesData.leases : []);
            leases.forEach(function(lease) {
                var ip = lease.ipaddr || lease.ip || '';
                if (!ip)
                    return;
                var covered = networkForIp(ip, networks);
                var host = hostsByIp[ip];
                if (!host) {
                    host = {
                        section: null,
                        ip: ip,
                        name: lease.hostname || lease.name || '',
                        vlan: covered ? covered.vlan : '',
                        covered: !!covered,
                        profiles: []
                    };
                    hostsByIp[ip] = host;
                }
                if (!host.name)
                    host.name = lease.hostname || lease.name || '';
                if (covered) {
                    host.vlan = covered.vlan;
                    host.covered = true;
                }
                if (!host.section)
                    host.section = deviceSectionsByIp[ip] || uci.add('squid_profiles', 'vm');
                deviceSectionsByIp[ip] = host.section;
                uci.set('squid_profiles', host.section, 'type', 'vm');
                uci.set('squid_profiles', host.section, 'ip', ip);
                uci.set('squid_profiles', host.section, 'name', host.name || '');
                uci.set('squid_profiles', host.section, 'vlan', host.vlan || '');
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
        s.load = function() {
            hostList.forEach(function(host) {
                if (!host.section)
                    return;
                uci.set('squid_profiles', host.section, 'type', 'vm');
                uci.set('squid_profiles', host.section, 'ip', host.ip);
                uci.set('squid_profiles', host.section, 'name', host.name || '');
                uci.set('squid_profiles', host.section, 'vlan', host.vlan || '');
            });
            return Promise.resolve();
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
        assigned.modalonly = true;
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
            if (!host)
                throw new Error(_('Unable to resolve the mapping row for this device.'));
            if (!host.covered && listValue(value).length)
                ui.addNotification(null, E('p', {}, [ _('IP address is outside the networks covered by Squid; validation or apply will reject this mapping until LAN/VLAN coverage is fixed.') ]), 'warning');
            host.profiles = listValue(value);
            uci.set('squid_profiles', sectionId, 'profile', listValue(value));
        };
        assigned.remove = function(sectionId) { uci.unset('squid_profiles', sectionId, 'profile'); };

        var actions = m.section(form.NamedSection, 'core', 'globals', _('Actions'));
        actions.addremove = false;
        var validate = actions.option(form.Button, '_validate', _('Validate configuration'));
        validate.inputstyle = 'apply';
        validate.description = _('Run squid -k parse before saving anything.');
        validate.onclick = function() {
            return m.save().then(function() { return callAction('parse'); }).then(function(data) {
                notifyResult(data.success ? _('Validation succeeded') : _('Validation failed'), data, data.success ? 'info' : 'error');
            });
        };
        // var apply = actions.option(form.Button, '_apply', _('Apply'));
        // apply.inputstyle = 'save';
        // apply.description = _('Save UCI changes, validate Squid, then reconfigure Squid.');
        // apply.onclick = function() {
        //     return m.save().then(function() { return uci.commit('squid_profiles'); }).then(function() { return callAction('apply'); }).then(function(data) {
        //         notifyResult(data.success ? _('Configuration applied') : _('Apply failed'), data, data.success ? 'info' : 'error');
        //     });
        // };
        var help = actions.option(form.Button, '_help', _('Quick tip'));
        help.inputstyle = 'reset';
        help.description = _('OpenWrt networks appear automatically. Use LAN/VLAN mappings to assign profiles to a whole network.');
        help.onclick = function() {
            ui.addNotification(null, E('p', {}, [
                _('Edit a device row for per-IP profiles, or edit a LAN/VLAN row for profiles inherited by the whole network.')
            ]), 'info');
            return Promise.resolve();
        };

        return m.render();
    }
});
