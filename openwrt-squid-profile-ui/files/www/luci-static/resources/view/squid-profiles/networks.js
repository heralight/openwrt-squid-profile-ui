'use strict';
'require view';
'require form';
'require uci';
'require request';
'require ui';

function responseJson(res) {
    if (res && typeof res.json === 'function')
        return res.json();
    return (res || {}).json || {};
}

function callAction(action) {
    return request.get(L.url('admin/services/squid-profiles/' + action), { timeout: 30000 }).then(responseJson);
}

function notifyResult(title, data, level) {
    ui.addNotification(null, E('div', {}, [
        E('p', {}, [ title ]),
        data && data.output ? E('pre', { 'style': 'white-space:pre-wrap' }, [ data.output ]) : ''
    ]), level || 'info');
}

function listValue(value) {
    return Array.isArray(value) ? value : (value ? [ value ] : []);
}

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

function profileSummary(values) {
    values = listValue(values);
    return values.length ? values.join(', ') : _('None');
}

function virtualNetworkSection(cidr, vlan) {
    return 'net_' + String((cidr || '') + '_' + (vlan || '')).replace(/[^A-Za-z0-9_]/g, '_');
}

return view.extend({
    load: function() {
        return Promise.all([
            uci.load('squid_profiles'),
            uci.load('network').catch(function() { return null; })
        ]);
    },

    render: function() {
        var m = new form.Map(
            'squid_profiles',
            _('Squid Profiles - LAN/VLAN Mapping'),
            _('Map LAN/VLAN networks to profiles, then use the standard OpenWrt Save & Apply button to apply Squid changes.')
        );
        var profiles = [];
        var profileNamesById = {};
        var networks = [];
        var networksByKey = {};
        var networksBySection = {};

        function getNetwork(sectionId, createIfMissing) {
            var network = networksBySection[sectionId];
            if (!network && createIfMissing) {
                network = {
                    section: sectionId,
                    realSection: null,
                    cidr: '',
                    vlan: '',
                    description: '',
                    source: 'custom',
                    profiles: []
                };
                networksBySection[sectionId] = network;
                networks.push(network);
            }
            return network;
        }

        function ensureNetworkSection(network) {
            if (!network.realSection && network.section) {
                if (uci.get('squid_profiles', network.section, 'type') !== null ||
                    uci.get('squid_profiles', network.section, 'cidr') !== null ||
                    uci.get('squid_profiles', network.section, 'vlan') !== null ||
                    uci.get('squid_profiles', network.section, 'description') !== null ||
                    uci.get('squid_profiles', network.section, 'source') !== null ||
                    uci.get('squid_profiles', network.section, 'profile') !== null) {
                    network.realSection = network.section;
                }
            }
            if (!network.realSection)
                network.realSection = uci.add('squid_profiles', 'network');
            return network.realSection;
        }

        function syncNetwork(network) {
            var sectionId;

            if (!network)
                throw new Error(_('Unable to resolve this LAN/VLAN mapping.'));

            if (!network.realSection && network.source === 'system' && !listValue(network.profiles).length)
                return null;

            sectionId = network.realSection;
            if (!sectionId)
                sectionId = ensureNetworkSection(network);

            uci.set('squid_profiles', sectionId, 'cidr', network.cidr);
            uci.set('squid_profiles', sectionId, 'vlan', network.vlan);
            uci.set('squid_profiles', sectionId, 'description', network.description || '');
            uci.set('squid_profiles', sectionId, 'source', network.source || 'custom');
            uci.set('squid_profiles', sectionId, 'profile', listValue(network.profiles));
            return sectionId;
        }

        uci.sections('squid_profiles', 'profile', function(s) {
            var sectionId = s['.name'];
            var name = s.name || sectionId;
            if (name)
                profiles.push(name);
            if (sectionId)
                profileNamesById[sectionId] = name || sectionId;
        });

        uci.sections('squid_profiles', 'network', function(s) {
            var cidr = normalizeCidr(s.cidr || s.subnet || '') || (s.cidr || s.subnet || '');
            var vlan = s.vlan || '';
            var source = s.source || 'custom';
            var profilesList = listValue(s.profile);
            var sectionId;
            var network;

            if (cidr && cidr !== s.cidr)
                cidr = normalizeCidr(cidr) || cidr;
            if (!cidr || !vlan)
                return;
            if (!profilesList.length && source === 'system')
                return;

            sectionId = virtualNetworkSection(cidr, vlan);
            network = {
                section: sectionId,
                realSection: s['.name'],
                cidr: cidr,
                vlan: vlan,
                description: s.description || '',
                source: source,
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
            var network;

            if (!cidr || name === 'loopback' || networksByKey[key])
                return;

            sectionId = virtualNetworkSection(cidr, vlan);
            network = {
                section: sectionId,
                realSection: null,
                cidr: cidr,
                vlan: vlan,
                description: 'OpenWrt network ' + name,
                source: 'system',
                profiles: []
            };
            networksByKey[key] = network;
            networksBySection[sectionId] = network;
            networks.push(network);
        });

        var s = m.section(form.GridSection, 'network', _('LAN/VLAN mappings'));
        s.anonymous = true;
        s.addremove = true;
        s.nodescriptions = true;
        s.sectiontitle = function(sectionId) {
            var network = networksBySection[sectionId];
            if (!network)
                return sectionId;
            return network.vlan + (network.cidr ? ' - ' + network.cidr : '');
        };
        s.cfgsections = function() {
            return networks.map(function(network) {
                return network.section;
            }).filter(function(sectionId, idx, arr) {
                return sectionId && arr.indexOf(sectionId) === idx;
            });
        };

        var cidr = s.option(form.Value, 'cidr', _('IPv4 CIDR'));
        cidr.rmempty = false;
        cidr.datatype = 'cidr4';
        cidr.placeholder = '192.168.31.0/24';
        cidr.description = _('System OpenWrt networks are detected automatically; add only extra Squid coverage here.');
        cidr.cfgvalue = function(sectionId) {
            return (networksBySection[sectionId] || {}).cidr || '';
        };
        cidr.write = function(sectionId, value) {
            var network = getNetwork(sectionId, true);
            network.cidr = normalizeCidr(value) || String(value || '').trim();
            if (network.realSection || (network.source !== 'system' && network.cidr && network.vlan))
                syncNetwork(network);
        };

        var vlan = s.option(form.Value, 'vlan', _('VLAN/LAN'));
        vlan.rmempty = false;
        vlan.placeholder = 'LAN';
        vlan.description = _('Use the same label that appears in the main machine list.');
        vlan.cfgvalue = function(sectionId) {
            return (networksBySection[sectionId] || {}).vlan || '';
        };
        vlan.write = function(sectionId, value) {
            var network = getNetwork(sectionId, true);
            network.vlan = String(value || '').trim();
            if (network.realSection || (network.source !== 'system' && network.cidr && network.vlan))
                syncNetwork(network);
        };

        var description = s.option(form.Value, 'description', _('Description'));
        description.rmempty = true;
        description.description = _('Optional operator note.');
        description.cfgvalue = function(sectionId) {
            return (networksBySection[sectionId] || {}).description || '';
        };
        description.write = function(sectionId, value) {
            var network = getNetwork(sectionId, true);
            network.description = String(value || '').trim();
            if (network.realSection || (network.source !== 'system' && network.cidr && network.vlan))
                syncNetwork(network);
        };

        var source = s.option(form.DummyValue, 'source', _('Source'));
        source.cfgvalue = function(sectionId) {
            var network = networksBySection[sectionId];
            return network && network.source === 'system' ? _('OpenWrt') : _('Custom');
        };

        var profileView = s.option(form.DummyValue, '_profile_summary', _('Profiles'));
        profileView.cfgvalue = function(sectionId) {
            var network = networksBySection[sectionId];
            return profileSummary(listValue(network && network.profiles).map(function(value) {
                return profileNamesById[value] || value;
            }));
        };

        var assigned = s.option(form.MultiValue, 'profile', _('Profiles'));
        assigned.modalonly = true;
        assigned.multiple = true;
        assigned.size = Math.min(Math.max(profiles.length, 3), 8);
        assigned.description = _('Select profiles that apply to the whole LAN/VLAN network.');
        profiles.forEach(function(profile) { assigned.value(profile); });
        assigned.cfgvalue = function(sectionId) {
            var network = networksBySection[sectionId];
            return network ? listValue(network.profiles) : [];
        };
        assigned.write = function(sectionId, value) {
            var network = getNetwork(sectionId, true);
            var profilesList = listValue(value);

            network.profiles = profilesList;

            if (profilesList.length && (!network.cidr || !network.vlan))
                throw new Error(_('Set a CIDR and a VLAN/LAN label before assigning profiles.'));

            if (!profilesList.length) {
                if (network.realSection && network.source === 'system') {
                    uci.remove('squid_profiles', network.realSection);
                    network.realSection = null;
                }
                else if (network.realSection) {
                    uci.unset('squid_profiles', network.realSection, 'profile');
                    uci.set('squid_profiles', network.realSection, 'cidr', network.cidr);
                    uci.set('squid_profiles', network.realSection, 'vlan', network.vlan);
                    uci.set('squid_profiles', network.realSection, 'description', network.description || '');
                    uci.set('squid_profiles', network.realSection, 'source', network.source || 'custom');
                }
                return;
            }

            syncNetwork(network);
        };
        assigned.remove = function(sectionId) {
            var network = networksBySection[sectionId];
            if (!network)
                return;

            network.profiles = [];
            if (network.realSection && network.source === 'system') {
                uci.remove('squid_profiles', network.realSection);
                network.realSection = null;
                return;
            }

            if (network.realSection) {
                uci.unset('squid_profiles', network.realSection, 'profile');
                uci.set('squid_profiles', network.realSection, 'cidr', network.cidr);
                uci.set('squid_profiles', network.realSection, 'vlan', network.vlan);
                uci.set('squid_profiles', network.realSection, 'description', network.description || '');
                uci.set('squid_profiles', network.realSection, 'source', network.source || 'custom');
            }
        };

        var actions = m.section(form.NamedSection, 'core', 'globals', _('Actions'));
        actions.addremove = false;
        var validate = actions.option(form.Button, '_validate', _('Validate configuration'));
        validate.inputstyle = 'apply';
        validate.description = _('Run squid -k parse before applying LAN/VLAN mapping changes.');
        validate.onclick = function() {
            return m.save().then(function() { return callAction('parse'); }).then(function(data) {
                notifyResult(data.success ? _('Validation succeeded') : _('Validation failed'), data, data.success ? 'info' : 'error');
            });
        };

        return m.render();
    }
});
