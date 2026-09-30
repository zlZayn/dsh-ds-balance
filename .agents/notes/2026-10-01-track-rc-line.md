# 决策：承诺线从 alpha 换到 RC 线（dist-tag 是 `next`）（2026-10-01）

状态：生效

**取代**：[声明下限 vs 在跑版本](2026-10-01-declaration-floor-vs-running-version.md)
（那篇的结论「保 `>=0.1.7-alpha.1` 并为 token 写回落值」正是本文反转的对象；它自己也写了反转时机）

**类型**：决策记录（问题 / 事实 / 决策 / 替代方案 / 影响）。

## 问题

`engines.dsh` 与全部 23 条 `@deepseek-ai/dsh-*` 区间都写着 `>=0.1.7-alpha.1`，承诺的是 **alpha 线**。
而宿主实际上早已在 RC 线上跑，且 alpha 线的版本**低于我们声明的下限之上所依赖的能力**。
维护者裁定：**不再跟 alpha 线，转到 RC 线**，下限写 `>=0.2.0-rc.1`。

## 事实（本轮现查，不抄进文档）

1. **npm 上没有 `rc` 这个 dist-tag。** RC 版本全挂在 **`next`** 上。
   `@deepseek-ai/dsh` 的 `latest` 恰好与 `next` 同值，但那是巧合 —— 逐包看 `latest` 指向很旧的版本
   （多数 `0.0.1-rc.x`，个别甚至是 alpha 档）。所以「转 RC 线」= **把 `TRACKED_LINE` 改成 `next`**。
2. **换线前判据是全红的。** `node scripts/check-declaration.mjs --line next` 在旧声明下
   **24/24 全部罩不住** `0.2.0-rc.2`。原因是 npm 的预发布语义：
   **候选带预发布段时，只有区间里同一个 `major.minor.patch` 也带预发布段才允许匹配** ——
   `>=0.1.7-alpha.1` 的元组是 `(0,1,7)`，候选 `(0,2,0)`，不匹配。
   实测该区间只回 `0.1.7-alpha.1 / alpha.2 / rc.1 / rc.2`，确实不含 `0.2.0-rc.2`。
3. **RC 线的依赖树多了两个我们没声明的包**：`dsh-client-connection@0.2.0-rc.2` 把
   `@deepseek-ai/dsh-scope` 从 `^0.1.7-alpha.1` 收紧成**精确的 `0.2.0-rc.2`**，而 `dsh-scope` 又精确依赖
   `@deepseek-ai/dsh-invariants@0.2.0-rc.2`；`cordis` 的要求也从 `^4.0.3` 收紧成 `~4.0.4`（npm 上有 4.0.4）。
4. **换线时旧 `node_modules` 会挡住解析**：`npm install` 直接 ERESOLVE（"Found: …@0.1.7-alpha.1"）——
   npm 拿**现存的实际树**当起点，而那棵树里 `dsh-scope` / `dsh-invariants` 还是 alpha 档。
   把 `node_modules` 挪开再算锁就通过；换线属于整棵树搬家，**清掉旧树再装**是正常动作，不是绕过。

## 决策

1. `engines.dsh` 与全部 23 条 `@deepseek-ai/dsh-*` 区间 → **`>=0.2.0-rc.1`**（24 项同改）。
2. `scripts/check-declaration.mjs` 的 `TRACKED_LINE` → **`'next'`**（写线名，不写版本号）。
3. `compat.yml` 的矩阵 → **`line: [next]`**；**`alpha` 停测**。
4. README 让用户装的命令 → **`@next`**（中英各两处）。
5. **删掉那批为 alpha 线写的 token 回落值**（`--dsw-radius-*` / `--dsw-focus-ring-*`）。
6. 新增守卫：`test/redlines.test.ts` 断言 `TRACKED_LINE` 与 README 里让用户装的那条线**同名**。

## 替代方案（想过，为什么不选）

1. **下限写 `>=0.2.0-rc.2`（`next` 当前指向的那一版）。** 更保守，但维护者裁定用 `rc.1`
   —— 它是那条线的起点，且同一 `major.minor.patch` 内的后续预发布都罩得住（实测 `>=0.2.0-rc.1` 罩得住 `0.2.0-rc.2`）。
2. **下限写成能同时罩住 alpha 与 RC 的并集**（`>=0.1.7-alpha.1 <0.2.0 || >=0.2.0-rc.1`）。
   不选：那就等于**仍然承诺 alpha 线**，与「不再跟 alpha」矛盾；回落值也得继续留着。
3. **保留 token 回落值。** 不选：回落值服务的正是我们不再支持的 alpha 线；
   而红线已实测**官方在 RC 线上写的就是 token**（`var(--dsw-radius-md)`，不再是字面量），
   所以回落值在声明范围内**永远取不到** —— 是死代码。留着还会让「声明什么就支持什么」这句话变含糊。
4. **`alpha` 只记录、不阻断（两条线并存）。** 不选：换线后 `alpha` 低于我们的下限，
   测它等于测一个**装不上的宿主**；这与当初停 `next` 的理由同型，只是方向反过来。
5. **不换线，只把下限抬到某条 rc。** 不可行：npm 预发布语义下那是个**死区间** ——
   三条 dist-tag 没有一条指向它，用户无从安装，判据也无从校验。

## 影响

- 使用者侧的**可观察变化**：声明支持的最低宿主版本抬高，**alpha 线上的用户必须升级宿主**
  （README 已把安装命令从 `@alpha` 改成 `@next`）。这是定档时的关键事实。
- **同一条预发布语义的固有代价**：宿主换一个补丁位再推预发布（如 `0.2.1-rc.1`），
  这条下限会再次罩不住，届时要再抬一次。这不是这次选错形状，而是「跟预发布线」这件事本身的代价。
- 依赖树多了 `dsh-scope` / `dsh-invariants`（作为 `dsh-client-connection` 的 peer 被 npm 自动装上）。
- 判据从「罩住 alpha」变成「罩住 `next`」；`compat-swap.mjs check` 的对照列仍是三条线，
  只是承诺线那一列换了。
- 关联：[发布手册](../../docs/PUBLISHING.md#兼容性) · [架构](../../docs/ARCHITECTURE.md) ·
  [此前那篇（已取代）](2026-10-01-declaration-floor-vs-running-version.md)
