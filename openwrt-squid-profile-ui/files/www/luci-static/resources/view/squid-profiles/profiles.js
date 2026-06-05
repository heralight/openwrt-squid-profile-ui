'use strict';
'require view';
'require form';
'require uci';
'require request';
'require ui';

function splitText(value) {
    return String(value || '').split(/[\s,]+/).filter(function(item) { return item; });
}

function normalizeDomain(value) {
    value = String(value || '').trim();
    if (value.indexOf('*.') === 0)
        return '.' + value.slice(2);
    return value;
}

function normalizeDomainWithChange(value) {
    var input = String(value || '').trim();
    var normalized = normalizeDomain(input);
    return {
        value: normalized,
        changed: normalized !== input
    };
}

function isDomain(value) {
    value = normalizeDomain(value);
    if (!value || value.indexOf('*') >= 0 || value.indexOf('/') >= 0 || value.indexOf(' ') >= 0 || value.indexOf('..') >= 0)
        return false;
    if (value.charAt(0) === '.')
        value = value.slice(1);
    return /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(value);
}

function isDomainRule(value) {
    return isDomain(normalizeDomain(value));
}

function normalizeMode(value) {
    return value === 'text' ? 'text' : 'lists';
}

function listValue(value) {
    return Array.isArray(value) ? value : (value ? [ value ] : []);
}

function readListOption(sectionId, option) {
    return listValue(uci.get('squid_profiles', sectionId, option));
}

function joinRulesFromLists(allow, deny) {
    var lines = [];
    for (var i = 0; i < allow.length; i++)
        lines.push('allow ' + normalizeDomain(allow[i]));
    for (var j = 0; j < deny.length; j++)
        lines.push('deny ' + normalizeDomain(deny[j]));
    return lines.join('\n');
}

function parseRulesText(text) {
    var allow = [];
    var deny = [];
    var lines = String(text || '').split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
        var line = String(lines[i] || '').trim();
        var m;

        if (!line || line.charAt(0) === '#')
            continue;

        m = line.match(/^(allow|deny)\s+(.+)$/i);
        if (!m)
            return { error: _('Invalid rule syntax: ') + line };
        if (!isDomainRule(m[2].trim()))
            return { error: _('Invalid domain syntax: ') + m[2].trim() };

        if (m[1].toLowerCase() === 'allow')
            allow.push(normalizeDomain(m[2].trim()));
        else
            deny.push(normalizeDomain(m[2].trim()));
    }

    return { allow: allow, deny: deny };
}

function legacyTextRules(sectionId) {
    var allow = splitText(uci.get('squid_profiles', sectionId, 'allow_text'));
    var deny = splitText(uci.get('squid_profiles', sectionId, 'deny_text'));
    if (!allow.length && !deny.length)
        return '';
    return joinRulesFromLists(allow, deny);
}

function currentTextRules(sectionId) {
    var raw = String(uci.get('squid_profiles', sectionId, 'raw_rules') || '').trim();
    if (raw)
        return raw;

    raw = legacyTextRules(sectionId);
    if (raw)
        return raw;

    return joinRulesFromLists(readListOption(sectionId, 'allow_domain'), readListOption(sectionId, 'deny_domain'));
}

function currentRuleSet(sectionId) {
    var mode = normalizeMode(uci.get('squid_profiles', sectionId, 'edit_mode'));
    if (mode === 'text')
        return parseRulesText(currentTextRules(sectionId));

    return {
        allow: readListOption(sectionId, 'allow_domain'),
        deny: readListOption(sectionId, 'deny_domain')
    };
}

