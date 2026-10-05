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
  assert.ok(total <= 40 * MB, `los videos pesan ${(total / MB).toFixed(1)} MB`);
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

test('«Oportunidades» only for the accounts that see it in the menu', () => {
  assert.ok(!visibleTutorialVideos({ opportunities: false }).some(video => video.id === 'oportunidades'));
  assert.ok(visibleTutorialVideos({ opportunities: true }).some(video => video.id === 'oportunidades'));
});

test('lengths read as minutes and seconds', () => {
  assert.equal(formatVideoLength(65), '1:05');
  assert.equal(formatVideoLength(39.4), '0:39');
  assert.equal(formatVideoLength(120), '2:00');
});
