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

function networkForIp(ip, networks) {
    for (var i = 0; i < networks.length; i++)
        if (ipInCidr(ip, networks[i].cidr))
            return networks[i];
    return null;
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

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('squid_profiles'),
            loadLeases()
        ]);
    },

    render: function(data) {
        var leasesData = data[1] || {};
        var filterKey = 'squid_profiles_vlan_filter';
        var sortKey = 'squid_profiles_sort';
        var selectedVlan = window.localStorage.getItem(filterKey) || '';
        var selectedSort = window.localStorage.getItem(sortKey) || 'ip';
        var profiles = [];
        var profileNamesById = {};
        var profileIdsByName = {};
        var networks = [];
        var hostsByIp = {};
        var hostsBySection = {};

        uci.sections('squid_profiles', 'profile', function(s) {
            var sectionId = s['.name'];
            var name = s.name || s['.name'];
            if (name)
                profiles.push(name);
            if (sectionId)
                profileNamesById[sectionId] = name || sectionId;
            if (name)
                profileIdsByName[name] = sectionId;
        });

        uci.sections('squid_profiles', 'network', function(s) {
            networks.push({ cidr: s.cidr || s.subnet || '', vlan: s.vlan || '', description: s.description || '' });
        });

        uci.sections('squid_profiles', 'vm', function(s) {
            var ip = s.ip || s['.name'];
            if (!ip)
                return;
            hostsByIp[ip] = {
                section: s['.name'],
                ip: ip,
                name: s.name || '',
                vlan: s.vlan || '',
                covered: false,
                profiles: Array.isArray(s.profile) ? s.profile : (s.profile ? [ s.profile ] : [])
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
                if (!host.vlan && covered)
                    host.vlan = covered.vlan;
                if (!host.section)
                    host.section = uci.add('squid_profiles', 'vm');
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

        var m = new form.Map('squid_profiles', _('Squid Profiles - Mapping'), _('Detected devices, VLAN/LAN coverage and multi-profile Squid assignments.'));

        var filter = m.section(form.NamedSection, 'core', 'globals', _('View'));
        filter.addremove = false;
        var vf = filter.option(form.ListValue, '_vlan_filter', _('Filter by VLAN/LAN'));
        vf.value('', _('All'));
        networks.forEach(function(n) { vf.value(n.vlan, n.vlan + ' - ' + n.cidr); });
        vf.load = function() { return selectedVlan; };
        vf.write = function(sectionId, value) { window.localStorage.setItem(filterKey, value || ''); };
        var sf = filter.option(form.ListValue, '_sort', _('Sort by'));
        sf.value('ip', _('IP address'));
        sf.value('vlan', _('VLAN/LAN'));
        sf.value('name', _('Hostname'));
        sf.load = function() { return selectedSort; };
        sf.write = function(sectionId, value) { window.localStorage.setItem(sortKey, value || 'ip'); };

        var s = m.section(form.GridSection, 'vm', _('Mapping'));
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

        var assigned = s.option(form.MultiValue, 'profile', _('Profiles'));
        assigned.modalonly = false;
        assigned.multiple = true;
        assigned.size = Math.min(Math.max(profiles.length, 3), 8);
        profiles.forEach(function(profile) { assigned.value(profile); });
        assigned.cfgvalue = function(sectionId) {
            var host = hostsBySection[sectionId];
            var values = host ? (Array.isArray(host.profiles) ? host.profiles : []) : [];
            return values.map(function(value) {
                return profileNamesById[value] || value;
            });
        };
        assigned.write = function(sectionId, value) {
            var host = hostsBySection[sectionId];
            if (!host)
                throw new Error(_('Unable to resolve the mapping row for this device.'));
            if (!host.covered)
                throw new Error(_('IP address is outside the networks covered by Squid.'));
            uci.set('squid_profiles', sectionId, 'profile', (Array.isArray(value) ? value : (value ? [ value ] : [])).map(function(profile) {
                return profileIdsByName[profile] || profile;
            }));
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
        var apply = actions.option(form.Button, '_apply', _('Apply'));
        apply.inputstyle = 'save';
        apply.description = _('Validate then apply the current Squid profile configuration.');
        apply.onclick = function() {
            return m.save().then(function() { return uci.commit('squid_profiles'); }).then(function() { return callAction('apply'); }).then(function(data) {
                notifyResult(data.success ? _('Configuration applied') : _('Apply failed'), data, data.success ? 'info' : 'error');
            });
        };
        var help = actions.option(form.Button, '_help', _('Quick tip'));
        help.inputstyle = 'reset';
        help.description = _('Only covered IPs can receive profiles. Filter by VLAN to narrow the list.');
        help.onclick = function() {
            ui.addNotification(null, E('p', {}, [
                _('Select a covered network, then assign one or more profiles. Uncovered hosts stay read-only.')
            ]), 'info');
            return Promise.resolve();
        };

        return m.render();
    }
});
