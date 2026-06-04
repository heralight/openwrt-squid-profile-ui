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
        var networksByKey = {};

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
            if (cidr && cidr !== s.cidr)
                uci.set('squid_profiles', s['.name'], 'cidr', cidr);
            if (cidr && vlan)
                networksByKey[cidr + '|' + vlan] = s['.name'];
        });

        uci.sections('network', 'interface', function(s) {
            var name = s['.name'] || '';
            var cidr = interfaceCidr(s);
            var vlan = name.toUpperCase();
            var key = cidr + '|' + vlan;
            var sectionId;

            if (!cidr || name === 'loopback' || networksByKey[key])
                return;

            sectionId = uci.add('squid_profiles', 'network');
            uci.set('squid_profiles', sectionId, 'cidr', cidr);
            uci.set('squid_profiles', sectionId, 'vlan', vlan);
            uci.set('squid_profiles', sectionId, 'description', 'OpenWrt network ' + name);
            uci.set('squid_profiles', sectionId, 'source', 'system');
            networksByKey[key] = sectionId;
        });

        var s = m.section(form.GridSection, 'network', _('LAN/VLAN mappings'));
        s.anonymous = true;
        s.addremove = true;
        s.nodescriptions = true;
        s.sectiontitle = function(sectionId) {
            var cidr = uci.get('squid_profiles', sectionId, 'cidr') || '';
            var label = uci.get('squid_profiles', sectionId, 'vlan') || sectionId;
            return label + (cidr ? ' - ' + cidr : '');
        };

        var cidr = s.option(form.Value, 'cidr', _('IPv4 CIDR'));
        cidr.rmempty = false;
        cidr.datatype = 'cidr4';
        cidr.placeholder = '192.168.31.0/24';
        cidr.description = _('System OpenWrt networks are detected automatically; add only extra Squid coverage here.');

        var vlan = s.option(form.Value, 'vlan', _('VLAN/LAN'));
        vlan.rmempty = false;
        vlan.placeholder = 'LAN';
        vlan.description = _('Use the same label that appears in the main machine list.');

        var description = s.option(form.Value, 'description', _('Description'));
        description.rmempty = true;
        description.description = _('Optional operator note.');

        var source = s.option(form.DummyValue, 'source', _('Source'));
        source.cfgvalue = function(sectionId) {
            return uci.get('squid_profiles', sectionId, 'source') === 'system' ? _('OpenWrt') : _('Custom');
        };

        var profileView = s.option(form.DummyValue, '_profile_summary', _('Profiles'));
        profileView.cfgvalue = function(sectionId) {
            return profileSummary(listValue(uci.get('squid_profiles', sectionId, 'profile')).map(function(value) {
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
            var values = uci.get('squid_profiles', sectionId, 'profile');
            return listValue(values).map(function(value) {
                return profileNamesById[value] || value;
            });
        };
        assigned.write = function(sectionId, value) {
            uci.set('squid_profiles', sectionId, 'profile', listValue(value));
        };
        assigned.remove = function(sectionId) {
            uci.unset('squid_profiles', sectionId, 'profile');
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
        help.description = _('OpenWrt networks appear automatically. Add custom CIDRs only when Squid must cover an extra subnet.');
        help.onclick = function() {
            ui.addNotification(null, E('p', {}, [
                _('Assign profiles here to apply a policy to a whole LAN/VLAN. Use Devices for per-IP overrides.')
            ]), 'info');
            return Promise.resolve();
        };

        return m.render();
    }
});
