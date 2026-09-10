import assert from 'node:assert/strict';
import test from 'node:test';

import { generateMailFromStyle } from './ai/style-mail';
import { GRUPOEXPRO_REFERENCE_TEMPLATES } from './email-studio/grupoexpro-templates';
import {
  EmailStyleSelectionSchema,
  OUTSOURCING_EMAIL_STYLE_PRESETS,
  getOutsourcingEmailStylePresetFromSelection,
  outsourcingEmailStylePresetSelection,
  styleProfileFromOutsourcingEmailStylePreset,
} from './outsourcing-email-style-presets';

test('outsourcing email presets expose distinct frameworks with safe drafting rules', () => {
  assert.deepEqual(OUTSOURCING_EMAIL_STYLE_PRESETS.map((preset) => preset.id), ['pas', 'qvc', 'bab', 'aida']);
  assert.equal(new Set(OUTSOURCING_EMAIL_STYLE_PRESETS.map((preset) => preset.label)).size, 4);
  for (const preset of OUTSOURCING_EMAIL_STYLE_PRESETS) {
    assert.equal(preset.profile.constraints?.noFabrication, true);
    assert.equal(preset.profile.personalization?.useReportSignals, true);
    assert.match(preset.profile.instructions || '', /No mezcles|sin repetir/);
    assert.ok((preset.profile.cta?.label || '').length > 10);
    assert.match(preset.profile.bodyTemplate || '', /\{\{companyProfile\.valueProposition\}\}/);
  }
});

test('outsourcing email preset previews render complete subjects and bodies', () => {
  for (const preset of OUTSOURCING_EMAIL_STYLE_PRESETS) {
    const output = generateMailFromStyle({
      ...preset.profile,
      scope: 'leads',
      name: preset.label,
    }, {
      company: { name: 'Acme', domain: 'acme.example' },
      pains: ['trabajo manual'],
      valueProps: ['automatización'],
    }, {
      fullName: 'María González',
      email: 'maria@acme.example',
      companyName: 'Acme',
    }, {
      sender: {
        name: 'Grace Hopper',
        email: 'grace@northstar.example',
        company: 'Northstar',
      },
      companyProfile: {
        valueProposition: 'Reducimos carga operativa con servicios definidos en el perfil comercial.',
      },
    });

    assert.ok(output.subject.length > 3, `${preset.id} subject should not be empty`);
    assert.ok(output.body.includes('Hola María,'), `${preset.id} body should include the rendered greeting`);
    assert.ok(
      output.body.includes('Reducimos carga operativa con servicios definidos en el perfil comercial.'),
      `${preset.id} body should use the seller value proposition`,
    );
    assert.doesNotMatch(output.subject, /\{\{|\}\}/);
    assert.doesNotMatch(output.body, /\{\{|\}\}/);
  }
});

test('outsourcing email presets expose stable selectable ids', () => {
  for (const preset of OUTSOURCING_EMAIL_STYLE_PRESETS) {
    const selection = outsourcingEmailStylePresetSelection(preset.id);
    assert.equal(EmailStyleSelectionSchema.safeParse(selection).success, true);
    assert.equal(getOutsourcingEmailStylePresetFromSelection(selection)?.id, preset.id);
    assert.equal(styleProfileFromOutsourcingEmailStylePreset(preset, 'opportunities').presetId, preset.id);
  }
  assert.equal(EmailStyleSelectionSchema.safeParse('preset:not-a-preset').success, false);
  assert.equal(EmailStyleSelectionSchema.safeParse('not-a-uuid').success, false);
});

test('six service references are not globally selectable or implicitly approved', () => {
  assert.equal(GRUPOEXPRO_REFERENCE_TEMPLATES.length, 6);
  assert.equal(new Set(GRUPOEXPRO_REFERENCE_TEMPLATES.map((item) => item.id)).size, 6);
  for (const item of GRUPOEXPRO_REFERENCE_TEMPLATES) {
    assert.equal(item.status, 'editable-reference');
    assert.equal(EmailStyleSelectionSchema.safeParse(item.id).success, false);
    assert.equal(getOutsourcingEmailStylePresetFromSelection(`preset:${item.id}`), null);
    const copy = `${item.profile.subjectTemplate}\n${item.profile.bodyTemplate}`;
    assert.doesNotMatch(copy, /\d|garantiz|garantia|ley\s|sin costo|libre de responsabilidad|ranking|Workges/i);
    assert.equal((copy.match(/\?/g) || []).length, 1);
    assert.equal(item.profile.constraints.noFabrication, true);
    assert.doesNotMatch(copy, /explorar si|te escribo para|soluciones integrales|prioridades/i);
    assert.match(item.profile.instructions, /no autoriza capacidades/);
    assert.ok(item.profile.do.some((rule) => /sin repetir el inicial/.test(rule)));
  }
});

test('service references render the actual sender, not a hardcoded brand identity', () => {
  for (const item of GRUPOEXPRO_REFERENCE_TEMPLATES) {
    const preview = generateMailFromStyle(item.profile, null, { fullName: 'Ana Perez', companyName: 'Acme' }, {
      sender: { name: 'Pat', email: 'pat@example.test', company: 'Sender Org' },
    });
    assert.match(preview.subject, /Acme/);
    assert.match(preview.body, /Hola Ana/);
    assert.match(preview.body, /Pat/);
    assert.doesNotMatch(preview.body, /\{\{|\[\[|GrupoExpro/);
  }
});
