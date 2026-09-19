# 锁文件的 resolved 必须指向官方源：从散文变成红线

## 问题

「`package-lock.json` 里 `resolved` 必须指向 `registry.npmjs.org`」这条规则**写在另一个仓库里**
（`dsh-zhihu-search` 的 `docs/PUBLISHING.md`，以散文前置条件的形式），所以本仓既没有它、
**也在违反它**：实测 129/131 条 `resolved` 指向 `registry.npmmirror.com`。

镜像锁文件的问题不在当下会不会红，而在它是**安静**的：CI 一直在绿，
它只是把供应链与可复现性置于风险中（`npm ci` 可能因镜像未同步而失败，或从非官方源取包）。

## 决策

两步，同一次改动：

1. **清理**：把 129 条 `resolved` 的 host 从 `registry.npmmirror.com` 换成 `registry.npmjs.org`。
   **不动 `version`、不动 `integrity`** —— 镜像是官方源的字节级副本，sha512 一致，所以这是纯改指。
   前提已核：`~\.npmrc` 的 registry **已经是官方源**、仓内没有 `.npmrc`，
   所以镜像是**旧锁文件的遗留**，改完不会自动变回来。
2. **落成断言**：`test/redlines.test.ts` 新增「锁文件」组 —— 读 `package-lock.json` 的
   `packages[*].resolved`，断言 http(s) 来源必须落在 `https://registry.npmjs.org/`，
   失败信息点出**是哪些包、指向了哪个 host**（否则又要人工翻一遍）。

## 替代方案

- **删掉 `package-lock.json` 与 `node_modules` 重装** —— 否。diff 更大，而且可能在 semver 区间内
  顺带升级一批 patch 版本，把"改源"变成"改依赖"。改指方案可以逐条核对 `integrity` 未变。
- **只清锁文件、不加断言** —— 否。这正是当初那条规则失效的形态：靠人记得。
  能落成校验的不写散文（见根文档的同一节）。
- **把规则写成 `npm config` 或 `.npmrc` 提交进仓** —— 否。`.npmrc` 会影响所有使用者的解析行为，
  而我们要管的是**本仓锁文件的内容**，不是使用者的网络。

## 影响

- 供应链与可复现性回到可核查状态：**改完 131/131 全部官方源**，`npm ci` 能装出来。
- 断言落地后，镜像再回来会当场红 —— 这次它会**响**。
- 同源另一仓 `dsh-zhihu-search` 本来就是 131/131 官方源，只需要补同一条断言。
