/**
 * 发布前检查。
 *
 * 开发期刻意从 package.json 去掉了 `dsh.bundle`：宿主在跑 `dsh plugin` 时会把
 * 任何声明它的已装包回填进 `dsh.profile.bundles`，与 patch 层的 insert 行形成
 * 双挂载。发布态必须把它加回来，否则装出来的包没有 bundle 层。
 *
 * 本脚本把「发布态该有什么」变成可执行断言，避免靠人记得。
 */

import { existsSync, readFileSync } from 'node:fs';

const failures = [];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

/** 断言一条发布态不变量。 */
function require_(label, ok, hint) {
  if (!ok) failures.push(`${label} —— ${hint}`);
}

require_(
  'dsh.bundle.patch',
  pkg.dsh?.bundle?.patch === './cordis.patch.yml',
  '开发期会去掉它以免被回填进 profile bundles；发布前必须加回。',
);
require_('private', pkg.private !== true, '发布前要移除 "private": true。');
require_('engines.dsh', typeof pkg.engines?.dsh === 'string', '宿主兼容范围必须声明。');
require_('files 含 cordis.patch.yml', Array.isArray(pkg.files) && pkg.files.includes('cordis.patch.yml'), 'bundle 层依赖它。');
require_('LICENSE 存在', existsSync('LICENSE'), 'package.json 声明 MIT，仓库里必须有对应文件。');

if (failures.length > 0) {
  console.error('release check failed:');
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('release check passed');
