import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { HELP_SECTIONS, visibleHelpSections } from './manual';
import { TUTORIAL_VIDEOS, formatVideoLength, tutorialVideoFiles, videoForPath, videosForSection, visibleTutorialVideos } from './tutorial-videos';

const MB = 1024 * 1024;

test('every video belongs to sections of the manual and has a unique id', () => {
  const sections = new Set(HELP_SECTIONS.map(section => section.id));
  assert.equal(new Set(TUTORIAL_VIDEOS.map(video => video.id)).size, TUTORIAL_VIDEOS.length);
  for (const video of TUTORIAL_VIDEOS) {
    assert.ok(video.sections.length > 0, video.id);
    for (const id of video.sections) assert.ok(sections.has(id), `${video.id} → ${id}`);
    assert.ok(video.seconds >= 30 && video.seconds <= 150, `${video.id} dura ${video.seconds} s`);
  }
});

test('the files of each video are in public/, small enough to serve as they are', () => {
  let total = 0;
  for (const video of TUTORIAL_VIDEOS) {
    for (const file of Object.values(tutorialVideoFiles(video))) {
      const local = path.join('public', file);
      assert.ok(existsSync(local), `falta ${local}`);
      if (file.endsWith('.mp4')) {
        const size = statSync(local).size;
        assert.ok(size <= 4 * MB, `${local} pesa ${(size / MB).toFixed(1)} MB`);
        total += size;
      }
    }
  }
  // 17 videos since 20 Oct 2026 («Contacto del día»; «Hoy» and «Informe semanal» grew with the goal and the alerts):
  // about 2,6 MB each, 44,8 MB in all.
  assert.ok(total <= 45 * MB, `los videos pesan ${(total / MB).toFixed(1)} MB`);
});

test('each screen finds its video: by its manual section, or by its route when it has none', () => {
  const sections = visibleHelpSections({ opportunities: true, admin: true });
  assert.equal(videoForPath('/crm', sections)?.id, 'pipeline');
  assert.equal(videoForPath('/saved/leads', sections)?.id, 'contactos');
  assert.equal(videoForPath('/leads/import', sections)?.id, 'importar');
  assert.equal(videoForPath('/cowork', sections)?.id, 'cowork');
  assert.equal(videoForPath('/settings/privacy', sections), null);
  assert.deepEqual(videosForSection('por-completar').map(video => video.id), ['contactos', 'importar']);
  assert.deepEqual(videosForSection('tabla').map(video => video.id), ['importar']);
});

test('«Oportunidades» and «Mercado público» only for the accounts that see Oportunidades in the menu', () => {
  for (const id of ['oportunidades', 'mercado-publico']) {
    assert.ok(!visibleTutorialVideos({ opportunities: false }).some(video => video.id === id), id);
    assert.ok(visibleTutorialVideos({ opportunities: true }).some(video => video.id === id), id);
  }
});

test('the new screens have their video: the weekly report, the companies of the Pipeline and Cowork', () => {
  const sections = visibleHelpSections({ opportunities: true, admin: true, cowork: true });
  assert.equal(videoForPath('/weekly-report', sections)?.id, 'informe-semanal');
  assert.deepEqual(videosForSection('pipeline').map(video => video.id), ['pipeline', 'empresas']);
  assert.deepEqual(videosForSection('oportunidades').map(video => video.id), ['oportunidades', 'mercado-publico']);
  assert.deepEqual(videosForSection('cowork').map(video => video.id), ['cowork']);
});

test('lengths read as minutes and seconds', () => {
  assert.equal(formatVideoLength(65), '1:05');
  assert.equal(formatVideoLength(39.4), '0:39');
  assert.equal(formatVideoLength(120), '2:00');
});
