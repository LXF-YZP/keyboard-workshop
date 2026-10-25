# 键帽文字回归样本

- `blurred-42.png`：2026-10-24 用户反馈截图；`blurred-42.json` 保存真实自动识别区域和人工逐键核对的文字，覆盖 I / O / J / L / V、Shift 与五种标点。
- `reference-42.json`：对应项目 `示例/参考键盘.png` 的真实自动识别区域。
- `blurred-current-42.json` / `reference-current-42.json`：两张截图完成分体校正后，“识别键帽文字”按当前键位实际产生的裁切区域，覆盖中心和尺寸与首次检测略有差异的情况。
- `reference-reloaded-41.json`：连续 PNG / TIFF 粘贴、重新识别并恢复工程后，实际补读的 41 个编号键；首键改为手工文字后不参加补读，覆盖 Ctrl 因亚像素采样差异而漏读的情况。
- `symbols.png` / `symbols.json`：19 个字母、数字、键名与 21 个纯图标，包含浅色、深色和旋转键帽；图标标准答案为空，防止为了提高召回率而误填图标。
- `GenerateSymbols.swift`：合成图的生成源文件。在临时目录编译运行会生成 `synth.png` / `synth-truth.json`；仓库保存固定 PNG，避免系统字体或 SF Symbols 版本变化影响现有样本。

标准答案只用于测试，不进入应用识别逻辑。识别器按图像笔画读取，不使用 QWERTY 排列或键位顺序推断文字。
