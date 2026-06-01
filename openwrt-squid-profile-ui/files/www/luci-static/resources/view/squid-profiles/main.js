'use strict';

var view = require('view');
var form = require('form');
var uci = require('uci');
var network = require('network');
var request = require('request');
var ui = require('ui');

function ipToInt(ip) {
    var parts = String(ip || '').split('.').map(function(part) { return parseInt(part, 10); });
    if (parts.length !== 4 || parts.some(function(part) { return isNaN(part) || part < 0 || part > 255; }))
        return null;
    return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function ipInCidr(ip, cidr) {
    var ipInt = ipToInt(ip);
    var bits = String(cidr || '').split('/');
    var netInt = ipToInt(bits[0]);
    var prefix = parseInt(bits[1], 10);
    if (ipInt === null || netInt === null || isNaN(prefix) || prefix < 0 || prefix > 32)
        return false;
    var mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (netInt & mask);
}

function networkForIp(ip, networks) {
    for (var i = 0; i < networks.length; i++) {
        if (ipInCidr(ip, networks[i].cidr))
            return networks[i];
    }
    return null;
}

function notifyResult(title, data, level) {
    ui.addNotification(null, E('div', {}, [
        E('p', {}, [ title ]),
        data && data.output ? E('pre', { 'style': 'white-space:pre-wrap' }, [ data.output ]) : ''
    ]), level || 'info');
}

function callAction(action) {
    return request.get('/cgi-bin/luci/admin/services/squid-profiles/' + action, { timeout: 20000 }).then(function(res) {
        return (res || {}).json || {};
    });
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('squid_profiles'),
            network.getHostHints().catch(function() { return {}; })
        ]);
    },

    render: function(data) {
        var hostHints = data[1] || {};
        var filterKey = 'squid_profiles_vlan_filter';
        var sortKey = 'squid_profiles_sort';
        var selectedVlan = window.localStorage.getItem(filterKey) || '';
        var selectedSort = window.localStorage.getItem(sortKey) || 'ip';

        var profiles = [];
        uci.sections('squid_profiles', 'profile', function(section) {
            var name = section.name || section['.name'];
            if (name)
                profiles.push(name);
        });

        var coveredNetworks = [];
        uci.sections('squid_profiles', 'network', function(section) {
            coveredNetworks.push({
                cidr: section.cidr || section.subnet || '',
                vlan: section.vlan || '',
                description: section.description || ''
            });
        });

        var hosts = {};
        uci.sections('squid_profiles', 'vm', function(section) {
            var ip = section['.name'];
            var covered = networkForIp(ip, coveredNetworks);
            hosts[ip] = {
                ip: ip,
                name: section.name || '',
                vlan: section.vlan || (covered ? covered.vlan : ''),
                covered: !!covered,
                profiles: Array.isArray(section.profile) ? section.profile : (section.profile ? [ section.profile ] : [])
            };
        });

        try {
            var hints = hostHints.getAllHints ? hostHints.getAllHints() : hostHints;
            Object.keys(hints || {}).forEach(function(mac) {
                var hint = hints[mac] || {};
                (hint.ipv4 || []).forEach(function(ip) {
                    var covered = networkForIp(ip, coveredNetworks);
                    if (!hosts[ip]) {
                        hosts[ip] = {
                            ip: ip,
                            name: hint.name || '',
                            vlan: covered ? covered.vlan : '',
                            covered: !!covered,
                            profiles: []
                        };
                    }
                    else if (!hosts[ip].name && hint.name) {
                        hosts[ip].name = hint.name;
                    }
                });
            });
        }
        catch (e) {}

        var hostList = Object.keys(hosts).map(function(ip) { return hosts[ip]; }).filter(function(host) {
            return !selectedVlan || host.vlan === selectedVlan;
        });

        hostList.sort(function(a, b) {
            if (selectedSort === 'vlan')
                return String(a.vlan).localeCompare(String(b.vlan)) || ((ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0));
            if (selectedSort === 'name')
                return String(a.name).localeCompare(String(b.name)) || ((ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0));
            return (ipToInt(a.ip) || 0) - (ipToInt(b.ip) || 0);
        });

        var m = new form.Map('squid_profiles', _('Squid Profiles - Devices'), _('Detected machines, VLAN/LAN coverage and multi-profile Squid assignments.'));

        m.render = (function(render) {
            return function() {
                return render.apply(this, arguments).then(function(node) {
                    var filters = E('div', { 'class': 'cbi-section' }, [
                        E('div', { 'class': 'cbi-value' }, [
                            E('label', { 'class': 'cbi-value-title' }, [ _('Filter by VLAN/LAN') ]),
                            E('div', { 'class': 'cbi-value-field' }, [
                                E('select', { 'change': function(ev) { window.localStorage.setItem(filterKey, ev.target.value); location.reload(); } }, [
                                    E('option', { 'value': '', 'selected': selectedVlan === '' }, [ _('All') ])
                                ].concat(coveredNetworks.map(function(net) {
                                    return E('option', { 'value': net.vlan, 'selected': selectedVlan === net.vlan }, [ net.vlan + ' - ' + net.cidr ]);
                                })))
                            ])
                        ]),
                        E('div', { 'class': 'cbi-value' }, [
                            E('label', { 'class': 'cbi-value-title' }, [ _('Sort by') ]),
                            E('div', { 'class': 'cbi-value-field' }, [
                                E('select', { 'change': function(ev) { window.localStorage.setItem(sortKey, ev.target.value); location.reload(); } }, [
                                    E('option', { 'value': 'ip', 'selected': selectedSort === 'ip' }, [ _('IP address') ]),
                                    E('option', { 'value': 'vlan', 'selected': selectedSort === 'vlan' }, [ _('VLAN/LAN') ]),
                                    E('option', { 'value': 'name', 'selected': selectedSort === 'name' }, [ _('Hostname') ])
                                ])
                            ])
                        ])
                    ]);
                    node.insertBefore(filters, node.firstChild);
                    return node;
                });
            };
        })(m.render);

        var s = m.section(form.GridSection, 'vm', _('Machines'));
        s.anonymous = true;
        s.addremove = false;
        s.nodescriptions = true;
        s.cfgsections = function() { return hostList.map(function(host) { return host.ip; }); };
        s.load = function() {
            hostList.forEach(function(host) {
                if (!host.covered)
                    return;
                uci.set('squid_profiles', host.ip, 'type', 'vm');
                uci.set('squid_profiles', host.ip, 'name', host.name || '');
                uci.set('squid_profiles', host.ip, 'vlan', host.vlan || '');
            });
            return Promise.resolve();
        };

        var ip = s.option(form.DummyValue, '_ip', _('IP address'));
        ip.cfgvalue = function(sectionId) { return sectionId; };

        var name = s.option(form.Value, 'name', _('Hostname'));
        name.readonly = true;

        var vlan = s.option(form.Value, 'vlan', _('VLAN/LAN'));
        vlan.readonly = true;

        var status = s.option(form.DummyValue, '_coverage', _('Coverage'));
        status.cfgvalue = function(sectionId) {
            return hosts[sectionId] && hosts[sectionId].covered ? _('Covered') : _('Outside covered networks');
        };

        var assigned = s.option(form.MultiValue, 'profile', _('Profiles'));
        assigned.modalonly = false;
        assigned.multiple = true;
        assigned.size = Math.min(Math.max(profiles.length, 3), 8);
        profiles.forEach(function(profile) { assigned.value(profile); });
        assigned.write = function(sectionId, value) {
            var host = hosts[sectionId];
            if (!host || !host.covered)
                throw new Error(_('IP address is outside the networks covered by Squid.'));
            uci.set('squid_profiles', sectionId, 'profile', Array.isArray(value) ? value : (value ? [ value ] : []));
        };
        assigned.remove = function(sectionId) {
            uci.unset('squid_profiles', sectionId, 'profile');
        };

        var actions = m.section(form.NamedSection, 'core', 'globals', _('Actions'));
        actions.addremove = false;
        var validate = actions.option(form.Button, '_validate', _('Validate configuration'));
        validate.inputstyle = 'apply';
        validate.onclick = function() {
            return uci.save().then(function() { return callAction('parse'); }).then(function(data) {
                notifyResult(data.success ? _('Validation succeeded') : _('Validation failed'), data, data.success ? 'info' : 'error');
            });
        };
        var apply = actions.option(form.Button, '_apply', _('Apply'));
        apply.inputstyle = 'save';
        apply.onclick = function() {
            return uci.save().then(function() { return uci.commit('squid_profiles'); }).then(function() {
                return callAction('apply');
            }).then(function(data) {
                notifyResult(data.success ? _('Configuration applied') : _('Apply failed'), data, data.success ? 'info' : 'error');
            });
        };

        return m.render();
    }
});