function responseJson(res) {
    if (res && typeof res.json === 'function') {
        try {
            return res.json();
        }
        catch (e) {
            return Promise.resolve({
                success: false,
                code: 500,
                message: e.message || String(e),
                output: res.responseText || ''
            });
        }
    }
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

function optionList(value) {
    return Array.isArray(value) ? value : (value ? [ value ] : []);
}

function collectDomainSet(sectionId) {
    return currentRuleSet(sectionId);
}

function modeField(section, sectionId) {
    return section && section.getOption ? section.getOption('edit_mode').getUIElement(sectionId) : null;
}

function listField(section, sectionId, option) {
    return section && section.getOption ? section.getOption(option).getUIElement(sectionId) : null;
}

function syncMode(section, sectionId, value) {
    var mode = normalizeMode(value);
    var allowField = listField(section, sectionId, 'allow_domain');
    var denyField = listField(section, sectionId, 'deny_domain');
    var rawField = section && section.getOption ? section.getOption('raw_rules').getUIElement(sectionId) : null;
    var legacyAllow = section && section.getOption ? section.getOption('allow_text').getUIElement(sectionId) : null;
    var legacyDeny = section && section.getOption ? section.getOption('deny_text').getUIElement(sectionId) : null;

    if (mode === 'text') {
        var lists = {
            allow: allowField ? listValue(allowField.getValue()) : readListOption(sectionId, 'allow_domain'),
            deny: denyField ? listValue(denyField.getValue()) : readListOption(sectionId, 'deny_domain')
        };
        var text = joinRulesFromLists(lists.allow, lists.deny);
        if (!text)
            text = currentTextRules(sectionId);
        if (rawField)
            rawField.setValue(text);
        uci.set('squid_profiles', sectionId, 'raw_rules', text);
        if (allowField)
            allowField.setValue([]);
        if (denyField)
            denyField.setValue([]);
        uci.unset('squid_profiles', sectionId, 'allow_domain');
        uci.unset('squid_profiles', sectionId, 'deny_domain');
        uci.unset('squid_profiles', sectionId, 'allow_text');
        uci.unset('squid_profiles', sectionId, 'deny_text');
    }
    else {
        var parsed = parseRulesText(rawField ? rawField.getValue() : currentTextRules(sectionId));
        if (parsed.error) {
            ui.addNotification(null, E('p', {}, [ parsed.error ]), 'error');
            return;
        }
        if (allowField)
            allowField.setValue(parsed.allow);
        if (denyField)
            denyField.setValue(parsed.deny);
        uci.set('squid_profiles', sectionId, 'allow_domain', parsed.allow);
        uci.set('squid_profiles', sectionId, 'deny_domain', parsed.deny);
        uci.unset('squid_profiles', sectionId, 'raw_rules');
        if (rawField)
            rawField.setValue('');
        if (legacyAllow)
            legacyAllow.setValue('');
        if (legacyDeny)
            legacyDeny.setValue('');
        uci.unset('squid_profiles', sectionId, 'allow_text');
        uci.unset('squid_profiles', sectionId, 'deny_text');
    }
}

function validateDomainSet(sectionId) {
    var data = collectDomainSet(sectionId);
    var allow = data.allow || [];
    var deny = data.deny || [];
    var seenAllow = {};
    var seenDeny = {};

    if (data.error)
        return data.error;

    for (var i = 0; i < allow.length; i++) {
        allow[i] = normalizeDomain(allow[i]);
        if (!isDomainRule(allow[i]))
            return _('Invalid domain syntax: ') + allow[i];
        if (seenAllow[allow[i]])
            return _('Duplicate allowed domain: ') + allow[i];
        seenAllow[allow[i]] = true;
    }

    for (var j = 0; j < deny.length; j++) {
        deny[j] = normalizeDomain(deny[j]);
        if (!isDomainRule(deny[j]))
            return _('Invalid domain syntax: ') + deny[j];
        if (seenDeny[deny[j]])
            return _('Duplicate denied domain: ') + deny[j];
        if (seenAllow[deny[j]])
            return _('Domain is both allowed and denied: ') + deny[j];
        seenDeny[deny[j]] = true;
    }

    return null;
}

return view.extend({
    load: function() {
        return uci.load('squid_profiles');
    },

    render: function() {
        var m = new form.Map(
            'squid_profiles',
            _('Squid Profiles - Profiles'),
            E('span', { style: 'white-space: pre-line' }, [
                _('Create and edit Squid profiles.'),
                '\n',
                _('Use the standard OpenWrt Save & Apply button to regenerate and reload Squid.'),
                  '\n',
                _("TIPS: Run 'squid -k parse' if trouble."),
            ])
        );

        var s = m.section(form.TypedSection, 'profile', _('Profiles'));
        s.anonymous = false;
        s.addremove = true;
        s.nodescriptions = true;
        s.sectiontitle = function(sectionId) {
            return uci.get('squid_profiles', sectionId, 'name') || sectionId;
        };

        var name = s.option(form.Value, 'name', _('Name'));
        name.rmempty = false;
        name.datatype = 'uciname';
        name.description = _('Short identifier used to build Squid profile files.');

        var description = s.option(form.Value, 'description', _('Description'));
        description.rmempty = true;
        description.description = _('Optional note for operators.');

        var editMode = s.option(form.ListValue, 'edit_mode', _('Editing mode'));
        editMode.value('lists', _('Lists'));
        editMode.value('text', _('Full text'));
        editMode.default = 'lists';
        editMode.rmempty = false;
        editMode.description = _(
            'Pick one source of truth for this profile.\n' +
            'Full text accepts one rule per line: allow .example.com or deny bad.example.com.\n' +
            'Wildcard is NOT *.domain.com but .domain.com.'
        );
        editMode.renderFrame = (function(orig) {
            return function(section_id, in_table, option_index, nodes) {
                var el = orig.call(this, section_id, in_table, option_index, nodes);
                var descr = el && el.querySelector ? el.querySelector('.cbi-value-description') : null;

                if (descr)
                    descr.style.whiteSpace = 'pre-line';

                return el;
            };
        })(editMode.renderFrame);
        editMode.onchange = function(ev, sectionId, value) {
            syncMode(s, sectionId, value || uci.get('squid_profiles', sectionId, 'edit_mode'));
        };

        var allow = s.option(form.DynamicList, 'allow_domain', _('Allowed domains'));
        allow.depends('edit_mode', 'lists');
        allow.cfgvalue = function(sectionId) {
            return currentRuleSet(sectionId).allow || [];
        };
        allow.validate = function(sectionId, value) { return !value || isDomainRule(value) ? true : _('Invalid domain syntax.'); };
        allow.description = _('Use .example.com for wildcard matches. One item per entry.');

        var deny = s.option(form.DynamicList, 'deny_domain', _('Denied domains'));
        deny.depends('edit_mode', 'lists');
        deny.cfgvalue = function(sectionId) {
            return currentRuleSet(sectionId).deny || [];
        };
        deny.validate = function(sectionId, value) { return !value || isDomainRule(value) ? true : _('Invalid domain syntax.'); };
        deny.description = _('Use .example.com for wildcard matches. One item per entry.');

        var rawRules = s.option(form.TextValue, 'raw_rules', _('Full text rules'));
        rawRules.depends('edit_mode', 'text');
        rawRules.rows = 10;
        rawRules.monospace = true;
        rawRules.placeholder = 'allow .example.com\ndeny bad.example.com';
        rawRules.description = _('One rule per line. The selected mode is exclusive.');
        rawRules.cfgvalue = function(sectionId) {
            return currentTextRules(sectionId);
        };
        rawRules.validate = function(sectionId, value) {
            var lines = String(value || '').split(/\r?\n/);
            for (var i = 0; i < lines.length; i++) {
                var line = String(lines[i] || '').trim();
                var m;
                if (!line || line.charAt(0) === '#')
                    continue;
                m = line.match(/^(allow|deny)\s+(.+)$/i);
                if (!m)
                    return _('Invalid rule syntax: ') + line;
                if (!isDomainRule(m[2].trim()))
                    return _('Invalid domain syntax: ') + m[2].trim();
            }
            return true;
        };

        // var syntaxHelp = s.option(form.Button, '_syntax_help', _('Fix Domain syntax'));
        // syntaxHelp.inputstyle = 'apply';
        // syntaxHelp.description = _('Squid WWwildcard domains use a leading dot, for example .example.com. Do not use *.example.com.');
        // syntaxHelp.onclick = function(sectionId) {
        //     var mode = normalizeMode(uci.get('squid_profiles', sectionId, 'edit_mode'));
        //     var allowField = s.getOption ? s.getOption('allow_domain').getUIElement(sectionId) : null;
        //     var denyField = s.getOption ? s.getOption('deny_domain').getUIElement(sectionId) : null;
        //     var rawField = s.getOption ? s.getOption('raw_rules').getUIElement(sectionId) : null;
        //     var allowTextField = s.getOption ? s.getOption('allow_text').getUIElement(sectionId) : null;
        //     var denyTextField = s.getOption ? s.getOption('deny_text').getUIElement(sectionId) : null;
        //     var changed = [];

        //     if (mode === 'text') {
        //         var lines = String(rawField ? rawField.getValue() : currentTextRules(sectionId) || '').split(/\r?\n/);
        //         var rewritten = lines.map(function(line) {
        //             var trimmed = String(line || '').trim();
        //             var match = trimmed.match(/^(allow|deny)\s+(.+)$/i);
        //             var domain, normalized;

        //             if (!match)
        //                 return line;

        //             domain = match[2].trim();
        //             normalized = normalizeDomainWithChange(domain);
        //             if (normalized.changed)
        //                 changed.push(domain + ' -> ' + normalized.value);

        //             return match[1].toLowerCase() + ' ' + normalized.value;
        //         }).join('\n');

        //         if (rawField)
        //             rawField.setValue(rewritten);
        //         uci.set('squid_profiles', sectionId, 'raw_rules', rewritten);
        //         uci.unset('squid_profiles', sectionId, 'allow_domain');
        //         uci.unset('squid_profiles', sectionId, 'deny_domain');
        //         if (allowTextField)
        //             allowTextField.setValue('');
        //         if (denyTextField)
        //             denyTextField.setValue('');
        //         uci.unset('squid_profiles', sectionId, 'allow_text');
        //         uci.unset('squid_profiles', sectionId, 'deny_text');
        //     }
        //     else {
        //         var allow = listValue(allowField ? allowField.getValue() : readListOption(sectionId, 'allow_domain'));
        //         var deny = listValue(denyField ? denyField.getValue() : readListOption(sectionId, 'deny_domain'));
        //         var normalizedAllow = [];
        //         var normalizedDeny = [];

        //         allow.forEach(function(item) {
        //             var normalized = normalizeDomainWithChange(item);
        //             normalizedAllow.push(normalized.value);
        //             if (normalized.changed)
        //                 changed.push(item + ' -> ' + normalized.value);
        //         });

        //         deny.forEach(function(item) {
        //             var normalized = normalizeDomainWithChange(item);
        //             normalizedDeny.push(normalized.value);
        //             if (normalized.changed)
        //                 changed.push(item + ' -> ' + normalized.value);
        //         });

        //         if (allowField)
        //             allowField.setValue(normalizedAllow);
        //         if (denyField)
        //             denyField.setValue(normalizedDeny);
        //         uci.set('squid_profiles', sectionId, 'allow_domain', normalizedAllow);
        //         uci.set('squid_profiles', sectionId, 'deny_domain', normalizedDeny);
        //         uci.unset('squid_profiles', sectionId, 'raw_rules');
        //         if (rawField)
        //             rawField.setValue('');
        //         uci.unset('squid_profiles', sectionId, 'allow_text');
        //         uci.unset('squid_profiles', sectionId, 'deny_text');
        //         if (allowTextField)
        //             allowTextField.setValue('');
        //         if (denyTextField)
        //             denyTextField.setValue('');
        //     }

        //     ui.addNotification(null, E('p', {}, [
        //         changed.length ? _('Converted wildcard domains to leading-dot syntax: %s').format(changed.join(', ')) : _('No wildcard domains needed conversion.')
        //     ]), 'info');
        //     return Promise.resolve();
        // };

        // var validateProfile = s.option(form.Button, '_validate_profile', _('Validate this profile'));
        // validateProfile.inputstyle = 'apply';
        // validateProfile.description = _('Run squid -k parse against the current profile mode. Save & Apply still performs the final Squid reload.');
        // validateProfile.onclick = function(sectionId) {
        //     var error = validateDomainSet(sectionId);
        //     if (error) {
        //         ui.addNotification(null, E('p', {}, [ error ]), 'error');
        //         return Promise.resolve();
        //     }
        //     return m.save().then(function() { return callAction('parse'); }).then(function(data) {
        //         notifyResult(data.success ? _('Profile validation succeeded') : _('Profile validation failed'), data, data.success ? 'info' : 'error');
        //     });
        // };

        return m.render();
    }
});
