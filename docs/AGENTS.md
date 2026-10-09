# docs/ — 规则层

继承根规则，见 [../AGENTS.md](../AGENTS.md)。

docs/ 特有约束：

- **本目录只放活文档**：描述现状、随代码改。改了对外行为，同一次改动内同步它。
  「为什么这么定」归 [.agents/notes/](../.agents/notes/README.md)（决策与依据），
  「当时出了什么事」归 [postmortem/](postmortem/README.md)。**别在本目录写理由** ——
  写指针。
- **唯一例外是 [postmortem/](postmortem/README.md)**：事故复盘是独立体裁、有独立双件，
  按它自己的规则维护（见该目录 `AGENTS.md`）。
- **活文档不抄会漂的值**：宿主版本范围、dist-tag 实际版本、测试数量一律写指针或现查命令。红线在 [../test/redlines.test.ts](../test/redlines.test.ts)。
- 一份事实一个 home：别的文档要讲同一件事时写指针，不重抄内容。
- 链接一律相对路径；**相对链接指不到文件时 `test/redlines.test.ts` 的「文档链接」会红**
  （`npm test` 里跑，不需要单独命令）。`docs/postmortem/` 与 `.agents/notes/` 不查 ——
  它们写死当时的事实、按规则不追改。
- 不写本机路径、端口、profile 名与用户名 —— 用占位符。
