# Matting worker

为 SmartImage 工作台提供本地抠图推理。宿主（Go）不链接任何原生推理库；
本进程崩溃只影响当前批次。

## 构建

需要 Rust（MSVC 工具链）：

```powershell
pwsh -File scripts/build-matting-worker.ps1
pwsh -File scripts/fetch-matting-models.ps1
```

产物：`bin/matting-worker.exe` 与 `models/*.onnx`。ONNX Runtime 由 `ort`
的预编译二进制静态链接进 exe（首次构建会下载，需 x86-64 AVX2）。exe 依赖
Microsoft Visual C++ 2015–2022 x64 运行时（`MSVCP140.dll`、`VCRUNTIME140.dll`）；
Windows 10/11 通常已安装，安装包应一并提供 VC++ 运行库。DirectML.dll 由系统提供，
不会触发 GPU 推理。

## 协议

stdout 以 `SIM1\n` 开头，之后为小端帧：

- 请求：`u32 长度 + PNG 字节`；长度 0 表示退出。
- 响应：`u32 长度 + 状态字节 + 内容`
  - `0`：`u32 宽 + u32 高 + 宽*高*4 的 RGBA`（直通 alpha）
  - `1`：UTF-8 错误信息

日志写 stderr；宿主在启动失败或进程退出时展示其尾部。

## 模型

- `u2netp.onnx`（快速，~4.5 MB）
- `u2net.onnx`（精细，~168 MB）
- 来源：rembg releases；U2-Net 代码与权重为 Apache-2.0。
- 许可与架构决策见 `docs/adr/0008-matting-worker.md`。
