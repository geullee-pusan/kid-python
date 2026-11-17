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

// 연습 문제 묶음(단원마다 하나). 수업 대본과 같은 틀이라서 같은 방법으로 읽는다.
export const PRACTICE = Object.fromEntries(
  readdirSync(join(content, 'practice'))
    .map((file) => read('practice', file))
    .map((set) => [set.id, mergeScript(set, common)]),
);

/** 수업과 연습 문제 묶음을 한데 모은 것(문제를 돌려 보는 테스트에서 쓴다) */
export const SCRIPTS = { ...MISSIONS, ...PRACTICE };
