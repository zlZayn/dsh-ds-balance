# adapters/ — 规则层

继承根规则，见 [../../AGENTS.md](../../AGENTS.md)。

adapters/ 特有约束：

- 只实现 `src/ports/` 的接口；**不许把实现细节泄漏给上层**（上层只认端口类型）。
- 外部依赖一律可注入（`fetchImpl` / `now` / 存储句柄），否则测试就得打真网络。
- **超时不许用真实睡眠驱动测试**；用注入的取消信号与短超时。
- **凭据绝不进日志、绝不进错误消息。**
- 错误一律抛 `src/domain/errors.ts` 的类型，不抛裸 `Error`（`classify` 认不出来就落到 `STORAGE_ERROR`）。
