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

return view.extend({
    load: function() {
        return uci.load('squid_profiles');
    },

    render: function() {
        var m = new form.Map('squid_profiles', _('Squid Profiles - Networks'), _('Define IPv4 networks covered by Squid and their VLAN or LAN label.'));

        var s = m.section(form.GridSection, 'network', _('Covered networks'));
        s.anonymous = false;
        s.addremove = true;
        s.nodescriptions = true;

        var cidr = s.option(form.Value, 'cidr', _('IPv4 CIDR'));
        cidr.rmempty = false;
        cidr.datatype = 'cidr4';
        cidr.placeholder = '192.168.31.0/24';
        cidr.description = _('Enter the client subnet that Squid may cover.');

        var vlan = s.option(form.Value, 'vlan', _('VLAN/LAN'));
        vlan.rmempty = false;
        vlan.placeholder = 'VLAN 31';
        vlan.description = _('Use the same label that appears in the main machine list.');

        var description = s.option(form.Value, 'description', _('Description'));
        description.rmempty = true;
        description.description = _('Optional note for operators.');

        var actions = m.section(form.NamedSection, 'core', 'globals', _('Actions'));
        actions.addremove = false;
        var validate = actions.option(form.Button, '_validate', _('Validate configuration'));
        validate.inputstyle = 'apply';
        validate.description = _('Run squid -k parse before applying network changes.');
        validate.onclick = function() {
            return m.save().then(function() { return callAction('parse'); }).then(function(data) {
                notifyResult(data.success ? _('Validation succeeded') : _('Validation failed'), data, data.success ? 'info' : 'error');
            });
        };
        var apply = actions.option(form.Button, '_apply', _('Apply'));
        apply.inputstyle = 'save';
        apply.description = _('Validate then apply the current Squid network set.');
        apply.onclick = function() {
            return m.save().then(function() { return uci.commit('squid_profiles'); }).then(function() { return callAction('apply'); }).then(function(data) {
                notifyResult(data.success ? _('Configuration applied') : _('Apply failed'), data, data.success ? 'info' : 'error');
            });
        };
        var help = actions.option(form.Button, '_help', _('Quick tip'));
        help.inputstyle = 'reset';
        help.description = _('Match each CIDR to one VLAN/LAN label.');
        help.onclick = function() {
            ui.addNotification(null, E('p', {}, [
                _('Define one covered network per row. Hosts outside these CIDRs cannot receive Squid profiles.')
            ]), 'info');
            return Promise.resolve();
        };

        return m.render();
    }
});
