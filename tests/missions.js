// 테스트가 함께 쓰는 것: 수업 대본을 앱과 같은 방법으로 읽는다(common.json의 대사를 합친다).
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeScript } from '../src/core/lesson.js';

const content = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'content');
const read = (...parts) => JSON.parse(readFileSync(join(content, ...parts), 'utf8'));

const common = read('missions', 'common.json');

export const MISSIONS = Object.fromEntries(
  readdirSync(join(content, 'missions'))
    .filter((file) => file !== 'common.json')
    .map((file) => read('missions', file))
    .map((mission) => [mission.id, mergeScript(mission, common)]),
);

export const CURRICULUM = read('curriculum.json');
